/**
 * Dashboard — what needs attention when you sit down: your move (late and
 * due-this-week to-dos, older backlog folded away), deals by stage with days
 * since contact, then what has come in (inbox drafts, news about contacts,
 * replies you're waiting on, recent activity). Quote of the day up top.
 */
import Link from "next/link";
import { getDb, KINDS, STAGES } from "@/lib/db";
import { allOpportunities, allPeople, openActionItems, opportunityHref, recentInteractions } from "@/lib/queries";
import { quoteOfTheDay } from "@/lib/quotes";
import { openInboxItems } from "@/lib/inbox";
import { cleanSubject } from "@/lib/inboxRoute";
import { newsFeed, newsCounts, type NewsFeedItem } from "@/lib/news";
import { loadOwner } from "@/lib/owner.mjs";
import { todayLocal } from "@/lib/dates.mjs";
import type { ActionItemJoined as ActionBase } from "@/lib/types";

/** openActionItems() selects a.*, so created_at is there at runtime. */
type ActionItemJoined = ActionBase & { created_at: string };
import SubmitButton from "@/components/SubmitButton";
import { dashboardCompleteAction, dashboardDismissNews } from "@/lib/dashboardActions";
import AiStatusBanner from "@/components/AiStatusBanner";

export const dynamic = "force-dynamic";

/** An item more than this many days late is "backlog", not "slipped". */
const SLIPPED_DAYS = 14;
/** Deals: days since the last logged contact before the row turns amber / red. */
const QUIET_DAYS = 14;
const COLD_DAYS = 30;

const DAY = 86_400_000;
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / DAY);
}
function short(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Context shown under a to-do: who, their company, the open deal it belongs to, and when you last spoke. */
interface ActionContext {
  company: { name: string; href: string } | null;
  deal: { name: string; href: string } | null;
  lastContact: { date: string; channel: string | null } | null;
}

/** Plain text for a one-line title: drop Markdown markup and a leading "Name:" / "Name / Co —" the context line already shows. */
function cleanTitle(title: string, person: string | null): string {
  let t = title
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (person) {
    const last = person.trim().split(/\s+/).pop()!.toLowerCase();
    const m = t.match(/^([^:—–]{2,60}?)\s*[:—–]\s+/);
    if (m && last.length > 1 && m[1].toLowerCase().includes(last)) t = t.slice(m[0].length);
  }
  return t ? t[0].toUpperCase() + t.slice(1) : title;
}

function ActionLine({ a, today, late, ctx }: { a: ActionItemJoined; today: string; late?: number; ctx: ActionContext }) {
  const due = a.due_date;
  const when =
    late != null
      ? late === 0
        ? "due today"
        : `${late}d late`
      : due
        ? daysBetween(today, due) === 0
          ? "today"
          : daysBetween(today, due) === 1
            ? "tomorrow"
            : new Date(`${due}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
        : "no date";
  const whenTone = late != null ? (late > SLIPPED_DAYS ? "text-stone-400" : "font-semibold text-red-700") : "text-amber-700";
  const meta: React.ReactNode[] = [];
  if (a.person_name)
    meta.push(
      <Link key="p" href={`/people/${a.person_slug}`} className="font-medium text-stone-600 hover:text-indigo-700">
        {a.person_name}
      </Link>
    );
  if (ctx.company)
    meta.push(
      <Link key="c" href={ctx.company.href} title={ctx.company.name} className="hover:text-indigo-700">
        {ctx.company.name.replace(/\s*\(.*\)\s*$/, "") || ctx.company.name}
      </Link>
    );
  if (ctx.deal)
    meta.push(
      <Link key="d" href={ctx.deal.href} className="text-indigo-700/80 hover:text-indigo-700" title="Open deal">
        ⚑ {ctx.deal.name}
      </Link>
    );
  if (a.bucket_raw === "awaiting") meta.push(<span key="w" className="text-sky-700">waiting on reply — chase</span>);
  if (ctx.lastContact)
    meta.push(
      <span key="l">
        last contact {short(ctx.lastContact.date)}
        {ctx.lastContact.channel ? ` (${ctx.lastContact.channel.toLowerCase().replace(/[-_]+/g, " ")})` : ""}
      </span>
    );
  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5">
      <form action={dashboardCompleteAction.bind(null, a.id)} className="flex h-5 items-center">
        <SubmitButton
          title="Mark done"
          className="flex h-4 w-4 items-center justify-center rounded border border-stone-300 bg-white text-[0.6rem] leading-none text-transparent transition-colors hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-600"
        >
          ✓
        </SubmitButton>
      </form>
      <div className="min-w-0">
        <p className="text-sm leading-5 text-stone-800 line-clamp-2" title={a.detail ?? a.title}>
          {cleanTitle(a.title, a.person_name)}
        </p>
        {meta.length ? (
          <p className="mt-1 text-xs leading-4 text-stone-400">
            {meta.map((m, i) => (
              <span key={i}>
                <span>
                  {m}
                  {i < meta.length - 1 ? <span aria-hidden className="text-stone-300">{"\u00a0\u00a0·"}</span> : null}
                </span>
                {i < meta.length - 1 ? " " : null}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <span className={`whitespace-nowrap text-xs leading-5 tabular-nums ${whenTone}`}>{when}</span>
    </li>
  );
}

function NewsLine({ n, dealRefs }: { n: NewsFeedItem; dealRefs: Set<string> }) {
  const deal = n.about.some((a) => dealRefs.has(a.ref));
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-2">
        <a
          href={n.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium leading-snug text-stone-800 hover:text-indigo-700 hover:underline"
        >
          {n.headline}
        </a>
        <form action={dashboardDismissNews.bind(null, n.id)}>
          <button title="Dismiss" aria-label="Dismiss" className="rounded px-1 text-base leading-none text-stone-300 hover:bg-stone-100 hover:text-stone-600">
            ×
          </button>
        </form>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-400">
        {deal ? <span className="rounded bg-indigo-50 px-1.5 font-medium text-indigo-700">⚑ deal</span> : null}
        <span>
          {n.source ?? new URL(n.url).hostname.replace(/^www\./, "")}
          {n.published ? ` · ${short(n.published)}` : ""}
        </span>
        {n.about.map((a) => (
          <Link key={a.ref} href={a.href} className="text-stone-500 hover:text-indigo-600">
            {a.name}
          </Link>
        ))}
      </div>
    </li>
  );
}

export default function Dashboard() {
  const db = getDb();
  const today = todayLocal();
  const owner = loadOwner();
  const people = allPeople();

  // ── Your move: everything with a date that is due within a week or already late,
  //    plus awaiting items whose follow-up date has passed ("chase").
  const actions = openActionItems() as ActionItemJoined[];
  const lateness = (a: ActionItemJoined) => daysBetween(a.due_date ?? a.created_at.slice(0, 10), today);
  const late = actions.filter((a) => a.bucket === "overdue").sort((x, y) => lateness(x) - lateness(y));
  const slipped = late.filter((a) => lateness(a) <= SLIPPED_DAYS);
  const backlog = late.filter((a) => lateness(a) > SLIPPED_DAYS);
  const upcoming = actions.filter(
    (a) => a.bucket !== "overdue" && a.bucket_raw !== "awaiting" && a.due_date && daysBetween(today, a.due_date) <= 7
  );
  const logGaps = actions.filter((a) => a.bucket === "log_gap");
  const waiting = actions.filter((a) => a.bucket === "awaiting");

  // ── Deals in motion: open opportunities, with days since the last logged
  //    interaction with their person or company.
  const lastContact = db.prepare(
    `SELECT MAX(date) AS d FROM interactions WHERE (person_id IS NOT NULL AND person_id = ?) OR (company_id IS NOT NULL AND company_id = ?)`
  );
  const deals = allOpportunities()
    .filter((o) => STAGES[o.stage]?.open)
    .map((o) => {
      const d = (lastContact.get(o.person_id ?? -1, o.company_id ?? -1) as { d: string | null }).d;
      return { ...o, last: d, quiet: d ? daysBetween(d.slice(0, 10), today) : null };
    })
    .sort(
      (a, b) =>
        (STAGES[b.stage]?.order ?? 0) - (STAGES[a.stage]?.order ?? 0) ||
        // job opportunities (a "separate" kind) after business development within a stage
        Number(KINDS[a.kind]?.separate ?? false) - Number(KINDS[b.kind]?.separate ?? false) ||
        a.priority - b.priority ||
        a.name.localeCompare(b.name)
    );
  const goingQuiet = deals.filter((d) => d.quiet == null || d.quiet > COLD_DAYS).length;

  // ── Context for each to-do: company (the item's, else the person's), an open
  //    deal on the same person or company, and the last logged contact.
  const personCompany = new Map(people.map((p) => [p.id, p.company_slug ? { name: p.company_name!, href: `/companies/${p.company_slug}`, id: p.company_id } : null]));
  const lastTouch = db.prepare(
    `SELECT date, channel FROM interactions WHERE person_id = ? AND date GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY date DESC, id DESC LIMIT 1`
  );
  const contextFor = (a: ActionItemJoined): ActionContext => {
    const pc = a.person_id ? personCompany.get(a.person_id) ?? null : null;
    const company = a.company_slug ? { name: a.company_name!, href: `/companies/${a.company_slug}` } : pc ? { name: pc.name, href: pc.href } : null;
    const companyId = a.company_id ?? pc?.id ?? null;
    const deal =
      deals.find((d) => a.person_id && d.person_id === a.person_id) ?? deals.find((d) => companyId && d.company_id === companyId) ?? null;
    const lc = a.person_id ? (lastTouch.get(a.person_id) as { date: string; channel: string | null } | undefined) : undefined;
    return { company, deal: deal ? { name: deal.name, href: opportunityHref(deal) } : null, lastContact: lc ?? null };
  };

  // ── Signals: inbox drafts to review, and news — deal-related first.
  const inbox = openInboxItems();
  const dealRefs = new Set<string>();
  for (const d of deals) {
    if (d.person_slug) dealRefs.add(`p:${d.person_slug}`);
    if (d.company_slug) dealRefs.add(`c:${d.company_slug}`);
  }
  const allNews = newsFeed({ limit: 60 });
  const isDeal = (n: NewsFeedItem) => n.about.some((a) => dealRefs.has(a.ref));
  const news = [...allNews.filter(isDeal), ...allNews.filter((n) => !isDeal(n))].slice(0, 6);
  const newsTotal = newsCounts().open;

  const recent = recentInteractions(8);
  const quote = quoteOfTheDay(today);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dueNowCount = slipped.length + upcoming.length;

  const card = "rounded-xl border border-stone-200 bg-white";
  const cardHead = "flex items-baseline justify-between border-b border-stone-100 px-5 py-3";
  const h2 = "text-sm font-semibold text-stone-800";
  const more = "text-xs font-medium text-indigo-600 hover:underline";

  return (
    <div className="space-y-6">
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
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}
          {owner.configured ? `, ${owner.first}` : ""}
        </h1>
        <figure className="mt-2 max-w-2xl border-l-2 border-indigo-200 pl-3">
          <blockquote className="font-serif text-[0.95rem] italic leading-snug text-stone-600">&ldquo;{quote.text}&rdquo;</blockquote>
          <figcaption className="mt-0.5 text-xs text-stone-400">— {quote.author}</figcaption>
        </figure>
        <p className="mt-3 text-sm text-stone-500">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} ·{" "}
          {[
            dueNowCount ? `${dueNowCount} on your plate this week` : "nothing due this week",
            inbox.length ? `${inbox.length} email${inbox.length === 1 ? "" : "s"} to review` : null,
            goingQuiet ? `${goingQuiet} deal${goingQuiet === 1 ? "" : "s"} gone quiet` : null,
            newsTotal ? `${newsTotal} news item${newsTotal === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ─────────── Left: what I do and what I'm working ─────────── */}
        <div className="space-y-6 lg:col-span-2">
          <section className={card}>
            <div className={cardHead}>
              <h2 className={h2}>☑ Your move</h2>
              <Link href="/actions" className={more}>
                All actions →
              </Link>
            </div>
            <div className="px-5 pb-2">
              {slipped.length ? (
                <>
                  <h3 className="pt-4 pb-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-red-700">Late</h3>
                  <ul className="divide-y divide-stone-100">
                    {slipped.map((a) => (
                      <ActionLine key={a.id} a={a} ctx={contextFor(a)} today={today} late={lateness(a)} />
                    ))}
                  </ul>
                </>
              ) : null}
              <h3 className="pt-4 pb-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-amber-700">Next 7 days</h3>
              {upcoming.length ? (
                <ul className="divide-y divide-stone-100">
                  {upcoming.map((a) => (
                    <ActionLine key={a.id} a={a} ctx={contextFor(a)} today={today} />
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-sm italic text-stone-400">Nothing dated this week.</p>
              )}
              {logGaps.length ? (
                <>
                  <h3 className="pt-4 pb-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-orange-700">Not logged yet</h3>
                  <ul className="divide-y divide-stone-100">
                    {logGaps.map((a) => (
                      <ActionLine key={a.id} a={a} ctx={contextFor(a)} today={today} />
                    ))}
                  </ul>
                </>
              ) : null}
              {backlog.length ? (
                <details className="mt-2 border-t border-stone-100 pt-2">
                  <summary className="cursor-pointer py-1 text-xs text-stone-500 hover:text-stone-800">
                    <b>{backlog.length} older items</b> more than {SLIPPED_DAYS} days late — do, re-date or drop them
                  </summary>
                  <ul className="divide-y divide-stone-100 opacity-80">
                    {backlog.map((a) => (
                      <ActionLine key={a.id} a={a} ctx={contextFor(a)} today={today} late={lateness(a)} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </section>

          <section className={card}>
            <div className={cardHead}>
              <h2 className={h2}>⚑ Deals in motion — {deals.length}</h2>
              <Link href="/pipeline" className={more}>
                Board →
              </Link>
            </div>
            <ul className="divide-y divide-stone-100 px-5">
              {deals.map((o, i) => {
                const s = STAGES[o.stage];
                const header = i === 0 || deals[i - 1].stage !== o.stage;
                const kind = KINDS[o.kind];
                const tone =
                  o.quiet == null || o.quiet > COLD_DAYS ? "text-red-700" : o.quiet > QUIET_DAYS ? "text-amber-700" : "text-stone-400";
                return (
                  <li key={o.id} className={kind?.card ? "border-b-0 py-1.5" : "py-2.5"}>
                    {header ? (
                      <h3 className="-mt-0.5 mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-stone-500">
                        {s?.icon} {s?.label} · {deals.filter((d) => d.stage === o.stage).length}
                      </h3>
                    ) : null}
                    <div className={kind?.card ? `-mx-2 rounded-md border px-2 py-1.5 ${kind.card}` : ""}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <Link href={opportunityHref(o)} className="min-w-0 truncate text-sm font-medium text-stone-800 hover:text-indigo-700">
                          {o.priority === 1 ? <span className="text-red-600">★ </span> : null}
                          {o.name}
                        </Link>
                        {kind?.separate ? (
                          <span className={`shrink-0 rounded-full px-1.5 text-[0.65rem] font-medium ring-1 ring-inset ${kind.badge}`}>{kind.label}</span>
                        ) : null}
                      </span>
                      <span className={`shrink-0 text-xs tabular-nums ${tone}`}>
                        {o.quiet == null ? "no contact logged" : o.quiet === 0 ? "talked today" : `${o.quiet}d since contact`}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500">
                      {o.next_step ? <span className="line-clamp-1">→ {o.next_step}</span> : <span className="italic text-stone-400">no next step set</span>}
                    </div>
                    </div>
                  </li>
                );
              })}
              {!deals.length ? <li className="py-4 text-sm italic text-stone-400">No open deals.</li> : null}
            </ul>
          </section>
        </div>

        {/* ─────────── Right: what's come in ─────────── */}
        <div className="space-y-6">
          {inbox.length ? (
            <section className={card}>
              <div className={cardHead}>
                <h2 className={h2}>📥 To review — {inbox.length}</h2>
                <Link href="/inbox" className={more}>
                  Inbox →
                </Link>
              </div>
              <ul className="divide-y divide-stone-100 px-5">
                {inbox.slice(0, 6).map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-2 py-2 text-sm">
                    <Link href={m.href} className="min-w-0 truncate text-stone-800 hover:text-indigo-700">
                      {cleanSubject(m.subject ?? "") || "(no subject)"}
                    </Link>
                    <span
                      className={`shrink-0 text-xs ${m.state === "ready" ? "font-medium text-green-700" : m.state === "error" ? "text-red-700" : "text-stone-400"}`}
                    >
                      {m.state === "ready" ? "review" : m.state === "error" ? "failed" : m.state === "working" ? "drafting…" : "not routed"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={card}>
            <div className={cardHead}>
              <h2 className={h2}>📰 In the news</h2>
              <Link href="/news" className={more}>
                All {newsTotal} →
              </Link>
            </div>
            <ul className="divide-y divide-stone-100 px-5">
              {news.map((n) => (
                <NewsLine key={n.id} n={n} dealRefs={dealRefs} />
              ))}
              {!news.length ? <li className="py-4 text-sm italic text-stone-400">No news about your contacts right now.</li> : null}
            </ul>
          </section>

          <section className={card}>
            <div className={cardHead}>
              <h2 className={h2}>⏳ Waiting on others — {waiting.length}</h2>
            </div>
            <ul className="divide-y divide-stone-100 px-5">
              {waiting.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="line-clamp-2 text-stone-700">{a.title}</div>
                  <div className="mt-0.5 flex justify-between text-xs text-stone-400">
                    <span>{a.person_name ?? a.company_name ?? ""}</span>
                    <span>
                      {a.due_date ? `nudge ${short(a.due_date)}` : `asked ${daysBetween(a.created_at.slice(0, 10), today)}d ago`}
                    </span>
                  </div>
                </li>
              ))}
              {!waiting.length ? <li className="py-4 text-sm italic text-stone-400">Nobody owes you a reply.</li> : null}
            </ul>
          </section>

          <section className={card}>
            <div className={cardHead}>
              <h2 className={h2}>↺ Recent activity</h2>
            </div>
            <ul className="divide-y divide-stone-100 px-5">
              {recent.map((i) => {
                const who = i.person_slug
                  ? { name: i.person_name, href: `/people/${i.person_slug}` }
                  : i.company_slug
                    ? { name: i.company_name, href: `/companies/${i.company_slug}` }
                    : null;
                return (
                  <li key={i.id} className="py-2 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      {who ? (
                        <Link href={who.href} className="min-w-0 truncate font-medium text-stone-800 hover:text-indigo-700">
                          {who.name}
                        </Link>
                      ) : (
                        <span />
                      )}
                      <span className="shrink-0 text-xs tabular-nums text-stone-400">
                        {i.channel ? `${i.channel} · ` : ""}
                        {short(i.date)}
                      </span>
                    </div>
                    {i.summary ? (
                      <div className="mt-0.5 line-clamp-1 text-xs text-stone-500">{i.summary.replace(/[#*_>`]/g, "").replace(/\s+/g, " ")}</div>
                    ) : null}
                  </li>
                );
              })}
              {!recent.length ? <li className="py-4 text-sm italic text-stone-400">No interactions logged yet.</li> : null}
            </ul>
          </section>
        </div>
      </div>

    </div>
  );
}
