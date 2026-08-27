import Link from "next/link";
import { approxDownloadSize, getAiStatus, type AiStatus } from "@/lib/aiStatus";

export const OLLAMA_SITE = "https://ollama.com";

/**
 * The plain-words explanation of why the AI can't run right now, or null when
 * it can. Exported so Settings can show the same sentence next to its status box.
 */
export function aiOffExplanation(status: AiStatus): { text: string; getOllama: boolean; settingsHint: boolean } | null {
  if (status.aiUsable) return null;
  if (status.provider === "claude") {
    return {
      text:
        "AI features are off — this CRM is set to run its AI through Claude, but Claude Code isn't installed on this Mac. " +
        "Install Claude Code (see “If you use Claude” in the README), or switch “Where the AI runs” to “On this Mac” in Settings.",
      getOllama: false,
      settingsHint: true,
    };
  }
  const claudeNote = status.fallbackToClaude
    ? " (Claude isn't installed either, so it can't fill in.)"
    : "";
  if (!status.ollama.ok) {
    const isMac = process.platform === "darwin";
    return {
      text:
        (isMac
          ? "AI features are off — Ollama isn't running. Open Ollama from your Applications folder (look for the llama in the menu bar) and reload this page."
          : "AI features are off — Ollama isn't running. Start Ollama and reload this page.") + claudeNote,
      getOllama: status.ollama.installedHint === "not-installed",
      settingsHint: false,
    };
  }
  const size = approxDownloadSize(status.model.name);
  const downloaded = status.model.available.map((m) => m.name);
  return {
    text:
      `The AI model ${status.model.name} hasn't been downloaded yet. Open Terminal and run \`ollama pull ${status.model.name}\`` +
      `${size ? ` (${size})` : ""}, or pick a smaller model in Settings.` +
      (downloaded.length ? ` Already downloaded: ${downloaded.join(", ")}.` : "") +
      claudeNote,
    getOllama: false,
    settingsHint: true,
  };
}

/** Render `code` spans for the backtick-quoted commands in an explanation. */
function withCode(text: string) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") ? (
      <code key={i} className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[0.8em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/**
 * Amber notice shown at the top of the AI pages (and inside the dashboard's
 * first-run banner) whenever the AI can't run. Renders nothing when it can.
 */
export default async function AiStatusBanner({ className = "" }: { className?: string }) {
  const status = await getAiStatus();
  const why = aiOffExplanation(status);
  if (!why) return null;
  return (
    <div
      role="status"
      className={`rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 ${className}`}
    >
      <p>{withCode(why.text)}</p>
      {why.getOllama || why.settingsHint ? (
        <p className="mt-1.5 flex flex-wrap gap-x-4 text-xs font-medium">
          {why.getOllama ? (
            <a href={OLLAMA_SITE} target="_blank" rel="noreferrer" className="underline">
              Get Ollama at ollama.com (free)
            </a>
          ) : null}
          {why.settingsHint ? (
            <Link href="/settings" className="underline">
              Open Settings
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
