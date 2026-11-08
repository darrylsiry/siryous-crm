import FloatingDetails from "@/components/FloatingDetails";
import PendingButton from "@/components/PendingButton";
import { PersonSelect } from "@/components/PeoplePicker";
import { updateActionItem } from "@/lib/actions";
import { BUCKETS, PICKABLE_BUCKETS } from "@/lib/db";
import { todayLocal } from "@/lib/dates.mjs";
import type { ActionItemJoined } from "@/lib/types";
import KeepTypedForm from "@/components/KeepTypedForm";

function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

/**
 * Edit a to-do in place: its title, person, group and due date, with
 * one-click re-dating (Tomorrow / Next Mon / +1 week). `children` is the
 * clickable summary (the Dashboard uses the "3d late" label). The person
 * picker reads the page's <PeopleOptions>.
 */
export default function ActionEdit({ item, children }: { item: ActionItemJoined; children: React.ReactNode }) {
  const today = todayLocal();
  const dow = new Date(`${today}T12:00:00`).getDay();
  const quick: [string, string][] = [
    ["Tomorrow", plusDays(today, 1)],
    ["Next Mon", plusDays(today, ((8 - dow) % 7) || 7)],
    ["+1 week", plusDays(today, 7)],
  ];
  const chip =
    "rounded-full border border-stone-300 bg-white px-2 py-0.5 text-xs font-medium text-stone-700 hover:border-indigo-400 hover:text-indigo-700";
  return (
    <FloatingDetails
      className="inline-block"
      summary={children}
      summaryClassName="cursor-pointer list-none select-none hover:text-indigo-700"
      title="Edit or re-date"
    >
      <KeepTypedForm
        action={updateActionItem}
        className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3 text-left text-xs font-normal text-stone-700 shadow-lg"
      >
        <input type="hidden" name="id" value={item.id} />
        <label className="block">
          <span className="text-stone-500">To-do</span>
          <input
            name="title"
            defaultValue={item.title}
            required
            className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm focus:border-indigo-400"
          />
        </label>
        <label className="block">
          <span className="text-stone-500">Person</span>
          <PersonSelect defaultValue={item.person_id} className="mt-0.5 rounded border border-stone-300 bg-white px-2 py-1 text-sm" />
        </label>
        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-stone-500">Due</span>
            <input
              type="date"
              name="due_date"
              defaultValue={item.due_date ?? ""}
              className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 focus:border-indigo-400"
            />
          </label>
          <label className="block flex-1">
            <span className="text-stone-500">Group</span>
            <select
              name="bucket"
              defaultValue={Object.hasOwn(PICKABLE_BUCKETS, item.bucket_raw ?? item.bucket) ? (item.bucket_raw ?? item.bucket) : "this_week"}
              className="mt-0.5 w-full rounded border border-stone-300 px-1 py-1 focus:border-indigo-400"
            >
              {Object.entries(PICKABLE_BUCKETS).map(([k, b]) => (
                <option key={k} value={k}>
                  {b.icon} {b.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-stone-500">Clear the date to make it undated.</p>
        <PendingButton
          label="Save"
          pendingLabel="Saving…"
          className="rounded bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-700"
        />
        {/* Shown first, but after Save in the form so Enter in a field saves rather than re-dates. */}
        <div className="order-first flex flex-wrap items-center gap-1.5">
          <span className="text-stone-500">Re-date:</span>
          {quick.map(([label, iso]) => (
            <button key={label} name="quick_due" value={iso} className={chip}>
              {label}
            </button>
          ))}
        </div>
      </KeepTypedForm>
    </FloatingDetails>
  );
}
