import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, STATUS, STRENGTHS, BUCKETS } from "@/lib/db";
import type { IntakeAnalysis, ProgressEvent } from "@/lib/ai";
import { confirmIntake, discardIntake, intakeToLog, retryIntake } from "@/lib/intake";
import { readReceipt, receiptLine } from "@/lib/receipts";
import { isIsoDate, parseDueDate, todayLocal } from "@/lib/dates.mjs";
import { stateWord } from "@/lib/stateWords";
import CompanyChoice from "@/components/CompanyChoice";
import EditableMarkdown from "@/components/EditableMarkdown";
import CopyButton from "@/components/CopyButton";
import AiRouteNote from "@/components/AiRouteNote";
import ErrorExplain from "@/components/ErrorExplain";
import { typicalRunSeconds } from "@/lib/progress";
import { claudeAvailable } from "@/lib/ai";
import { slugify } from "@/lib/slug";
import Markdown from "@/components/Markdown";
import PendingButton from "@/components/PendingButton";
import ActivityFeed from "@/components/ActivityFeed";
import FeedRecap from "@/components/FeedRecap";
import SearchSelect from "@/components/SearchSelect";
import { first, type Param } from "@/lib/params";

export const dynamic = "force-dynamic";

export const metadata = { title: "Intake review" };

const input = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";
const label = "block text-xs font-medium text-stone-600";


export default async function IntakeReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ duplicate?: Param; baddate?: Param }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const blockedSlug = first(sp.duplicate);
  const badDate = !!first(sp.baddate);
  const db = getDb();
  const draft = db.prepare(`SELECT * FROM intake_drafts WHERE id=?`).get(Number(id)) as
    | { id: number; raw_text: string; result_json: string | null; status: string; error: string | null; progress: string | null }
    | undefined;
  if (!draft) notFound();

  if (draft.status === "analyzing" || draft.status === "pending") {
    let events: ProgressEvent[] = [];
    try {
      events = draft.progress ? (JSON.parse(draft.progress) as ProgressEvent[]) : [];
    } catch {}
    return (
      <div className="max-w-3xl space-y-4">
        <header>
          <Link href="/intake" className="text-xs text-stone-500 hover:text-indigo-600">← Intake</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">✨ Drafting the profile…</h1>
        </header>
        <ActivityFeed
          kind="intake"
          id={draft.id}
          title="Intake draft"
          subtitle={draft.raw_text.slice(0, 90) + "…"}
          initialEvents={events}
          typicalSecs={typicalRunSeconds("intake")}
        />
      </div>
    );
  }

  if (draft.status === "error") {
    return (
      <div className="max-w-3xl space-y-4">
        <Link href="/intake" className="text-xs text-stone-500 hover:text-indigo-600">← Intake</Link>
        <h1 className="text-2xl font-bold tracking-tight">Analysis failed</h1>
        <ErrorExplain error={draft.error} />
        <FeedRecap progress={draft.progress} />
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">What you pasted — kept, nothing was lost</h2>
            <CopyButton text={draft.raw_text} label="Copy" />
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-stone-700">{draft.raw_text}</pre>
        </section>
        <form action={retryIntake.bind(null, draft.id)} className="flex flex-wrap items-center gap-3">
          {claudeAvailable() ? (
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <input type="checkbox" name="research" value="1" defaultChecked />
              Look them up on the web first
            </label>
          ) : null}
          <PendingButton label="Try again" pendingLabel="Starting…" />
          <button formNoValidate formAction={discardIntake.bind(null, draft.id)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-100">
            Discard
          </button>
        </form>
      </div>
    );
  }
  if (draft.status === "confirmed" || draft.status === "discarded" || !draft.result_json) {
    const receipt = readReceipt(db, "intake", draft.id);
    return (
      <div className="max-w-3xl space-y-4">
        <Link href="/intake" className="text-xs text-stone-500 hover:text-indigo-600">← Intake</Link>
        <h1 className="text-2xl font-bold tracking-tight">Intake draft: {stateWord(draft.status)}</h1>
        {receipt ? (
          <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">✓ {receiptLine("intake", receipt)}</p>
        ) : draft.status === "discarded" ? (
          <p className="text-sm text-stone-600">This draft was discarded, so nothing from it was saved.</p>
        ) : null}
      </div>
    );
  }

  const a = JSON.parse(draft.result_json) as IntakeAnalysis;
  const p = a.person;
  const companies = db.prepare(`SELECT id, slug, name FROM companies ORDER BY name`).all() as { id: number; slug: string; name: string }[];
  const existingCompany = p.existing_company_slug ? companies.find((c) => c.slug === p.existing_company_slug) : null;
  // Two independent duplicate checks: Claude's judgement from the roster, and a
  // deterministic exact match on the name's slug (the one that actually blocks).
  const findPerson = (slug: string | null | undefined) =>
    slug ? (db.prepare(`SELECT slug, name FROM people WHERE slug=?`).get(slug) as { slug: string; name: string } | undefined) : undefined;
  const nameMatch = findPerson(slugify(p.name));
  const existingPerson = nameMatch ?? findPerson(p.existing_person_slug);
  const connCandidates = a.connections
    .map((c) => ({ ...c, name: (db.prepare(`SELECT name FROM people WHERE slug=?`).get(c.person_slug) as { name: string } | undefined)?.name }))
    .filter((c): c is typeof c & { name: string } => !!c.name);
  const blockedName = blockedSlug ? findPerson(blockedSlug)?.name ?? p.name : null;
  const today = todayLocal();
  const dateFound = isIsoDate(a.interaction?.date ?? null);

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <Link href="/intake" className="text-xs text-stone-500 hover:text-indigo-600">← Intake</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Review the new profile</h1>
        <p className="mt-1 text-sm text-stone-600">Check it against what you pasted, change anything, then create the profile. Nothing is saved until you do.</p>
        <AiRouteNote progress={draft.progress} />
      </header>
      <div className="gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">

      <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Summary</h2>
        <div className="mt-1"><Markdown>{a.summary_md}</Markdown></div>
      </section>

      {blockedName ? (
        <section className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          Not saved — <b>{blockedName}</b> already has a profile. Log this on that profile instead (below), or tick
          &ldquo;This is a different {p.name}&rdquo; and create the profile again.
        </section>
      ) : null}
      {badDate ? (
        <section role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          Not saved — the interaction needs the date it happened. Pick one below, or untick &ldquo;Log this interaction too&rdquo;.
        </section>
      ) : null}

      {existingPerson ? (
        <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            ⚠️ {nameMatch ? <><b>{existingPerson.name}</b> is already in your CRM.</> : <>The AI thinks this may already be <b>{existingPerson.name}</b>.</>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <form action={intakeToLog.bind(null, draft.id, existingPerson.slug)}>
              <PendingButton
                label={`Log this on ${existingPerson.name}`}
                pendingLabel="Starting…"
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
              />
            </form>
            <Link href={`/people/${existingPerson.slug}`} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100">
              Open profile
            </Link>
          </div>
        </section>
      ) : null}

      {a.confidence_flags?.length ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Inferences & gaps to verify</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
            {a.confidence_flags.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </section>
      ) : null}

      <form action={confirmIntake} className="space-y-6">
        <input type="hidden" name="draft_id" value={draft.id} />

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Person</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Name *<input name="name" required defaultValue={p.name} className={input} /></label>
            <label className={label}>Role / title<input name="role_title" defaultValue={p.role_title ?? ""} className={input} /></label>
            <label className={label}>Location<input name="location" defaultValue={p.location ?? ""} className={input} /></label>
            <label className={label}>Email<input name="email" defaultValue={p.email ?? ""} className={input} /></label>
            <label className={label}>Phone<input name="phone" type="tel" defaultValue={p.phone ?? ""} className={input} /></label>
            <label className={label}>LinkedIn<input name="linkedin" defaultValue={p.linkedin ?? ""} className={input} /></label>
            <label className={label}>Tags<input name="tags" defaultValue={p.tags ?? ""} className={input} /></label>
            <label className={label}>Status
              <select name="status_key" defaultValue={p.status_suggestion || "new"} className={input}>
                {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.emoji} {s.label}</option>)}
              </select>
            </label>
            <label className={label}>Status note<input name="status_note" defaultValue={p.status_note ?? ""} className={input} /></label>
            <label className={label}>Relationship strength
              <select name="relationship_strength" defaultValue={p.relationship_strength ?? ""} className={input}>
                <option value="">—</option>
                {STRENGTHS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={label}>Keep-warm cadence (days)<input name="cadence_days" type="number" defaultValue={p.cadence_days ?? ""} className={input} /></label>
          </div>
          <label className={label}>Next step<input name="next_action" defaultValue={p.next_action ?? ""} className={input} /></label>
          {nameMatch || blockedSlug ? (
            <label className="flex items-center gap-2 text-sm text-amber-900">
              <input type="checkbox" name="allow_duplicate" value="1" />
              This is a different {p.name} — create a separate profile
            </label>
          ) : null}
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Company</h2>
          <CompanyChoice
            companies={companies.map((c) => ({ id: c.id, name: c.name }))}
            existingId={existingCompany?.id ?? null}
            suggested={p.new_company ?? null}
          />
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Profile sections</h2>
          {([
            ["relationship_intel", "Relationship Intelligence", p.relationship_intel_md],
            ["business_context", "Business Context", p.business_context_md],
            ["engagement_strategy", "Engagement Strategy", p.engagement_strategy_md],
            ["notes", "Notes", p.notes_md],
          ] as const).map(([name, title, value]) => (
            <EditableMarkdown key={name} name={name} label={title} defaultValue={value ?? ""} />
          ))}
        </section>

        {a.interaction?.summary_md ? (
          <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="interaction_include" defaultChecked className="mt-1" />
              <span>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                  ✎ Log this interaction too
                </h2>
                <span className="block text-xs text-stone-500">
                  The paste describes a meeting/call/email that already happened — logging it sets
                  this person&apos;s last touch. Uncheck to skip.
                </span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Date *
                <input
                  type="date"
                  name="interaction_date"
                  max={today}
                  defaultValue={dateFound ? a.interaction.date! : today}
                  className={`${input} ${dateFound && !badDate ? "" : "border-amber-400 bg-amber-50"}`}
                />
                {dateFound ? null : <span className="mt-1 block font-normal text-amber-800">The text doesn&apos;t give a date. Today is a guess; please check.</span>}
              </label>
              <label className={label}>Channel
                <input name="interaction_channel" defaultValue={a.interaction.channel ?? ""} className={input} />
              </label>
            </div>
            <EditableMarkdown name="interaction_summary" label="Log entry" defaultValue={a.interaction.summary_md} />
          </section>
        ) : null}

        {connCandidates.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Suggested connections</h2>
            <p className="text-xs text-stone-500">Ticked connections appear as lines on the Map and on both profiles.</p>
            {connCandidates.map((c) => (
              <label key={c.person_slug} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name={`conn_${c.person_slug}`} defaultChecked className="mt-1" />
                <span>
                  <span className="font-semibold">{c.name}</span>
                  <input type="hidden" name={`conn_label_${c.person_slug}`} value={c.label} />
                  <span className="text-stone-500"> — {c.label}. {c.reason}</span>
                </span>
              </label>
            ))}
          </section>
        )}

        {a.suggested_actions?.length > 0 && (
          <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Suggested to-dos</h2>
            {a.suggested_actions.map((s, i) => {
              const parsed = s.due ? (isIsoDate(s.due) ? s.due : parseDueDate(s.due)) : null;
              return (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name={`action_${i}`} defaultChecked aria-label={`Add: ${s.title}`} className="mt-2.5" />
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(10rem,1fr)_9.5rem]">
                    <input name={`action_title_${i}`} defaultValue={s.title} aria-label="To-do" className={input.replace("mt-1 ", "")} />
                    <input
                      type="date"
                      name={`action_due_${i}`}
                      defaultValue={parsed ?? ""}
                      aria-label="Due"
                      className={`rounded-lg border px-2 py-1.5 text-sm ${s.due && !parsed ? "border-amber-400 bg-amber-50" : "border-stone-300"}`}
                    />
                    <select name={`action_bucket_${i}`} defaultValue={BUCKETS[s.bucket] ? s.bucket : "this_week"} aria-label="Group" className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm sm:col-span-2">
                      {Object.entries(BUCKETS).map(([k, b]) => (
                        <option key={k} value={k}>
                          {b.icon} {b.label}
                        </option>
                      ))}
                    </select>
                    {s.due && !parsed ? <p className="text-xs text-amber-800 sm:col-span-2">The AI said &ldquo;{s.due}&rdquo; — pick a date.</p> : null}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        <div className="flex items-center gap-3">
          <PendingButton label="Create profile" pendingLabel="Saving…" pendingNote="" />
          <button formNoValidate formAction={discardIntake.bind(null, draft.id)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-100">
            Discard
          </button>
        </div>
      </form>

      <FeedRecap progress={draft.progress} />
      </div>

      <aside className="mt-6 xl:mt-0">
        <details className="rounded-xl border border-stone-200 bg-white xl:sticky xl:top-4" open>
          <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-stone-600">What you pasted</summary>
          <pre className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap px-5 pb-4 font-sans text-sm leading-relaxed text-stone-700">{draft.raw_text}</pre>
        </details>
      </aside>
      </div>
    </div>
  );
}
