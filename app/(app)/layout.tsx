import Link from "next/link";
import MobileNav from "@/components/MobileNav";
import SideNav from "@/components/SideNav";
import { ToastProvider } from "@/components/Toaster";
import ReceiptBanner from "@/components/ReceiptBanner";
import { Suspense } from "react";
import { loadOwner } from "@/lib/owner.mjs";
import { navCounts, type NavCounts } from "@/lib/navCounts";
import { hasReports } from "@/lib/agentActivity";
import { STATUS, getDb } from "@/lib/db";

/** "🌱 New · 🔍 Exploring · …", from the vocabulary. */
const statusLegend = Object.values(STATUS)
  .map((s) => `${s.emoji} ${s.label}`.trim())
  .join(" · ");

/**
 * Sidebar groups. Dashboard stands alone at the top and Settings at the
 * bottom; everything else sits under a small heading. MobileNav renders the
 * same groups.
 */
type NavItem = { href: string; label: string; icon: string };
type NavGroup = { title: string | null; items: NavItem[] };

const nav: NavGroup[] = [
  { title: null, items: [{ href: "/", label: "Dashboard", icon: "◧" }] },
  {
    title: "New Business",
    items: [
      { href: "/intake", label: "Intake", icon: "✨" },
      { href: "/log", label: "Log", icon: "✎" },
      { href: "/inbox", label: "Inbox", icon: "📥" },
    ],
  },
  {
    title: "Pipeline",
    items: [
      { href: "/actions", label: "Actions", icon: "☑" },
      { href: "/pipeline", label: "Pipeline", icon: "⚑" },
      { href: "/followups", label: "Keep Warm", icon: "♨" },
      { href: "/outreach", label: "Outreach", icon: "✉" },
      { href: "/prep", label: "Prep", icon: "🗓" },
      { href: "/news", label: "News Feed", icon: "📰" },
      { href: "/coach", label: "Coach", icon: "◎" },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/people", label: "People", icon: "๛" },
      { href: "/companies", label: "Companies", icon: "▣" },
      { href: "/map", label: "Map", icon: "❖" },
      { href: "/import", label: "Import", icon: "⇪" },
    ],
  },
  { title: null, items: [{ href: "/settings", label: "Settings", icon: "⚙" }] },
];

/**
 * The nav as this install needs it: Outreach only once it holds something
 * (the app never creates outreach itself), App Tests only once a review
 * agent has written a report (most installs never run them).
 */
function navFor(): NavGroup[] {
  let groups = nav;
  try {
    const outreach = (getDb().prepare(`SELECT COUNT(*) AS n FROM outreach`).get() as { n: number }).n;
    if (!outreach) groups = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.href !== "/outreach") }));
  } catch {
    /* never let the nav take the app chrome down */
  }
  try {
    if (!hasReports()) return groups;
  } catch {
    return groups;
  }
  return groups.map((g) => (g.items.some((i) => i.href === "/settings") ? { ...g, items: [{ href: "/app-tests", label: "App Tests", icon: "✓" }, ...g.items] } : g));
}

/** "Siryous CRM" → "Siryous" + accented " CRM"; any other name is rendered as-is. */
function AppName({ name }: { name: string }) {
  const m = name.match(/^(.*?)(\s+CRM)$/i);
  if (!m) return <>{name}</>;
  return (
    <>
      {m[1]}
      <span className="text-indigo-600">{m[2]}</span>
    </>
  );
}

/**
 * The signed-in app chrome: sidebar (desktop) / top bar (mobile) around every
 * page except sign-in, which lives in the (bare) group with no navigation.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = loadOwner();
  const groups = navFor();
  let counts: NavCounts = {};
  try {
    counts = navCounts();
  } catch {
    /* never let the badges take the app chrome down */
  }
  return (
    <>
      <MobileNav nav={groups} appName={owner.appName} counts={counts} statusLegend={statusLegend} />
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 hidden w-52 overflow-y-auto border-r border-stone-200 bg-white px-4 py-6 md:flex md:flex-col">
          <Link href="/" className="mb-8 block px-2">
            <div className="text-lg font-bold tracking-tight text-stone-900">
              <AppName name={owner.appName} />
            </div>
            <div className="text-[0.7rem] text-stone-500 mt-0.5">
              Business Development
            </div>
          </Link>
          <form action="/search" method="get" className="mb-4">
            <input
              name="q"
              placeholder="Search…  ⏎"
              aria-label="Search"
              className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs focus:border-indigo-400 focus:bg-white focus:outline-none"
            />
          </form>
          <SideNav groups={groups} counts={counts} />
          <div className="mt-auto px-2 text-[0.68rem] leading-relaxed text-stone-500">
            Status: {statusLegend}
          </div>
        </aside>
        <main className="min-w-0 w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 md:ml-52 md:px-8 md:py-8 [&:has(.full-bleed)]:max-w-none">
          <ToastProvider>
            <Suspense fallback={null}>
              <ReceiptBanner />
            </Suspense>
            {children}
          </ToastProvider>
        </main>
      </div>
    </>
  );
}
