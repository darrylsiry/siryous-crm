import type { ProgressEvent } from "@/lib/ai";

/**
 * One line at the top of a review page or brief saying where the text was
 * written: on this Mac (nothing left it) or by Claude (it went to
 * Anthropic), read from the run's own progress record rather than from
 * settings, so a silent fallback to Claude can't pass as local.
 */
export default function AiRouteNote({ progress }: { progress: string | null }) {
  let events: ProgressEvent[] = [];
  try {
    events = progress ? (JSON.parse(progress) as ProgressEvent[]) : [];
  } catch {}
  const local = events.some((e) => e.route === "local");
  const claudeWrote = events.some((e) => e.route === "claude" && !e.tools);
  const claudeFetched = events.some((e) => e.route === "claude" && e.tools);
  const fellBack = events.some((e) => /using Claude instead/.test(e.label));
  if (!local && !claudeWrote && !claudeFetched) return null;
  if (claudeWrote) {
    return (
      <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
        <b>Written by Claude</b> — this text{fellBack ? " and your contact list" : ""} went to Anthropic
        {fellBack ? ", because the AI on this Mac wasn't running" : ""}.
      </p>
    );
  }
  return (
    <p className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-700">
      {claudeFetched ? (
        <>
          <b>Fetched or researched through Claude</b> (your connectors or the web), then <b>written on this Mac</b>.
        </>
      ) : (
        <>
          <b>Written on this Mac</b> — nothing left it.
        </>
      )}
    </p>
  );
}
