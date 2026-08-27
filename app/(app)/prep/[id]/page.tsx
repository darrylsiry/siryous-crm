import Link from "next/link";
import ConfirmButton from "@/components/ConfirmButton";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import type { ProgressEvent } from "@/lib/ai";
import { deleteBrief } from "@/lib/prep";
import { analyzeLog } from "@/lib/logmeeting";
import Markdown from "@/components/Markdown";
import ActivityFeed from "@/components/ActivityFeed";
import FeedRecap from "@/components/FeedRecap";
import PendingButton from "@/components/PendingButton";

export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const brief = db
    .prepare(
      `SELECT b.*, p.slug AS person_slug, p.name AS person_name,
              c.slug AS company_slug, c.name AS company_name
       FROM briefs b
       LEFT JOIN people p ON p.id = b.person_id
       LEFT JOIN companies c ON c.id = p.company_id
       WHERE b.id=?`
    )
    .get(Number(id)) as
    | { id: number; title: string; focus: string | null; content_md: string | null; status: string; error: string | null; created_at: string; person_slug: string | null; person_name: string | null; company_slug: string | null; company_name: string | null; progress: string | null }
    | undefined;
  if (!brief) notFound();

  if (brief.status === "analyzing" || brief.status === "pending") {
    let events: ProgressEvent[] = [];
    try {
      events = brief.progress ? (JSON.parse(brief.progress) as ProgressEvent[]) : [];
    } catch {}
    return (
      <div className="max-w-3xl space-y-4">
        <header>
          <Link href="/prep" className="text-xs text-stone-400 hover:text-indigo-600">← Meeting prep</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">🗓 Preparing your brief…</h1>
        </header>
        <ActivityFeed
          kind="prep"
          id={brief.id}
          title={brief.title}
          subtitle={brief.focus ?? undefined}
          initialEvents={events}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/prep" className="text-xs text-stone-400 hover:text-indigo-600">← Meeting prep</Link>
        <div className="flex flex-wrap items-center gap-2">
          {brief.status === "ready" ? (
            <a
              href={`/api/briefs/${brief.id}/docx`}
              className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              ⬇ Word doc
            </a>
          ) : null}
          {brief.person_slug ? (
            <Link
              href={`/people/${brief.person_slug}`}
              className="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              👤 {brief.person_name}
            </Link>
          ) : null}
          {brief.company_slug ? (
            <Link
              href={`/companies/${brief.company_slug}`}
              className="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              🏢 {brief.company_name}
            </Link>
          ) : null}
          <form action={deleteBrief.bind(null, brief.id)}>
            <ConfirmButton label="Delete" confirm="Delete this brief? This can't be undone." />
          </form>
        </div>
      </div>

      {brief.status === "error" ? (
        <>
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{brief.error}</p>
          <FeedRecap progress={brief.progress} />
        </>
      ) : (
        <>
          <article className="rounded-xl border border-stone-200 bg-white p-8 print:border-0 print:p-0">
            <Markdown>{brief.content_md ?? "*Still generating…*"}</Markdown>
            <p className="mt-6 border-t border-stone-100 pt-3 text-xs text-stone-400 print:hidden">
              Generated {brief.created_at}{brief.focus ? ` · focus: ${brief.focus}` : ""} — verify anything
              attributed to Gmail/web before relying on it.
            </p>
          </article>
          <section className="rounded-xl border border-stone-200 bg-white p-5 print:hidden">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">✎ Log this meeting</h2>
            <p className="mt-1 text-xs text-stone-500">
              After the call, jot down what happened — the AI drafts the CRM log entries and follow-ups,
              and you review everything before it's saved.
            </p>
            <form action={analyzeLog} className="mt-3 space-y-3">
              <input type="hidden" name="source" value="paste" />
              <textarea
                name="raw_text"
                required
                minLength={10}
                rows={7}
                defaultValue={`${
                  brief.person_name
                    ? `Call with ${brief.person_name}${brief.company_name ? ` (${brief.company_name})` : ""}`
                    : `Meeting`
                } — ${new Date().toLocaleDateString("sv-SE")}. Context: prepped in brief "${brief.title}"${
                  brief.focus ? ` (focus: ${brief.focus})` : ""
                }.\n\nNotes:\n- `}
                className="w-full rounded-xl border border-stone-300 p-4 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
              />
              <PendingButton
                label="✎ Analyze & draft log entries"
                pendingLabel="Starting…"
                pendingNote="You'll see the AI's progress live on the next page…"
              />
            </form>
          </section>

          <div className="print:hidden">
            <FeedRecap progress={brief.progress} />
          </div>
        </>
      )}
    </div>
  );
}
