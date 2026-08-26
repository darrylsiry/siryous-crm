import type { ProgressEvent } from "@/lib/ai";
import { FEED_ICONS } from "@/components/feedIcons";

/** Collapsed post-run recap of what the model did — shown on finished review pages. */
export default function FeedRecap({ progress }: { progress: string | null }) {
  let events: ProgressEvent[] = [];
  try {
    events = progress ? (JSON.parse(progress) as ProgressEvent[]) : [];
  } catch {}
  if (!events.length) return null;
  const searches = events.filter((e) => e.t === "search").length;
  const secs =
    events.length > 1 ? Math.round((events[events.length - 1].ts - events[0].ts) / 1000) : 0;
  return (
    <details className="rounded-xl border border-stone-200 bg-white">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-stone-500 select-none">
        How this was produced{" "}
        <span className="font-normal text-stone-400">
          ({events.length} steps{searches ? `, ${searches} web search${searches === 1 ? "" : "es"}` : ""}
          {secs ? `, ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} min` : ""})
        </span>
      </summary>
      <ul className="space-y-2 px-5 pb-4">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <span className="w-5 shrink-0 text-center">{FEED_ICONS[e.t] ?? "🔧"}</span>
            <span className={e.t === "think" ? "italic text-stone-500" : "text-stone-700"}>
              {e.label}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
