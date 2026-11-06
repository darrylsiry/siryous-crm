import Link from "next/link";
import type { OpportunityJoined } from "@/lib/types";
import { KINDS, STAGES } from "@/lib/db";
import { deleteOpportunity, setOpportunityStage, updateOpportunity } from "@/lib/actions";
import { dealQuietLabel } from "@/lib/queries";
import ClosingDetails from "@/components/ClosingDetails";
import ConfirmButton from "@/components/ConfirmButton";
import PendingButton from "@/components/PendingButton";
import StageSelect from "@/components/StageSelect";

/** A deal on the board. `quiet` is the days since the last contact with its person or company (null = none logged). */
export default function OpportunityCard({ o, quiet }: { o: OpportunityJoined; quiet?: number | null }) {
  const kind = KINDS[o.kind] ?? KINDS.engagement;
  const profile = o.person_slug ? `/people/${o.person_slug}` : o.company_slug ? `/companies/${o.company_slug}` : null;
  const q = quiet === undefined || !STAGES[o.stage]?.open ? null : dealQuietLabel(quiet);
  return (
    <div
      id={`opp-${o.id}`}
      className={`scroll-mt-4 rounded-lg border p-3 shadow-xs target:ring-2 target:ring-indigo-400 ${kind.card ?? "border-stone-200 bg-white"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[0.85rem] font-semibold leading-snug text-stone-900">
          {profile ? (
            <Link href={profile} className="hover:text-indigo-700">
              {o.name}
            </Link>
          ) : (
            o.name
          )}
        </div>
        {o.priority === 1 ? (
          <span title="High priority" className="shrink-0 text-xs font-bold text-red-600">
            ★
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded-full px-1.5 py-px font-medium ring-1 ring-inset ${kind.badge}`}>{kind.label}</span>
        {o.person_slug ? (
          <Link href={`/people/${o.person_slug}`} className="text-stone-600 hover:text-indigo-600">
            {o.person_name}
          </Link>
        ) : null}
        {o.company_slug ? (
          <Link href={`/companies/${o.company_slug}`} className="text-stone-500 hover:text-indigo-600">
            · {o.company_name}
          </Link>
        ) : null}
      </div>
      {q ? <p className={`mt-1 text-xs tabular-nums ${q.tone}`}>{q.text}</p> : null}
      {o.value_note ? <p className="mt-1.5 text-xs leading-snug text-stone-600">{o.value_note}</p> : null}
      {o.next_step ? (
        <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs leading-snug text-amber-900">
          <span className="font-semibold">Next step:</span> {o.next_step}
        </p>
      ) : STAGES[o.stage]?.open ? (
        <p className="mt-1.5 text-xs font-medium text-red-700">No next step — add one with ✎ Edit</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <form action={setOpportunityStage} className="flex items-center gap-1">
          <input type="hidden" name="id" value={o.id} />
          <StageSelect stage={o.stage} stages={Object.entries(STAGES).map(([key, s]) => ({ key, label: s.label, icon: s.icon }))} />
        </form>
        {/* Expands inline (full card width) rather than as an absolutely
            positioned popover, which the board's overflow-x-auto clipped. */}
        <ClosingDetails className="group open:basis-full">
          <summary className="cursor-pointer select-none list-none text-xs font-medium text-stone-600 hover:text-indigo-600">
            <span className="group-open:hidden">✎ Edit</span>
            <span className="hidden group-open:inline">✕ Close</span>
          </summary>
          <form action={updateOpportunity} className="mt-1.5 space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-2.5">
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="updated_at" value={o.updated_at ?? ""} />
            <input name="name" defaultValue={o.name} aria-label="Name" className="w-full rounded border border-stone-300 px-2 py-1 text-xs" />
            <div className="flex gap-2">
              <select name="kind" defaultValue={o.kind} aria-label="Kind" className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-1 text-xs">
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
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
          <form action={deleteOpportunity.bind(null, o.id)} className="mt-2 text-right">
            <ConfirmButton
              label="Delete deal…"
              confirm={`Delete the deal "${o.name}"? Its person, company and their history stay. This can't be undone.`}
              className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            />
          </form>
        </ClosingDetails>
      </div>
    </div>
  );
}
