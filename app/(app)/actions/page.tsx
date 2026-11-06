import Link from "next/link";
import { BUCKETS } from "@/lib/db";
import { companyOptions, doneActionCount, doneActionItems, openActionItems, peopleOptions } from "@/lib/queries";
import { ActionRow } from "@/components/ActionList";
import AddActionForm from "@/components/AddActionForm";
import { PeopleOptions } from "@/components/PeoplePicker";
import { first, type Param } from "@/lib/params";

export const dynamic = "force-dynamic";

export const metadata = { title: "Actions" };

/** Recently completed lists this many days unless "Show older" is on. */
const RECENT_DAYS = 30;

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ older?: Param }> }) {
  const older = first((await searchParams).older) === "1";
  const open = openActionItems();
  const done = doneActionItems(older ? {} : { days: RECENT_DAYS });
  const doneTotal = doneActionCount();

  const buckets = Object.entries(BUCKETS).sort((a, b) => a[1].order - b[1].order);

  return (
    <PeopleOptions options={peopleOptions()}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Actions</h1>
          <p className="mt-1 text-sm text-stone-500">
            Your to-dos: {open.length} open · {doneTotal} done
          </p>
        </header>

        <details id="add" className="rounded-xl border border-dashed border-stone-300 bg-white p-4" open={!open.length}>
          <summary className="cursor-pointer text-sm font-medium text-indigo-600 select-none">＋ Add a to-do</summary>
          <div className="mt-3">
            <AddActionForm
              buckets={buckets.map(([key, b]) => ({ key, label: b.label, icon: b.icon }))}
              companies={companyOptions()}
            />
          </div>
        </details>

        {buckets.map(([key, b]) => {
          const items = open.filter((a) => a.bucket === key);
          if (!items.length) return null;
          return (
            <section key={key} className="rounded-xl border border-stone-200 bg-white">
              <header className="border-b border-stone-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-stone-700">
                  {b.icon} {b.label}
                  <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{items.length}</span>
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
        {!open.length ? <p className="text-sm italic text-stone-500">Nothing open. Add a to-do above, or log a meeting and tick its follow-ups.</p> : null}

        <details className="rounded-xl border border-stone-200 bg-white" open={older || undefined}>
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-stone-600 select-none">
            ✅ Recently completed ({done.length}
            {older ? "" : `, last ${RECENT_DAYS} days`})
          </summary>
          <ul className="divide-y divide-stone-100 px-5 py-1">
            {done.map((a) => (
              <ActionRow key={a.id} item={a} done />
            ))}
            {!done.length ? <li className="py-2 text-sm italic text-stone-500">Nothing ticked in the last {RECENT_DAYS} days.</li> : null}
          </ul>
          {!older && doneTotal > done.length ? (
            <p className="border-t border-stone-100 px-5 py-2 text-xs">
              <Link href="/actions?older=1" className="font-medium text-indigo-600 hover:underline">
                Show older ({doneTotal - done.length} more)
              </Link>
            </p>
          ) : null}
        </details>
      </div>
    </PeopleOptions>
  );
}
