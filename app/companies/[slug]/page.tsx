import Link from "next/link";
import { notFound } from "next/navigation";
import { companyBySlug, interactionsFor, opportunitiesFor, peopleAtCompany } from "@/lib/queries";
import StatusBadge from "@/components/StatusBadge";
import StatusEditor from "@/components/StatusEditor";
import EditableSection from "@/components/EditableSection";
import AddInteraction from "@/components/AddInteraction";
import InteractionLog from "@/components/InteractionLog";
import ConfirmButton from "@/components/ConfirmButton";
import { deleteCompany, updateSnapshot } from "@/lib/actions";
import PendingButton from "@/components/PendingButton";
import StaleNotice from "@/components/StaleNotice";
import { opportunityHref } from "@/lib/queries";
import { STAGES } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ stale?: string }>;
}) {
  const { slug } = await params;
  const { stale } = await searchParams;
  const c = companyBySlug(slug);
  if (!c) notFound();
  const people = peopleAtCompany(c.id);
  const interactions = interactionsFor({ companyId: c.id });
  const opps = opportunitiesFor({ companyId: c.id });
  const companyOnlyInteractions = interactions.filter((i) => !i.person_id).length;

  return (
    <div className="space-y-6">
      {stale ? <StaleNotice href={`/companies/${slug}`} /> : null}
      <header>
        <Link href="/companies" className="text-xs text-stone-400 hover:text-indigo-600">
          ← Companies
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{c.name}</h1>
          <StatusBadge statusKey={c.status_key} note={c.status_note} />
        </div>
        {c.industry ? (
          <p className="mt-1 text-sm text-stone-500">{c.industry}</p>
        ) : null}
        {c.next_action ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <span className="font-semibold">Next action:</span> {c.next_action}
            {c.last_touch ? (
              <span className="ml-2 text-xs text-amber-700/70">last touch {c.last_touch}</span>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3">
          <StatusEditor
            entity="company"
            id={c.id}
            statusKey={c.status_key}
            statusNote={c.status_note}
            nextAction={c.next_action}
            updatedAt={c.updated_at}
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <EditableSection
            title="Business Context"
            subtitle="What this company cares about and where we fit"
            entity="company"
            id={c.id}
            updatedAt={c.updated_at}
            column="business_context"
            value={c.business_context}
          />
          <EditableSection
            title="Relationship Intelligence"
            subtitle="Our footprint inside the org"
            entity="company"
            id={c.id}
            updatedAt={c.updated_at}
            column="relationship_intel"
            value={c.relationship_intel}
          />
          <EditableSection
            title="Engagement Strategy"
            entity="company"
            id={c.id}
            updatedAt={c.updated_at}
            column="engagement_strategy"
            value={c.engagement_strategy}
          />
          {c.extra_sections ? (
            <EditableSection
              title="More"
              entity="company"
              id={c.id}
            updatedAt={c.updated_at}
              column="extra_sections"
              value={c.extra_sections}
            />
          ) : null}
          <EditableSection
            title="Notes"
            entity="company"
            id={c.id}
            updatedAt={c.updated_at}
            column="notes"
            value={c.notes}
          />

          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Interaction Log
            </h2>
            <div className="mb-4">
              <AddInteraction companyId={c.id} />
            </div>
            <InteractionLog interactions={interactions} />
          </section>
        </div>

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
              Key People
            </h2>
            {people.length ? (
              <ul className="space-y-2.5">
                {people.map((p) => (
                  <li key={p.id}>
                    <Link href={`/people/${p.slug}`} className="text-sm font-semibold text-stone-900 hover:text-indigo-700">
                      {p.name}
                    </Link>
                    <div className="text-xs text-stone-500">
                      {p.role_title ?? "—"}
                      {p.relationship_strength ? (
                        <span className="ml-1 text-stone-400">· {p.relationship_strength}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm italic text-stone-400">No linked contacts.</p>
            )}
          </section>

          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Snapshot
            </h2>
            <dl className="space-y-2.5 text-sm">
              {[
                ["HQ / locations", c.hq],
                ["Size", c.size],
                ["Revenue / stage", c.revenue_stage],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-stone-400">{label}</dt>
                  <dd className="text-stone-800">{(value as string) ?? "—"}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs text-stone-400">Website</dt>
                <dd>
                  {c.website && /https?:\/\/\S+/.test(c.website) ? (
                    <a
                      href={c.website.match(/https?:\/\/\S+/)![0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-700 hover:underline break-all"
                    >
                      {c.website.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : c.website ? (
                    <span className="text-xs text-stone-800 break-all">{c.website}</span>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone-400">Last touch</dt>
                <dd className="text-stone-800 tabular-nums">{c.last_touch ?? "—"}</dd>
              </div>
            </dl>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-indigo-600 select-none">
                ✎ Edit snapshot
              </summary>
              <form action={updateSnapshot} className="mt-2 space-y-2">
                <input type="hidden" name="entity" value="company" />
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="updated_at" value={c.updated_at ?? ""} />
                {[
                  ["industry", "Industry", c.industry],
                  ["size", "Size / headcount", c.size],
                  ["hq", "HQ / locations", c.hq],
                  ["website", "Website", c.website],
                  ["revenue_stage", "Revenue / stage", c.revenue_stage],
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
            Deleting <strong className="text-stone-800">{c.name}</strong> permanently removes the company
            profile, the {companyOnlyInteractions === 1 ? "1 interaction" : `${companyOnlyInteractions} interactions`} logged
            on the company itself (not on a person), and any action items filed against the company alone.
            {people.length
              ? ` ${people.length === 1 ? "The 1 linked contact keeps" : `The ${people.length} linked contacts keep`} their profiles and interaction logs, just without a company.`
              : ""}
            {opps.length
              ? ` ${opps.length === 1 ? "The 1 opportunity" : `The ${opps.length} opportunities`} linked here will be kept, unlinked from the company.`
              : ""}
            {" "}
            There is no undo — restore from a backup in
            <code className="mx-1 rounded bg-stone-100 px-1 py-0.5 text-xs">data/backups</code>if this was a mistake.
          </p>
          <form action={deleteCompany.bind(null, c.id)}>
            <ConfirmButton
              label={`Delete ${c.name}`}
              confirm={`Permanently delete ${c.name}? Contacts are kept but unlinked; interactions and action items filed only on the company are removed. This can't be undone.`}
            />
          </form>
        </div>
      </details>
    </div>
  );
}
