import Link from "next/link";
import { getDb } from "@/lib/db";
import { analyzeLog } from "@/lib/logmeeting";
import { getAiStatus } from "@/lib/aiStatus";
import PendingButton from "@/components/PendingButton";
import AiStatusBanner from "@/components/AiStatusBanner";

export const dynamic = "force-dynamic";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; company?: string }>;
}) {
  const ai = await getAiStatus();
  const hasClaude = ai.claude.ok;
  const db = getDb();
  const sp = await searchParams;
  // Opened from a profile's "Draft with AI" link: the entries default to that contact.
  const hintPerson = sp.person
    ? (db.prepare(`SELECT id, slug, name FROM people WHERE slug=?`).get(sp.person) as { id: number; slug: string; name: string } | undefined)
    : undefined;
  const hintCompany =
    !hintPerson && sp.company
      ? (db.prepare(`SELECT id, slug, name FROM companies WHERE slug=?`).get(sp.company) as { id: number; slug: string; name: string } | undefined)
      : undefined;
  const hint = hintPerson
    ? { kind: "person" as const, id: hintPerson.id, name: hintPerson.name, href: `/people/${hintPerson.slug}` }
    : hintCompany
      ? { kind: "company" as const, id: hintCompany.id, name: hintCompany.name, href: `/companies/${hintCompany.slug}` }
      : null;
  const drafts = db
    .prepare(
      `SELECT id, status, source, substr(raw_text, 1, 80) AS preview
       FROM log_drafts WHERE status IN ('analyzing','ready','error') ORDER BY id DESC LIMIT 5`
    )
    .all() as { id: number; status: string; source: string; preview: string }[];

  return (
    <div className="max-w-3xl space-y-6">
      <AiStatusBanner />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">✎ Log activity</h1>
        <p className="mt-1 text-sm text-stone-500">
          Turn a meeting, call, or email thread into interaction-log entries on the
          right contacts — with next actions updated and stale to-dos closed. You
          review everything before it's saved.
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
              — the entries will go on {hint.kind === "person" ? "them" : "this company"} even if the text doesn&apos;t name {hint.kind === "person" ? "them" : "anyone"}; other roster contacts who took part are picked up too.
            </span>
            <Link href="/log" className="ml-auto text-xs text-stone-400 hover:text-indigo-600" title="Log without a preset contact">
              ✕ clear
            </Link>
          </div>
        ) : null}
        <fieldset className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 text-sm">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Source
          </legend>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="source" value="paste" defaultChecked className="mt-1" />
            <span>
              <span className="font-medium">Paste</span>
              <span className="block text-xs text-stone-500">
                Paste a transcript, an email thread, or your raw notes directly.
                {ai.aiUsable ? null : (
                  <span className="block text-amber-800">
                    Pasting still needs the AI to write the entries — it&apos;s off right now (see above).
                  </span>
                )}
              </span>
            </span>
          </label>
          {hasClaude ? (
            <>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="source" value="zoom" className="mt-1" />
            <span>
              <span className="font-medium">Fetch from Zoom</span>
              <span className="block text-xs text-stone-500">
                Describe the meeting ("yesterday's call with Sam", "the Acme meeting on 7/15")
                — Claude fetches the transcript and the AI on this Mac writes the log entries.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="source" value="meet" className="mt-1" />
            <span>
              <span className="font-medium">Fetch from Google Meet</span>
              <span className="block text-xs text-stone-500">
                Describe the meeting ("Friday's Meet with Sam") — Claude finds the
                transcript or Gemini notes in your Google Drive and the AI on this Mac writes the log entries.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="source" value="gmail" className="mt-1" />
            <span>
              <span className="font-medium">Fetch from Gmail</span>
              <span className="block text-xs text-stone-500">
                Describe the thread ("latest thread with Sam about the proposal") — Claude
                fetches it and the AI on this Mac writes the log entries.
              </span>
            </span>
          </label>
            </>
          ) : (
            <p className="text-xs text-stone-400">
              Fetching from Zoom, Google Meet or Gmail needs Claude Code (see &ldquo;If you use Claude&rdquo; in the README). It isn&apos;t installed on this Mac, so paste the content instead.
            </p>
          )}
        </fieldset>

        <label htmlFor="log-raw-text" className="sr-only">
          Content to log
        </label>
        <textarea
          id="log-raw-text"
          name="raw_text"
          aria-label="Content to log — pasted meeting or email, or a description of what to fetch"
          required
          minLength={10}
          rows={10}
          placeholder={"Paste content here — or, for Zoom/Meet/Gmail, describe what to fetch…"}
          className="w-full rounded-xl border border-stone-300 p-4 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
        />
        <PendingButton
          label="✎ Analyze & draft log entries"
          pendingLabel="Working…"
          pendingNote="Starting — you'll see the AI's progress live on the next page…"
          disabled={!ai.aiUsable}
        />
      </form>

      {drafts.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
            Recent
          </h2>
          <ul className="space-y-1.5">
            {drafts.map((d) => (
              <li key={d.id} className="text-sm">
                <Link href={`/log/${d.id}`} className="font-medium text-indigo-700 hover:underline">
                  #{d.id}
                </Link>{" "}
                <span className={d.status === "error" ? "text-red-600" : d.status === "analyzing" ? "animate-pulse text-indigo-600" : "text-green-700"}>
                  [{d.status}]
                </span>{" "}
                <span className="text-stone-400">({d.source})</span>{" "}
                <span className="text-stone-500">{d.preview}…</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-stone-400">
        Zoom, Google Meet and Gmail are read-only, using the Gmail/Zoom/Drive access you&apos;ve
        already given Claude. Meet transcripts must be visible to the Google account Claude uses.
        Nothing is written to the CRM until you confirm on the review screen.
      </p>
    </div>
  );
}
