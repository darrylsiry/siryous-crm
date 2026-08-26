import Link from "next/link";
import ConfirmButton from "@/components/ConfirmButton";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import type { ProgressEvent } from "@/lib/ai";
import { sessionLabel } from "@/lib/coachai";
import { sendCoachMessage, endCoachSession, deleteCoachSession } from "@/lib/coach";
import Markdown from "@/components/Markdown";
import ActivityFeed from "@/components/ActivityFeed";
import FeedRecap from "@/components/FeedRecap";
import PendingButton from "@/components/PendingButton";

export const dynamic = "force-dynamic";

export default async function CoachSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const session = db.prepare(`SELECT * FROM coach_sessions WHERE id=?`).get(Number(id)) as
    | {
        id: number;
        week_start: string;
        kind: string;
        status: string;
        advice_md: string | null;
        summary_md: string | null;
        error: string | null;
        progress: string | null;
        created_at: string;
        closed_at: string | null;
      }
    | undefined;
  if (!session) notFound();

  const title = sessionLabel(session);

  if (session.status === "analyzing") {
    let events: ProgressEvent[] = [];
    try {
      events = session.progress ? (JSON.parse(session.progress) as ProgressEvent[]) : [];
    } catch {}
    return (
      <div className="max-w-3xl space-y-4">
        <header>
          <Link href="/coach" className="text-xs text-stone-400 hover:text-indigo-600">← Coach</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {session.kind === "checkin" ? "◉ Your coach is catching up…" : "◎ Your coach is reviewing the week…"}
          </h1>
        </header>
        <ActivityFeed kind="coach" id={session.id} title={title} initialEvents={events} />
      </div>
    );
  }

  const messages = db
    .prepare(`SELECT id, role, content_md, created_at FROM coach_messages WHERE session_id=? ORDER BY id`)
    .all(session.id) as { id: number; role: string; content_md: string; created_at: string }[];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/coach" className="text-xs text-stone-400 hover:text-indigo-600">← Coach</Link>
        <form action={deleteCoachSession.bind(null, session.id)}>
          <ConfirmButton
            label="Delete session"
            confirm="Delete this coaching session and its whole conversation? This can't be undone."
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          />
        </form>
      </div>

      {session.status === "error" ? (
        <>
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {session.error ?? "Something went wrong generating the advice."}
          </p>
          <FeedRecap progress={session.progress} />
          <p className="text-xs text-stone-400">
            Delete this session and start it again from the Coach page.
          </p>
        </>
      ) : (
        <>
          {session.status === "closed" && session.summary_md ? (
            <article className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">
                Session closed {session.closed_at?.slice(0, 10)}
              </p>
              <Markdown>{session.summary_md}</Markdown>
            </article>
          ) : null}

          <article className="rounded-xl border border-stone-200 bg-white p-8">
            <Markdown>{session.advice_md ?? "*No advice recorded.*"}</Markdown>
            <p className="mt-6 border-t border-stone-100 pt-3 text-xs text-stone-400">
              Generated {session.created_at.slice(0, 16)} from your CRM data only.
            </p>
          </article>

          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              💬 {session.status === "closed" ? "Session transcript" : "Talk it through"}
            </h2>
            {messages.length === 0 ? (
              <p className="mt-2 text-sm text-stone-400">
                {session.status === "closed"
                  ? "No discussion — the session was closed from the written advice alone."
                  : "React to the advice, push back, or ask where to focus — the coach answers in context. Anything you complete or commit to here is recorded in the CRM automatically (you'll see a 📌 receipt)."}
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {messages.map((m) =>
                  m.role === "crm" ? (
                    <li
                      key={m.id}
                      className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs text-emerald-900 whitespace-pre-line"
                    >
                      <span className="font-semibold">📌 Recorded in CRM</span>
                      {"\n" + m.content_md}
                    </li>
                  ) : (
                    <li
                      key={m.id}
                      className={
                        m.role === "coach"
                          ? "rounded-xl rounded-tl-sm border border-indigo-100 bg-indigo-50/60 p-4"
                          : "ml-8 rounded-xl rounded-tr-sm border border-stone-200 bg-stone-50 p-4"
                      }
                    >
                      <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-stone-400">
                        {m.role === "coach" ? "◎ Coach" : "You"} · {m.created_at.slice(11, 16)}
                      </p>
                      <Markdown>{m.content_md}</Markdown>
                    </li>
                  )
                )}
              </ul>
            )}

            {session.status === "ready" ? (
              <>
                {session.error ? (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {session.error}
                  </p>
                ) : null}
                <form action={sendCoachMessage} className="mt-4 space-y-2">
                  <input type="hidden" name="session_id" value={session.id} />
                  <textarea
                    name="message"
                    required
                    minLength={2}
                    rows={3}
                    placeholder="Reply to your coach…"
                    className="w-full rounded-xl border border-stone-300 p-3 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
                  />
                  <PendingButton
                    label="Send"
                    pendingLabel="Coach is thinking…"
                    pendingNote="Replies usually take under a minute."
                  />
                </form>
                <form action={endCoachSession} className="mt-4 border-t border-stone-100 pt-4">
                  <input type="hidden" name="session_id" value={session.id} />
                  <PendingButton
                    label="⏹ End session — summarize & record commitments"
                    pendingLabel="Summarizing the session…"
                    pendingNote="The coach is writing up what was discussed and your commitments."
                  />
                  <p className="mt-2 text-xs text-stone-400">
                    Closes the session for good. The summary and commitments carry into next week's session.
                  </p>
                </form>
              </>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
