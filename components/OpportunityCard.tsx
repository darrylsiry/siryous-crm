import Link from "next/link";
import type { OpportunityJoined } from "@/lib/types";
import { KINDS, STAGES } from "@/lib/db";
import { setOpportunityStage, updateOpportunity } from "@/lib/actions";
import ClosingDetails from "@/components/ClosingDetails";
import PendingButton from "@/components/PendingButton";
import SubmitButton from "@/components/SubmitButton";

export default function OpportunityCard({ o }: { o: OpportunityJoined }) {
  const kind = KINDS[o.kind] ?? KINDS.engagement;
  return (
    <div
      id={`opp-${o.id}`}
      className="scroll-mt-4 rounded-lg border border-stone-200 bg-white p-3 shadow-xs target:ring-2 target:ring-indigo-400"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[0.82rem] font-semibold leading-snug text-stone-900">
          {o.name}
        </div>
        {o.priority === 1 ? (
          <span title="High priority" className="shrink-0 text-[0.65rem] font-bold text-red-600">
            ★
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.68rem]">
        <span className={`rounded-full px-1.5 py-px font-medium ring-1 ring-inset ${kind.badge}`}>
          {kind.label}
        </span>
        {o.person_slug ? (
          <Link href={`/people/${o.person_slug}`} className="text-stone-500 hover:text-indigo-600">
            {o.person_name}
          </Link>
        ) : null}
        {o.company_slug ? (
          <Link href={`/companies/${o.company_slug}`} className="text-stone-400 hover:text-indigo-600">
            · {o.company_name}
          </Link>
        ) : null}
      </div>
      {o.value_note ? (
        <p className="mt-1.5 text-[0.72rem] leading-snug text-stone-500">{o.value_note}</p>
      ) : null}
      {o.next_step ? (
        <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[0.72rem] leading-snug text-amber-900">
          <span className="font-semibold">Next:</span> {o.next_step}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <form action={setOpportunityStage} className="flex items-center gap-1">
          <input type="hidden" name="id" value={o.id} />
          <select
            name="stage"
            defaultValue={o.stage}
            aria-label="Stage"
            className="rounded border border-stone-200 bg-stone-50 px-1 py-0.5 text-[0.68rem] text-stone-600"
          >
            {Object.entries(STAGES).map(([key, s]) => (
              <option key={key} value={key}>
                {s.icon} {s.label}
              </option>
            ))}
          </select>
          <SubmitButton
            pendingChildren="…"
            className="rounded bg-stone-100 px-1.5 py-0.5 text-[0.68rem] font-medium text-stone-600 hover:bg-indigo-100 hover:text-indigo-700"
          >
            Move
          </SubmitButton>
        </form>
        {/* Expands inline (full card width) rather than as an absolutely
            positioned popover, which the board's overflow-x-auto clipped. */}
        <ClosingDetails className="group open:basis-full">
          <summary className="cursor-pointer text-[0.68rem] text-stone-400 hover:text-indigo-600 select-none list-none">
            <span className="group-open:hidden">✎ edit</span>
            <span className="hidden group-open:inline">✕ close</span>
          </summary>
          <form
            action={updateOpportunity}
            className="mt-1.5 space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-2.5"
          >
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="updated_at" value={o.updated_at ?? ""} />
            <input
              name="name"
              defaultValue={o.name}
              aria-label="Name"
              className="w-full rounded border border-stone-300 px-2 py-1 text-xs"
            />
            <div className="flex gap-2">
              <select name="kind" defaultValue={o.kind} aria-label="Kind" className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-1 text-xs">
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <select name="priority" defaultValue={o.priority} aria-label="Priority" className="rounded border border-stone-300 px-1 py-1 text-xs">
                <option value={1}>★ High</option>
                <option value={2}>Normal</option>
                <option value={3}>Low</option>
              </select>
            </div>
            <textarea
              name="value_note"
              defaultValue={o.value_note ?? ""}
              placeholder="Value / economics"
              aria-label="Value / economics"
              rows={2}
              className="w-full rounded border border-stone-300 px-2 py-1 text-xs"
            />
            <textarea
              name="next_step"
              defaultValue={o.next_step ?? ""}
              placeholder="Next step"
              aria-label="Next step"
              rows={2}
              className="w-full rounded border border-stone-300 px-2 py-1 text-xs"
            />
            <textarea
              name="notes"
              defaultValue={o.notes ?? ""}
              placeholder="Notes"
              aria-label="Notes"
              rows={2}
              className="w-full rounded border border-stone-300 px-2 py-1 text-xs"
            />
            <PendingButton
              label="Save"
              pendingLabel="Saving…"
              className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            />
          </form>
        </ClosingDetails>
      </div>
    </div>
  );
}
