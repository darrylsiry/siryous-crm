"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProgressEvent } from "@/lib/ai";
import { FEED_ICONS } from "@/components/feedIcons";

/**
 * Live view of an in-flight AI analysis. Polls /api/progress every 2s and
 * refreshes the page (into the normal review UI) once the run finishes.
 */
export default function ActivityFeed({
  kind,
  id,
  title,
  subtitle,
  initialEvents,
}: {
  kind: "intake" | "log" | "prep" | "coach";
  id: number;
  title: string;
  subtitle?: string;
  initialEvents: ProgressEvent[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState<ProgressEvent[]>(initialEvents);
  const [showDetail, setShowDetail] = useState(false);
  // Start from the first event's timestamp (identical on server and client)
  // so hydration doesn't see two different clocks; the tick takes over after mount.
  const startedAt = useRef(initialEvents[0]?.ts ?? 0);
  const [now, setNow] = useState(() => startedAt.current);
  const [gone, setGone] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!startedAt.current) startedAt.current = Date.now();
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = async () => {
      if (doneRef.current) return;
      try {
        const res = await fetch(`/api/progress/${kind}/${id}`, { cache: "no-store" });
        if (res.status === 404) {
          doneRef.current = true;
          setGone(true);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { status: string; events: ProgressEvent[] };
        if (data.events?.length) {
          setEvents(data.events);
          if (!startedAt.current || startedAt.current > data.events[0].ts) {
            startedAt.current = data.events[0].ts;
          }
        }
        if (data.status !== "analyzing" && data.status !== "pending") {
          doneRef.current = true;
          router.refresh();
        }
      } catch {}
    };
    const interval = setInterval(poll, 2000);
    // Background tabs throttle/freeze intervals — catch up the moment we're visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    poll();
    return () => {
      clearInterval(tick);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [kind, id, router]);

  const elapsed = Math.max(0, Math.floor((now - startedAt.current) / 1000));
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  const lastTs = events[events.length - 1]?.ts ?? startedAt.current;
  const stale = now - lastTs > 9 * 60 * 1000;
  const searches = events.filter((e) => e.t === "search").length;

  if (gone) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white px-5 py-4 text-sm text-stone-500">
        This run no longer exists — it was discarded or deleted.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {subtitle ? <p className="text-xs text-stone-500">{subtitle}</p> : null}
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Running · {mm}:{ss}
        </span>
      </div>

      <ul className="space-y-2.5 px-5 py-4">
        {events.length === 0 && (
          <li className="text-sm text-stone-400 animate-pulse">Starting the model…</li>
        )}
        {events.map((e, i) => {
          const last = i === events.length - 1;
          return (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="w-5 shrink-0 text-center">{FEED_ICONS[e.t] ?? "🔧"}</span>
              <span className={
                e.t === "think"
                  ? "italic text-stone-500"
                  : last
                    ? "text-stone-800 animate-pulse"
                    : "text-stone-700"
              }>
                {e.label}
                {showDetail && e.detail ? (
                  <span className="mt-0.5 block break-all font-mono text-xs text-stone-400">{e.detail}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {stale ? (
        <p className="mx-5 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This seems to have stalled. Go back and start it again.
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t border-stone-100 px-5 py-2.5 text-xs text-stone-400">
        <span>
          {events.length} step{events.length === 1 ? "" : "s"}
          {searches ? ` · ${searches} web search${searches === 1 ? "" : "es"}` : ""} · you can leave
          this page and come back
        </span>
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="font-medium text-stone-500 hover:text-indigo-600"
        >
          {showDetail ? "Hide raw detail" : "Show raw detail"}
        </button>
      </div>
    </div>
  );
}
