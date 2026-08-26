import Link from "next/link";
import { getDb } from "@/lib/db";
import { analyzeLog } from "@/lib/logmeeting";
import { claudeAvailable } from "@/lib/ai";
import PendingButton from "@/components/PendingButton";

export const dynamic = "force-dynamic";

export default function LogPage() {
  const hasClaude = claudeAvailable();
  const drafts = getDb()
    .prepare(
      `SELECT id, status, source, substr(raw_text, 1, 80) AS preview
       FROM log_drafts WHERE status IN ('analyzing','ready','error') ORDER BY id DESC LIMIT 5`
    )
    .all() as { id: number; status: string; source: string; preview: string }[];

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">✎ Log activity</h1>
        <p className="mt-1 text-sm text-stone-500">
          Turn a meeting, call, or email thread into interaction-log entries on the
          right contacts — with next actions updated and stale to-dos closed. You
          review everything before it's saved.
        </p>
      </header>

      <form action={analyzeLog} className="space-y-4">
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
                and Claude pulls the recording transcript / AI summary; the local model writes the log.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="source" value="meet" className="mt-1" />
            <span>
              <span className="font-medium">Fetch from Google Meet</span>
              <span className="block text-xs text-stone-500">
                Describe the meeting ("Friday's Meet with Sam") and Claude finds the
                transcript / Gemini notes doc in Google Drive and logs from it.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="source" value="gmail" className="mt-1" />
            <span>
              <span className="font-medium">Fetch from Gmail</span>
              <span className="block text-xs text-stone-500">
                Describe the thread ("latest thread with Sam about the proposal")
                and Claude retrieves and logs it.
              </span>
            </span>
          </label>
            </>
          ) : (
            <p className="text-xs text-stone-400">
              Fetching from Zoom, Google Meet or Gmail needs the Claude Code CLI with those connectors; it isn&apos;t installed, so paste the content instead.
            </p>
          )}
        </fieldset>

        <textarea
          name="raw_text"
          required
          minLength={10}
          rows={10}
          placeholder={"Paste content here — or, for Zoom/Meet/Gmail, describe what to fetch…"}
          className="w-full rounded-xl border border-stone-300 p-4 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
        />
        <PendingButton
          label="✎ Analyze & draft log entries"
          pendingLabel="Working…"
          pendingNote="Starting — you'll see Claude's progress live on the next page…"
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
        Zoom, Google Meet (via Drive), and Gmail access is read-only, via your existing
        claude.ai connectors. Meet transcripts must be visible to the connected Google
        account. Nothing is written to the CRM until you confirm on the review screen.
      </p>
    </div>
  );
}
