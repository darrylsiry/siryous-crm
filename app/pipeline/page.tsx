import { KINDS, STAGES } from "@/lib/db";
import { allCompanies, allOpportunities, allPeople } from "@/lib/queries";
import { createOpportunity } from "@/lib/actions";
import OpportunityCard from "@/components/OpportunityCard";

export const dynamic = "force-dynamic";

export default function PipelinePage() {
  const opps = allOpportunities();
  const people = allPeople();
  const companies = allCompanies();

  const openStages = Object.entries(STAGES)
    .filter(([, s]) => s.open)
    .sort((a, b) => a[1].order - b[1].order);
  const closedStages = Object.entries(STAGES).filter(([, s]) => !s.open);
  const closed = opps.filter((o) => !STAGES[o.stage]?.open);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-stone-500">
            {opps.length - closed.length} open opportunities · ★ = high priority
          </p>
        </div>
      </header>

      <div className="full-bleed -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:-mx-2 sm:snap-none sm:px-2">
        {openStages.map(([key, s]) => {
          const items = opps.filter((o) => o.stage === key);
          return (
            <div
              key={key}
              className={`w-72 max-w-[85vw] shrink-0 snap-start rounded-xl border border-stone-200 border-t-4 bg-stone-100/60 md:w-auto md:min-w-60 md:max-w-none md:flex-1 ${s.color}`}
            >
              <header className="px-3 py-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                  {s.icon} {s.label}
                  <span className="ml-1.5 text-stone-400">{items.length}</span>
                </h2>
              </header>
              <div className="space-y-2 px-2 pb-2">
                {items.map((o) => (
                  <OpportunityCard key={o.id} o={o} />
                ))}
                {!items.length && (
                  <p className="px-2 pb-2 text-xs italic text-stone-400">Empty</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {closed.length > 0 && (
        <details className="rounded-xl border border-stone-200 bg-white">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-stone-500 select-none">
            {closedStages.map(([, s]) => s.icon).join(" ")} Closed / on hold ({closed.length})
          </summary>
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {closed.map((o) => (
              <OpportunityCard key={o.id} o={o} />
            ))}
          </div>
        </details>
      )}

      <details className="rounded-xl border border-dashed border-stone-300 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-indigo-600 select-none">
          ＋ Add opportunity
        </summary>
        <form action={createOpportunity} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-stone-600 sm:col-span-2">
            Name *
            <input name="name" required placeholder="e.g. Acme — AI strategy engagement" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Kind
            <select name="kind" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              {Object.entries(KINDS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Stage
            <select name="stage" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              {Object.entries(STAGES).map(([k, s]) => (
                <option key={k} value={k}>{s.icon} {s.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Person
            <select name="person_id" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              <option value="">—</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Company
            <select name="company_id" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Value / economics
            <input name="value_note" placeholder="retainer, % fee, project fee…" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Priority
            <select name="priority" defaultValue={2} className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              <option value={1}>★ High</option>
              <option value={2}>Normal</option>
              <option value={3}>Low</option>
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600 sm:col-span-2">
            Next step
            <input name="next_step" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              Add to pipeline
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
