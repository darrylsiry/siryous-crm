import Link from "next/link";
import { BUCKETS, STAGES, STATUS } from "@/lib/db";
import {
  allOpportunities,
  allPeople,
  dashboardStats,
  openActionItems,
  recentInteractions,
} from "@/lib/queries";
import { ActionRow } from "@/components/ActionList";
import AiStatusBanner from "@/components/AiStatusBanner";
import { openInboxItems, type OpenInboxItem } from "@/lib/inbox";
import { cleanSubject } from "@/lib/inboxRoute";

export const dynamic = "force-dynamic";

const INBOX_STATE: Record<OpenInboxItem["state"], { label: string; cls: string }> = {
  ready: { label: "Review", cls: "bg-green-600 text-white" },
  working: { label: "Drafting…", cls: "bg-indigo-50 text-indigo-700" },
  error: { label: "Failed", cls: "bg-red-50 text-red-700" },
  unrouted: { label: "Not routed", cls: "bg-stone-100 text-stone-600" },
};

export default function Dashboard() {
  const stats = dashboardStats();
  const actions = openActionItems();
  const people = allPeople();
  const recent = recentInteractions(8);

  const overdue = actions.filter((a) => a.bucket === "overdue");
  const thisWeek = actions.filter((a) => a.bucket === "this_week");
  const awaiting = actions.filter((a) => a.bucket === "awaiting");
  const logGaps = actions.filter((a) => a.bucket === "log_gap");

  const opps = allOpportunities().filter((o) => STAGES[o.stage]?.open);
  const inbox = openInboxItems();

  return (
    <div className="space-y-8">
      {!people.length ? (
        <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <p>
            <span className="font-semibold">Welcome — the CRM is empty.</span> Three ways to start: add a person on the{" "}
            <Link href="/people" className="font-semibold underline">People page</Link>,{" "}
            <Link href="/import" className="font-semibold underline">import your LinkedIn connections</Link>, or paste a
            LinkedIn profile into <Link href="/intake" className="font-semibold underline">Intake</Link>. The AI features are
            set up on <Link href="/settings" className="font-semibold underline">Settings</Link>.
          </p>
          <AiStatusBanner />
        </div>
      ) : null}
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-stone-500">
          {overdue.length > 0
            ? `${overdue.length} overdue item${overdue.length === 1 ? "" : "s"} need your move.`
            : "Nothing overdue — nice."}{" "}
          {awaiting.length} awaiting the other party.
        </p>
      </header>

      {/* Pipeline summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["active", "exploring", "new", "dormant"].map((key) => {
          const s = STATUS[key];
          const n = stats.people.find((r) => r.status_key === key)?.n ?? 0;
          const nc = stats.companies.find((r) => r.status_key === key)?.n ?? 0;
          return (
            <Link
              key={key}
              href={`/people?status=${key}`}
              className="rounded-xl border border-stone-200 bg-white p-4 hover:border-indigo-300"
            >
              <div className="text-xs font-medium text-stone-500">
                {s.emoji} {s.label}
              </div>
              <div className="mt-1 text-2xl font-bold">{n}</div>
              <div className="text-xs text-stone-400">
                people · {nc} companies
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pipeline strip */}
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              ⚑ Pipeline — {opps.length} open
            </h2>
            <Link href="/pipeline" className="text-xs font-medium text-indigo-600 hover:underline">
              Full board →
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {Object.entries(STAGES)
              .filter(([, s]) => s.open)
              .sort((a, b) => a[1].order - b[1].order)
              .map(([key, s]) => {
                const n = opps.filter((o) => o.stage === key).length;
                return (
                  <span key={key} className={n ? "text-stone-700" : "text-stone-300"}>
                    {s.icon} {s.label}: <span className="font-bold">{n}</span>
                  </span>
                );
              })}
          </div>
          <ul className="mt-3 space-y-1.5 border-t border-stone-100 pt-3">
            {opps
              .filter((o) => o.priority === 1)
              .map((o) => (
                <li key={o.id} className="text-sm">
                  <span className="font-bold text-red-600">★</span>{" "}
                  <span className="font-medium text-stone-800">{o.name}</span>
                  {o.next_step ? (
                    <span className="text-xs text-stone-500"> — {o.next_step}</span>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>

        {/* Inbox — emails still needing a review or a fix */}
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              📥 Inbox — {inbox.length} open
            </h2>
            <Link href="/inbox" className="text-xs font-medium text-indigo-600 hover:underline">
              Inbox →
            </Link>
          </div>
          {inbox.length ? (
            <ul className="mt-3 max-h-64 divide-y divide-stone-100 overflow-y-auto">
              {inbox.map((m) => {
                const st = INBOX_STATE[m.state];
                return (
                  <li key={m.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      <Link href={`/inbox/${m.id}`} className="font-medium text-stone-800 hover:text-indigo-700">
                        {cleanSubject(m.subject ?? "") || "(no subject)"}
                      </Link>
                      <span className="text-xs text-stone-400"> · {m.date}</span>
                    </span>
                    <Link
                      href={m.href}
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium hover:opacity-80 ${st.cls}`}
                    >
                      {st.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm italic text-stone-400">Nothing waiting — all emails are dealt with.</p>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Overdue */}
        <section className="rounded-xl border border-red-200 bg-white">
          <header className="border-b border-red-100 bg-red-50/60 px-5 py-3 rounded-t-xl">
            <h2 className="text-sm font-semibold text-red-800">
              {BUCKETS.overdue.icon} {BUCKETS.overdue.label}
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs">
                {overdue.length}
              </span>
            </h2>
          </header>
          <ul className="divide-y divide-stone-100 px-5 py-1 max-h-105 overflow-y-auto">
            {overdue.map((a) => (
              <ActionRow key={a.id} item={a} />
            ))}
            {!overdue.length && (
              <li className="py-4 text-sm italic text-stone-400">All clear.</li>
            )}
          </ul>
        </section>

        <div className="space-y-6">
          {/* This week */}
          <section className="rounded-xl border border-stone-200 bg-white">
            <header className="border-b border-stone-100 bg-amber-50/60 px-5 py-3 rounded-t-xl">
              <h2 className="text-sm font-semibold text-amber-800">
                {BUCKETS.this_week.icon} {BUCKETS.this_week.label}
              </h2>
            </header>
            <ul className="divide-y divide-stone-100 px-5 py-1">
              {thisWeek.map((a) => (
                <ActionRow key={a.id} item={a} />
              ))}
              {!thisWeek.length && (
                <li className="py-4 text-sm italic text-stone-400">Nothing dated.</li>
              )}
            </ul>
          </section>

          {/* Awaiting */}
          <section className="rounded-xl border border-stone-200 bg-white">
            <header className="border-b border-stone-100 bg-sky-50/60 px-5 py-3 rounded-t-xl">
              <h2 className="text-sm font-semibold text-sky-800">
                {BUCKETS.awaiting.icon} {BUCKETS.awaiting.label}
              </h2>
            </header>
            <ul className="divide-y divide-stone-100 px-5 py-1">
              {awaiting.map((a) => (
                <ActionRow key={a.id} item={a} />
              ))}
              {!awaiting.length && (
                <li className="py-4 text-sm italic text-stone-400">Nothing waiting on anyone.</li>
              )}
            </ul>
          </section>

          {/* Log gaps */}
          {logGaps.length > 0 && (
            <section className="rounded-xl border border-stone-200 bg-white">
              <header className="border-b border-stone-100 bg-orange-50/60 px-5 py-3 rounded-t-xl">
                <h2 className="text-sm font-semibold text-orange-800">
                  {BUCKETS.log_gap.icon} {BUCKETS.log_gap.label}
                </h2>
              </header>
              <ul className="divide-y divide-stone-100 px-5 py-1">
                {logGaps.map((a) => (
                  <ActionRow key={a.id} item={a} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent activity</h2>
        {!recent.length ? (
          <p className="rounded-xl border border-stone-200 bg-white p-4 text-sm italic text-stone-400">
            No interactions logged yet — log one from a profile, or let ✎ Log turn a meeting or email into entries.
          </p>
        ) : null}
        <ul className="space-y-1.5">
          {recent.map((i) => (
            <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="tabular-nums text-xs text-stone-400 w-20">{i.date}</span>
              {i.person_slug ? (
                <Link href={`/people/${i.person_slug}`} className="font-medium hover:text-indigo-600">
                  {i.person_name}
                </Link>
              ) : i.company_slug ? (
                <Link href={`/companies/${i.company_slug}`} className="font-medium hover:text-indigo-600">
                  {i.company_name}
                </Link>
              ) : null}
              <span className="text-stone-500 text-xs">{i.channel ?? ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
