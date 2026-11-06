import Link from "next/link";
import { getDb } from "@/lib/db";
import { allPeople } from "@/lib/queries";
import { generatePrep } from "@/lib/prep";
import PendingButton from "@/components/PendingButton";
import AiStatusBanner from "@/components/AiStatusBanner";
import { getAiStatus } from "@/lib/aiStatus";
import SearchSelect from "@/components/SearchSelect";
import AiWhereLine from "@/components/AiWhereLine";
import { localStamp } from "@/lib/dates.mjs";
import { stateTone, stateWord } from "@/lib/stateWords";
import { slugParam } from "@/lib/slug";
import { first, type Param } from "@/lib/params";

export const dynamic = "force-dynamic";

export const metadata = { title: "Prep" };

export default async function PrepPage({ searchParams }: { searchParams: Promise<{ person?: Param; pick?: Param }> }) {
  const ai = await getAiStatus();
  const hasClaude = ai.claude.ok;
  const people = allPeople();
  const sp = await searchParams;
  const pick = !!first(sp.pick);
  const wanted = first(sp.person);
  const preset = wanted ? people.find((p) => p.slug === slugParam(wanted)) : undefined;
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
        <h1 className="text-2xl font-bold tracking-tight">🗓 Prep</h1>
        <p className="mt-1 text-sm text-stone-600">
          A 3-minute brief before any meeting: where things stand, what&apos;s changed since the last touch, objectives,
          talking points, questions and watch-outs.{" "}
          {hasClaude
            ? "What's changed is checked against your Gmail, calendar and the web; the brief says which of those it could check."
            : "Written from what's in your CRM. Add Claude (see “If you use Claude” in the README) to also check your calendar, email and the web."}
        </p>
      </header>

      {pick ? (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Choose who the meeting is with: finding the next meeting on your calendar needs Claude, which isn&apos;t set up on this Mac.
        </p>
      ) : null}
      <form action={generatePrep} className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <label className="block text-xs font-medium text-stone-600">
          Who's the meeting with?
          <SearchSelect
            name="person_id"
            options={people.map((p) => ({ value: String(p.id), label: p.name, hint: p.company_name }))}
            defaultValue={preset?.id}
            allowEmpty={hasClaude}
            emptyLabel={hasClaude ? "✨ Auto — check my calendar for the next meeting with someone in the CRM" : "Choose a person"}
            className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
          />
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
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Briefs</h2>
          <ul className="space-y-1.5">
            {briefs.map((b) => {
              const word = b.status === "ready" ? null : stateWord(b.status);
              return (
                <li key={b.id} className="text-sm">
                  <Link href={`/prep/${b.id}`} className="font-medium text-indigo-700 hover:underline">
                    {b.title}
                  </Link>
                  {word ? <span className={stateTone(word)}> · {word}</span> : null}
                  <span className="text-xs text-stone-500">
                    {" "}
                    · {localStamp(b.created_at)}
                    {b.focus ? ` · ${b.focus}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <AiWhereLine extra={hasClaude ? " except the calendar, Gmail and web checks, which run through Claude" : ""} />
      <p className="text-xs text-stone-500">
        Calendar and Gmail are read-only, using the access you&apos;ve already given Claude. Briefs are kept on this Mac; delete them from the brief page.
      </p>
    </div>
  );
}
