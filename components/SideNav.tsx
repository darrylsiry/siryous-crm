"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavBadge from "@/components/NavBadge";
import type { NavCounts } from "@/lib/navCounts";

type NavGroup = { title: string | null; items: { href: string; label: string; icon: string }[] };

/** Is `href` the section the page at `pathname` belongs to? ("/" only for the Dashboard itself.) */
export function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The desktop sidebar's links, with the current section tinted and marked for screen readers. */
export default function SideNav({ groups, counts }: { groups: NavGroup[]; counts: NavCounts }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-4" aria-label="Main">
      {groups.map((g, i) => (
        <div key={g.title ?? i}>
          {g.title ? <div className="mb-1 px-3 text-[0.65rem] font-semibold uppercase tracking-wider text-stone-500">{g.title}</div> : null}
          <div className="space-y-0.5">
            {g.items.map((n) => {
              const current = isCurrent(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                    current ? "bg-indigo-50 text-indigo-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  <span className={`w-4 text-center ${current ? "text-indigo-600" : "text-stone-500"}`}>{n.icon}</span>
                  {n.label}
                  <NavBadge href={n.href} initial={counts} />
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
