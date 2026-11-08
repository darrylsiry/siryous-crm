import Link from "next/link";
import { opportunityHref, search, SEARCH_LIMIT, type SearchResults } from "@/lib/queries";
import StatusBadge from "@/components/StatusBadge";
import { STAGES } from "@/lib/db";
import { first, type Param } from "@/lib/params";
import { shortDate } from "@/lib/dates.mjs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: Param }>;
}) {
  const query = (first((await searchParams).q) ?? "").trim();
  const results = query ? search(query) : null;
  const total = results
    ? results.people.length +
      results.companies.length +
      results.interactions.length +
      results.actions.length +
      results.opportunities.length
    : 0;
  const anyTruncated = results ? Object.values(results.truncated).some(Boolean) : false;
  const Truncated = ({ section }: { section: keyof SearchResults["truncated"] }) =>
    results?.truncated[section] ? (
      <span className="ml-2 font-normal normal-case tracking-normal text-stone-500">
        showing first {SEARCH_LIMIT} — narrow the search to see the rest
      </span>
    ) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <form action="/search" method="get" className="mt-3">
          <input
            name="q"
            defaultValue={query}
            autoFocus
            placeholder="Search everything — names, emails, companies, notes, interactions, to-dos, deals…"
            aria-label="Search"
            className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm shadow-xs focus:border-indigo-400 focus:outline-none"
          />
        </form>
        {results ? (
          <p className="mt-2 text-sm text-stone-500">
            {anyTruncated ? `${total}+` : total} result{total === 1 ? "" : "s"} for “{query}”
            {anyTruncated ? ` — some sections show only the first ${SEARCH_LIMIT}` : ""}
          </p>
        ) : null}
      </header>

      {results && (
        <div className="space-y-6">
          {results.people.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                People
                <Truncated section="people" />
              </h2>
              <ul className="space-y-1.5">
                {results.people.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Link href={`/people/${p.slug}`} className="text-sm font-semibold hover:text-indigo-700">
                      {p.name}
                    </Link>
                    <span className="text-xs text-stone-500">{p.company_name ?? ""}</span>
                    <StatusBadge statusKey={p.status_key} compact />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results.companies.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Companies
                <Truncated section="companies" />
              </h2>
              <ul className="space-y-1.5">
                {results.companies.map((c) => (
                  <li key={c.id} className="flex min-w-0 items-center gap-2">
                    <Link href={`/companies/${c.slug}`} className="shrink-0 text-sm font-semibold hover:text-indigo-700">
                      {c.name}
                    </Link>
                    <span className="min-w-0 truncate text-xs text-stone-500">{c.industry ?? ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results.opportunities.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Pipeline
                <Truncated section="opportunities" />
              </h2>
              <ul className="space-y-1.5">
                {results.opportunities.map((o) => (
                  <li key={o.id} className="text-sm">
                    <Link href={opportunityHref(o)} className="font-semibold hover:text-indigo-700">
                      {o.name}
                    </Link>
                    <span className="ml-2 text-xs text-stone-500">
                      {STAGES[o.stage]?.icon} {STAGES[o.stage]?.label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results.interactions.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Interactions
                <Truncated section="interactions" />
              </h2>
              <ul className="space-y-2">
                {results.interactions.map((i) => (
                  <li key={i.id} className="text-sm">
                    <span className="tabular-nums text-xs text-stone-500">{shortDate(i.date) || i.date}</span>{" "}
                    {i.person_slug ? (
                      <Link href={`/people/${i.person_slug}`} className="font-medium hover:text-indigo-700">
                        {i.person_name}
                      </Link>
                    ) : i.company_slug ? (
                      <Link href={`/companies/${i.company_slug}`} className="font-medium hover:text-indigo-700">
                        {i.company_name}
                      </Link>
                    ) : null}
                    <span className="block text-xs text-stone-500 line-clamp-2">{i.summary}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results.actions.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                To-dos
                <Truncated section="actions" />
              </h2>
              <ul className="space-y-1.5">
                {results.actions.map((a) => (
                  <li key={a.id} className="text-sm text-stone-700">
                    {a.status === "done" ? "✅ " : "☐ "}
                    <Link
                      href={a.status === "done" ? `/actions?older=1#item-${a.id}` : `/actions#item-${a.id}`}
                      className={`hover:text-indigo-700 ${a.status === "done" ? "text-stone-500 line-through" : "font-medium"}`}
                    >
                      {a.title}
                    </Link>
                    <span className="ml-2 text-xs text-stone-500">
                      {a.person_slug ? (
                        <Link href={`/people/${a.person_slug}`} className="hover:text-indigo-700">
                          {a.person_name}
                        </Link>
                      ) : a.company_slug ? (
                        <Link href={`/companies/${a.company_slug}`} className="hover:text-indigo-700">
                          {a.company_name}
                        </Link>
                      ) : (
                        "Actions"
                      )}
                      {a.due_date || a.due_label ? ` · due ${a.due_date ? shortDate(a.due_date) : a.due_label}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {total === 0 && <p className="text-sm italic text-stone-500">No matches.</p>}
        </div>
      )}
    </div>
  );
}
