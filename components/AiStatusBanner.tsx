import Link from "next/link";
import { approxDownloadSize, getAiStatus, recommendedModel, routeUsable, type AiStatus } from "@/lib/aiStatus";
import { modelListed } from "@/lib/llm";
import { useModel } from "@/lib/settingsActions";
import type { Provider } from "@/lib/settings";
import CopyButton from "@/components/CopyButton";
import RefreshButton from "@/components/RefreshButton";
import PendingButton from "@/components/PendingButton";

export const OLLAMA_SITE = "https://ollama.com";

/**
 * The plain-words explanation of why the AI can't run right now, or null when
 * it can. Exported so Settings can show the same sentence next to its status box.
 * `pull` is set when the fix is downloading a model: the one to get, and how big.
 */
export function aiOffExplanation(
  status: AiStatus
): { text: string; getOllama: boolean; settingsHint: boolean; pull: { model: string; size: string | null; memoryGb: number } | null } | null {
  if (status.aiUsable) return null;
  if (status.provider === "claude") {
    return {
      text:
        "AI features are off — this CRM is set to run its AI through Claude, but Claude Code isn't installed on this Mac. " +
        "Install Claude Code (see “If you use Claude” in the README), or switch “Where the AI runs” to “On this Mac” in Settings.",
      getOllama: false,
      settingsHint: true,
      pull: null,
    };
  }
  const claudeNote = status.fallbackToClaude ? " (Claude isn't installed either, so it can't fill in.)" : "";
  if (!status.ollama.ok) {
    const notInstalled = status.ollama.installedHint === "not-installed";
    const isMac = process.platform === "darwin";
    return {
      text: notInstalled
        ? "AI features are off — Ollama, the free app that runs the AI on this Mac, isn't installed. Get it at ollama.com, open it once, then come back and press Check again." +
          claudeNote
        : (isMac
            ? "AI features are off — Ollama isn't running. Open Ollama from your Applications folder (look for the llama in the menu bar), then press Check again."
            : "AI features are off — Ollama isn't running. Start Ollama, then press Check again.") + claudeNote,
      getOllama: notInstalled,
      settingsHint: false,
      pull: null,
    };
  }
  const rec = recommendedModel();
  const configured = status.model.name;
  // Suggest the configured model when it suits this Mac (or no better fit is known); else the one that does.
  const pull =
    configured === rec.model || !approxDownloadSize(configured)
      ? { model: configured, size: approxDownloadSize(configured), memoryGb: rec.memoryGb }
      : { model: rec.model, size: rec.size, memoryGb: rec.memoryGb };
  return {
    text:
      `The AI model ${configured} hasn't been downloaded yet.` +
      (pull.model !== configured ? ` This Mac has ${rec.memoryGb} GB of memory, so ${pull.model} is the better fit.` : "") +
      claudeNote,
    getOllama: false,
    settingsHint: true,
    pull,
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
 * Amber notice at the top of the AI pages (and inside the Dashboard's first-run
 * banner): why the AI can't run and what to do, step by step; or, when runs
 * would quietly go to Claude because the AI on this Mac is down, that the
 * text would leave the Mac. Renders nothing when the AI runs where it should.
 */
export default async function AiStatusBanner({
  className = "",
  route,
}: {
  className?: string;
  /** A feature with its own AI choice (the Coach): judge that route instead of the app-wide one. */
  route?: { provider: Provider; model: string };
}) {
  const base = await getAiStatus();
  const status: AiStatus = route
    ? {
        ...base,
        provider: route.provider,
        model: { ...base.model, name: route.model, ok: base.ollama.ok && modelListed(base.model.available.map((m) => m.name), route.model) },
        aiUsable: routeUsable(base, route),
        // A feature with its own route (the Coach) never falls back to Claude.
        fallbackToClaude: false,
        fallingBack: false,
      }
    : base;
  const box = `rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 ${className}`;
  if (status.fallingBack) {
    return (
      <div role="alert" className={box}>
        <p>
          <b>⚠ The AI on this Mac isn&apos;t running.</b> If you continue, what you enter here and your contact list go to Anthropic
          through Claude instead of staying on this Mac.
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
          <span>{status.ollama.ok ? `Download ${status.model.name} (see Settings) to stay private.` : "Open Ollama to stay private."}</span>
          <RefreshButton />
          <Link href="/settings#ai" className="underline">
            Turn the Claude fallback off in Settings
          </Link>
        </p>
      </div>
    );
  }
  const why = aiOffExplanation(status);
  if (!why) return null;
  const downloaded = status.model.available.map((m) => m.name);
  const pulledAlready = why.pull && downloaded.some((d) => d === why.pull!.model || d === `${why.pull!.model}:latest`);
  return (
    <div role="status" className={box}>
      <p>{withCode(why.text)}</p>
      {why.pull && !pulledAlready ? (
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            Open Terminal (in Applications → Utilities) and paste this{why.pull.size ? ` — ${why.pull.size} to download` : ""}:
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[0.85em]">ollama pull {why.pull.model}</code>
              <CopyButton text={`ollama pull ${why.pull.model}`} label="Copy" />
            </span>
          </li>
          <li>
            When it finishes: <RefreshButton />
          </li>
          {why.pull.model !== status.model.name ? <li>Then choose it with the button that appears here.</li> : null}
        </ol>
      ) : null}
      {downloaded.length && !status.model.ok ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span>Already downloaded:</span>
          {downloaded.slice(0, 4).map((m) => (
            <form key={m} action={useModel.bind(null, m)}>
              <PendingButton
                label={`Use ${m}`}
                pendingLabel="Switching…"
                className="rounded-md border border-amber-400 bg-white px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
              />
            </form>
          ))}
        </div>
      ) : null}
      {why.getOllama || why.settingsHint || !why.pull ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
          {why.getOllama ? (
            <a href={OLLAMA_SITE} target="_blank" rel="noreferrer" className="underline">
              Get Ollama at ollama.com (free)
            </a>
          ) : null}
          {!why.pull && status.provider !== "claude" ? <RefreshButton /> : null}
          {why.settingsHint ? (
            <Link href="/settings#ai" className="underline">
              Open Settings
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
