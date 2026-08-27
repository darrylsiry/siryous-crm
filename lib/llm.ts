/**
 * Local open-weight model provider (Ollama on this Mac).
 *
 * The AI features do their thinking and writing here; the Claude Code CLI is
 * only used for steps that need external data (Gmail, Calendar, Zoom, Drive,
 * web search) and as an automatic fallback when the local model is unavailable
 * (see runModel in lib/ai.ts).
 *
 * Configuration: the Settings page (/settings, stored in the database) —
 * defaults come from env (e.g. .env.local — see .env.example):
 *   LOCAL_LLM_URL      Ollama base URL          default http://127.0.0.1:11434
 *   LOCAL_LLM_MODEL    model tag                default gemma4:26b
 *   LOCAL_LLM_NUM_CTX  context window (tokens)  default 32768
 *   LOCAL_LLM_TEMPERATURE                       default 0.3
 *   AI_PROVIDER        local | claude           default local
 *   AI_FALLBACK        claude | none            default claude
 */
import type { ProgressEvent } from "./ai";
import { getAiSettings, type Provider } from "./settings";

export type { Provider };

/** Ollama's view of a pulled model (subset of /api/tags). */
export interface OllamaModel {
  name: string;
  size: number;
  parameter_size: string | null;
  quantization: string | null;
  family: string | null;
  modified_at: string | null;
}

/** List the models Ollama has pulled. Throws if Ollama is unreachable. */
export async function listLocalModels(url = getAiSettings().ollamaUrl): Promise<OllamaModel[]> {
  const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Ollama answered ${res.status} at ${url}`);
  const body = (await res.json()) as {
    models?: { name: string; size?: number; modified_at?: string; details?: { parameter_size?: string; quantization_level?: string; family?: string } }[];
  };
  return (body.models ?? [])
    .map((m) => ({
      name: m.name,
      size: m.size ?? 0,
      parameter_size: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
      family: m.details?.family ?? null,
      modified_at: m.modified_at ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Why the local model can't run: Ollama itself is down, or the model isn't downloaded. */
export type LocalUnavailableKind = "down" | "model";

/** Thrown when Ollama itself is unreachable/misconfigured — the cases worth falling back on. */
export class LocalUnavailable extends Error {
  kind: LocalUnavailableKind;
  constructor(message: string, kind: LocalUnavailableKind = "down") {
    super(message);
    this.kind = kind;
  }
}

/**
 * The low-level code behind a failed fetch to Ollama (ECONNREFUSED when
 * nothing is listening, ENOTFOUND for a bad host, TimeoutError, …), or null.
 */
export function fetchErrorCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const cause = (err as Error & { cause?: { code?: string; name?: string } }).cause;
  if (cause?.code) return String(cause.code);
  if (err.name === "TimeoutError" || err.name === "AbortError") return "TIMEOUT";
  return cause?.name ?? null;
}

/** A short technical description of why Ollama couldn't be reached — used in "(Detail: …)" clauses. */
export function describeFetchError(err: unknown, url: string): string {
  const code = fetchErrorCode(err);
  if (code === "ECONNREFUSED") return `nothing is listening at ${url} (connection refused)`;
  if (code === "TIMEOUT") return `no answer from ${url} within 3 seconds`;
  const msg = err instanceof Error ? err.message : String(err);
  return `could not reach ${url}${code ? ` (${code})` : ""}: ${msg}`;
}

/** Does Ollama's list contain this model tag (with or without an explicit ":latest")? */
export function modelListed(names: string[], model: string): boolean {
  const wanted = model.includes(":") ? model : `${model}:latest`;
  return names.includes(wanted) || names.includes(model);
}

/** The plain-words message for a model that Ollama hasn't downloaded. */
export function modelNotPulledMessage(model: string): string {
  return `The AI model ${model} hasn't been downloaded yet — run \`ollama pull ${model}\` in Terminal, or choose a downloaded model in Settings.`;
}

/**
 * Cheap health check: is Ollama up, and is the configured model pulled?
 * Resolves with a human-readable reason on failure instead of throwing.
 */
export async function localAvailable(
  modelOverride?: string
): Promise<{ ok: true } | { ok: false; reason: string; kind: LocalUnavailableKind }> {
  const { ollamaUrl, model: defaultModel } = getAiSettings();
  const model = modelOverride || defaultModel;
  let names: string[];
  try {
    names = (await listLocalModels(ollamaUrl)).map((m) => m.name);
  } catch (err) {
    return { ok: false, kind: "down", reason: describeFetchError(err, ollamaUrl) };
  }
  if (!modelListed(names, model)) {
    return { ok: false, kind: "model", reason: modelNotPulledMessage(model) };
  }
  return { ok: true };
}

/** "about 41 thousand words" — tokens expressed in a unit a person can picture (~0.75 words per token). */
const thousandWords = (tokens: number) => `${Math.max(1, Math.round((tokens * 0.75) / 1000))} thousand words`;

function tooMuchTextMessage(estTokens: number, numCtx: number): string {
  return (
    `That's too much text for the AI to read at once (about ${thousandWords(estTokens)}; the limit is about ${thousandWords(numCtx)}). ` +
    "Paste less, or raise “How much text the AI can read at once” in Settings."
  );
}

function timeoutMessage(timeoutMs: number, model: string): string {
  return `The AI didn't finish in ${fmtTimeout(timeoutMs)} — the model (${model}) may be too big for this Mac. Try a smaller model in Settings.`;
}

interface OllamaChunk {
  message?: { role: string; content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const fmtTimeout = (ms: number) => (ms >= 120_000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 1000)} seconds`);

/**
 * Run one prompt through the local model, streaming progress events (so the
 * activity feed shows the model thinking/writing) and returning the full text.
 * `json: true` turns on Ollama's JSON mode — the prompt must still ask for JSON.
 */
// Ollama serves one request at a time per loaded model; queue in-process so a
// second run waits (and says so) instead of sitting in Ollama's queue with its
// abort timer already counting.
let queue: Promise<unknown> = Promise.resolve();

export function runLocalStream(
  prompt: string,
  opts: { json?: boolean; timeoutMs?: number; onEvent?: (e: ProgressEvent) => void; model?: string } = {}
): Promise<string> {
  const onEvent = opts.onEvent ?? (() => {});
  let waited = false;
  const waitNote = setTimeout(() => {
    waited = true;
    onEvent({ t: "info", label: "Waiting for the local model to finish another run…", ts: Date.now() });
  }, 1500);
  const run = queue.then(() => {
    clearTimeout(waitNote);
    if (waited) onEvent({ t: "info", label: "Model free — starting", ts: Date.now() });
    return runLocalStreamNow(prompt, opts);
  });
  queue = run.catch(() => {});
  return run;
}

async function runLocalStreamNow(
  prompt: string,
  {
    json = false,
    timeoutMs = 420_000,
    onEvent = () => {},
    model: modelOverride,
  }: { json?: boolean; timeoutMs?: number; onEvent?: (e: ProgressEvent) => void; model?: string } = {}
): Promise<string> {
  // A feature may run on a different model than the default (Settings → Coach).
  const LOCAL = { ...getAiSettings(), model: modelOverride || getAiSettings().model };
  const health = await localAvailable(LOCAL.model);
  if (!health.ok) throw new LocalUnavailable(health.reason, health.kind);

  // Ollama silently drops the middle of a prompt that exceeds num_ctx, so
  // refuse up front (rough estimate: ~4 chars per token, 1k reserved for output).
  const estTokens = Math.round(prompt.length / 4);
  if (estTokens > LOCAL.numCtx - 1024) {
    throw new Error(tooMuchTextMessage(estTokens, LOCAL.numCtx));
  }

  const started = Date.now();
  onEvent({
    t: "info",
    label: `Local model ${LOCAL.model} — reading your input (${Math.round(prompt.length / 4).toLocaleString()} tokens approx.)`,
    ts: started,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${LOCAL.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: LOCAL.model,
        stream: true,
        // JSON extraction steps: no thinking (it competes with the answer for
        // the context window and confuses JSON mode on some models).
        ...(json ? { format: "json", think: false } : {}),
        options: { num_ctx: LOCAL.numCtx, temperature: LOCAL.temperature },
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new Error(timeoutMessage(timeoutMs, LOCAL.model));
    throw new LocalUnavailable(describeFetchError(err, LOCAL.ollamaUrl), "down");
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const detail = await res.text().catch(() => "");
    // 404 here is Ollama's "model not found" (e.g. removed since the health check).
    if (res.status === 404 && /model/i.test(detail)) throw new LocalUnavailable(modelNotPulledMessage(LOCAL.model), "model");
    throw new LocalUnavailable(`Ollama answered ${res.status}: ${detail.slice(0, 300)}`, "down");
  }

  let content = "";
  let thinking = "";
  let lastWriteEvent = 0;
  let sawThink = false;
  let sawWrite = false;
  let doneReason = "";
  let evalCount = 0;
  let sawDone = false;
  let buffer = "";

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let chunk: OllamaChunk;
    try {
      chunk = JSON.parse(line) as OllamaChunk;
    } catch {
      return;
    }
    if (chunk.error) throw new LocalUnavailable(`Ollama reported an error: ${chunk.error}`, "down");
    if (chunk.message?.thinking) {
      thinking += chunk.message.thinking;
      if (!sawThink || Date.now() - lastWriteEvent > 4000) {
        onEvent({ t: "think", label: trunc(thinking.trim().slice(-280), 280), ts: Date.now() });
        lastWriteEvent = Date.now();
        sawThink = true;
      }
    }
    if (chunk.message?.content) {
      content += chunk.message.content;
      if (!sawWrite || Date.now() - lastWriteEvent > 4000) {
        onEvent({
          t: "write",
          label: sawWrite ? "Writing (continued)…" : "Writing up the result…",
          detail: trunc(content.trim().slice(-200), 200),
          ts: Date.now(),
        });
        lastWriteEvent = Date.now();
        sawWrite = true;
      }
    }
    if (chunk.done) {
      sawDone = true;
      doneReason = chunk.done_reason ?? "";
      evalCount = chunk.eval_count ?? 0;
    }
  };

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    }
    if (buffer.trim()) handleLine(buffer);
  } catch (err) {
    if (controller.signal.aborted) throw new Error(timeoutMessage(timeoutMs, LOCAL.model));
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!sawDone) throw new Error("The connection to Ollama closed before the model finished (partial output discarded).");
  const secs = Math.round((Date.now() - started) / 1000);
  onEvent({
    t: "info",
    label: `${LOCAL.model} finished in ${secs}s (${evalCount.toLocaleString()} tokens${doneReason && doneReason !== "stop" ? `, stopped: ${doneReason}` : ""})`,
    ts: Date.now(),
  });
  if (doneReason === "length") {
    // The prompt plus the answer overran num_ctx: the same fix as an oversized paste.
    throw new Error(tooMuchTextMessage(estTokens + evalCount, LOCAL.numCtx));
  }
  if (!content.trim()) throw new Error("The local model returned an empty response.");
  return content;
}
