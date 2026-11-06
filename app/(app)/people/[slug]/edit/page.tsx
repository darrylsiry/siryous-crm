import Link from "next/link";
import { notFound } from "next/navigation";
import { companyOptions, personBySlug } from "@/lib/queries";
import SearchSelect from "@/components/SearchSelect";
import PendingButton from "@/components/PendingButton";
import StaleNotice from "@/components/StaleNotice";
import { updateSnapshot } from "@/lib/actions";
import { STATUS, STRENGTHS } from "@/lib/db";
import { first, localPath, type Param } from "@/lib/params";
import { profilePath, slugParam } from "@/lib/slug";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

const LABEL = "text-xs font-medium text-stone-600";
const INPUT = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = personBySlug(slugParam((await params).slug));
  return { title: p ? `Edit ${p.name}` : "Not found" };
}

/** Everything about a person that isn't a written section: opened from the profile or from the People list. */
export default async function EditPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ back?: Param; stale?: Param }>;
}) {
  const slug = slugParam((await params).slug);
  const sp = await searchParams;
  const p = personBySlug(slug);
  if (!p) notFound();
  const profile = profilePath("people", slug);
  const back = localPath(first(sp.back)) ?? profile;
  const self = `${profile}/edit${back === profile ? "" : `?back=${encodeURIComponent(back)}`}`;
  const cadence = p.cadence_days == null ? "" : String(p.cadence_days);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {first(sp.stale) ? <StaleNotice href={self} /> : null}
      <header>
        <Link href={back} className="text-xs text-stone-500 hover:text-indigo-600">
          ← {back === profile ? p.name : back.startsWith("/people") ? "People" : "Back"}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Edit {p.name}</h1>
        <p className="mt-1 text-sm text-stone-600">
          Contact details, company and status. Relationship notes and the other sections are edited on the{" "}
          <Link href={profile} className="font-medium text-indigo-700 hover:underline">
            profile
          </Link>
          .
        </p>
      </header>

      <form action={updateSnapshot} className="grid gap-3 rounded-xl border border-stone-200 bg-white p-5 sm:grid-cols-2">
        <input type="hidden" name="entity" value="person" />
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="updated_at" value={p.updated_at ?? ""} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="cadence_was" value={cadence} />
        <label className={`${LABEL} sm:col-span-2`}>
          Name *
          <input name="name" required defaultValue={p.name} className={INPUT} />
        </label>
        <label className={LABEL}>
          Company
          <SearchSelect
            name="company_id"
            options={companyOptions()}
            defaultValue={p.company_id}
            emptyLabel="No company"
            ariaLabel="Company"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className={LABEL}>
          …or a new company
          <input name="new_company" placeholder="Type a name to create (or link) it" className={INPUT} />
        </label>
        <label className={LABEL}>
          Role / title
          <input name="role_title" defaultValue={p.role_title ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          Company note
          <input name="company_note" defaultValue={p.company_note ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          Status
          <select name="status_key" defaultValue={p.status_key} className={INPUT}>
            {Object.entries(STATUS).map(([key, s]) => (
              <option key={key} value={key}>
                {s.emoji} {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Relationship strength
          <select name="relationship_strength" defaultValue={p.relationship_strength ?? ""} className={INPUT}>
            <option value="">—</option>
            {STRENGTHS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Email
          <input name="email" defaultValue={p.email ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          Phone
          <input name="phone" type="tel" defaultValue={p.phone ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          Location
          <input name="location" defaultValue={p.location ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          LinkedIn
          <input name="linkedin" defaultValue={p.linkedin ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          Tags (comma-separated)
          <input name="tags" defaultValue={p.tags ?? ""} placeholder="connector, friend, inbound…" className={INPUT} />
        </label>
        <label className={LABEL}>
          Keep-warm cadence (days, blank = none)
          <input name="cadence_days" type="number" min={1} defaultValue={cadence} className={INPUT} />
          <span className="mt-1 block font-normal text-stone-500">Left as it is, a new status brings its usual cadence.</span>
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <PendingButton
            label="Save"
            pendingLabel="Saving…"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          />
          <Link href={back} className="text-sm font-medium text-stone-600 hover:text-indigo-700">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
