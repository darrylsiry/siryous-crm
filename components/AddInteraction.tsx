import { addInteraction } from "@/lib/actions";
import ClosingDetails from "@/components/ClosingDetails";
import PendingButton from "@/components/PendingButton";

export default function AddInteraction({
  personId,
  companyId,
}: {
  personId?: number;
  companyId?: number;
}) {
  const today = new Date().toLocaleDateString("sv-SE"); // local date, not UTC
  return (
    <ClosingDetails className="group">
      <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-800 select-none list-none">
        ＋ Log interaction
      </summary>
      <form
        action={addInteraction}
        className="mt-3 rounded-xl border border-stone-200 bg-white p-4 space-y-3"
      >
        {personId ? <input type="hidden" name="person_id" value={personId} /> : null}
        {companyId ? <input type="hidden" name="company_id" value={companyId} /> : null}
        <div className="flex flex-wrap gap-3">
          <label className="block text-xs font-medium text-stone-600">
            Date
            <input
              type="date"
              name="date"
              defaultValue={today}
              required
              className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block flex-1 min-w-40 text-xs font-medium text-stone-600">
            Channel
            <input
              name="channel"
              placeholder="Call · Email · Meeting · LinkedIn…"
              className="mt-1 block w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <label className="block text-xs font-medium text-stone-600">
          Summary — substance, decisions, surprises, next step
          <textarea
            name="summary"
            rows={4}
            required
            className="mt-1 block w-full rounded-lg border border-stone-300 p-2.5 text-sm"
            placeholder="What was discussed, outcome, agreed next step. Markdown supported."
          />
        </label>
        <PendingButton
          label="Log it"
          pendingLabel="Logging…"
          className={"rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"}
        />
        <p className="text-[0.7rem] text-stone-400">
          Logging also bumps “last touch” if this is the newest interaction.
        </p>
      </form>
    </ClosingDetails>
  );
}
