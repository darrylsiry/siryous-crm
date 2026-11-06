import Link from "next/link";
import { notFound } from "next/navigation";
import { companyBySlug } from "@/lib/queries";
import PendingButton from "@/components/PendingButton";
import StaleNotice from "@/components/StaleNotice";
import { updateSnapshot } from "@/lib/actions";
import { STATUS } from "@/lib/db";
import { first, localPath, type Param } from "@/lib/params";
import { profilePath, slugParam } from "@/lib/slug";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

const LABEL = "text-xs font-medium text-stone-600";
const INPUT = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = companyBySlug(slugParam((await params).slug));
  return { title: c ? `Edit ${c.name}` : "Not found" };
}

/** Everything about a company that isn't a written section: opened from the profile or from the Companies list. */
export default async function EditCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ back?: Param; stale?: Param }>;
}) {
  const slug = slugParam((await params).slug);
  const sp = await searchParams;
  const c = companyBySlug(slug);
  if (!c) notFound();
  const profile = profilePath("companies", slug);
  const back = localPath(first(sp.back)) ?? profile;
  const self = `${profile}/edit${back === profile ? "" : `?back=${encodeURIComponent(back)}`}`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {first(sp.stale) ? <StaleNotice href={self} /> : null}
      <header>
        <Link href={back} className="text-xs text-stone-500 hover:text-indigo-600">
          ← {back === profile ? c.name : back.startsWith("/companies") ? "Companies" : "Back"}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Edit {c.name}</h1>
        <p className="mt-1 text-sm text-stone-600">
          Name, status and the snapshot. Business context and the other sections are edited on the{" "}
          <Link href={profile} className="font-medium text-indigo-700 hover:underline">
            profile
          </Link>
          ; people are linked to a company from their own Edit page.
        </p>
      </header>

      <form action={updateSnapshot} className="grid gap-3 rounded-xl border border-stone-200 bg-white p-5 sm:grid-cols-2">
        <input type="hidden" name="entity" value="company" />
        <input type="hidden" name="id" value={c.id} />
        <input type="hidden" name="updated_at" value={c.updated_at ?? ""} />
        <input type="hidden" name="back" value={back} />
        <label className={`${LABEL} sm:col-span-2`}>
          Name *
          <input name="name" required defaultValue={c.name} className={INPUT} />
        </label>
        <label className={LABEL}>
          Status
          <select name="status_key" defaultValue={c.status_key} className={INPUT}>
            {Object.entries(STATUS).map(([key, s]) => (
              <option key={key} value={key}>
                {s.emoji} {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Industry
          <input name="industry" defaultValue={c.industry ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          Size / headcount
          <input name="size" defaultValue={c.size ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          HQ / locations
          <input name="hq" defaultValue={c.hq ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          Website
          <input name="website" defaultValue={c.website ?? ""} className={INPUT} />
        </label>
        <label className={LABEL}>
          Revenue / stage
          <input name="revenue_stage" defaultValue={c.revenue_stage ?? ""} className={INPUT} />
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
