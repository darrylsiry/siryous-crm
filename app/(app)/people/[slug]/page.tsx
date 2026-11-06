import Link from "next/link";
import { notFound } from "next/navigation";
import { companyOptions, connectionsFor, interactionsFor, openActionItems, opportunitiesFor, peopleOptions, personBySlug } from "@/lib/queries";
import StatusPicker from "@/components/StatusPicker";
import StatusEditor from "@/components/StatusEditor";
import EditableSection from "@/components/EditableSection";
import AddInteraction from "@/components/AddInteraction";
import InteractionLog from "@/components/InteractionLog";
import ConfirmButton from "@/components/ConfirmButton";
import ClosingDetails from "@/components/ClosingDetails";
import SearchSelect from "@/components/SearchSelect";
import { PeopleOptions } from "@/components/PeoplePicker";
import { OpenTodos, ProfileActions, RestoreNote } from "@/components/ProfileParts";
import { deletePerson, updateSnapshot } from "@/lib/actions";
import PendingButton from "@/components/PendingButton";
import StaleNotice from "@/components/StaleNotice";
import { profilePath, slugParam } from "@/lib/slug";
import { opportunityHref } from "@/lib/queries";
import { STAGES, STATUS, STRENGTHS } from "@/lib/db";
import { shortDate, todayLocal } from "@/lib/dates.mjs";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = personBySlug(slugParam((await params).slug));
  return { title: p?.name ?? "Not found" };
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ stale?: string }>;
}) {
  const slug = slugParam((await params).slug);
  const { stale } = await searchParams;
  const p = personBySlug(slug);
  if (!p) notFound();
  const interactions = interactionsFor({ personId: p.id });
  const opps = opportunitiesFor({ personId: p.id });
  const todos = openActionItems().filter((a) => a.person_id === p.id);
  const connections = connectionsFor(p.id);
  const tags = p.tags;
  const cadence = p.cadence_days;
  const today = todayLocal();
  const first = p.name.split(/\s+/)[0] || p.name;
  const connectedOn = (p as { connected_on?: string | null }).connected_on ?? null;
  const tel = p.phone?.replace(/[^\d+]/g, "");
  const mail = p.email?.match(/[^\s<>(),;]+@[^\s<>(),;]+\.[^\s<>(),;]+/)?.[0];

  return (
    <PeopleOptions options={peopleOptions()}>
      <div className="space-y-6">
        {stale ? <StaleNotice href={profilePath("people", slug)} kept={stale === "kept"} /> : null}
        <header>
          <Link href="/people" className="text-xs text-stone-500 hover:text-indigo-600">
            ← People
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
            <StatusPicker entity="person" id={p.id} statusKey={p.status_key} note={p.status_note} updatedAt={p.updated_at} statuses={STATUS} />
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
          <div className="mt-1 text-sm text-stone-600">
            {p.role_title ? <span>{p.role_title}</span> : null}
            {p.company_slug ? (
              <>
                {p.role_title ? " · " : ""}
                <Link href={`/companies/${p.company_slug}`} className="font-medium text-indigo-700 hover:underline">
                  {p.company_name}
                </Link>
              </>
            ) : null}
            {p.company_note ? <span className="text-stone-500"> · {p.company_note}</span> : null}
          </div>
          <ProfileActions person={p} />
          {p.next_action ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <span className="font-semibold">Next step:</span> {p.next_action}
              {p.last_touch ? <span className="ml-2 text-xs text-amber-800">last touch {shortDate(p.last_touch, today)}</span> : null}
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

        <OpenTodos name={first} items={todos} />

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
              <EditableSection title="More" entity="person" id={p.id} updatedAt={p.updated_at} column="extra_sections" value={p.extra_sections} />
            ) : null}
            <EditableSection title="Notes" entity="person" id={p.id} updatedAt={p.updated_at} column="notes" value={p.notes} />

            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Interaction Log</h2>
              </div>
              <div className="mb-4">
                <AddInteraction personId={p.id} companyId={p.company_id ?? undefined} personSlug={p.slug} />
              </div>
              <InteractionLog interactions={interactions} />
            </section>
          </div>

          {/* Snapshot sidebar: first on a phone, where calling or emailing is the point. */}
          <aside className="order-first space-y-4 lg:order-none">
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Snapshot</h2>
              <dl className="space-y-2.5 text-sm">
                <div>
                  <dt className="text-xs text-stone-500">Email</dt>
                  <dd className="break-words text-stone-800">
                    {p.email ? mail ? <a href={`mailto:${mail}`} className="text-indigo-700 hover:underline">{p.email}</a> : p.email : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Phone</dt>
                  <dd className="break-words text-stone-800">
                    {p.phone ? tel && tel.replace(/\D/g, "").length >= 6 ? <a href={`tel:${tel}`} className="text-indigo-700 hover:underline">{p.phone}</a> : p.phone : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Location</dt>
                  <dd className="break-words text-stone-800">{p.location ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">LinkedIn</dt>
                  <dd className="break-words">
                    {p.linkedin ? (
                      (() => {
                        const m = p.linkedin!.match(/\((https?:[^)]+)\)/) || p.linkedin!.match(/(https?:\S+)/);
                        const url = m ? m[1] : null;
                        return url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-700 hover:underline">
                            {url.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                        ) : (
                          <span className="text-xs text-stone-800">{p.linkedin}</span>
                        );
                      })()
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Last touch</dt>
                  <dd className="tabular-nums text-stone-800">
                    {p.last_touch && !(connectedOn && p.last_touch === connectedOn && !interactions.length)
                      ? shortDate(p.last_touch, today)
                      : "—"}
                  </dd>
                </div>
                {connectedOn ? (
                  <div>
                    <dt className="text-xs text-stone-500">Connected</dt>
                    <dd className="text-stone-800">
                      {new Date(`${connectedOn}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-stone-500">Keep-warm cadence</dt>
                  <dd className="text-stone-800">{cadence ? `every ${cadence} days` : "—"}</dd>
                </div>
              </dl>
              <ClosingDetails className="mt-4">
                <summary className="cursor-pointer select-none text-xs font-medium text-indigo-600">✎ Edit snapshot</summary>
                <form action={updateSnapshot} className="mt-2 space-y-2">
                  <input type="hidden" name="entity" value="person" />
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="updated_at" value={p.updated_at ?? ""} />
                  <label className="block text-xs font-medium text-stone-600">
                    Name
                    <input name="name" required defaultValue={p.name} className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                  </label>
                  <label className="block text-xs font-medium text-stone-600">
                    Company
                    <SearchSelect
                      name="company_id"
                      options={companyOptions()}
                      defaultValue={p.company_id}
                      emptyLabel="No company"
                      ariaLabel="Company"
                      className="mt-0.5 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs"
                    />
                  </label>
                  <label className="block text-xs font-medium text-stone-600">
                    …or a new company
                    <input
                      name="new_company"
                      placeholder="Type a name to create (or link) it"
                      className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                    />
                  </label>
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
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <PendingButton
                    label="Save"
                    pendingLabel="Saving…"
                    className={"rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"}
                  />
                </form>
              </ClosingDetails>
            </section>
            {opps.length > 0 && (
              <section className="rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Deals</h2>
                <ul className="space-y-2.5">
                  {opps.map((o) => (
                    <li key={o.id}>
                      <Link href={opportunityHref(o)} className="text-sm font-semibold text-stone-900 hover:text-indigo-700">
                        {o.name}
                      </Link>
                      <div className="text-xs text-stone-500">
                        {STAGES[o.stage]?.icon} {STAGES[o.stage]?.label}
                        {o.priority === 1 ? <span className="ml-1 text-red-600">★</span> : null}
                        {o.next_step ? <span> · → {o.next_step}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {connections.length > 0 && (
              <section className="rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Connections</h2>
                <ul className="space-y-1.5 text-sm">
                  {connections.map((c) => (
                    <li key={c.slug}>
                      <Link href={`/people/${c.slug}`} className="font-medium text-stone-800 hover:text-indigo-700">
                        {c.name}
                      </Link>
                      {c.label ? <span className="text-xs text-stone-500"> · {c.label}</span> : null}
                    </li>
                  ))}
                </ul>
                <Link href="/map" className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline">
                  See on the Map →
                </Link>
              </section>
            )}
          </aside>
        </div>

        <details className="rounded-xl border border-stone-200 bg-white px-5 py-3">
          <summary className="cursor-pointer select-none text-xs font-medium text-stone-500 hover:text-red-600">Danger zone</summary>
          <div className="mt-3 space-y-3 text-sm text-stone-600">
            <p>
              Deleting <strong className="text-stone-800">{p.name}</strong> permanently removes the profile,{" "}
              {interactions.length === 1 ? "its 1 logged interaction" : `its ${interactions.length} logged interactions`}, all of this
              person&apos;s to-dos (open and done), their meeting briefs, and any connections to other people.
              {opps.length
                ? ` ${opps.length === 1 ? "The 1 deal" : `The ${opps.length} deals`} linked here will be kept but no longer linked to a person.`
                : ""}{" "}
              Outreach drafts are kept, unlinked. <RestoreNote />
            </p>
            <form action={deletePerson.bind(null, p.id)}>
              <ConfirmButton
                label={`Delete ${p.name}`}
                confirm={`Permanently delete ${p.name} and their interactions, to-dos, briefs and connections? This can't be undone.`}
              />
            </form>
          </div>
        </details>
      </div>
    </PeopleOptions>
  );
}
