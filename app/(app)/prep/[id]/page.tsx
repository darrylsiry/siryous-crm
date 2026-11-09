import Link from "next/link";
import ConfirmButton from "@/components/ConfirmButton";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import type { ProgressEvent } from "@/lib/ai";
import { deleteBrief, retryPrep } from "@/lib/prep";
import { analyzeLog } from "@/lib/logmeeting";
import { getAiStatus } from "@/lib/aiStatus";
import { briefChecks, briefChecksLine } from "@/lib/briefChecks";
import { localStamp, todayLocal } from "@/lib/dates.mjs";
import Markdown from "@/components/Markdown";
import ActivityFeed from "@/components/ActivityFeed";
import FeedRecap from "@/components/FeedRecap";
import PendingButton from "@/components/PendingButton";
import AiRouteNote from "@/components/AiRouteNote";
import ErrorExplain from "@/components/ErrorExplain";
import { typicalRunSeconds } from "@/lib/progress";
import SaveAsTypedButton from "@/components/SaveAsTypedButton";

export const dynamic = "force-dynamic";

export const metadata = { title: "Brief" };

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const brief = db
    .prepare(
      `SELECT b.*, p.id AS pid, p.slug AS person_slug, p.name AS person_name,
              c.id AS cid, c.slug AS company_slug, c.name AS company_name
       FROM briefs b
       LEFT JOIN people p ON p.id = b.person_id
       LEFT JOIN companies c ON c.id = p.company_id
       WHERE b.id=?`
    )
    .get(Number(id)) as
    | {
        id: number;
        title: string;
        focus: string | null;
        content_md: string | null;
        status: string;
        error: string | null;
        created_at: string;
        pid: number | null;
        cid: number | null;
        person_slug: string | null;
        person_name: string | null;
        company_slug: string | null;
        company_name: string | null;
        progress: string | null;
        checks: string | null;
      }
    | undefined;
  if (!brief) notFound();
  const back = (
    <Link href="/prep" className="text-xs text-stone-500 hover:text-indigo-600">
      ← Prep
    </Link>
  );

  if (brief.status === "analyzing" || brief.status === "pending") {
    let events: ProgressEvent[] = [];
    try {
      events = brief.progress ? (JSON.parse(brief.progress) as ProgressEvent[]) : [];
    } catch {}
    return (
      <div className="max-w-3xl space-y-4">
        <header>
          {back}
          <h1 className="mt-1 text-2xl font-bold tracking-tight">🗓 Preparing your brief…</h1>
        </header>
        <ActivityFeed
          kind="prep"
          id={brief.id}
          title={brief.title}
          subtitle={brief.focus ?? undefined}
          initialEvents={events}
          typicalSecs={typicalRunSeconds("prep")}
        />
      </div>
    );
  }

  const ai = await getAiStatus();
  const checks = briefChecks(brief.checks);
  const today = todayLocal();
  const who = brief.person_name ? `${brief.person_name}${brief.company_name ? ` (${brief.company_name})` : ""}` : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          {brief.status === "ready" ? (
            <a href={`/api/briefs/${brief.id}/docx`} className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
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
          <h1 className="text-2xl font-bold tracking-tight">The brief couldn&apos;t be written</h1>
          <ErrorExplain error={brief.error} />
          <form action={retryPrep.bind(null, brief.id)}>
            <PendingButton label="Try again" pendingLabel="Starting…" disabled={!ai.aiUsable} />
          </form>
          <FeedRecap progress={brief.progress} />
        </>
      ) : (
        <>
          <div className="print:hidden">
            <AiRouteNote progress={brief.progress} />
            {checks ? (
              <p
                className={`mt-2 rounded-lg border px-3 py-1.5 text-sm ${checks.notChecked.length ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-200 bg-stone-50 text-stone-700"}`}
              >
                {briefChecksLine(checks)}
                {checks.notChecked.length ? ". Anything “unchanged” from those wasn't looked at." : ""}
              </p>
            ) : null}
          </div>
          <article className="rounded-xl border border-stone-200 bg-white p-8 print:border-0 print:p-0">
            <Markdown>{brief.content_md ?? "*Still generating…*"}</Markdown>
            <p className="mt-6 border-t border-stone-100 pt-3 text-xs text-stone-500 print:hidden">
              Prepared {localStamp(brief.created_at)}
              {brief.focus ? ` · focus: ${brief.focus}` : ""} — verify anything attributed to Gmail or the web before relying on it.
            </p>
          </article>
          <section className="rounded-xl border border-stone-200 bg-white p-5 print:hidden">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">✎ Log this meeting</h2>
            <form action={analyzeLog} className="mt-3 space-y-3">
              <input type="hidden" name="source" value="paste" />
              {brief.pid ? <input type="hidden" name="hint_person_id" value={brief.pid} /> : null}
              {brief.pid ? <input type="hidden" name="person_id" value={brief.pid} /> : null}
              {brief.cid ? <input type="hidden" name="company_id" value={brief.cid} /> : null}
              <input
                type="hidden"
                name="context"
                value={`Meeting${who ? ` with ${who}` : ""}. Prepped in the brief "${brief.title}"${brief.focus ? ` (focus: ${brief.focus})` : ""}.`}
              />
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
                <span>Meeting{who ? ` with ${who}` : ""} on</span>
                <input type="date" name="date" defaultValue={today} max={today} required aria-label="Date" className="rounded-lg border border-stone-300 px-2 py-1" />
                <input name="channel" placeholder="Call, Zoom, Meeting…" aria-label="Channel" className="w-36 rounded-lg border border-stone-300 px-2 py-1" />
              </div>
              <label className="block text-xs font-medium text-stone-600">
                What happened? *
                <textarea
                  name="raw_text"
                  required
                  minLength={10}
                  rows={6}
                  placeholder="What was discussed, what was agreed, the next step…"
                  className="mt-1 w-full rounded-xl border border-stone-300 p-4 text-sm leading-relaxed focus:border-indigo-400"
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <PendingButton
                  label="✎ Draft log entries with AI"
                  pendingLabel="Starting…"
                  pendingNote="You'll see the AI's progress live on the next page…"
                  disabled={!ai.aiUsable}
                />
                {brief.pid ? <SaveAsTypedButton /> : null}
              </div>
              <p className="text-xs text-stone-500">
                The AI drafts the entries and follow-ups for you to review. Save as typed keeps your words exactly, with no AI, on{" "}
                {brief.person_name ?? "this person"}.
              </p>
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
