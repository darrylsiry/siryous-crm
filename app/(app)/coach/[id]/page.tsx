import Link from "next/link";
import ConfirmButton from "@/components/ConfirmButton";
import { notFound } from "next/navigation";
import type { ProgressEvent } from "@/lib/ai";
import { sessionLabel } from "@/lib/coachai";
import { sendCoachMessage, endCoachSession, deleteCoachSession, retryCoachSession, reviewCoachProposals } from "@/lib/coach";
import { BUCKETS, getDb } from "@/lib/db";
import { getCoachSettings } from "@/lib/settings";
import { isIsoDate, localDateOf, localStamp, parseDueDate, shortDate } from "@/lib/dates.mjs";
import SubmitButton from "@/components/SubmitButton";
import SearchSelect from "@/components/SearchSelect";
import PendingButton from "@/components/PendingButton";
import AiRouteNote from "@/components/AiRouteNote";
import ErrorExplain from "@/components/ErrorExplain";
import { loadProposals, type CoachProposal } from "@/lib/coachData";
import Markdown from "@/components/Markdown";
import ActivityFeed from "@/components/ActivityFeed";
import FeedRecap from "@/components/FeedRecap";
import CoachChat from "@/components/CoachChat";

export const dynamic = "force-dynamic";

export const metadata = { title: "Coach session" };

/** The coach's proposed CRM changes for one reply (or the close): tick what to record. */
function ProposalReview({
  sessionId,
  group,
  proposals,
  people,
}: {
  sessionId: number;
  group: string;
  proposals: CoachProposal[];
  people: { slug: string; name: string }[];
}) {
  if (!proposals.length) return null;
  const pending = proposals.filter((p) => p.status === "pending");
  const nameOf = (slug: string | null) => (slug ? (people.find((x) => x.slug === slug)?.name ?? slug) : null);
  const line = (p: CoachProposal) => (
    <>
      <span className="font-medium">{p.kind === "complete" ? "Mark done:" : "Add:"}</span> {p.title}
      {p.due_label ? <span className="text-stone-500"> · due {p.due_label}</span> : null}
      {p.kind === "create" && p.bucket ? <span className="text-stone-500"> · {BUCKETS[p.bucket]?.label ?? p.bucket}</span> : null}
      {p.person_slug ? <span className="text-stone-500"> · {nameOf(p.person_slug)}</span> : null}
    </>
  );
  /** A "create" proposal as editable fields: the owner can fix the wording, date or person before recording. */
  const editable = (p: CoachProposal) => {
    const parsed = p.due_label ? (isIsoDate(p.due_label) ? p.due_label : parseDueDate(p.due_label)) : null;
    return (
      <span className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
        <input name={`title_${p.id}`} defaultValue={p.title} aria-label="To-do" className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm sm:col-span-2" />
        <SearchSelect
          name={`person_${p.id}`}
          options={people.map((x) => ({ value: x.slug, label: x.name }))}
          defaultValue={p.person_slug ?? ""}
          emptyLabel="Nobody"
          ariaLabel="Person"
          className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
        />
        <input
          type="date"
          name={`due_${p.id}`}
          defaultValue={parsed ?? ""}
          aria-label="Due"
          className={`rounded-md border px-2 py-1 text-sm ${p.due_label && !parsed ? "border-amber-400 bg-amber-50" : "border-stone-300 bg-white"}`}
        />
        {p.due_label && !parsed ? <span className="text-xs text-amber-800 sm:col-span-2">The coach said &ldquo;{p.due_label}&rdquo; — pick a date.</span> : null}
      </span>
    );
  };
  if (!pending.length) {
    return (
      <ul className="mt-2 space-y-1 text-xs text-stone-500">
        {proposals.map((p) => (
          <li key={p.id} className={p.status === "rejected" ? "line-through decoration-stone-300" : ""}>
            {p.status === "applied" ? "✅ " : "❌ "}
            {line(p)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <form id={`proposals-${group}`} action={reviewCoachProposals} className="mt-3 scroll-mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm">
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="group" value={group} />
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
        Proposed CRM changes — nothing is recorded until you say so
      </p>
      <ul className="space-y-1.5">
        {pending.map((p) => (
          <li key={p.id}>
            <div className="flex items-start gap-2">
              <input type="checkbox" name={`apply_${p.id}`} value="1" defaultChecked aria-label={`Record: ${p.title}`} className="mt-1.5" />
              {p.kind === "create" ? editable(p) : <span>{line(p)}</span>}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SubmitButton
          name="decision"
          value="apply"
          pendingChildren="Recording…"
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          Record ticked items
        </SubmitButton>
        <button
          type="submit"
          name="decision"
          value="reject"
          className="rounded-lg border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100"
        >
          Reject all
        </button>
        <span className="text-xs text-stone-500">Unticked items are rejected; the coach won't propose them again.</span>
      </div>
    </form>
  );
}

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
          <Link href="/coach" className="text-xs text-stone-500 hover:text-indigo-600">← Coach</Link>
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
  const proposals = loadProposals(session.id);
  const people = db.prepare(`SELECT slug, name FROM people ORDER BY name`).all() as { slug: string; name: string }[];
  const coach = getCoachSettings();
  const forMessage = (id: number) => proposals.filter((p) => p.message_id === id);
  const closeProposals = proposals.filter((p) => p.message_id === null);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/coach" className="text-xs text-stone-500 hover:text-indigo-600">← Coach</Link>
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
          <ErrorExplain error={session.error ?? "Something went wrong generating the advice."} />
          <form action={retryCoachSession.bind(null, session.id)}>
            <PendingButton label="Try again" pendingLabel="Starting…" />
          </form>
          <FeedRecap progress={session.progress} />
        </>
      ) : (
        <>
          {session.status === "closed" && session.summary_md ? (
            <article className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">
                Session closed {session.closed_at ? shortDate(localDateOf(session.closed_at)) : ""}
              </p>
              <Markdown modelWritten>{session.summary_md}</Markdown>
              <ProposalReview sessionId={session.id} group="close" proposals={closeProposals} people={people} />
            </article>
          ) : null}

          <article className="rounded-xl border border-stone-200 bg-white p-8">
            <Markdown modelWritten>{session.advice_md ?? "*No advice recorded.*"}</Markdown>
            <p className="mt-6 border-t border-stone-100 pt-3 text-xs text-stone-500">
              Written {localStamp(session.created_at)} from your CRM{coach.contextDir ? " and your notes folder" : ""}.
            </p>
            <AiRouteNote progress={session.progress} />
          </article>

          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              💬 {session.status === "closed" ? "Session transcript" : "Talk it through"}
            </h2>
            {messages.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">
                {session.status === "closed"
                  ? "No discussion — the session was closed from the written advice alone."
                  : "React to the advice, push back, or ask where to focus — the coach answers in context. Anything you say you've done or commit to shows up as a proposed CRM change under the coach's reply — you tick what to record."}
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
                      <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-stone-500">
                        {m.role === "coach" ? "◎ Coach" : "You"} · {localStamp(m.created_at)}
                      </p>
                      <Markdown modelWritten>{m.content_md}</Markdown>
                      {m.role === "coach" ? <ProposalReview sessionId={session.id} group={String(m.id)} proposals={forMessage(m.id)} people={people} /> : null}
                    </li>
                  )
                )}
              </ul>
            )}

            {session.status === "ready" ? (
              <CoachChat
                sessionId={session.id}
                error={session.error}
                sendAction={sendCoachMessage}
                endAction={endCoachSession}
                pendingProposals={proposals.filter((p) => p.status === "pending").length}
              />
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
