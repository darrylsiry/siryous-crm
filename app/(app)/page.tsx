/**
 * Dashboard — what needs attention when you sit down: your move (late and
 * due-this-week to-dos, undated ones and the older backlog folded away), who
 * is due a touch, deals (those needing attention first) with days since
 * contact, then what has come in (inbox drafts, news about contacts, replies
 * you're waiting on, recent activity). Quote of the day up top.
 */
import Link from "next/link";
import { getDb, KINDS, STAGES } from "@/lib/db";
import {
  DEAL_COLD_DAYS,
  allOpportunities,
  allPeople,
  dealQuietDays,
  dealQuietLabel,
  followUps,
  openActionItems,
  opportunityHref,
  peopleOptions,
  recentInteractions,
} from "@/lib/queries";
import { quoteOfTheDay } from "@/lib/quotes";
import { openInboxItems } from "@/lib/inbox";
import { cleanSubject } from "@/lib/inboxRoute";
import { newsEnabled, newsFeed, newsCounts, type NewsFeedItem } from "@/lib/news";
import { hostOf } from "@/lib/newsCore";
import { loadOwner } from "@/lib/owner.mjs";
import { shortDate, todayLocal } from "@/lib/dates.mjs";
import { backupHealth } from "@/lib/backup.mjs";
import type { ActionItemJoined as ActionBase } from "@/lib/types";

/** openActionItems() selects a.*, so created_at is there at runtime. */
type ActionItemJoined = ActionBase & { created_at: string };
import { dashboardDismissNews, hideSetupChecklist } from "@/lib/dashboardActions";
import { getAiStatus } from "@/lib/aiStatus";
import { getSetting } from "@/lib/settings";
import { getInboxSettings } from "@/lib/inbox";
import { setDealNextStep } from "@/lib/actions";
import AiStatusBanner from "@/components/AiStatusBanner";
import ActionEdit from "@/components/ActionEdit";
import DoneTick from "@/components/DoneTick";
import QuickLog from "@/components/QuickLog";
import PendingButton from "@/components/PendingButton";
import { PeopleOptions } from "@/components/PeoplePicker";
import { todoDetail, todoTitle } from "@/components/ActionList";
import { inboxStateLabel } from "@/lib/stateWords";
import OpenOnHash from "@/components/OpenOnHash";
import KeepTypedForm from "@/components/KeepTypedForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard" };

/** An item more than this many days late is "backlog", not "slipped". */
const SLIPPED_DAYS = 14;
/** Waiting on others: an ask older than this, with no nudge date, reads "chase". */
const CHASE_DAYS = 14;
/** How many of the most overdue Keep Warm people the Dashboard lists. */
const TOUCH_ROWS = 5;

const DAY = 86_400_000;
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / DAY);
}

/** Context shown under a to-do: who, their company, the open deal it belongs to, and when you last spoke. */
interface ActionContext {
  company: { name: string; href: string } | null;
  deal: { name: string; href: string } | null;
  lastContact: { date: string; channel: string | null } | null;
}

/** Plain text for a one-line title: drop Markdown markup and a leading "Name:" / "Name / Co —" the context line already shows. */
function cleanTitle(title: string, person: string | null): string {
  let t = todoTitle({ title });
  if (person) {
    const last = person.trim().split(/\s+/).pop()!.toLowerCase();
    const m = t.match(/^([^:—–]{2,60}?)\s*[:—–]\s+/);
    if (m && last.length > 1 && m[1].toLowerCase().includes(last)) t = t.slice(m[0].length);
  }
  return t ? t[0].toUpperCase() + t.slice(1) : title;
}

function ActionLine({ a, today, late, ctx }: { a: ActionItemJoined; today: string; late?: number; ctx: ActionContext }) {
  const due = a.due_date;
  // Never a negative "late": a date still ahead shows as the date below.
  const when =
    late != null && late >= 0
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
  const whenTone = late != null ? (late > SLIPPED_DAYS ? "text-stone-500" : "font-semibold text-red-700") : due ? "text-amber-700" : "text-stone-500";
  const title = cleanTitle(a.title, a.person_name);
  const detail = todoDetail(a);
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
  if (ctx.lastContact)
    meta.push(
      <span key="l">
        last contact {shortDate(ctx.lastContact.date, today)}
        {ctx.lastContact.channel ? ` (${ctx.lastContact.channel.toLowerCase().replace(/[-_]+/g, " ")})` : ""}
      </span>
    );
  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5">
      <span className="flex h-5 items-center">
        <DoneTick id={a.id} title={title} />
      </span>
      <div className="min-w-0">
        <p className="text-sm leading-5 text-stone-800 line-clamp-2">{title}</p>
        {meta.length ? (
          <p className="mt-1 text-xs leading-4 text-stone-500">
            {meta.map((m, i) => (
              <span key={i}>
                <span>
                  {m}
                  {i < meta.length - 1 ? <span aria-hidden className="text-stone-500">{"  ·"}</span> : null}
                </span>
                {i < meta.length - 1 ? " " : null}
              </span>
            ))}
          </p>
        ) : null}
        {detail ? (
          <details className="mt-1 text-xs text-stone-600">
            <summary className="cursor-pointer text-stone-500 hover:text-stone-800">Details</summary>
            <p className="mt-1 whitespace-pre-line">{detail}</p>
          </details>
        ) : null}
      </div>
      <span className={`whitespace-nowrap text-xs leading-5 tabular-nums ${whenTone}`}>
        <ActionEdit item={a}>
          {when} <span className="text-stone-500 hover:text-indigo-700">✎</span>
        </ActionEdit>
      </span>
    </li>
  );
}

function NewsLine({ n, dealRefs, today }: { n: NewsFeedItem; dealRefs: Set<string>; today: string }) {
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
          <button title="Dismiss" aria-label={`Dismiss: ${n.headline}`} className="-m-2 rounded px-3 py-2 text-base leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-700 sm:m-0 sm:px-1 sm:py-0">
            ×
          </button>
        </form>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
        {deal ? <span className="rounded bg-indigo-50 px-1.5 font-medium text-indigo-700">⚑ deal</span> : null}
        <span>
          {hostOf(n.url) || "source"}
          {n.published ? ` · ${shortDate(n.published, today)}` : ""}
        </span>
        {n.about.map((a) => (
          <Link key={a.ref} href={a.href} className="text-stone-600 hover:text-indigo-600">
            {a.name}
          </Link>
        ))}
      </div>
    </li>
  );
}

export default async function Dashboard() {
  const db = getDb();
  const today = todayLocal();
  const owner = loadOwner();
  const people = allPeople();
  const backup = backupHealth(db);

  // ── Your move: dated to-dos due within a week or already late, and the
  //    undated ones that belong to the dated group. Replies you're waiting on
  //    live in their own card at any age, so each to-do shows once.
  const actions = openActionItems() as ActionItemJoined[];
  const lateness = (a: ActionItemJoined) => daysBetween(a.due_date ?? a.created_at.slice(0, 10), today);
  const waiting = actions
    .filter((a) => a.bucket_raw === "awaiting")
    .sort((x, y) => (x.due_date ?? x.created_at).localeCompare(y.due_date ?? y.created_at));
  const mine = actions.filter((a) => a.bucket_raw !== "awaiting");
  const late = mine.filter((a) => a.bucket === "overdue").sort((x, y) => lateness(x) - lateness(y));
  const slipped = late.filter((a) => lateness(a) <= SLIPPED_DAYS);
  const backlog = late.filter((a) => lateness(a) > SLIPPED_DAYS);
  const logGaps = mine.filter((a) => a.bucket === "log_gap");
  const upcoming = mine.filter(
    (a) => a.bucket !== "overdue" && a.bucket !== "log_gap" && a.due_date && daysBetween(today, a.due_date) <= 7
  );
  const undated = mine.filter((a) => !a.due_date && a.bucket === "this_week");

  // ── Due a touch: the most overdue people on Keep Warm.
  const dueTouch = followUps().filter((f) => f.days_over != null && f.days_over > 0);

  // ── Deals: open opportunities, with days since the last logged interaction
  //    with their person or company. Quiet ones, or ones with no next step,
  //    need attention and are listed first.
  const deals = allOpportunities()
    .filter((o) => STAGES[o.stage]?.open)
    .map((o) => {
      const quiet = dealQuietDays(o, today);
      const nobody = !o.person_id && !o.company_id;
      const why = [
        nobody ? null : quiet == null ? "no contact logged" : quiet > DEAL_COLD_DAYS ? `${quiet}d quiet` : null,
        o.next_step ? null : "no next step",
      ].filter((w): w is string => !!w);
      return { ...o, quiet, why, nobody };
    })
    .sort(
      (a, b) =>
        (STAGES[b.stage]?.order ?? 0) - (STAGES[a.stage]?.order ?? 0) ||
        // job opportunities (a "separate" kind) after business development within a stage
        Number(KINDS[a.kind]?.separate ?? false) - Number(KINDS[b.kind]?.separate ?? false) ||
        a.priority - b.priority ||
        a.name.localeCompare(b.name)
    );
  const attention = deals.filter((d) => d.why.length || d.nobody).sort((a, b) => (b.quiet ?? 9999) - (a.quiet ?? 9999));
  const steady = deals.filter((d) => !d.why.length && !d.nobody);

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
  const toReview = inbox.filter((m) => m.state === "ready" || m.state === "error");
  const drafting = inbox.filter((m) => m.state === "working");
  const dealRefs = new Set<string>();
  for (const d of deals) {
    if (d.person_slug) dealRefs.add(`p:${d.person_slug}`);
    if (d.company_slug) dealRefs.add(`c:${d.company_slug}`);
  }
  const newsOn = newsEnabled();
  const allNews = newsFeed({ limit: 60 });
  const isDeal = (n: NewsFeedItem) => n.about.some((a) => dealRefs.has(a.ref));
  const news = [...allNews.filter(isDeal), ...allNews.filter((n) => !isDeal(n))].slice(0, 6);
  const newsTotal = newsCounts().open;

  const recent = recentInteractions(8);

  // ── Getting started: shown until each step is done (or the owner hides it).
  const ai = await getAiStatus();
  const setup = [
    { done: people.length > 0, text: "Add your first person", href: "/people?add=1#add", hint: "or import your LinkedIn connections" , hintHref: "/import" },
    { done: owner.configured, text: "Tell the AI who you are", href: "/settings#about" },
    { done: ai.aiUsable && !ai.fallingBack, text: "Set up the AI on this Mac", href: "/settings#ai" },
    { done: deals.length > 0 || allOpportunities().length > 0, text: "Add a deal", href: "/pipeline?add=1#add" },
    ...(ai.claude.ok ? [{ done: !!getInboxSettings().address, text: "Set your CRM email address", href: "/inbox" }] : []),
  ];
  const showSetup = setup.some((x) => !x.done) && !getSetting("setup.checklist_hidden");
  const quote = quoteOfTheDay(today);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dueNowCount = slipped.length + upcoming.length;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const card = "rounded-xl border border-stone-200 bg-white";
  const cardHead = "flex items-baseline justify-between border-b border-stone-100 px-5 py-3";
  const h2 = "text-sm font-semibold text-stone-800";
  const more = "text-xs font-medium text-indigo-600 hover:underline";
  const headLink = "hover:text-indigo-700 hover:underline";

  const summary: { text: string; href: string; tone?: string }[] = [
    { text: dueNowCount ? `${dueNowCount} on your plate this week` : "nothing due this week", href: "#your-move" },
  ];
  if (backlog.length) summary.push({ text: `${backlog.length} long overdue`, href: "#backlog", tone: "text-red-700" });
  if (undated.length) summary.push({ text: `${undated.length} with no date`, href: "#undated" });
  if (dueTouch.length) summary.push({ text: `${dueTouch.length} due a touch`, href: "#touch" });
  if (toReview.length) summary.push({ text: `${plural(toReview.length, "email")} to review`, href: "/inbox" });
  if (drafting.length) summary.push({ text: `${drafting.length} still drafting`, href: "/inbox" });
  if (attention.length) summary.push({ text: `${plural(attention.length, "deal")} need${attention.length === 1 ? "s" : ""} attention`, href: "#deals" });
  if (newsTotal) summary.push({ text: plural(newsTotal, "news item"), href: "/news" });

  const dealRow = (o: (typeof deals)[number], flagged: boolean) => {
    const kind = KINDS[o.kind];
    const s = STAGES[o.stage];
    const quiet = o.nobody ? { text: "nobody linked", tone: "text-red-700" } : dealQuietLabel(o.quiet);
    return (
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
            {flagged ? <span className="shrink-0 text-xs text-stone-500">{s?.icon} {s?.label}</span> : null}
          </span>
          <span className={`shrink-0 text-xs tabular-nums ${quiet.tone}`}>{quiet.text}</span>
        </div>
        {flagged ? (
          <>
            <p className="mt-0.5 text-xs font-medium text-red-700">
              Needs attention: {[...(o.nobody ? ["no person or company linked"] : []), ...o.why].join(" · ")}
              {o.nobody ? (
                <>
                  {" — "}
                  <Link href={opportunityHref(o)} className="underline">
                    Link one →
                  </Link>
                </>
              ) : null}
            </p>
            {o.next_step ? <p className="mt-0.5 line-clamp-1 text-xs text-stone-600">→ {o.next_step}</p> : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {!o.next_step ? (
                <KeepTypedForm action={setDealNextStep} clearOnSave className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input type="hidden" name="id" value={o.id} />
                  <input
                    name="next_step"
                    required
                    placeholder="Next step…"
                    aria-label={`Next step for ${o.name}`}
                    className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1 text-xs"
                  />
                  <PendingButton
                    label="Save"
                    pendingLabel="Saving…"
                    className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                  />
                </KeepTypedForm>
              ) : null}
              <QuickLog personId={o.person_id} companyId={o.company_id} name={o.person_name ?? o.company_name ?? o.name} />
            </div>
          </>
        ) : (
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-600">
            <span className="line-clamp-1">→ {o.next_step}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <PeopleOptions options={peopleOptions()}>
      <OpenOnHash />
      <div className="space-y-6">
        {showSetup ? (
          <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">{people.length ? "Getting started" : "Welcome — the CRM is empty. Getting started:"}</h2>
              <form action={hideSetupChecklist}>
                <button className="text-xs font-medium text-indigo-700 hover:underline">Hide this</button>
              </form>
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {setup.map((x) => (
                <li key={x.text} className="flex items-baseline gap-2">
                  <span aria-hidden className={x.done ? "text-green-700" : "text-indigo-400"}>
                    {x.done ? "✓" : "○"}
                  </span>
                  {x.done ? (
                    <span className="text-stone-600 line-through decoration-stone-400">{x.text}</span>
                  ) : (
                    <span>
                      <Link href={x.href} className="font-semibold underline">
                        {x.text}
                      </Link>
                      {"hint" in x && x.hint ? (
                        <>
                          {" "}
                          <span className="text-indigo-900/80">
                            ({x.hintHref ? <Link href={x.hintHref} className="underline">{x.hint}</Link> : x.hint})
                          </span>
                        </>
                      ) : null}
                    </span>
                  )}
                  <span className="sr-only">{x.done ? "(done)" : "(to do)"}</span>
                </li>
              ))}
            </ul>
            <AiStatusBanner />
          </section>
        ) : null}
        {backup.warning ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            <span className="font-semibold">Backups need attention.</span> {backup.warning}{" "}
            <Link href="/settings" className="font-semibold underline">
              Settings
            </Link>
          </p>
        ) : null}
        <header>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting}
            {owner.configured ? `, ${owner.first}` : ""}
          </h1>
          <figure className="mt-2 max-w-2xl border-l-2 border-indigo-200 pl-3">
            <blockquote className="font-serif text-[0.95rem] italic leading-snug text-stone-600">&ldquo;{quote.text}&rdquo;</blockquote>
            <figcaption className="mt-0.5 text-xs text-stone-500">— {quote.author}</figcaption>
          </figure>
          <p className="mt-3 text-sm text-stone-600">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            {summary.map((s) => (
              <span key={s.text}>
                {" · "}
                <a href={s.href} className={`${headLink} ${s.tone ?? ""}`}>
                  {s.text}
                </a>
              </span>
            ))}
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ─────────── Left: what I do and what I'm working ─────────── */}
          <div className="space-y-6 lg:col-span-2">
            <section id="your-move" className={`${card} scroll-mt-4`}>
              <div className={cardHead}>
                <h2 className={h2}>☑ Your move</h2>
                <Link href="/actions" className={more}>
                  All to-dos →
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
                  <p className="py-2 text-sm italic text-stone-500">Nothing dated this week.</p>
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
                  <details id="backlog" className="mt-2 scroll-mt-4 border-t border-stone-100 pt-2">
                    <summary className="cursor-pointer py-1 text-xs text-stone-600 hover:text-stone-900">
                      <b>{plural(backlog.length, "older item")}</b> more than {SLIPPED_DAYS} days late — do, re-date (✎ on the date) or drop them
                    </summary>
                    <ul className="divide-y divide-stone-100">
                      {backlog.map((a) => (
                        <ActionLine key={a.id} a={a} ctx={contextFor(a)} today={today} late={lateness(a)} />
                      ))}
                    </ul>
                  </details>
                ) : null}
                {undated.length ? (
                  <details id="undated" className="mt-2 scroll-mt-4 border-t border-stone-100 pt-2">
                    <summary className="cursor-pointer py-1 text-xs text-stone-600 hover:text-stone-900">
                      <b>{undated.length} with no date</b> — give them a date (✎) or drop them
                    </summary>
                    <ul className="divide-y divide-stone-100">
                      {undated.map((a) => (
                        <ActionLine key={a.id} a={a} ctx={contextFor(a)} today={today} />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </section>

            {dueTouch.length ? (
              <section id="touch" className={`${card} scroll-mt-4`}>
                <div className={cardHead}>
                  <h2 className={h2}>♨ Due a touch — {dueTouch.length}</h2>
                  <Link href="/followups" className={more}>
                    Keep Warm →
                  </Link>
                </div>
                <ul className="divide-y divide-stone-100 px-5">
                  {dueTouch.slice(0, TOUCH_ROWS).map((f) => (
                    <li key={f.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm">
                          <Link href={`/people/${f.slug}`} className="font-medium text-stone-800 hover:text-indigo-700">
                            {f.name}
                          </Link>
                          {f.company_name ? <span className="text-xs text-stone-500"> · {f.company_name}</span> : null}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500">
                          <span className="font-medium text-red-700">
                            {f.days_over != null && f.days_over >= 9999 ? "no touch logged" : `${f.days_over}d overdue`}
                          </span>
                          {f.last_touch ? ` · last ${shortDate(f.last_touch, today)}` : ""}
                          {f.cadence_days ? ` · every ${f.cadence_days}d` : ""}
                        </p>
                        {f.next_action ? <p className="mt-0.5 line-clamp-1 text-xs text-stone-600">Next step: {f.next_action}</p> : null}
                      </div>
                      <QuickLog personId={f.id} name={f.name} />
                    </li>
                  ))}
                </ul>
                {dueTouch.length > TOUCH_ROWS ? (
                  <p className="border-t border-stone-100 px-5 py-2 text-xs text-stone-500">
                    And {dueTouch.length - TOUCH_ROWS} more on{" "}
                    <Link href="/followups" className="font-medium text-indigo-600 hover:underline">
                      Keep Warm
                    </Link>
                    .
                  </p>
                ) : null}
              </section>
            ) : null}

            <section id="deals" className={`${card} scroll-mt-4`}>
              <div className={cardHead}>
                <h2 className={h2}>⚑ Deals in motion — {deals.length}</h2>
                <Link href="/pipeline" className={more}>
                  Board →
                </Link>
              </div>
              <ul className="divide-y divide-stone-100 px-5">
                {attention.map((o, i) => (
                  <li key={o.id} className="py-2.5">
                    {i === 0 ? (
                      <h3 className="-mt-0.5 mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-red-700">
                        Needs attention · {attention.length}
                      </h3>
                    ) : null}
                    {dealRow(o, true)}
                  </li>
                ))}
                {steady.map((o, i) => {
                  const s = STAGES[o.stage];
                  const header = i === 0 || steady[i - 1].stage !== o.stage;
                  return (
                    <li key={o.id} className={KINDS[o.kind]?.card ? "border-b-0 py-1.5" : "py-2.5"}>
                      {header ? (
                        <h3 className="-mt-0.5 mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-stone-500">
                          {s?.icon} {s?.label} · {steady.filter((d) => d.stage === o.stage).length}
                        </h3>
                      ) : null}
                      {dealRow(o, false)}
                    </li>
                  );
                })}
                {!deals.length ? <li className="py-4 text-sm italic text-stone-500">No open deals.</li> : null}
              </ul>
            </section>
          </div>

          {/* ─────────── Right: what's come in ─────────── */}
          <div className="space-y-6">
            {inbox.length ? (
              <section className={card}>
                <div className={cardHead}>
                  <h2 className={h2}>
                    📥 To review — {toReview.length}
                    {drafting.length ? <span className="font-normal text-stone-500"> · {drafting.length} drafting</span> : null}
                  </h2>
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
                        className={`shrink-0 text-xs ${m.state === "ready" ? "font-medium text-green-700" : m.state === "error" ? "text-red-700" : "text-stone-500"}`}
                      >
                        {inboxStateLabel(m.state)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className={card}>
              <div className={cardHead}>
                <h2 className={h2}>📰 In the news</h2>
                {newsTotal ? (
                  <Link href="/news" className={more}>
                    All {newsTotal} →
                  </Link>
                ) : null}
              </div>
              <ul className="divide-y divide-stone-100 px-5">
                {news.map((n) => (
                  <NewsLine key={n.id} n={n} dealRefs={dealRefs} today={today} />
                ))}
                {!news.length ? (
                  <li className="py-4 text-sm text-stone-500">
                    {newsOn ? (
                      <span className="italic">No news about your contacts right now.</span>
                    ) : (
                      <>
                        The daily news search is off.{" "}
                        <Link href="/news" className="font-medium text-indigo-600 hover:underline">
                          Turn it on →
                        </Link>
                      </>
                    )}
                  </li>
                ) : null}
              </ul>
            </section>

            <section className={card}>
              <div className={cardHead}>
                <h2 className={h2}>⏳ Waiting on others — {waiting.length}</h2>
              </div>
              <ul className="divide-y divide-stone-100 px-5">
                {waiting.map((a) => {
                  const asked = daysBetween(a.created_at.slice(0, 10), today);
                  const overdueNudge = !!a.due_date && a.due_date < today;
                  const chase = overdueNudge || (!a.due_date && asked > CHASE_DAYS);
                  const who = a.person_slug
                    ? { name: a.person_name, href: `/people/${a.person_slug}` }
                    : a.company_slug
                      ? { name: a.company_name, href: `/companies/${a.company_slug}` }
                      : null;
                  const title = todoTitle(a);
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-stone-700">{title}</div>
                        <div className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-xs text-stone-500">
                          {who ? (
                            <Link href={who.href} className="hover:text-indigo-700">
                              {who.name}
                            </Link>
                          ) : (
                            <span />
                          )}
                          <span className={chase ? "font-medium text-amber-700" : ""}>
                            {a.due_date
                              ? overdueNudge
                                ? `nudge was due ${shortDate(a.due_date, today)} — chase`
                                : `nudge ${shortDate(a.due_date, today)}`
                              : `asked ${asked}d ago${chase ? " — chase" : ""}`}
                          </span>
                        </div>
                      </div>
                      <DoneTick id={a.id} title={title} label="Got it" />
                    </li>
                  );
                })}
                {!waiting.length ? <li className="py-4 text-sm italic text-stone-500">Nobody owes you a reply.</li> : null}
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
                        <span className="shrink-0 text-xs tabular-nums text-stone-500">
                          {i.channel ? `${i.channel} · ` : ""}
                          {shortDate(i.date, today)}
                        </span>
                      </div>
                      {i.summary ? (
                        <div className="mt-0.5 line-clamp-1 text-xs text-stone-600">{i.summary.replace(/[#*_>`]/g, "").replace(/\s+/g, " ")}</div>
                      ) : null}
                    </li>
                  );
                })}
                {!recent.length ? <li className="py-4 text-sm italic text-stone-500">No interactions logged yet.</li> : null}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </PeopleOptions>
  );
}
