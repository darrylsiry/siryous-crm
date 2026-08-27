import { STATUS } from "@/lib/db";
import ClosingDetails from "@/components/ClosingDetails";
import { updateStatus } from "@/lib/actions";
import PendingButton from "@/components/PendingButton";

export default function StatusEditor({
  entity,
  id,
  statusKey,
  statusNote,
  nextAction,
  updatedAt,
}: {
  entity: "person" | "company";
  id: number;
  statusKey: string;
  statusNote: string | null;
  nextAction: string | null;
  /** Row's updated_at at render time — the action refuses to overwrite a newer row. */
  updatedAt: string | null;
}) {
  return (
    <ClosingDetails className="group">
      <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-800 select-none list-none">
        ✎ Update status / next action
      </summary>
      <form
        action={updateStatus}
        className="mt-3 rounded-xl border border-stone-200 bg-white p-4 space-y-3"
      >
        <input type="hidden" name="entity" value={entity} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="updated_at" value={updatedAt ?? ""} />
        <div className="flex flex-wrap gap-3">
          <label className="block text-xs font-medium text-stone-600">
            Status
            <select
              name="status_key"
              defaultValue={statusKey}
              className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            >
              {Object.entries(STATUS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.emoji} {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1 min-w-40 text-xs font-medium text-stone-600">
            Status note (qualifier)
            <input
              name="status_note"
              defaultValue={statusNote ?? ""}
              placeholder="e.g. retainer offer, partnership forming"
              className="mt-1 block w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <label className="block text-xs font-medium text-stone-600">
          Next action
          <input
            name="next_action"
            defaultValue={nextAction ?? ""}
            className="mt-1 block w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
          />
        </label>
        <PendingButton
          label="Save"
          pendingLabel="Saving…"
          className={"rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"}
        />
      </form>
    </ClosingDetails>
  );
}
