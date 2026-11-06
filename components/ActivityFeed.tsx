"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProgressEvent } from "@/lib/ai";
import { FEED_ICONS } from "@/components/feedIcons";
import { cancelRunAction } from "@/lib/runActions";

/** No new step for this long reads as stalled (a long "thinking" step still logs events). */
const STALL_MS = 4 * 60 * 1000;

/** Where a run of each kind waits if the owner leaves the page. */
const WAITS_IN: Record<string, { label: string; href: string }> = {
  log: { label: "Log → To review", href: "/log" },
  intake: { label: "Intake → To review", href: "/intake" },
  prep: { label: "Prep → Briefs", href: "/prep" },
  coach: { label: "Coach", href: "/coach" },
};

function minutes(secs: number): string {
  if (secs < 90) return "about a minute";
  const m = Math.round(secs / 60);
  return `about ${m} minutes`;
}

/**
 * Live view of an in-flight AI analysis. Polls /api/progress every 2s and
 * refreshes the page (into the normal review UI) once the run finishes.
 * Says how long runs usually take here (`typicalSecs`, from recent runs) and
 * offers Cancel, which stops the run and keeps its text for Try again.
 */
export default function ActivityFeed({
  kind,
  id,
  title,
  subtitle,
  initialEvents,
  typicalSecs = null,
}: {
  kind: "intake" | "log" | "prep" | "coach";
  id: number;
  title: string;
  subtitle?: string;
  initialEvents: ProgressEvent[];
  typicalSecs?: number | null;
}) {
  const [cancelling, startCancel] = useTransition();
  const cancel = () =>
    startCancel(async () => {
      await cancelRunAction(kind as "log" | "intake" | "prep", id);
      doneRef.current = true;
      router.refresh();
    });
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
  const stale = now - lastTs > STALL_MS;
  const waits = WAITS_IN[kind];
  const cancellable = kind !== "coach";
  const searches = events.filter((e) => e.t === "search").length;

  if (gone) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white px-5 py-4 text-sm text-stone-600">
        This run no longer exists — it was discarded or deleted.{" "}
        <Link href={waits.href} className="font-medium text-indigo-700 hover:underline">
          Back to {waits.label.split(" →")[0]}
        </Link>
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
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
            Running · {mm}:{ss}
          </span>
          {cancellable ? (
            <button
              type="button"
              onClick={cancel}
              disabled={cancelling}
              className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              {cancelling ? "Cancelling…" : "Cancel"}
            </button>
          ) : null}
        </span>
      </div>
      <p className="border-b border-stone-100 px-5 py-2 text-xs text-stone-600">
        {typicalSecs ? `Runs here usually take ${minutes(typicalSecs)}.` : "Usually 1–3 minutes on this Mac, longer for a long text or a web search."} You
        can leave this page; it will wait under{" "}
        <Link href={waits.href} className="font-medium text-indigo-700 hover:underline">
          {waits.label}
        </Link>
        .
      </p>

      <ul className="space-y-2.5 px-5 py-4" aria-live="polite" aria-relevant="additions">
        {events.length === 0 && (
          <li className="text-sm text-stone-500 animate-pulse">Starting the model…</li>
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
                  <span className="mt-0.5 block break-all font-mono text-xs text-stone-500">{e.detail}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {stale ? (
        <p className="mx-5 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No progress for {Math.round((now - lastTs) / 60000)} minutes — it may have stalled.
          {cancellable ? (
            <button type="button" onClick={cancel} disabled={cancelling} className="font-semibold underline">
              Cancel it and try again (your text is kept)
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t border-stone-100 px-5 py-2.5 text-xs text-stone-500">
        <span>
          {events.length} step{events.length === 1 ? "" : "s"}
          {searches ? ` · ${searches} web search${searches === 1 ? "" : "es"}` : ""}
        </span>
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="font-medium text-stone-600 hover:text-indigo-600"
        >
          {showDetail ? "Hide raw detail" : "Show raw detail"}
        </button>
      </div>
    </div>
  );
}
