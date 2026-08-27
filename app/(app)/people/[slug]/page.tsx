import Link from "next/link";
import { notFound } from "next/navigation";
import { interactionsFor, opportunitiesFor, personBySlug } from "@/lib/queries";
import StatusBadge from "@/components/StatusBadge";
import StatusEditor from "@/components/StatusEditor";
import EditableSection from "@/components/EditableSection";
import AddInteraction from "@/components/AddInteraction";
import InteractionLog from "@/components/InteractionLog";
import ConfirmButton from "@/components/ConfirmButton";
import { deletePerson, updateSnapshot } from "@/lib/actions";
import PendingButton from "@/components/PendingButton";
import StaleNotice from "@/components/StaleNotice";
import { opportunityHref } from "@/lib/queries";
import { STAGES, STRENGTHS } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ stale?: string }>;
}) {
  const { slug } = await params;
  const { stale } = await searchParams;
  const p = personBySlug(slug);
  if (!p) notFound();
  const interactions = interactionsFor({ personId: p.id });
  const opps = opportunitiesFor({ personId: p.id });
  const tags = p.tags;
  const cadence = p.cadence_days;

  return (
    <div className="space-y-6">
      {stale ? <StaleNotice href={`/people/${slug}`} /> : null}
      <header>
        <Link href="/people" className="text-xs text-stone-400 hover:text-indigo-600">
          ← People
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
          <StatusBadge statusKey={p.status_key} note={p.status_note} />
          {p.relationship_strength ? (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300">
              {p.relationship_strength}
            </span>
          ) : null}
          {tags
            ? tags.split(",").map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-[0.68rem] font-medium text-indigo-600 ring-1 ring-inset ring-indigo-200"
                >
                  {t.trim()}
                </span>
              ))
            : null}
        </div>
        <div className="mt-1 text-sm text-stone-500">
          {p.role_title ? <span>{p.role_title}</span> : null}
          {p.company_slug ? (
            <>
              {p.role_title ? " · " : ""}
              <Link href={`/companies/${p.company_slug}`} className="font-medium text-indigo-700 hover:underline">
                {p.company_name}
              </Link>
            </>
          ) : null}
          {p.company_note ? <span className="text-stone-400"> · {p.company_note}</span> : null}
        </div>
        {p.next_action ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <span className="font-semibold">Next action:</span> {p.next_action}
            {p.last_touch ? (
              <span className="ml-2 text-xs text-amber-700/70">last touch {p.last_touch}</span>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3">
          <StatusEditor
            entity="person"
            id={p.id}
            statusKey={p.status_key}
            statusNote={p.status_note}
            nextAction={p.next_action}
            updatedAt={p.updated_at}
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <EditableSection
            title="Relationship Intelligence"
            subtitle="How we're connected and how strong it is"
            entity="person"
            id={p.id}
            updatedAt={p.updated_at}
            column="relationship_intel"
            value={p.relationship_intel}
          />
          <EditableSection
            title="Business Context"
            subtitle="What's going on in their world that matters to us"
            entity="person"
            id={p.id}
            updatedAt={p.updated_at}
            column="business_context"
            value={p.business_context}
          />
          <EditableSection
            title="Engagement Strategy"
            subtitle="The plan for moving this relationship forward"
            entity="person"
            id={p.id}
            updatedAt={p.updated_at}
            column="engagement_strategy"
            value={p.engagement_strategy}
          />
          {p.extra_sections ? (
            <EditableSection
              title="More"
              entity="person"
              id={p.id}
            updatedAt={p.updated_at}
              column="extra_sections"
              value={p.extra_sections}
            />
          ) : null}
          <EditableSection
            title="Notes"
            entity="person"
            id={p.id}
            updatedAt={p.updated_at}
            column="notes"
            value={p.notes}
          />

          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Interaction Log
              </h2>
            </div>
            <div className="mb-4">
              <AddInteraction personId={p.id} companyId={p.company_id ?? undefined} personSlug={p.slug} />
            </div>
            <InteractionLog interactions={interactions} />
          </section>
        </div>

        {/* Snapshot sidebar */}
        <aside className="space-y-4">
          {opps.length > 0 && (
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Opportunities
              </h2>
              <ul className="space-y-2.5">
                {opps.map((o) => (
                  <li key={o.id}>
                    <Link href={opportunityHref(o)} className="text-sm font-semibold text-stone-900 hover:text-indigo-700">
                      {o.name}
                    </Link>
                    <div className="text-xs text-stone-500">
                      {STAGES[o.stage]?.icon} {STAGES[o.stage]?.label}
                      {o.priority === 1 ? <span className="ml-1 text-red-600">★</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Snapshot
            </h2>
            <dl className="space-y-2.5 text-sm">
              {[
                ["Email", p.email],
                ["Phone", p.phone],
                ["Location", p.location],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-stone-400">{label}</dt>
                  <dd className="text-stone-800 break-words">{value ?? "—"}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs text-stone-400">LinkedIn</dt>
                <dd className="break-words">
                  {p.linkedin ? (
                    (() => {
                      const m = p.linkedin!.match(/\((https?:[^)]+)\)/) || p.linkedin!.match(/(https?:\S+)/);
                      const url = m ? m[1] : null;
                      return url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 hover:underline text-xs">
                          {url.replace(/^https?:\/\/(www\.)?/, "")}
                        </a>
                      ) : (
                        <span className="text-stone-800 text-xs">{p.linkedin}</span>
                      );
                    })()
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone-400">Last touch</dt>
                <dd className="text-stone-800 tabular-nums">{p.last_touch ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-400">Keep-warm cadence</dt>
                <dd className="text-stone-800">
                  {cadence ? `every ${cadence} days` : "—"}
                </dd>
              </div>
            </dl>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-indigo-600 select-none">
                ✎ Edit snapshot
              </summary>
              <form action={updateSnapshot} className="mt-2 space-y-2">
                <input type="hidden" name="entity" value="person" />
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="updated_at" value={p.updated_at ?? ""} />
                {[
                  ["role_title", "Role / title", p.role_title],
                  ["email", "Email", p.email],
                  ["phone", "Phone", p.phone],
                  ["location", "Location", p.location],
                  ["linkedin", "LinkedIn", p.linkedin],
                  ["company_note", "Company note", p.company_note],
                ].map(([name, label, value]) => (
                  <label key={name as string} className="block text-xs font-medium text-stone-600">
                    {label}
                    <input
                      name={name as string}
                      defaultValue={(value as string) ?? ""}
                      className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                    />
                  </label>
                ))}
                <label className="block text-xs font-medium text-stone-600">
                  Keep-warm cadence (days, blank = none)
                  <input
                    name="cadence_days"
                    type="number"
                    min={1}
                    defaultValue={cadence ?? ""}
                    className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="block text-xs font-medium text-stone-600">
                  Tags (comma-separated)
                  <input
                    name="tags"
                    defaultValue={tags ?? ""}
                    placeholder="connector, friend, inbound…"
                    className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="block text-xs font-medium text-stone-600">
                  Relationship strength
                  <select
                    name="relationship_strength"
                    defaultValue={p.relationship_strength ?? ""}
                    className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">—</option>
                    {STRENGTHS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <PendingButton label="Save" pendingLabel="Saving…" className={"rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"} />
              </form>
            </details>
          </section>
        </aside>
      </div>

      <details className="rounded-xl border border-stone-200 bg-white px-5 py-3">
        <summary className="cursor-pointer text-xs font-medium text-stone-400 select-none hover:text-red-600">
          Danger zone
        </summary>
        <div className="mt-3 space-y-3 text-sm text-stone-600">
          <p>
            Deleting <strong className="text-stone-800">{p.name}</strong> permanently removes the profile,
            {" "}
            {interactions.length === 1 ? "its 1 logged interaction" : `its ${interactions.length} logged interactions`},
            all of this person&apos;s action items (open and completed), their meeting briefs, and any
            connections to other people.
            {opps.length
              ? ` ${opps.length === 1 ? "The 1 opportunity" : `The ${opps.length} opportunities`} linked here will be kept but no longer linked to a person.`
              : ""}
            {" "}
            Outreach drafts are kept, unlinked. There is no undo — restore from a backup in
            <code className="mx-1 rounded bg-stone-100 px-1 py-0.5 text-xs">data/backups</code>if this was a mistake.
          </p>
          <form action={deletePerson.bind(null, p.id)}>
            <ConfirmButton
              label={`Delete ${p.name}`}
              confirm={`Permanently delete ${p.name} and their interactions, action items, briefs and connections? This can't be undone.`}
            />
          </form>
        </div>
      </details>
    </div>
  );
}
