import Link from "next/link";
import { notFound } from "next/navigation";
import { companyBySlug, interactionsFor, openActionItems, opportunitiesFor, peopleAtCompany, peopleOptions } from "@/lib/queries";
import StatusPicker from "@/components/StatusPicker";
import StatusEditor from "@/components/StatusEditor";
import EditableSection from "@/components/EditableSection";
import AddInteraction from "@/components/AddInteraction";
import InteractionLog from "@/components/InteractionLog";
import ConfirmButton from "@/components/ConfirmButton";
import { PeopleOptions } from "@/components/PeoplePicker";
import { OpenTodos, ProfileActions, RestoreNote } from "@/components/ProfileParts";
import { shortDate, todayLocal } from "@/lib/dates.mjs";
import type { Metadata } from "next";
import { deleteCompany } from "@/lib/actions";
import StaleNotice from "@/components/StaleNotice";
import { profilePath, slugParam } from "@/lib/slug";
import { opportunityHref } from "@/lib/queries";
import { STAGES, STATUS } from "@/lib/db";
import FlashBanner from "@/components/FlashBanner";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = companyBySlug(slugParam((await params).slug));
  return { title: c?.name ?? "Not found" };
}

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ stale?: string; saved?: string; added?: string }>;
}) {
  const slug = slugParam((await params).slug);
  const { stale, saved, added } = await searchParams;
  const c = companyBySlug(slug);
  if (!c) notFound();
  const people = peopleAtCompany(c.id);
  const interactions = interactionsFor({ companyId: c.id });
  const opps = opportunitiesFor({ companyId: c.id });
  const companyOnlyInteractions = interactions.filter((i) => !i.person_id).length;
  const todos = openActionItems().filter((a) => a.company_id === c.id);
  const today = todayLocal();

  return (
    <PeopleOptions options={peopleOptions()}>
    <div className="space-y-6">
      {stale ? <StaleNotice href={profilePath("companies", slug)} kept={stale === "kept"} /> : null}
        {saved ? (
          <FlashBanner cleanHref={profilePath("companies", slug)} className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
            ✓ Saved.
          </FlashBanner>
        ) : added === "deal" ? (
          <FlashBanner cleanHref={profilePath("companies", slug)} className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
            ✓ Deal added.{" "}
            <Link href="/pipeline" className="font-medium underline">
              See it on the Pipeline →
            </Link>
          </FlashBanner>
        ) : null}
      <header>
        <Link href="/companies" className="text-xs text-stone-500 hover:text-indigo-600">
          ← Companies
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{c.name}</h1>
          <StatusPicker entity="company" id={c.id} statusKey={c.status_key} note={c.status_note} updatedAt={c.updated_at} statuses={STATUS} />
        </div>
        {c.industry ? (
          <p className="mt-1 text-sm text-stone-600">{c.industry}</p>
        ) : null}
        <ProfileActions company={c} />
        {/* One place for the next step (and the status note with it): the box shows it, ✎ Change edits it. */}
        <div className={c.next_action ? "mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" : "mt-3"}>
          {c.next_action ? (
            <p>
              <span className="font-semibold">Next step:</span> {c.next_action}
              {c.last_touch ? <span className="ml-2 text-xs text-amber-800">last touch {shortDate(c.last_touch, today)}</span> : null}
            </p>
          ) : null}
          <StatusEditor
            entity="company"
            id={c.id}
            statusKey={c.status_key}
            statusNote={c.status_note}
            nextAction={c.next_action}
            updatedAt={c.updated_at}
            label={c.next_action ? "✎ Change" : "✎ Add a next step"}
          />
        </div>
      </header>

      <OpenTodos name={c.name} items={todos} />

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
              <AddInteraction companyId={c.id} companySlug={c.slug} />
            </div>
            <InteractionLog interactions={interactions} />
          </section>
        </div>

        <aside className="space-y-4">
          {opps.length > 0 && (
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Deals
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
                        <span className="ml-1 text-stone-500">· {p.relationship_strength}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm italic text-stone-500">No linked contacts. Link someone from their profile&apos;s ✎ Edit.</p>
            )}
          </section>

          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Snapshot</h2>
              <Link href={`${profilePath("companies", c.slug)}/edit`} className="text-xs font-medium text-indigo-600 hover:underline">
                ✎ Edit
              </Link>
            </div>
            <dl className="space-y-2.5 text-sm">
              {[
                ["HQ / locations", c.hq],
                ["Size", c.size],
                ["Revenue / stage", c.revenue_stage],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-stone-500">{label}</dt>
                  <dd className="text-stone-800">{(value as string) ?? "—"}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs text-stone-500">Website</dt>
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
                <dt className="text-xs text-stone-500">Last touch</dt>
                <dd className="text-stone-800 tabular-nums">{c.last_touch ? shortDate(c.last_touch, today) : "—"}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <details className="rounded-xl border border-stone-200 bg-white px-5 py-3">
        <summary className="cursor-pointer text-xs font-medium text-stone-500 select-none hover:text-red-600">
          Danger zone
        </summary>
        <div className="mt-3 space-y-3 text-sm text-stone-600">
          <p>
            Deleting <strong className="text-stone-800">{c.name}</strong> permanently removes the company
            profile, the {companyOnlyInteractions === 1 ? "1 interaction" : `${companyOnlyInteractions} interactions`} logged
            on the company itself (not on a person), any to-dos filed against the company alone, and earlier versions of its profile text.
            {people.length
              ? ` ${people.length === 1 ? "The 1 linked contact keeps" : `The ${people.length} linked contacts keep`} their profiles and interaction logs, just without a company.`
              : ""}
            {opps.length
              ? ` ${opps.length === 1 ? "The 1 deal" : `The ${opps.length} deals`} linked here will be kept, unlinked from the company.`
              : ""}
            {" "}
            <RestoreNote />
          </p>
          <form action={deleteCompany.bind(null, c.id)}>
            <ConfirmButton
              label={`Delete ${c.name}`}
              confirm={`Permanently delete ${c.name}? Contacts are kept but unlinked; interactions and to-dos filed only on the company are removed. This can't be undone.`}
            />
          </form>
        </div>
      </details>
    </div>
    </PeopleOptions>
  );
}
