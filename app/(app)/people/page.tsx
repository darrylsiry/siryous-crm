import Link from "next/link";
import { allPeople, allCompanies } from "@/lib/queries";
import StatusPicker from "@/components/StatusPicker";
import { createPerson } from "@/lib/actions";
import { STATUS } from "@/lib/db";
import PendingButton from "@/components/PendingButton";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[]; duplicate?: string }>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const status = first(sp.status);
  const q = first(sp.q);
  const duplicate = sp.duplicate;
  let people = allPeople();
  if (status) people = people.filter((p) => p.status_key === status);
  if (q) {
    const needle = q.toLowerCase();
    people = people.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.company_name ?? "").toLowerCase().includes(needle) ||
        (p.role_title ?? "").toLowerCase().includes(needle)
    );
  }
  const companies = allCompanies();

  return (
    <div className="space-y-6">
      {duplicate ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Not created — <Link href={`/people/${duplicate}`} className="font-semibold underline">a profile with that name already exists</Link>. Open it, or add a distinguishing detail to the name.
        </p>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-stone-500">{people.length} contacts</p>
        </div>
        <form className="flex w-full gap-2 sm:w-auto" action="/people" method="get">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search name, company, role…"
            className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm sm:w-56"
          />
          {status ? <input type="hidden" name="status" value={status} /> : null}
        </form>
      </header>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Link
          href={q ? `/people?q=${encodeURIComponent(q)}` : "/people"}
          className={`rounded-full px-3 py-1 ring-1 ring-inset ${!status ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-300 hover:bg-stone-100"}`}
        >
          All
        </Link>
        {Object.entries(STATUS).map(([key, s]) => (
          <Link
            key={key}
            href={q ? `/people?status=${key}&q=${encodeURIComponent(q)}` : `/people?status=${key}`}
            className={`rounded-full px-3 py-1 ring-1 ring-inset ${status === key ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-300 hover:bg-stone-100"}`}
          >
            {s.emoji} {s.label}
          </Link>
        ))}
      </div>

      {/* Mobile card list */}
      <ul className="space-y-2 md:hidden">
        {people.map((p) => (
          <li key={p.id} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/people/${p.slug}`} className="font-semibold text-stone-900 hover:text-indigo-700">
                  {p.name}
                </Link>
                {p.role_title ? (
                  <div className="truncate text-xs text-stone-400">{p.role_title}</div>
                ) : null}
              </div>
              <StatusPicker entity="person" id={p.id} statusKey={p.status_key} note={p.status_note} updatedAt={p.updated_at} statuses={STATUS} compact />
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-stone-500">
              {p.company_slug ? (
                <Link href={`/companies/${p.company_slug}`} className="hover:text-indigo-700">
                  {p.company_name}
                </Link>
              ) : p.company_note ? (
                <span>{p.company_note.split("(")[0].trim()}</span>
              ) : null}
              {p.relationship_strength ? <span>{p.relationship_strength}</span> : null}
              {p.last_touch ? (
                <span className="tabular-nums text-stone-400">touched {p.last_touch}{p.last_touch_note ? ` · ${p.last_touch_note}` : ""}</span>
              ) : null}
            </div>
            {p.next_action ? (
              <div className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600 line-clamp-2">
                <span className="font-medium text-stone-400">Next: </span>
                {p.next_action}
              </div>
            ) : null}
          </li>
        ))}
        {!people.length && (
          <li className="rounded-xl border border-stone-200 bg-white p-4 text-sm italic text-stone-400">
            {q || status ? "No matches." : "No people yet — add one below, or paste a LinkedIn profile into Intake."}
          </li>
        )}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Strength</th>
              <th className="px-4 py-3 font-medium">Last touch</th>
              <th className="px-4 py-3 font-medium">Next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {people.map((p) => (
              <tr key={p.id} className="hover:bg-indigo-50/40">
                <td className="px-4 py-3">
                  <Link href={`/people/${p.slug}`} className="font-semibold text-stone-900 hover:text-indigo-700">
                    {p.name}
                  </Link>
                  {p.role_title ? (
                    <div className="text-xs text-stone-400 max-w-52 truncate">{p.role_title}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  {p.company_slug ? (
                    <Link href={`/companies/${p.company_slug}`} className="hover:text-indigo-700">
                      {p.company_name}
                    </Link>
                  ) : (
                    <span className="text-stone-500">{(p.company_note ?? "—").split("(")[0].trim()}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPicker entity="person" id={p.id} statusKey={p.status_key} note={p.status_note} updatedAt={p.updated_at} statuses={STATUS} compact />
                </td>
                <td className="px-4 py-3 text-xs text-stone-500">{p.relationship_strength ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums text-xs text-stone-500">{p.last_touch ?? (p.last_touch_note ? `undated — ${p.last_touch_note}` : "—")}</td>
                <td className="px-4 py-3 text-xs text-stone-600 max-w-72">
                  <span className="line-clamp-2">{p.next_action ?? "—"}</span>
                </td>
              </tr>
            ))}
            {!people.length && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-sm italic text-stone-400">
                  {q || status ? "No matches." : "No people yet — add one below, or paste a LinkedIn profile into Intake."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border border-dashed border-stone-300 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-indigo-600 select-none">
          ＋ Add person
        </summary>
        <form action={createPerson} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-stone-600">
            Name *
            <input name="name" required className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Role / title
            <input name="role_title" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Company
            <select name="company_id" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              <option value="">— none —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Status
            <select name="status_key" defaultValue="new" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              {Object.entries(STATUS).map(([key, s]) => (
                <option key={key} value={key}>{s.emoji} {s.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Email
            <input name="email" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            LinkedIn
            <input name="linkedin" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600 sm:col-span-2">
            Next action
            <input name="next_action" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <PendingButton label="Create profile" pendingLabel="Creating…" className={"rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"} />
          </div>
        </form>
      </details>
    </div>
  );
}
