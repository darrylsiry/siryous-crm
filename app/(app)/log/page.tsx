import Link from "next/link";
import { getDb } from "@/lib/db";
import { analyzeLog, discardLog } from "@/lib/logmeeting";
import LogInput from "@/components/LogInput";
import { stateTone, stateWord } from "@/lib/stateWords";
import { ago } from "@/lib/dates.mjs";

export const metadata = { title: "Log" };

/** A draft's source, in words. */
function sourceWord(source: string): string {
  return ({ paste: "Notes", zoom: "Zoom", meet: "Google Meet", gmail: "Gmail", email: "Email" } as Record<string, string>)[source] ?? source;
}
import { getAiStatus } from "@/lib/aiStatus";
import PendingButton from "@/components/PendingButton";
import AiStatusBanner from "@/components/AiStatusBanner";
import AiWhereLine from "@/components/AiWhereLine";
import { first, type Param } from "@/lib/params";
import { profilePath } from "@/lib/slug";

export const dynamic = "force-dynamic";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: Param; company?: Param }>;
}) {
  const ai = await getAiStatus();
  const hasClaude = ai.claude.ok;
  const db = getDb();
  const sp = await searchParams;
  const person = first(sp.person);
  const company = first(sp.company);
  // Opened from a profile's "Draft with AI" link: the entries default to that contact.
  const hintPerson = person
    ? (db.prepare(`SELECT id, slug, name FROM people WHERE slug=?`).get(person) as { id: number; slug: string; name: string } | undefined)
    : undefined;
  const hintCompany =
    !hintPerson && company
      ? (db.prepare(`SELECT id, slug, name FROM companies WHERE slug=?`).get(company) as { id: number; slug: string; name: string } | undefined)
      : undefined;
  const hint = hintPerson
    ? { kind: "person" as const, id: hintPerson.id, name: hintPerson.name, href: profilePath("people", hintPerson.slug) }
    : hintCompany
      ? { kind: "company" as const, id: hintCompany.id, name: hintCompany.name, href: profilePath("companies", hintCompany.slug) }
      : null;
  // Everything still waiting, however old; failures listed apart so they can't push a ready draft off the page.
  const drafts = db
    .prepare(
      `SELECT id, status, source, substr(COALESCE(fetched_text, raw_text), 1, 80) AS preview, created_at
       FROM log_drafts WHERE status IN ('analyzing','ready') ORDER BY status = 'ready' DESC, id DESC`
    )
    .all() as { id: number; status: string; source: string; preview: string; created_at: string }[];
  const failed = db
    .prepare(`SELECT id, status, source, substr(raw_text, 1, 80) AS preview, created_at FROM log_drafts WHERE status='error' ORDER BY id DESC LIMIT 20`)
    .all() as { id: number; status: string; source: string; preview: string; created_at: string }[];
  const failedCount = (db.prepare(`SELECT COUNT(*) n FROM log_drafts WHERE status='error'`).get() as { n: number }).n;

  return (
    <div className="max-w-3xl space-y-6">
      <AiStatusBanner />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">✎ Log</h1>
        <p className="mt-1 text-sm text-stone-600">
          Turn a meeting, call, or email thread into entries on the right contacts — with next steps updated and stale
          to-dos closed. You review everything before it&apos;s saved. For a quick call, <b className="font-medium">Log touch</b> on
          Keep Warm or a profile is faster.
        </p>
      </header>

      <form action={analyzeLog} className="space-y-4">
        {hint ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-sm">
            <input type="hidden" name={hint.kind === "person" ? "hint_person_id" : "hint_company_id"} value={hint.id} />
            <span className="text-stone-600">Logging for</span>
            <Link href={hint.href} className="font-semibold text-indigo-800 hover:underline">
              {hint.name}
            </Link>
            <span className="text-xs text-stone-500">
              — the entries will go on {hint.kind === "person" ? "them" : "this company"} even if the text doesn&apos;t name {hint.kind === "person" ? "them" : "anyone"}; anyone else in your contacts who took part is picked up too.
            </span>
            <Link href="/log" className="ml-auto text-xs text-stone-500 hover:text-indigo-600" title="Log without a preset contact">
              ✕ clear
            </Link>
          </div>
        ) : null}
        <LogInput hasClaude={hasClaude} aiUsable={ai.aiUsable} />
        <PendingButton
          label="✎ Analyze & draft log entries"
          pendingLabel="Working…"
          pendingNote="Starting — you'll see the AI's progress live on the next page…"
          disabled={!ai.aiUsable}
        />
      </form>

      {drafts.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">To review · {drafts.length}</h2>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {drafts.map((d) => {
              const word = stateWord(d.status);
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className={stateTone(word)}>{word}</span>
                    <span className="text-stone-500"> · </span>
                    <span className="text-stone-700">{sourceWord(d.source)}: {d.preview.replace(/\s+/g, " ")}…</span>
                    <span className="text-stone-500"> · {ago(d.created_at)}</span>
                  </span>
                  <Link href={`/log/${d.id}`} className="shrink-0 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                    {d.status === "ready" ? "Review" : "Watch"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Failed · {failedCount}</h2>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {failed.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className={stateTone("Failed")}>Failed</span>
                  <span className="text-stone-500"> · </span>
                  <span className="text-stone-700">{sourceWord(d.source)}: {d.preview.replace(/\s+/g, " ")}…</span>
                  <span className="text-stone-500"> · {ago(d.created_at)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Link href={`/log/${d.id}`} className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                    See why
                  </Link>
                  <form action={discardLog.bind(null, d.id)}>
                    <button className="rounded-md px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100">Dismiss</button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AiWhereLine />
      <p className="text-xs text-stone-500">
        Zoom, Google Meet and Gmail are read-only, using the Gmail/Zoom/Drive access you&apos;ve
        already given Claude. Meet transcripts must be visible to the Google account Claude uses.
        Nothing is written to the CRM until you confirm on the review screen.
      </p>
    </div>
  );
}
