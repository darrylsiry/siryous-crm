import Link from "next/link";
import { followUps } from "@/lib/queries";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

function DueChip({ daysOver, daysSince, cadence, note }: { daysOver: number | null; daysSince: number | null; cadence: number | null; note?: string | null }) {
  if (cadence == null) {
    return <span className="text-xs text-stone-400">no cadence</span>;
  }
  if (daysOver != null && daysOver >= 9999) {
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20">
        {note ? "no dated touch" : "never touched"}
      </span>
    );
  }
  if (daysOver != null && daysOver > 0) {
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20">
        {daysOver}d overdue
      </span>
    );
  }
  const daysLeft = daysOver != null ? -daysOver : null;
  if (daysLeft != null && daysLeft <= 7) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
        due in {daysLeft}d
      </span>
    );
  }
  return (
    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
      warm ({daysSince ?? "?"}d ago)
    </span>
  );
}

export default function FollowUpsPage() {
  const rows = followUps();
  const overdue = rows.filter((r) => r.days_over != null && r.days_over > 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Keep Warm</h1>
        <p className="mt-1 text-sm text-stone-500">
          Who should you talk to? Everyone scored against their follow-up cadence —{" "}
          <span className="font-medium text-red-700">{overdue.length} due for a touch</span>.
          Set cadence per person in their snapshot.
        </p>
      </header>

      {/* Mobile card list */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`rounded-xl border border-stone-200 bg-white p-4 ${r.days_over != null && r.days_over > 0 ? "border-red-200 bg-red-50/30" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/people/${r.slug}`} className="font-semibold text-stone-900 hover:text-indigo-700">
                  {r.name}
                </Link>
                {r.company_name ? (
                  <div className="truncate text-xs text-stone-400">{r.company_name}</div>
                ) : null}
              </div>
              <DueChip daysOver={r.days_over} daysSince={r.days_since} cadence={r.cadence_days} note={r.last_touch_note} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
              <StatusBadge statusKey={r.status_key} compact />
              <span className="tabular-nums">
                {r.last_touch ?? (r.last_touch_note ? `undated — ${r.last_touch_note}` : "never")}
                {r.days_since != null ? ` (${r.days_since}d)` : ""}
              </span>
              <span>{r.cadence_days ? `every ${r.cadence_days}d` : "no cadence"}</span>
            </div>
            {r.next_action ? (
              <div className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600 line-clamp-2">
                <span className="font-medium text-stone-400">Next: </span>
                {r.next_action}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="px-4 py-3 font-medium">Last touch</th>
              <th className="px-4 py-3 font-medium">Cadence</th>
              <th className="px-4 py-3 font-medium">Next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.id} className={`hover:bg-indigo-50/40 ${r.days_over != null && r.days_over > 0 ? "bg-red-50/30" : ""}`}>
                <td className="px-4 py-3">
                  <Link href={`/people/${r.slug}`} className="font-semibold text-stone-900 hover:text-indigo-700">
                    {r.name}
                  </Link>
                  <div className="text-xs text-stone-400">
                    {r.company_name ?? ""}
                    {r.tags
                      ? r.tags.split(",").map((t, i) => (
                          <span key={`${t}-${i}`} className="ml-1.5 rounded bg-stone-100 px-1 py-px text-[0.65rem] text-stone-500">
                            {t.trim()}
                          </span>
                        ))
                      : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge statusKey={r.status_key} compact />
                </td>
                <td className="px-4 py-3">
                  <DueChip daysOver={r.days_over} daysSince={r.days_since} cadence={r.cadence_days} note={r.last_touch_note} />
                </td>
                <td className="px-4 py-3 tabular-nums text-xs text-stone-500">
                  {r.last_touch ?? (r.last_touch_note ? `undated — ${r.last_touch_note}` : "—")}
                  {r.days_since != null ? (
                    <span className="text-stone-400"> ({r.days_since}d)</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs text-stone-500">
                  {r.cadence_days ? `every ${r.cadence_days}d` : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-stone-600 max-w-72">
                  <span className="line-clamp-2">{r.next_action ?? "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-400">
        Cadence defaults were set by status (Active 30d · Exploring 45d · New 21d · Dormant 180d) —
        tune per person from their profile. Logging an interaction resets the clock.
      </p>
    </div>
  );
}
