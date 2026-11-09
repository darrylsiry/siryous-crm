import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, BUCKETS, PICKABLE_BUCKETS } from "@/lib/db";
import type { LogAnalysis, ProgressEvent } from "@/lib/ai";
import { confirmLog, discardLog, logToIntake, retryLog, retryLogOn, saveLogAsTyped } from "@/lib/logmeeting";
import { draftFromInbox, NOBODY_FOUND } from "@/lib/drafts";
import { readReceipt, receiptLine } from "@/lib/receipts";
import { isIsoDate, parseDueDate, todayLocal } from "@/lib/dates.mjs";
import Markdown from "@/components/Markdown";
import PendingButton from "@/components/PendingButton";
import ActivityFeed from "@/components/ActivityFeed";
import FeedRecap from "@/components/FeedRecap";
import LogEntryTarget from "@/components/LogEntryTarget";
import EditableMarkdown from "@/components/EditableMarkdown";
import CopyButton from "@/components/CopyButton";
import SearchSelect from "@/components/SearchSelect";
import AiRouteNote from "@/components/AiRouteNote";
import { COMPANY_TARGET } from "@/lib/logHint";
import { stateWord } from "@/lib/stateWords";
import { typicalRunSeconds } from "@/lib/progress";
import ErrorExplain from "@/components/ErrorExplain";
import { nameFromSlug, sourceName } from "@/lib/names";

export const dynamic = "force-dynamic";

export const metadata = { title: "Log review" };

const input = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";
const label = "block text-xs font-medium text-stone-600";
const secondary = "rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100";

export default async function LogReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nothing?: string }>;
}) {
  const { id } = await params;
  const nothing = !!(await searchParams).nothing;
  const db = getDb();
  const draft = db.prepare(`SELECT * FROM log_drafts WHERE id=?`).get(Number(id)) as
    | {
        id: number;
        raw_text: string;
        fetched_text: string | null;
        source: string;
        result_json: string | null;
        status: string;
        error: string | null;
        progress: string | null;
        hint_person_id: number | null;
        hint_company_id: number | null;
        meeting_date: string | null;
        meeting_channel: string | null;
      }
    | undefined;
  if (!draft) notFound();
  // What an email suggested is offered unticked: its text may have been written to steer the AI.
  const fromInbox = draftFromInbox(db, "log", draft.id);
  const today = todayLocal();
  // Where the draft was opened from, so every state of this page can link back.
  const origin = draft.hint_person_id
    ? (db.prepare(`SELECT slug, name FROM people WHERE id=?`).get(draft.hint_person_id) as { slug: string; name: string } | undefined)
    : draft.hint_company_id
      ? (db.prepare(`SELECT slug, name FROM companies WHERE id=?`).get(draft.hint_company_id) as { slug: string; name: string } | undefined)
      : undefined;
  const originHref = origin ? (draft.hint_person_id ? `/people/${origin.slug}` : `/companies/${origin.slug}`) : null;
  const back = (
    <div className="flex gap-3">
      <Link href="/log" className="text-xs text-stone-500 hover:text-indigo-600">
        ← Log
      </Link>
      {origin && originHref ? (
        <Link href={originHref} className="text-xs text-stone-500 hover:text-indigo-600">
          ← {origin.name}
        </Link>
      ) : null}
    </div>
  );
  const sourceText = draft.fetched_text ?? draft.raw_text;
  const what = draft.source === "paste" ? "Your notes" : draft.fetched_text ? `What was fetched from ${sourceName(draft.source)}` : "What you asked for";

  if (draft.status === "analyzing" || draft.status === "pending") {
    let events: ProgressEvent[] = [];
    try {
      events = draft.progress ? (JSON.parse(draft.progress) as ProgressEvent[]) : [];
    } catch {}
    return (
      <div className="max-w-3xl space-y-4">
        <header>
          {back}
          <h1 className="mt-1 text-2xl font-bold tracking-tight">✎ Drafting log entries…</h1>
        </header>
        <ActivityFeed
          kind="log"
          id={draft.id}
          title={`Log draft (${draft.source === "paste" ? "pasted notes" : draft.source})`}
          subtitle={draft.raw_text.slice(0, 90) + "…"}
          initialEvents={events}
          typicalSecs={typicalRunSeconds("log")}
        />
      </div>
    );
  }

  if (draft.status === "error") {
    const nobody = draft.error?.startsWith(NOBODY_FOUND) ?? false;
    const roster = nobody
      ? (db.prepare(`SELECT id, name FROM people ORDER BY name`).all() as { id: number; name: string }[])
      : [];
    return (
      <div className="max-w-3xl space-y-4">
        <header>
          {back}
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{nobody ? "Nobody here is in your CRM yet" : "Analysis failed"}</h1>
        </header>
        {nobody ? (
          <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm text-indigo-950">
            <p>
              Meeting someone new is normal. The AI didn&apos;t find anyone in these notes who has a profile, so there&apos;s nobody to log
              them on yet.
            </p>
            <form action={logToIntake.bind(null, draft.id)}>
              <PendingButton label="Create a profile from these notes" pendingLabel="Starting Intake…" />
            </form>
            {roster.length ? (
              <form action={retryLogOn} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="draft_id" value={draft.id} />
                <span>Or log it on someone else:</span>
                <span className="w-64">
                  <SearchSelect
                    name="person_id"
                    options={roster.map((p) => ({ value: String(p.id), label: p.name }))}
                    emptyLabel="Choose a person"
                    className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
                    ariaLabel="Person to log this on"
                  />
                </span>
                <PendingButton label="Run it on them" pendingLabel="Starting…" className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-300 hover:bg-indigo-50" />
              </form>
            ) : null}
          </section>
        ) : (
          <ErrorExplain error={draft.error} />
        )}
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{what} — kept, nothing was lost</h2>
            <CopyButton text={sourceText} label="Copy" />
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-stone-700">{sourceText}</pre>
        </section>
        <form action={retryLog.bind(null, draft.id)} className="flex flex-wrap items-center gap-3">
          {nobody ? null : <PendingButton label="Try again" pendingLabel="Starting…" />}
          <button formNoValidate formAction={discardLog.bind(null, draft.id)} className={secondary}>
            Discard
          </button>
        </form>
        {origin && !nobody ? (
          <form action={saveLogAsTyped} className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-4 text-sm">
            <input type="hidden" name="draft_id" value={draft.id} />
            <span className="text-stone-700">
              Or save it as typed on <b>{origin.name}</b>, with no AI: on
            </span>
            <input type="date" name="date" defaultValue={today} max={today} required aria-label="Date" className="rounded-lg border border-stone-300 px-2 py-1" />
            <input name="channel" placeholder="Call, Meeting…" aria-label="Channel" className="w-32 rounded-lg border border-stone-300 px-2 py-1" />
            <PendingButton
              label={`Save as typed on ${origin.name}`}
              pendingLabel="Saving…"
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-300 hover:bg-indigo-50"
            />
          </form>
        ) : null}
        <FeedRecap progress={draft.progress} />
      </div>
    );
  }

  if (draft.status !== "ready" || !draft.result_json) {
    const receipt = readReceipt(db, "log", draft.id);
    return (
      <div className="max-w-3xl space-y-4">
        {back}
        <h1 className="text-2xl font-bold tracking-tight">Log draft: {stateWord(draft.status)}</h1>
        {receipt ? (
          <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">✓ {receiptLine("log", receipt)}</p>
        ) : draft.status === "discarded" ? (
          <p className="text-sm text-stone-600">This draft was discarded, so nothing from it was saved.</p>
        ) : null}
        {originHref && origin ? (
          <Link href={originHref} className="text-sm font-medium text-indigo-700 hover:underline">
            Open {origin.name} →
          </Link>
        ) : null}
      </div>
    );
  }

  const a = JSON.parse(draft.result_json) as LogAnalysis;
  const roster = db.prepare(`SELECT slug, name, next_action AS next FROM people ORDER BY name`).all() as { slug: string; name: string; next: string | null }[];
  const companies = db.prepare(`SELECT slug, name FROM companies ORDER BY name`).all() as { slug: string; name: string }[];
  const people = new Map(roster.map((p) => [p.slug, p.name]));
  const companyTargets = new Set(companies.map((c) => `${COMPANY_TARGET}${c.slug}`));
  const isValidTarget = (slug: string) => people.has(slug) || companyTargets.has(slug);
  const unknownEntries = a.entries.filter((e) => !isValidTarget(e.person_slug));
  const resolvable = a.resolves_action_ids
    .map((aid) => db.prepare(`SELECT id, title, bucket FROM action_items WHERE id=? AND status='open'`).get(aid) as { id: number; title: string; bucket: string } | undefined)
    .filter(Boolean) as { id: number; title: string; bucket: string }[];
  // A date the owner gave on the form (Prep's "Log this meeting") wins over what the AI read.
  const fromForm = isIsoDate(draft.meeting_date);
  const dateFound = fromForm || isIsoDate(a.meeting.date);
  const meetingDate = fromForm ? draft.meeting_date! : isIsoDate(a.meeting.date) ? a.meeting.date! : today;
  const meetingChannel = draft.meeting_channel ?? a.meeting.channel ?? "";
  const intakeHref = `/intake?from_log=${draft.id}`;
  const personOptions = roster.map((p) => ({ value: p.slug, label: p.name }));

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        {back}
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Review the log entries</h1>
        <p className="mt-1 text-sm text-stone-600">Check each entry against the source, change anything, then save. Nothing is saved until you do.</p>
        <AiRouteNote progress={draft.progress} />
      </header>
      {nothing ? (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Nothing is ticked (or every entry is for someone who isn&apos;t in your CRM), so nothing would be saved. Tick an entry or a
          follow-up, or Discard the draft.
        </p>
      ) : null}

      <div className="gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Summary</h2>
            <div className="mt-1">
              <Markdown>{a.summary_md}</Markdown>
            </div>
          </section>

          {a.confidence_flags?.length ? (
            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">To verify</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
                {a.confidence_flags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {unknownEntries.length ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              The AI drafted {unknownEntries.length === 1 ? "an entry" : `${unknownEntries.length} entries`} for{" "}
              <span className="font-semibold">{unknownEntries.map((e) => nameFromSlug(e.person_slug)).join(", ")}</span>, who{" "}
              {unknownEntries.length === 1 ? "isn't" : "aren't"} in your CRM. Those entries are unticked below — re-target them to an
              existing contact, or{" "}
              <Link href={intakeHref} className="font-medium underline">
                create a profile from these notes
              </Link>{" "}
              first.
            </section>
          ) : null}

          {a.unmatched_participants?.length ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Participants not in your CRM: <span className="font-semibold">{a.unmatched_participants.join(", ")}</span> —{" "}
              <Link href={intakeHref} className="font-medium underline">
                create profiles from these notes
              </Link>{" "}
              if they&apos;re worth tracking.
            </section>
          ) : null}

          <form action={confirmLog} className="space-y-6">
            <input type="hidden" name="draft_id" value={draft.id} />

            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Meeting</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={label}>
                  Date *
                  <input
                    type="date"
                    name="date"
                    required
                    max={today}
                    defaultValue={meetingDate}
                    className={`${input} ${dateFound ? "" : "border-amber-400 bg-amber-50"}`}
                  />
                  {fromForm ? (
                    <span className="mt-1 block font-normal text-stone-500">From the Prep form · change it here if needed</span>
                  ) : dateFound ? null : (
                    <span className="mt-1 block font-normal text-amber-800">The notes don&apos;t give a date. Today is a guess; please check.</span>
                  )}
                </label>
                <label className={label}>
                  Channel
                  <input name="channel" defaultValue={meetingChannel} placeholder="Call · Zoom · Email…" className={input} />
                </label>
              </div>
            </section>

            <section className="space-y-4">
              {a.entries.map((e, i) => (
                <div key={i} className="rounded-xl border border-stone-200 bg-white p-5">
                  <LogEntryTarget
                    index={i}
                    modelSlug={e.person_slug}
                    valid={isValidTarget(e.person_slug)}
                    people={roster}
                    companies={companies}
                    aiNext={e.next_action ?? null}
                    intakeHref={intakeHref}
                  >
                    <EditableMarkdown name={`entry_summary_${i}`} defaultValue={e.summary_md} label="Entry" />
                  </LogEntryTarget>
                </div>
              ))}
            </section>

            {resolvable.length > 0 && (
              <section className="space-y-2 rounded-xl border border-green-200 bg-green-50/50 p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-green-800">Close these open to-dos?</h2>
                <p className="text-xs text-stone-600">The AI thinks these are done. Tick the ones that really are.</p>
                {resolvable.map((r) => (
                  <label key={r.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name={`resolve_${r.id}`} className="mt-1" />
                    <span>
                      {r.title} <span className="text-xs text-stone-500">· {BUCKETS[r.bucket]?.label ?? r.bucket}</span>
                    </span>
                  </label>
                ))}
              </section>
            )}

            {a.suggested_actions?.length > 0 && (
              <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Suggested follow-ups</h2>
                {fromInbox ? <p className="text-xs text-stone-500">From an email, so none is ticked: tick the ones you want.</p> : null}
                {a.suggested_actions.map((s, i) => {
                  const parsed = s.due ? (isIsoDate(s.due) ? s.due : parseDueDate(s.due)) : null;
                  return (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name={`action_${i}`} defaultChecked={!fromInbox} aria-label={`Add: ${s.title}`} className="mt-2.5" />
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                        <input name={`action_title_${i}`} defaultValue={s.title} aria-label="To-do" className={`${input.replace("mt-1 ", "")} sm:col-span-2`} />
                        <SearchSelect
                          name={`action_slug_${i}`}
                          options={personOptions}
                          defaultValue={s.person_slug && people.has(s.person_slug) ? s.person_slug : ""}
                          emptyLabel="Nobody"
                          ariaLabel="Person"
                          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
                        />
                        <input
                          type="date"
                          name={`action_due_${i}`}
                          defaultValue={parsed ?? ""}
                          aria-label="Due"
                          className={`rounded-lg border px-2 py-1.5 text-sm ${s.due && !parsed ? "border-amber-400 bg-amber-50" : "border-stone-300"}`}
                        />
                        <select
                          name={`action_bucket_${i}`}
                          defaultValue={BUCKETS[s.bucket] ? s.bucket : "this_week"}
                          aria-label="Group"
                          className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm sm:col-span-2"
                        >
                          {Object.entries(PICKABLE_BUCKETS).map(([k, b]) => (
                            <option key={k} value={k}>
                              {b.icon} {b.label}
                            </option>
                          ))}
                        </select>
                        {s.due && !parsed ? (
                          <p className="text-xs text-amber-800 sm:col-span-2">The AI said &ldquo;{s.due}&rdquo; — pick a date.</p>
                        ) : s.due ? (
                          <p className="text-xs text-stone-500 sm:col-span-2">The AI said &ldquo;{s.due}&rdquo; — check the date.</p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            <div className="flex items-center gap-3">
              <PendingButton label="Save log entries" pendingLabel="Saving…" pendingNote="" />
              <button formNoValidate formAction={discardLog.bind(null, draft.id)} className={secondary}>
                Discard
              </button>
            </div>
          </form>

          <FeedRecap progress={draft.progress} />
        </div>

        <aside className="mt-6 xl:mt-0">
          <details className="rounded-xl border border-stone-200 bg-white xl:sticky xl:top-4" open>
            <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-stone-600">
              {what}
            </summary>
            {draft.fetched_text ? <p className="px-5 pb-2 text-xs text-stone-500">Your request: {draft.raw_text}</p> : null}
            <pre className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap px-5 pb-4 font-sans text-sm leading-relaxed text-stone-700">{sourceText}</pre>
          </details>
        </aside>
      </div>
    </div>
  );
}
