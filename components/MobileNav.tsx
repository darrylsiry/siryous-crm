"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, useNavCounts } from "@/components/NavBadge";
import type { NavCounts } from "@/lib/navCounts";

export default function MobileNav({
  nav,
  appName = "CRM",
  counts: initialCounts = {},
}: {
  nav: { title: string | null; items: { href: string; label: string; icon: string }[] }[];
  appName?: string;
  counts?: NavCounts;
}) {
  const [open, setOpen] = useState(false);
  const counts = useNavCounts(initialCounts);
  const urgent = Object.values(counts).some((b) => b.tone === "alert" && b.n > 0);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white md:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="block">
          <span className="text-base font-bold tracking-tight text-stone-900">
            {appName}
          </span>
        </Link>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100"
        >
          {urgent && !open ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-600" aria-hidden /> : null}
          {open ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          )}
        </button>
      </div>
      {open ? (
        <div className="border-t border-stone-100 px-4 pb-4">
          <form action="/search" method="get" className="pt-3">
            <input
              name="q"
              placeholder="Search…  ⏎"
              aria-label="Search"
              className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-indigo-400 focus:bg-white focus:outline-none"
            />
          </form>
          <nav className="mt-3 space-y-3">
            {nav.map((g, i) => (
              <div key={g.title ?? i}>
                {g.title ? (
                  <div className="mb-1 px-1 text-[0.65rem] font-semibold uppercase tracking-wider text-stone-400">{g.title}</div>
                ) : null}
                <div className="grid grid-cols-2 gap-1">
                  {g.items.map((n) => {
                    const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
                    return (
                      <Link
                        key={n.href}
                        href={n.href}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium ${
                          active ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                        }`}
                      >
                        <span className="w-4 text-center text-stone-400">{n.icon}</span>
                        {n.label}
                        <Badge badge={counts[n.href]} />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-3 border-t border-stone-100 pt-3 text-[0.68rem] leading-relaxed text-stone-400">
            Status: 🌱 New · 🔍 Exploring · 🔥 Active · ⏸️ Hold · 🤝 Client · ✅ Won
            · ❌ Lost · 😴 Dormant
          </div>
        </div>
      ) : null}
    </header>
  );
}
