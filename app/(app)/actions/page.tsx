import { BUCKETS } from "@/lib/db";
import { doneActionItems, openActionItems, allPeople, allCompanies } from "@/lib/queries";
import { ActionRow } from "@/components/ActionList";
import { addActionItem } from "@/lib/actions";
import PendingButton from "@/components/PendingButton";
import SearchSelect from "@/components/SearchSelect";

export const dynamic = "force-dynamic";

export default function ActionsPage() {
  const open = openActionItems();
  const done = doneActionItems();
  const people = allPeople();
  const companies = allCompanies();

  const buckets = Object.entries(BUCKETS).sort((a, b) => a[1].order - b[1].order);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Outstanding Items</h1>
        <p className="mt-1 text-sm text-stone-500">
          {open.length} open · {done.length} completed
        </p>
      </header>

      <details className="rounded-xl border border-dashed border-stone-300 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-indigo-600 select-none">
          ＋ Add action item
        </summary>
        <form action={addActionItem} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-stone-600 sm:col-span-2">
            What needs doing *
            <input name="title" required className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Bucket
            <select name="bucket" defaultValue="this_week" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              {buckets.map(([key, b]) => (
                <option key={key} value={key}>{b.icon} {b.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Due date
            <input name="due_date" type="date" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Due (freeform, optional)
            <input name="due_label" placeholder="ASAP, ~late summer, Fri 7/25…" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Person
            <SearchSelect name="person_id" options={people.map((p) => ({ value: String(p.id), label: p.name, hint: p.company_name }))} className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Company
            <SearchSelect name="company_id" options={companies.map((c) => ({ value: String(c.id), label: c.name }))} className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <PendingButton label="Add" pendingLabel="Adding…" className={"rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"} />
          </div>
        </form>
      </details>

      {buckets.map(([key, b]) => {
        const items = open.filter((a) => a.bucket === key);
        if (!items.length) return null;
        return (
          <section key={key} className="rounded-xl border border-stone-200 bg-white">
            <header className="border-b border-stone-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-stone-700">
                {b.icon} {b.label}
                <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                  {items.length}
                </span>
              </h2>
            </header>
            <ul className="divide-y divide-stone-100 px-5 py-1">
              {items.map((a) => (
                <ActionRow key={a.id} item={a} />
              ))}
            </ul>
          </section>
        );
      })}

      <details className="rounded-xl border border-stone-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-stone-500 select-none">
          ✅ Recently completed ({done.length})
        </summary>
        <ul className="divide-y divide-stone-100 px-5 py-1">
          {done.map((a) => (
            <ActionRow key={a.id} item={a} done />
          ))}
        </ul>
      </details>
    </div>
  );
}
