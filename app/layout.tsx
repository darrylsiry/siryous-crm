import type { Metadata } from "next";
import Link from "next/link";
import MobileNav from "@/components/MobileNav";
import "./globals.css";
import { loadOwner } from "@/lib/owner.mjs";

const owner = loadOwner();

export const metadata: Metadata = {
  title: owner.appName,
  description: `Relationship-centered business development for ${owner.configured ? owner.practiceName : "your practice"}`,
};

const nav = [
  { href: "/", label: "Dashboard", icon: "◧" },
  { href: "/coach", label: "Coach", icon: "◎" },
  { href: "/intake", label: "Intake", icon: "✨" },
  { href: "/log", label: "Log", icon: "✎" },
  { href: "/prep", label: "Prep", icon: "🗓" },
  { href: "/actions", label: "Actions", icon: "☑" },
  { href: "/pipeline", label: "Pipeline", icon: "⚑" },
  { href: "/followups", label: "Keep Warm", icon: "♨" },
  { href: "/people", label: "People", icon: "๛" },
  { href: "/companies", label: "Companies", icon: "▣" },
  { href: "/map", label: "Map", icon: "❖" },
  { href: "/outreach", label: "Outreach", icon: "✉" },
  { href: "/settings", label: "Settings", icon: "⚙" },
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MobileNav nav={nav} appName={owner.appName} />
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
            <nav className="space-y-1">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                >
                  <span className="text-stone-400 w-4 text-center">{n.icon}</span>
                  {n.label}
                </Link>
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
      </body>
    </html>
  );
}
