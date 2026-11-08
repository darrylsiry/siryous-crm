import Link from "next/link";
import { allPeople, allCompanies } from "@/lib/queries";
import StatusPicker from "@/components/StatusPicker";
import { createPerson } from "@/lib/actions";
import { STATUS } from "@/lib/db";
import PendingButton from "@/components/PendingButton";
import SearchSelect from "@/components/SearchSelect";
import { first, type Param } from "@/lib/params";
import { profilePath } from "@/lib/slug";
import { shortDate, todayLocal } from "@/lib/dates.mjs";
import FlashBanner from "@/components/FlashBanner";

export const dynamic = "force-dynamic";

export const metadata = { title: "People" };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: Param; status?: Param; q?: Param; duplicate?: Param; sort?: Param; add?: Param }>;
}) {
  const sp = await searchParams;
  const status = first(sp.status);
  const q = first(sp.q);
  const duplicate = first(sp.duplicate);
  const byTouch = first(sp.sort) === "touch";
  let people = allPeople();
  const total = people.length;
  if (status) people = people.filter((p) => p.status_key === status);
  if (q) {
    const needle = q.toLowerCase();
    people = people.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.company_name ?? "").toLowerCase().includes(needle) ||
        (p.role_title ?? "").toLowerCase().includes(needle) ||
        (p.email ?? "").toLowerCase().includes(needle)
    );
  }
  // Longest since the last touch first; never touched at the top.
  if (byTouch) people = [...people].sort((a, b) => (a.last_touch ?? "").localeCompare(b.last_touch ?? ""));
  const today = todayLocal();
  const keep = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, sort: byTouch ? "touch" : undefined, ...extra })) if (v) u.set(k, v);
    const qs = u.toString();
    return qs ? `/people?${qs}` : "/people";
  };
  const companies = allCompanies();
  // A LinkedIn connection date stands in for last touch until something is logged: say which it is.
  const connectedOnly = (p: (typeof people)[number]) => !!p.connected_on && p.last_touch === p.connected_on && !p.logged;
  const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  // An edit opened from this list comes back to it, filters and all.
  const editHref = (slug: string) => `${profilePath("people", slug)}/edit?back=${encodeURIComponent(keep({}))}`;

  return (
    <div className="space-y-6">
      {first(sp.saved) ? (
        <FlashBanner cleanHref={keep({})} className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          ✓ Saved.
        </FlashBanner>
      ) : null}
      {duplicate ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Not created — <Link href={profilePath("people", duplicate)} className="font-semibold underline">a profile with that name already exists</Link>. Open it, or add a distinguishing detail to the name.
        </p>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-stone-600">
            {people.length === total ? `${total} ${total === 1 ? "contact" : "contacts"}` : `${people.length} of ${total} contacts`}
          </p>
        </div>
        <a href={`${keep({ add: "1" })}#add`} className="order-last rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 sm:order-none">
          ＋ Add person
        </a>
        <form className="flex w-full gap-2 sm:w-auto" action="/people" method="get">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search name, company, role, email…"
            aria-label="Search people"
            className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm sm:w-56"
          />
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {byTouch ? <input type="hidden" name="sort" value="touch" /> : null}
        </form>
      </header>
      <details id="add" className="rounded-xl border border-dashed border-stone-300 bg-white p-4" open={!total || !!sp.add}>
        <summary className="cursor-pointer text-sm font-medium text-indigo-600 select-none">
          ＋ Add a person
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
            <SearchSelect name="company_id" options={companies.map((c) => ({ value: String(c.id), label: c.name }))} emptyLabel="— none —" className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            …or a new company
            <input name="new_company" placeholder="Type a name to create it" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
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
            Phone
            <input name="phone" type="tel" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            LinkedIn
            <input name="linkedin" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Next step
            <input name="next_action" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <PendingButton label="Create profile" pendingLabel="Creating…" className={"rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"} />
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
        {byTouch ? (
          <>
            Sorted by last touch, longest ago first ·{" "}
            <Link href={keep({ sort: "" })} className="font-medium text-indigo-600 hover:underline">
              sort by status, then name
            </Link>
          </>
        ) : (
          <>
            Sorted by status, then name ·{" "}
            <Link href={keep({ sort: "touch" })} className="font-medium text-indigo-600 hover:underline">
              sort by last touch
            </Link>
          </>
        )}
      </p>

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
                  <div className="truncate text-xs text-stone-500">{p.role_title}</div>
                ) : null}
                {p.status_note ? <div className="text-xs text-stone-600">{p.status_note}</div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPicker entity="person" id={p.id} statusKey={p.status_key} note={p.status_note} updatedAt={p.updated_at} statuses={STATUS} compact />
                <Link href={editHref(p.slug)} aria-label={`Edit ${p.name}`} className="whitespace-nowrap rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:border-indigo-400 hover:text-indigo-700">
                  ✎ Edit
                </Link>
              </div>
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
              {p.last_touch && connectedOnly(p) ? (
                <span className="text-stone-500">connected {monthYear(p.last_touch)}</span>
              ) : p.last_touch ? (
                <span className="tabular-nums text-stone-500">touched {shortDate(p.last_touch, today)}{p.last_touch_note ? ` · ${p.last_touch_note}` : ""}</span>
              ) : null}
            </div>
            {p.next_action ? (
              <div className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600 line-clamp-2">
                <span className="font-medium text-stone-500">Next step: </span>
                {p.next_action}
              </div>
            ) : null}
          </li>
        ))}
        {!people.length && (
          <li className="rounded-xl border border-stone-200 bg-white p-4 text-sm italic text-stone-500">
            {q || status ? "No matches." : "No people yet — add one above, or paste a LinkedIn profile into Intake."}
          </li>
        )}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Strength</th>
              <th className="px-4 py-3 font-medium">Last touch</th>
              <th className="px-4 py-3 font-medium">Next step</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Edit</span>
              </th>
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
                    <div className="text-xs text-stone-500 max-w-52 truncate">{p.role_title}</div>
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
                <td className="px-4 py-3 tabular-nums text-xs text-stone-500">
                  {p.last_touch && connectedOnly(p) ? (
                    <span className="text-stone-500">connected {monthYear(p.last_touch)}</span>
                  ) : p.last_touch ? (
                    shortDate(p.last_touch, today)
                  ) : p.last_touch_note ? (
                    `undated — ${p.last_touch_note}`
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-stone-600 max-w-72">
                  <span className="line-clamp-2">{p.next_action ?? "—"}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={editHref(p.slug)} aria-label={`Edit ${p.name}`} className="whitespace-nowrap rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-stone-600 hover:border-indigo-400 hover:text-indigo-700">
                    ✎ Edit
                  </Link>
                </td>
              </tr>
            ))}
            {!people.length && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-sm italic text-stone-500">
                  {q || status ? "No matches." : "No people yet — add one above, or paste a LinkedIn profile into Intake."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
