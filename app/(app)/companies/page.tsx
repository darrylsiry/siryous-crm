import Link from "next/link";
import { allCompanies } from "@/lib/queries";
import StatusPicker from "@/components/StatusPicker";
import { createCompany } from "@/lib/actions";
import { STATUS } from "@/lib/db";
import PendingButton from "@/components/PendingButton";
import { first, type Param } from "@/lib/params";
import { profilePath } from "@/lib/slug";
import { shortDate, todayLocal } from "@/lib/dates.mjs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: Param; duplicate?: Param; q?: Param; sort?: Param; add?: Param }>;
}) {
  const sp = await searchParams;
  const status = first(sp.status);
  const duplicate = first(sp.duplicate);
  const q = first(sp.q);
  const byTouch = first(sp.sort) === "touch";
  let companies = allCompanies();
  const total = companies.length;
  if (status) companies = companies.filter((c) => c.status_key === status);
  if (q) {
    const needle = q.toLowerCase();
    companies = companies.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.industry ?? "").toLowerCase().includes(needle) ||
        (c.key_people ?? "").toLowerCase().includes(needle) ||
        (c.website ?? "").toLowerCase().includes(needle)
    );
  }
  if (byTouch) companies = [...companies].sort((a, b) => (a.last_touch ?? "").localeCompare(b.last_touch ?? ""));
  const today = todayLocal();
  const keep = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, sort: byTouch ? "touch" : undefined, ...extra })) if (v) u.set(k, v);
    const qs = u.toString();
    return qs ? `/companies?${qs}` : "/companies";
  };
  // An edit opened from this list comes back to it, filters and all.
  const editHref = (slug: string) => `${profilePath("companies", slug)}/edit?back=${encodeURIComponent(keep({}))}`;
  const empty = status || q ? "No matches." : "No companies yet — add one above. Intake also creates a company when it extracts one from a profile.";

  return (
    <div className="space-y-6">
      {duplicate ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Not created — <Link href={profilePath("companies", duplicate)} className="font-semibold underline">a company with that name already exists</Link>. Open it, or add a distinguishing detail to the name.
        </p>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
          <p className="mt-1 text-sm text-stone-600">
            {companies.length === total ? `${total} ${total === 1 ? "company" : "companies"}` : `${companies.length} of ${total} companies`}
          </p>
        </div>
        <a href={`${keep({ add: "1" })}#add`} className="order-last rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 sm:order-none">
          ＋ Add company
        </a>
        <form className="flex w-full gap-2 sm:w-auto" action="/companies" method="get">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search name, industry, people…"
            aria-label="Search companies"
            className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm sm:w-56"
          />
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {byTouch ? <input type="hidden" name="sort" value="touch" /> : null}
        </form>
      </header>

      <details id="add" className="rounded-xl border border-dashed border-stone-300 bg-white p-4" open={!total || !!sp.add}>
        <summary className="cursor-pointer text-sm font-medium text-indigo-600 select-none">＋ Add a company</summary>
        <form action={createCompany} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-stone-600">
            Name *
            <input name="name" required className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Industry
            <input name="industry" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Website
            <input name="website" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Status
            <select name="status_key" defaultValue="new" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              {Object.entries(STATUS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.emoji} {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600 sm:col-span-2">
            Next step
            <input name="next_action" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <PendingButton
              label="Create company"
              pendingLabel="Creating…"
              className={"rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"}
            />
          </div>
        </form>
      </details>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Link
          href={keep({ status: undefined })}
          className={`rounded-full px-3 py-1 ring-1 ring-inset ${!status ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-300 hover:bg-stone-100"}`}
        >
          All
        </Link>
        {Object.entries(STATUS).map(([key, s]) => (
          <Link
            key={key}
            href={keep({ status: key })}
            className={`rounded-full px-3 py-1 ring-1 ring-inset ${status === key ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-300 hover:bg-stone-100"}`}
          >
            {s.emoji} {s.label}
          </Link>
        ))}
      </div>
      <p className="-mt-3 text-xs text-stone-500">
        {byTouch ? "Sorted by last touch, longest ago first · " : "Sorted by status, then name · "}
        <Link href={keep({ sort: byTouch ? "" : "touch" })} className="font-medium text-indigo-600 hover:underline">
          {byTouch ? "sort by status, then name" : "sort by last touch"}
        </Link>
      </p>

      {/* Mobile card list */}
      <ul className="space-y-2 md:hidden">
        {companies.map((c) => (
          <li key={c.id} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/companies/${c.slug}`} className="min-w-0 font-semibold text-stone-900 hover:text-indigo-700">
                {c.name}
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPicker entity="company" id={c.id} statusKey={c.status_key} note={c.status_note} updatedAt={c.updated_at} statuses={STATUS} compact />
                <Link href={editHref(c.slug)} aria-label={`Edit ${c.name}`} className="whitespace-nowrap rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:border-indigo-400 hover:text-indigo-700">
                  ✎ Edit
                </Link>
              </div>
            </div>
            {c.industry ? <div className="mt-1 text-xs text-stone-600 line-clamp-2">{c.industry}</div> : null}
            {c.key_people ? <div className="mt-1 text-xs text-stone-500 line-clamp-2">{c.key_people}</div> : null}
            {c.next_action ? (
              <div className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600 line-clamp-2">
                <span className="font-medium text-stone-500">Next step: </span>
                {c.next_action}
              </div>
            ) : null}
          </li>
        ))}
        {!companies.length && <li className="rounded-xl border border-stone-200 bg-white p-4 text-sm italic text-stone-500">{empty}</li>}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Industry</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Contacts</th>
              <th className="px-4 py-3 font-medium">Last touch</th>
              <th className="px-4 py-3 font-medium">Next step</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {companies.map((c) => (
              <tr key={c.id} className="hover:bg-indigo-50/40">
                <td className="px-4 py-3">
                  <Link href={`/companies/${c.slug}`} className="font-semibold text-stone-900 hover:text-indigo-700">
                    {c.name}
                  </Link>
                </td>
                <td className="max-w-56 px-4 py-3 text-xs text-stone-600">
                  <span className="line-clamp-2">{c.industry ?? "—"}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusPicker entity="company" id={c.id} statusKey={c.status_key} note={c.status_note} updatedAt={c.updated_at} statuses={STATUS} compact />
                </td>
                <td className="max-w-48 px-4 py-3 text-xs text-stone-600">
                  <span className="line-clamp-2">{c.key_people || "—"}</span>
                </td>
                <td className="px-4 py-3 text-xs tabular-nums text-stone-500">{c.last_touch ? shortDate(c.last_touch, today) : "—"}</td>
                <td className="max-w-72 px-4 py-3 text-xs text-stone-600">
                  <span className="line-clamp-2">{c.next_action ?? "—"}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={editHref(c.slug)} aria-label={`Edit ${c.name}`} className="whitespace-nowrap rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:border-indigo-400 hover:text-indigo-700">
                    ✎ Edit
                  </Link>
                </td>
              </tr>
            ))}
            {!companies.length && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-sm italic text-stone-500">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
