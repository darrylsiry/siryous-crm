import Link from "next/link";
import { getDb } from "@/lib/db";
import { allPeople } from "@/lib/queries";
import { generatePrep } from "@/lib/prep";
import PendingButton from "@/components/PendingButton";
import AiStatusBanner from "@/components/AiStatusBanner";
import { getAiStatus } from "@/lib/aiStatus";

export const dynamic = "force-dynamic";

export default async function PrepPage() {
  const ai = await getAiStatus();
  const people = allPeople();
  const briefs = getDb()
    .prepare(
      `SELECT b.id, b.title, b.status, b.created_at, b.focus
       FROM briefs b ORDER BY b.id DESC LIMIT 15`
    )
    .all() as { id: number; title: string; status: string; created_at: string; focus: string | null }[];

  return (
    <div className="max-w-3xl space-y-6">
      <AiStatusBanner />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">🗓 Meeting prep</h1>
        <p className="mt-1 text-sm text-stone-500">
          A 3-minute brief before any meeting: where things stand, what's changed
          since last touch (checked against your Gmail, calendar, and the web),
          objectives, talking points, questions, and watch-outs.
        </p>
      </header>

      <form action={generatePrep} className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <label className="block text-xs font-medium text-stone-600">
          Who's the meeting with?
          <select name="person_id" className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
            <option value="">✨ Auto — check my calendar for the next meeting with someone in the CRM</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.company_name ? ` — ${p.company_name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Focus / context for this meeting (optional)
          <input
            name="focus"
            placeholder="e.g. nail down retainer scope and comp structure"
            className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
          />
        </label>
        <PendingButton
          label="🗓 Generate prep brief"
          pendingLabel="Preparing…"
          pendingNote="Starting — you'll see the AI's progress live on the next page…"
          disabled={!ai.aiUsable}
        />
      </form>

      {briefs.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Briefs</h2>
          <ul className="space-y-1.5">
            {briefs.map((b) => (
              <li key={b.id} className="text-sm">
                <Link href={`/prep/${b.id}`} className="font-medium text-indigo-700 hover:underline">
                  {b.title}
                </Link>{" "}
                {b.status !== "ready" ? (
                  <span className={b.status === "error" ? "text-red-600" : b.status === "analyzing" ? "animate-pulse text-indigo-600" : "text-stone-400"}>[{b.status}]</span>
                ) : null}
                <span className="text-xs text-stone-400"> · {b.created_at.slice(0, 10)}{b.focus ? ` · ${b.focus}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-stone-400">
        Calendar and Gmail are read-only, using the access you&apos;ve already given Claude. Briefs are kept on this Mac; delete them from the brief page.
      </p>
    </div>
  );
}
