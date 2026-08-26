import Link from "next/link";
import { search } from "@/lib/queries";
import StatusBadge from "@/components/StatusBadge";
import { STAGES } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q ?? "").trim();
  const results = query ? search(query) : null;
  const total = results
    ? results.people.length +
      results.companies.length +
      results.interactions.length +
      results.actions.length +
      results.opportunities.length
    : 0;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <form action="/search" method="get" className="mt-3">
          <input
            name="q"
            defaultValue={query}
            autoFocus
            placeholder="Search everything — people, companies, notes, interactions, deals…"
            aria-label="Search"
            className="w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm shadow-xs focus:border-indigo-400 focus:outline-none"
          />
        </form>
        {results ? (
          <p className="mt-2 text-sm text-stone-500">
            {total} result{total === 1 ? "" : "s"} for “{query}”
          </p>
        ) : null}
      </header>

      {results && (
        <div className="space-y-6">
          {results.people.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">People</h2>
              <ul className="space-y-1.5">
                {results.people.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Link href={`/people/${p.slug}`} className="text-sm font-semibold hover:text-indigo-700">
                      {p.name}
                    </Link>
                    <span className="text-xs text-stone-400">{p.company_name ?? ""}</span>
                    <StatusBadge statusKey={p.status_key} compact />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results.companies.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Companies</h2>
              <ul className="space-y-1.5">
                {results.companies.map((c) => (
                  <li key={c.id} className="flex min-w-0 items-center gap-2">
                    <Link href={`/companies/${c.slug}`} className="shrink-0 text-sm font-semibold hover:text-indigo-700">
                      {c.name}
                    </Link>
                    <span className="min-w-0 truncate text-xs text-stone-400">{c.industry ?? ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results.opportunities.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Pipeline</h2>
              <ul className="space-y-1.5">
                {results.opportunities.map((o) => (
                  <li key={o.id} className="text-sm">
                    <Link href="/pipeline" className="font-semibold hover:text-indigo-700">
                      {o.name}
                    </Link>
                    <span className="ml-2 text-xs text-stone-400">
                      {STAGES[o.stage]?.icon} {STAGES[o.stage]?.label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results.interactions.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Interactions</h2>
              <ul className="space-y-2">
                {results.interactions.map((i) => (
                  <li key={i.id} className="text-sm">
                    <span className="tabular-nums text-xs text-stone-400">{i.date}</span>{" "}
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
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Action items</h2>
              <ul className="space-y-1.5">
                {results.actions.map((a) => (
                  <li key={a.id} className="text-sm text-stone-700">
                    {a.status === "done" ? "✅ " : "☐ "}
                    <span className={a.status === "done" ? "text-stone-400 line-through" : ""}>{a.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {total === 0 && <p className="text-sm italic text-stone-400">No matches.</p>}
        </div>
      )}
    </div>
  );
}
