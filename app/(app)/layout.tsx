import Link from "next/link";
import MobileNav from "@/components/MobileNav";
import NavBadge from "@/components/NavBadge";
import { loadOwner } from "@/lib/owner.mjs";
import { navCounts, type NavCounts } from "@/lib/navCounts";

const owner = loadOwner();

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
  let counts: NavCounts = {};
  try {
    counts = navCounts();
  } catch {
    /* never let the badges take the app chrome down */
  }
  return (
    <>
      <MobileNav nav={nav} appName={owner.appName} counts={counts} />
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 hidden w-52 overflow-y-auto border-r border-stone-200 bg-white px-4 py-6 md:flex md:flex-col">
          <Link href="/" className="mb-8 block px-2">
            <div className="text-lg font-bold tracking-tight text-stone-900">
              <AppName name={owner.appName} />
            </div>
            <div className="text-[0.7rem] text-stone-400 mt-0.5">
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
          <nav className="space-y-4">
            {nav.map((g, i) => (
              <div key={g.title ?? i}>
                {g.title ? (
                  <div className="mb-1 px-3 text-[0.65rem] font-semibold uppercase tracking-wider text-stone-400">{g.title}</div>
                ) : null}
                <div className="space-y-0.5">
                  {g.items.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                    >
                      <span className="text-stone-400 w-4 text-center">{n.icon}</span>
                      {n.label}
                      <NavBadge href={n.href} initial={counts} />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto px-2 text-[0.68rem] leading-relaxed text-stone-400">
            Status: 🌱 New · 🔍 Exploring · 🔥 Active · ⏸️ Hold · 🤝 Client · ✅ Won
            · ❌ Lost · 😴 Dormant
          </div>
        </aside>
        <main className="min-w-0 w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 md:ml-52 md:px-8 md:py-8 [&:has(.full-bleed)]:max-w-none">
          {children}
        </main>
      </div>
    </>
  );
}
