import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, BUCKETS } from "@/lib/db";
import type { LogAnalysis, ProgressEvent } from "@/lib/ai";
import { confirmLog, discardLog } from "@/lib/logmeeting";
import Markdown from "@/components/Markdown";
import PendingButton from "@/components/PendingButton";
import ActivityFeed from "@/components/ActivityFeed";
import FeedRecap from "@/components/FeedRecap";
import LogEntryTarget from "@/components/LogEntryTarget";

export const dynamic = "force-dynamic";

const input = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";
const label = "block text-xs font-medium text-stone-600";
const area = "mt-1 w-full rounded-lg border border-stone-300 p-3 font-mono text-xs leading-relaxed";

export default async function LogReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ skipped?: string }>;
}) {
  const { id } = await params;
  const skipped = Number((await searchParams).skipped) || 0;
  const db = getDb();
  const draft = db.prepare(`SELECT * FROM log_drafts WHERE id=?`).get(Number(id)) as
    | { id: number; raw_text: string; fetched_text: string | null; source: string; result_json: string | null; status: string; error: string | null; progress: string | null }
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
          <Link href="/log" className="text-xs text-stone-400 hover:text-indigo-600">← Log activity</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">✎ Drafting log entries…</h1>
        </header>
        <ActivityFeed
          kind="log"
          id={draft.id}
          title={`Log draft #${draft.id} (${draft.source})`}
          subtitle={draft.raw_text.slice(0, 90) + "…"}
          initialEvents={events}
        />
      </div>
    );
  }

  if (draft.status === "error") {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Analysis failed</h1>
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{draft.error}</p>
        <FeedRecap progress={draft.progress} />
        <Link href="/log" className="text-sm font-medium text-indigo-700 hover:underline">← Try again</Link>
      </div>
    );
  }
  if (draft.status !== "ready" || !draft.result_json) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Draft {draft.status}</h1>
        {skipped > 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {skipped === 1 ? "One entry was" : `${skipped} entries were`} skipped because the contact isn't in your CRM.
            Add them via <Link href="/intake" className="font-medium underline">Intake</Link>, then log the meeting for them again.
          </p>
        ) : null}
        <Link href="/log" className="text-sm font-medium text-indigo-700 hover:underline">← Log activity</Link>
      </div>
    );
  }

  const a = JSON.parse(draft.result_json) as LogAnalysis;
  const roster = db.prepare(`SELECT slug, name FROM people ORDER BY name`).all() as { slug: string; name: string }[];
  const people = new Map(roster.map((p) => [p.slug, p.name]));
  const unknownEntries = a.entries.filter((e) => !people.has(e.person_slug));
  const resolvable = a.resolves_action_ids
    .map((aid) => db.prepare(`SELECT id, title, bucket FROM action_items WHERE id=? AND status='open'`).get(aid) as { id: number; title: string; bucket: string } | undefined)
    .filter(Boolean) as { id: number; title: string; bucket: string }[];
  const today = new Date().toLocaleDateString("sv-SE");

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <Link href="/log" className="text-xs text-stone-400 hover:text-indigo-600">← Log activity</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Review draft log entries</h1>
        <p className="mt-1 text-sm text-stone-500">Everything is editable. Nothing is saved until you confirm.</p>
      </header>

      <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Summary</h2>
        <div className="mt-1"><Markdown>{a.summary_md}</Markdown></div>
      </section>

      {a.confidence_flags?.length ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">To verify</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
            {a.confidence_flags.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </section>
      ) : null}

      {unknownEntries.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The model drafted {unknownEntries.length === 1 ? "an entry" : `${unknownEntries.length} entries`} for{" "}
          <span className="font-semibold">{unknownEntries.map((e) => e.person_slug).join(", ")}</span>, who {unknownEntries.length === 1 ? "isn't" : "aren't"} in your CRM.
          Those entries are unticked below — re-target them to an existing contact, or add the person via{" "}
          <Link href="/intake" className="underline font-medium">Intake</Link> first.
        </section>
      ) : null}

      {a.unmatched_participants?.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Participants not in your CRM: <span className="font-semibold">{a.unmatched_participants.join(", ")}</span>
          {" — add them via "}<Link href="/intake" className="underline font-medium">Intake</Link> if worth tracking.
        </section>
      ) : null}

      <form action={confirmLog} className="space-y-6">
        <input type="hidden" name="draft_id" value={draft.id} />

        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Meeting</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Date *
              <input type="date" name="date" required defaultValue={a.meeting.date ?? today} className={input} />
            </label>
            <label className={label}>Channel
              <input name="channel" defaultValue={a.meeting.channel ?? ""} placeholder="Call · Zoom · Email…" className={input} />
            </label>
          </div>
        </section>

        <section className="space-y-4">
          {a.entries.map((e, i) => (
            <div key={i} className="rounded-xl border border-stone-200 bg-white p-5">
              <LogEntryTarget index={i} modelSlug={e.person_slug} valid={people.has(e.person_slug)} people={roster} />
              <label className={`${label} mt-3`}>Entry (markdown)
                <textarea
                  name={`entry_summary_${i}`}
                  rows={Math.min(14, Math.max(4, e.summary_md.split("\n").length + 1))}
                  defaultValue={e.summary_md}
                  className={area}
                />
              </label>
              <label className={`${label} mt-2`}>Update next action (blank = leave unchanged)
                <input name={`entry_next_${i}`} defaultValue={e.next_action ?? ""} className={input} />
              </label>
            </div>
          ))}
        </section>

        {resolvable.length > 0 && (
          <section className="rounded-xl border border-green-200 bg-green-50/50 p-5 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-green-800">
              Close out these open items?
            </h2>
            {resolvable.map((r) => (
              <label key={r.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name={`resolve_${r.id}`} defaultChecked className="mt-1" />
                <span>
                  <span className="font-medium">[{r.bucket}]</span> {r.title}
                </span>
              </label>
            ))}
          </section>
        )}

        {a.suggested_actions?.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Suggested follow-ups
            </h2>
            {a.suggested_actions.map((s, i) => (
              <label key={i} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name={`action_${i}`} defaultChecked className="mt-1" />
                <span className="flex-1">
                  <input type="hidden" name={`action_title_${i}`} value={s.title} />
                  <input type="hidden" name={`action_bucket_${i}`} value={BUCKETS[s.bucket] ? s.bucket : "this_week"} />
                  <input type="hidden" name={`action_due_${i}`} value={s.due ?? ""} />
                  <input type="hidden" name={`action_slug_${i}`} value={s.person_slug ?? ""} />
                  {s.title}
                  <span className="text-xs text-stone-400">
                    {" "}({s.bucket}{s.due ? `, due ${s.due}` : ""}{s.person_slug ? `, ${people.get(s.person_slug) ?? s.person_slug}` : ""})
                  </span>
                </span>
              </label>
            ))}
          </section>
        )}

        <div className="flex items-center gap-3">
          <PendingButton label="Save log entries" pendingLabel="Saving…" pendingNote="" />
          <button formNoValidate formAction={discardLog.bind(null, draft.id)} className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-100">
            Discard
          </button>
        </div>
      </form>

      <FeedRecap progress={draft.progress} />

      <details className="rounded-xl border border-stone-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-stone-500 select-none">
          {draft.fetched_text ? `Retrieved ${draft.source} content` : `Original input (${draft.source})`}
        </summary>
        {draft.fetched_text ? (
          <p className="px-5 pb-2 text-xs text-stone-400">Your request: {draft.raw_text}</p>
        ) : null}
        <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap px-5 pb-4 text-xs text-stone-600">{draft.fetched_text ?? draft.raw_text}</pre>
      </details>
    </div>
  );
}
