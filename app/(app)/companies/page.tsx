import Link from "next/link";
import { allCompanies } from "@/lib/queries";
import StatusPicker from "@/components/StatusPicker";
import { createCompany } from "@/lib/actions";
import { STATUS } from "@/lib/db";
import PendingButton from "@/components/PendingButton";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; duplicate?: string }>;
}) {
  const sp = await searchParams;
  const status = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const duplicate = sp.duplicate;
  let companies = allCompanies();
  if (status) companies = companies.filter((c) => c.status_key === status);

  return (
    <div className="space-y-6">
      {duplicate ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Not created — <Link href={`/companies/${duplicate}`} className="font-semibold underline">a company with that name already exists</Link>. Open it, or add a distinguishing detail to the name.
        </p>
      ) : null}
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
        <p className="mt-1 text-sm text-stone-500">{companies.length} companies</p>
      </header>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Link
          href="/companies"
          className={`rounded-full px-3 py-1 ring-1 ring-inset ${!status ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-300 hover:bg-stone-100"}`}
        >
          All
        </Link>
        {Object.entries(STATUS).map(([key, s]) => (
          <Link
            key={key}
            href={`/companies?status=${key}`}
            className={`rounded-full px-3 py-1 ring-1 ring-inset ${status === key ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-300 hover:bg-stone-100"}`}
          >
            {s.emoji} {s.label}
          </Link>
        ))}
      </div>

      {/* Mobile card list */}
      <ul className="space-y-2 md:hidden">
        {companies.map((c) => (
          <li key={c.id} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/companies/${c.slug}`} className="min-w-0 font-semibold text-stone-900 hover:text-indigo-700">
                {c.name}
              </Link>
              <StatusPicker entity="company" id={c.id} statusKey={c.status_key} note={c.status_note} updatedAt={c.updated_at} statuses={STATUS} compact />
            </div>
            {c.industry ? (
              <div className="mt-1 text-xs text-stone-500 line-clamp-2">{c.industry}</div>
            ) : null}
            {c.key_people ? (
              <div className="mt-1 text-xs text-stone-400 line-clamp-2">{c.key_people}</div>
            ) : null}
            {c.next_action ? (
              <div className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600 line-clamp-2">
                <span className="font-medium text-stone-400">Next: </span>
                {c.next_action}
              </div>
            ) : null}
          </li>
        ))}
        {!companies.length && (
          <li className="rounded-xl border border-stone-200 bg-white p-4 text-sm italic text-stone-400">
            {status ? "No matches." : "No companies yet — add one below. Intake also creates a company when it extracts one from a profile."}
          </li>
        )}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Industry</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Contacts</th>
              <th className="px-4 py-3 font-medium">Next action</th>
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
                <td className="px-4 py-3 text-xs text-stone-500 max-w-56">
                  <span className="line-clamp-2">{c.industry ?? "—"}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusPicker entity="company" id={c.id} statusKey={c.status_key} note={c.status_note} updatedAt={c.updated_at} statuses={STATUS} compact />
                </td>
                <td className="px-4 py-3 text-xs text-stone-500 max-w-48">
                  <span className="line-clamp-2">{c.key_people || "—"}</span>
                </td>
                <td className="px-4 py-3 text-xs text-stone-600 max-w-72">
                  <span className="line-clamp-2">{c.next_action ?? "—"}</span>
                </td>
              </tr>
            ))}
            {!companies.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-sm italic text-stone-400">
                  {status ? "No matches." : "No companies yet — add one below. Intake also creates a company when it extracts one from a profile."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border border-dashed border-stone-300 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-indigo-600 select-none">
          ＋ Add company
        </summary>
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
                <option key={key} value={key}>{s.emoji} {s.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600 sm:col-span-2">
            Next action
            <input name="next_action" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <PendingButton label="Create company" pendingLabel="Creating…" className={"rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"} />
          </div>
        </form>
      </details>
    </div>
  );
}
