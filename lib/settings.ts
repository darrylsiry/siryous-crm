import { getDb } from "./db";

/**
 * App settings stored in the database (key/value), editable on /settings.
 * Environment variables (.env.local) provide the defaults; a saved setting
 * overrides them. Read at call time, so changes apply without a restart.
 */
export type Provider = "local" | "claude";

export interface AiSettings {
  provider: Provider;
  fallbackToClaude: boolean;
  ollamaUrl: string;
  model: string;
  numCtx: number;
  temperature: number;
}

export const AI_DEFAULTS: AiSettings = {
  provider: process.env.AI_PROVIDER === "claude" ? "claude" : "local",
  fallbackToClaude: (process.env.AI_FALLBACK ?? "claude") !== "none",
  ollamaUrl: (process.env.LOCAL_LLM_URL ?? "http://127.0.0.1:11434").replace(/\/$/, ""),
  model: process.env.LOCAL_LLM_MODEL ?? "gemma4:26b",
  numCtx: Number(process.env.LOCAL_LLM_NUM_CTX) || 32768,
  temperature: Number(process.env.LOCAL_LLM_TEMPERATURE ?? 0.3),
};

export function getSetting(key: string): string | null {
  try {
    const row = getDb().prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setSetting(key: string, value: string | null) {
  const db = getDb();
  if (value === null || value === "") db.prepare(`DELETE FROM settings WHERE key=?`).run(key);
  else
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
    ).run(key, value);
}

export function getAiSettings(): AiSettings {
  const d = AI_DEFAULTS;
  const provider = getSetting("ai.provider");
  const fallback = getSetting("ai.fallback");
  const numCtx = Number(getSetting("ai.num_ctx"));
  const temperature = getSetting("ai.temperature");
  return {
    provider: provider === "claude" || provider === "local" ? provider : d.provider,
    fallbackToClaude: fallback === null ? d.fallbackToClaude : fallback !== "none",
    ollamaUrl: (getSetting("ai.ollama_url") ?? d.ollamaUrl).replace(/\/$/, ""),
    model: getSetting("ai.model") ?? d.model,
    numCtx: numCtx > 0 ? numCtx : d.numCtx,
    temperature: temperature !== null && !Number.isNaN(Number(temperature)) ? Number(temperature) : d.temperature,
  };
}

/**
 * Accept only http(s) URLs, and only private/loopback hosts unless
 * LOCAL_LLM_ALLOW_REMOTE=1 — the prompt sent to this URL contains the whole
 * roster and dossiers, so it must never be pointable at the open internet
 * by anyone who can reach the settings page.
 */
export function validateOllamaUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "that isn't a web address" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "the address must start with http:// or https://" };
  if (u.username || u.password || u.search || u.hash)
    return { ok: false, reason: "the address should be just the computer's name or number and port, like http://mini.local:11434 (no credentials, query or fragment)" };
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^fe80:/i.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host);
  if (!isPrivate && process.env.LOCAL_LLM_ALLOW_REMOTE !== "1") {
    return {
      ok: false,
      reason:
        `${host} isn't on your own network. For safety the AI can only run on this Mac or on another ` +
        `computer in your home or office network. (developers: LOCAL_LLM_ALLOW_REMOTE=1)`,
    };
  }
  return { ok: true, url: `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, "")}` };
}
