import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, STATUS, STRENGTHS, BUCKETS } from "@/lib/db";
import type { IntakeAnalysis, ProgressEvent } from "@/lib/ai";
import { confirmIntake, discardIntake } from "@/lib/intake";
import { slugify } from "@/lib/slug";
import Markdown from "@/components/Markdown";
import PendingButton from "@/components/PendingButton";
import ActivityFeed from "@/components/ActivityFeed";
import FeedRecap from "@/components/FeedRecap";
import SearchSelect from "@/components/SearchSelect";

export const dynamic = "force-dynamic";

const input = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";
const label = "block text-xs font-medium text-stone-600";
const area = "mt-1 w-full rounded-lg border border-stone-300 p-3 font-mono text-xs leading-relaxed";

export default async function IntakeReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ duplicate?: string }>;
}) {
  const { id } = await params;
  const { duplicate: blockedSlug } = await searchParams;
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
          <Link href="/intake" className="text-xs text-stone-400 hover:text-indigo-600">← Intake</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">✨ Analyzing…</h1>
        </header>
        <ActivityFeed
          kind="intake"
          id={draft.id}
          title={`Intake #${draft.id}`}
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
        <Link href="/intake" className="text-sm font-medium text-indigo-700 hover:underline">← Try again</Link>
      </div>
    );
  }
  if (draft.status === "confirmed" || draft.status === "discarded" || !draft.result_json) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Draft {draft.status}</h1>
        <Link href="/intake" className="text-sm font-medium text-indigo-700 hover:underline">← Intake</Link>
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
  const connCandidates = a.connections.filter((c) =>
    db.prepare(`SELECT 1 FROM people WHERE slug=?`).get(c.person_slug)
  );

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <Link href="/intake" className="text-xs text-stone-400 hover:text-indigo-600">← Intake</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Review the analysis</h1>
        <p className="mt-1 text-sm text-stone-500">Everything below is editable. Nothing is saved until you confirm.</p>
      </header>

      <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Summary</h2>
        <div className="mt-1"><Markdown>{a.summary_md}</Markdown></div>
      </section>

      {blockedSlug ? (
        <section className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          Not saved — a profile with this name (<code>{blockedSlug}</code>) already exists. Log this on the existing
          profile instead, or tick "create a separate profile anyway" below and confirm again.
        </section>
      ) : null}

      {existingPerson ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠️ {nameMatch ? "This name already exists as" : "The AI thinks this may already be"}{" "}
          <Link href={`/people/${existingPerson.slug}`} className="font-semibold underline">{existingPerson.name}</Link>{" "}
          in your CRM. Review that profile before creating a duplicate
          {nameMatch ? " — the Log page can add this interaction to the existing profile" : ""}.
        </section>
      ) : null}

      {a.confidence_flags?.length ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Inferences & gaps to verify</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
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
          <label className={label}>Next action<input name="next_action" defaultValue={p.next_action ?? ""} className={input} /></label>
          {nameMatch || blockedSlug ? (
            <label className="flex items-center gap-2 text-sm text-amber-900">
              <input type="checkbox" name="allow_duplicate" value="1" />
              Create a separate profile anyway (this really is a different {p.name})
            </label>
          ) : null}
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Company</h2>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="company_mode" value="existing" defaultChecked={!!existingCompany} />
              Link to existing:
              <span className="min-w-56 flex-1"><SearchSelect name="existing_company_id" defaultValue={existingCompany?.id ?? ""} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm" /></span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="company_mode" value="new" defaultChecked={!existingCompany && !!p.new_company} />
              Create new company
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="company_mode" value="none" defaultChecked={!existingCompany && !p.new_company} />
              No company
            </label>
          </div>
          {p.new_company ? (
            <div className="grid gap-3 sm:grid-cols-2 border-t border-stone-100 pt-3">
              <label className={label}>Company name<input name="company_name" defaultValue={p.new_company.name} className={input} /></label>
              <label className={label}>Industry<input name="company_industry" defaultValue={p.new_company.industry ?? ""} className={input} /></label>
              <label className={label}>Website<input name="company_website" defaultValue={p.new_company.website ?? ""} className={input} /></label>
              <label className={label}>HQ<input name="company_hq" defaultValue={p.new_company.hq ?? ""} className={input} /></label>
              <label className={`${label} sm:col-span-2`}>Company business context (markdown)
                <textarea name="company_context" rows={4} defaultValue={p.new_company.business_context_md ?? ""} className={area} />
              </label>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 border-t border-stone-100 pt-3">
              <label className={label}>Company name<input name="company_name" className={input} /></label>
              <label className={label}>Industry<input name="company_industry" className={input} /></label>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Profile sections (markdown)</h2>
          {([
            ["relationship_intel", "Relationship Intelligence", p.relationship_intel_md],
            ["business_context", "Business Context", p.business_context_md],
            ["engagement_strategy", "Engagement Strategy", p.engagement_strategy_md],
            ["notes", "Notes", p.notes_md],
          ] as const).map(([name, title, value]) => (
            <label key={name} className={label}>{title}
              <textarea name={name} rows={Math.min(12, Math.max(4, (value ?? "").split("\n").length + 1))} defaultValue={value ?? ""} className={area} />
            </label>
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
                <span className="block text-xs text-stone-400">
                  The paste describes a meeting/call/email that already happened — logging it sets
                  this person&apos;s last touch. Uncheck to skip.
                </span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>Date (YYYY-MM-DD)
                <input name="interaction_date" defaultValue={a.interaction.date ?? ""} className={input} />
              </label>
              <label className={label}>Channel
                <input name="interaction_channel" defaultValue={a.interaction.channel ?? ""} className={input} />
              </label>
            </div>
            <label className={label}>Log entry (markdown)
              <textarea
                name="interaction_summary"
                rows={Math.min(12, Math.max(4, a.interaction.summary_md.split("\n").length + 1))}
                defaultValue={a.interaction.summary_md}
                className={area}
              />
            </label>
          </section>
        ) : null}

        {connCandidates.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Suggested connections</h2>
            <p className="text-xs text-stone-400">Checked connections appear as edges on the relationship map.</p>
            {connCandidates.map((c) => (
              <label key={c.person_slug} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name={`conn_${c.person_slug}`} defaultChecked className="mt-1" />
                <span>
                  <span className="font-semibold">{c.person_slug}</span>
                  <input type="hidden" name={`conn_label_${c.person_slug}`} value={c.label} />
                  <span className="text-stone-500"> — {c.label}. {c.reason}</span>
                </span>
              </label>
            ))}
          </section>
        )}

        {a.suggested_actions?.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Suggested action items</h2>
            {a.suggested_actions.map((s, i) => (
              <label key={i} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name={`action_${i}`} defaultChecked className="mt-1" />
                <span className="flex-1">
                  <input type="hidden" name={`action_title_${i}`} value={s.title} />
                  <input type="hidden" name={`action_bucket_${i}`} value={BUCKETS[s.bucket] ? s.bucket : "this_week"} />
                  <input type="hidden" name={`action_due_${i}`} value={s.due ?? ""} />
                  {s.title}
                  <span className="text-xs text-stone-400"> ({s.bucket}{s.due ? `, due ${s.due}` : ""})</span>
                </span>
              </label>
            ))}
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

      <details className="rounded-xl border border-stone-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-stone-500 select-none">Original pasted text</summary>
        <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap px-5 pb-4 text-xs text-stone-600">{draft.raw_text}</pre>
      </details>
    </div>
  );
}
