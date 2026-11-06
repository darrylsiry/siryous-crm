import ClosingDetails from "@/components/ClosingDetails";
import PendingButton from "@/components/PendingButton";
import { updateActionItem } from "@/lib/actions";
import { BUCKETS } from "@/lib/db";
import type { ActionItemJoined } from "@/lib/types";

/**
 * Edit a to-do in place: its title, bucket and due date. `children` is the
 * clickable summary (the Dashboard uses the "3d late" label, so re-dating is
 * one click on it).
 */
export default function ActionEdit({ item, children }: { item: ActionItemJoined; children: React.ReactNode }) {
  return (
    <ClosingDetails className="relative inline-block">
      <summary className="cursor-pointer list-none select-none hover:text-indigo-700" title="Edit or re-date">
        {children}
      </summary>
      <form
        action={updateActionItem}
        className="absolute right-0 z-20 mt-1 w-72 space-y-2 rounded-lg border border-stone-200 bg-white p-3 text-left text-xs font-normal text-stone-700 shadow-lg"
      >
        <input type="hidden" name="id" value={item.id} />
        <label className="block">
          <span className="text-stone-500">To-do</span>
          <input
            name="title"
            defaultValue={item.title}
            required
            className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-stone-500">Due</span>
            <input
              type="date"
              name="due_date"
              defaultValue={item.due_date ?? ""}
              className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 focus:border-indigo-400 focus:outline-none"
            />
          </label>
          <label className="block flex-1">
            <span className="text-stone-500">Bucket</span>
            <select
              name="bucket"
              defaultValue={item.bucket_raw ?? item.bucket}
              className="mt-0.5 w-full rounded border border-stone-300 px-1 py-1 focus:border-indigo-400 focus:outline-none"
            >
              {Object.entries(BUCKETS).map(([k, b]) => (
                <option key={k} value={k}>
                  {b.icon} {b.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-stone-400">Clear the date to make it undated.</p>
        <PendingButton
          label="Save"
          pendingLabel="Saving…"
          className="rounded bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-700"
        />
      </form>
    </ClosingDetails>
  );
}
