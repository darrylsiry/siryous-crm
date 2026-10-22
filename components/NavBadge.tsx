"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { NavCounts } from "@/lib/navCounts";

/**
 * Sidebar badge counts, shared by the desktop sidebar and MobileNav. The
 * layout renders the first values on the server; after that one client-side
 * store refreshes them on navigation, after any form submit (server actions),
 * when the window regains focus, and once a minute.
 */
const POLL_MS = 60_000;

let counts: NavCounts = {};
let seeded = false;
const listeners = new Set<() => void>();
let inflight = false;
let started = false;

function emit() {
  for (const l of listeners) l();
}

async function refresh() {
  if (inflight) return;
  inflight = true;
  try {
    const res = await fetch("/api/nav-counts", { cache: "no-store" });
    if (res.ok) {
      counts = (await res.json()) as NavCounts;
      emit();
    }
  } catch {
    /* offline / server restarting: keep the last values */
  } finally {
    inflight = false;
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, POLL_MS);
  window.addEventListener("focus", () => void refresh());
  // Server actions run on form submit; recount once they've likely landed.
  document.addEventListener(
    "submit",
    () => {
      window.setTimeout(() => void refresh(), 1200);
      window.setTimeout(() => void refresh(), 5000);
    },
    true
  );
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Seed from the server render once, then follow the store. */
export function useNavCounts(initial: NavCounts): NavCounts {
  if (!seeded) {
    counts = initial;
    seeded = true;
  }
  const value = useSyncExternalStore(
    subscribe,
    () => counts,
    () => initial
  );
  const pathname = usePathname();
  useEffect(() => {
    start();
  }, []);
  useEffect(() => {
    void refresh();
  }, [pathname]);
  return value;
}

const TONES = {
  alert: "bg-red-600 text-white",
  warn: "bg-amber-100 text-amber-800",
  muted: "bg-stone-100 text-stone-500",
} as const;

export function Badge({ badge }: { badge?: NavCounts[string] }) {
  if (!badge || badge.n <= 0) return null;
  return (
    <span
      title={badge.title}
      className={`ml-auto min-w-[1.25rem] rounded-full px-1.5 py-px text-center text-[0.68rem] font-semibold tabular-nums leading-4 ${TONES[badge.tone]}`}
    >
      {badge.n > 99 ? "99+" : badge.n}
    </span>
  );
}

/** Desktop sidebar badge for one nav item. */
export default function NavBadge({ href, initial }: { href: string; initial: NavCounts }) {
  const c = useNavCounts(initial);
  return <Badge badge={c[href]} />;
}
