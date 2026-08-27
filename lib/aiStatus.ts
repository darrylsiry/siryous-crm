import fs from "fs";
import os from "os";
import path from "path";
import { claudeAvailable } from "./ai";
import { describeFetchError, fetchErrorCode, listLocalModels, modelListed, type OllamaModel } from "./llm";
import { getAiSettings, type Provider } from "./settings";

/**
 * One answer to "can the AI features run right now?", shared by the banner on
 * Intake/Log/Prep/Coach, the dashboard's first-run notice and the Settings
 * page — so every screen tells the same story, before the person clicks.
 */
export interface AiStatus {
  ollama: {
    ok: boolean;
    /** Short technical reason when not ok (goes in a "(Detail: …)" clause). */
    reason: string | null;
    /** Best guess at why nothing answered: the app isn't installed, or it's installed but not running. */
    installedHint: "not-installed" | "not-running" | null;
    url: string;
  };
  model: {
    ok: boolean;
    /** The configured model tag. */
    name: string;
    /** What Ollama has downloaded (empty when Ollama is unreachable). */
    available: OllamaModel[];
  };
  claude: { ok: boolean };
  provider: Provider;
  fallbackToClaude: boolean;
  /** Can the configured provider run a tool-less "write" step right now? */
  aiUsable: boolean;
}

/** Rough download sizes for the models the README suggests, so the banner can warn "(about 16 GB)". */
const KNOWN_SIZES_GB: Record<string, number> = {
  "gemma4:26b": 16,
  "gemma4:12b": 8,
  "gemma3:27b": 17,
  "gemma3:12b": 8,
  "qwen3:32b": 20,
  "qwen3:14b": 9,
  "qwen3:8b": 5,
};

/** "about 16 GB" for a known tag, or null. */
export function approxDownloadSize(model: string): string | null {
  const gb = KNOWN_SIZES_GB[model] ?? KNOWN_SIZES_GB[`${model}:latest`];
  return gb ? `about ${gb} GB` : null;
}

/** Is the Ollama app or CLI on this machine at all? (No network call.) */
function ollamaInstalled(): boolean {
  const candidates: string[] = [];
  if (process.platform === "darwin") candidates.push("/Applications/Ollama.app", path.join(os.homedir(), "Applications", "Ollama.app"));
  if (process.platform === "win32") {
    candidates.push(path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama app.exe"));
  }
  const names = process.platform === "win32" ? ["ollama.exe", "ollama"] : ["ollama"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const n of names) candidates.push(path.join(dir, n));
  }
  candidates.push("/usr/local/bin/ollama", "/opt/homebrew/bin/ollama");
  return candidates.some((c) => {
    try {
      fs.accessSync(c);
      return true;
    } catch {
      return false;
    }
  });
}

type Probe = { ok: true; models: OllamaModel[] } | { ok: false; reason: string; code: string | null };

// The model list is the only network call; remember it for a few seconds so
// a page that renders the banner and the Settings box doesn't ask Ollama twice
// — and a burst of navigation doesn't either.
const CACHE_MS = 5000;
let cached: { url: string; at: number; probe: Promise<Probe> } | null = null;

function probeOllama(url: string): Promise<Probe> {
  const now = Date.now();
  if (cached && cached.url === url && now - cached.at < CACHE_MS) return cached.probe;
  const probe: Promise<Probe> = listLocalModels(url)
    .then((models): Probe => ({ ok: true, models }))
    .catch((err): Probe => ({ ok: false, reason: describeFetchError(err, url), code: fetchErrorCode(err) }));
  cached = { url, at: now, probe };
  return probe;
}

export async function getAiStatus(): Promise<AiStatus> {
  const s = getAiSettings();
  const probe = await probeOllama(s.ollamaUrl);
  const claudeOk = claudeAvailable();

  const ollama: AiStatus["ollama"] = probe.ok
    ? { ok: true, reason: null, installedHint: null, url: s.ollamaUrl }
    : {
        ok: false,
        reason: probe.reason,
        // Connection refused means nothing is listening: either the app was
        // never installed, or it's installed and simply not open.
        installedHint: probe.code === "ECONNREFUSED" || probe.code === "TIMEOUT" ? (ollamaInstalled() ? "not-running" : "not-installed") : null,
        url: s.ollamaUrl,
      };
  const available = probe.ok ? probe.models : [];
  const model: AiStatus["model"] = {
    ok: probe.ok && modelListed(available.map((m) => m.name), s.model),
    name: s.model,
    available,
  };
  const localOk = ollama.ok && model.ok;
  const aiUsable = s.provider === "claude" ? claudeOk : localOk || (s.fallbackToClaude && claudeOk);
  return { ollama, model, claude: { ok: claudeOk }, provider: s.provider, fallbackToClaude: s.fallbackToClaude, aiUsable };
}
