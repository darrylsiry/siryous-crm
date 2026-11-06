import Link from "next/link";
import { getDb } from "@/lib/db";
import { startCoachSession, startCheckinSession } from "@/lib/coach";
import { mondayOf, sessionLabel } from "@/lib/coachai";
import PendingButton from "@/components/PendingButton";
import AiStatusBanner from "@/components/AiStatusBanner";
import { getAiStatus, routeUsable } from "@/lib/aiStatus";
import { getCoachSettings } from "@/lib/settings";
import { coachToneSpec } from "@/lib/coachTone";
import AiWhereLine from "@/components/AiWhereLine";

export const dynamic = "force-dynamic";

export const metadata = { title: "Coach" };

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  analyzing: { label: "Drafting…", cls: "animate-pulse bg-indigo-50 text-indigo-700" },
  ready: { label: "In session", cls: "bg-green-50 text-green-700" },
  closed: { label: "Closed", cls: "bg-stone-100 text-stone-600" },
  error: { label: "Failed", cls: "bg-red-50 text-red-700" },
};

export default async function CoachPage() {
  const ai = await getAiStatus();
  const db = getDb();
  const sessions = db
    .prepare(
      `SELECT s.id, s.week_start, s.kind, s.created_at, s.status, s.advice_md, s.summary_md,
              (SELECT COUNT(*) FROM coach_messages m WHERE m.session_id = s.id) AS msg_count,
              (SELECT COUNT(*) FROM coach_proposals p WHERE p.session_id = s.id AND p.status = 'pending') AS waiting,
              (SELECT COALESCE(CAST(p.message_id AS TEXT), 'close') FROM coach_proposals p
                 WHERE p.session_id = s.id AND p.status = 'pending' ORDER BY p.id LIMIT 1) AS first_group
       FROM coach_sessions s ORDER BY s.id DESC`
    )
    .all() as {
    id: number;
    week_start: string;
    kind: string;
    created_at: string;
    status: string;
    advice_md: string | null;
    summary_md: string | null;
    msg_count: number;
    waiting: number;
    first_group: string | null;
  }[];
  const waitingTotal = sessions.reduce((n, s) => n + s.waiting, 0);

  const coach = getCoachSettings();
  // The coach may run somewhere else than everything else (Settings → Coach).
  const coachUsable = routeUsable(ai, coach.route);
  const toneLabel = coachToneSpec(coach.tone).label;
  const thisWeek = mondayOf(new Date());
  const current = sessions.find((s) => s.week_start === thisWeek && s.kind === "weekly");

  return (
    <div className="max-w-3xl space-y-6">
      <AiStatusBanner route={coach.route} />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">◎ Coach</h1>
        <p className="mt-1 text-sm text-stone-600">
          A weekly session with your coach: an objective read on the week's activity and the whole
          book of business — what's working, where you're dropping the ball, and what to work on as
          the owner of a premium consulting firm. Talk it through, then close the session to record
          your commitments. Between weekly sessions, start a check-in anytime — the coach picks up
          from the last session's commitments.
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Tone: <span className="font-medium text-stone-600">{toneLabel}</span>
          {" · AI: "}
          <span className="font-medium text-stone-700">{coach.route.provider === "claude" ? "Claude (sent to Anthropic)" : `${coach.route.model} on this Mac`}</span>
          {coach.contextDir ? " · reads your notes folder" : " · CRM data only"} —{" "}
          <Link href="/settings" className="underline hover:text-indigo-600">change in Settings</Link>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <form action={startCoachSession}>
          {current && current.status !== "error" ? (
            <Link
              href={`/coach/${current.id}`}
              className="inline-block rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              {current.status === "closed" ? "◎ Review this week's session" : "◎ Resume this week's session"}
            </Link>
          ) : (
            // A weekly session that failed to generate is replaced by a fresh one (see startCoachSession).
            <PendingButton
              label={current ? "◎ Start this week's session again" : "◎ Start this week's session"}
              pendingLabel="Starting…"
              pendingNote="The coach is reviewing your week…"
              disabled={!coachUsable}
            />
          )}
        </form>
        <form action={startCheckinSession}>
          <PendingButton
            label="◉ Check in with your coach now"
            pendingLabel="Starting check-in…"
            pendingNote="The coach is catching up on what's moved…"
            disabled={!coachUsable}
          />
        </form>
      </div>

      {waitingTotal ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {waitingTotal} proposed CRM change{waitingTotal === 1 ? " is" : "s are"} waiting for your tick — open the session marked below.
        </p>
      ) : null}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          Sessions
        </h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-stone-500">
            No sessions yet — start your first one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.error;
              const snippet = (s.summary_md ?? s.advice_md ?? "")
                .replace(/^#.*$/gm, "")
                .replace(/[#*_\-\[\]]/g, "")
                .trim()
                .slice(0, 150);
              return (
                <li key={s.id}>
                  <Link
                    href={s.waiting && s.first_group ? `/coach/${s.id}#proposals-${s.first_group}` : `/coach/${s.id}`}
                    className={`block rounded-xl border bg-white p-4 hover:border-indigo-300 ${s.waiting ? "border-amber-300" : "border-stone-200"}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-stone-800">
                        {sessionLabel(s)}
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${
                            s.kind === "checkin"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-indigo-50 text-indigo-600"
                          }`}
                        >
                          {s.kind === "checkin" ? "Check-in" : "Weekly"}
                        </span>
                        {s.waiting ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            {s.waiting} proposal{s.waiting === 1 ? "" : "s"} waiting →
                          </span>
                        ) : null}
                        {s.msg_count > 0 ? (
                          <span className="text-xs text-stone-500">
                            💬 {s.msg_count}
                          </span>
                        ) : null}
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </span>
                    </div>
                    {snippet ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{snippet}…</p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AiWhereLine route={coach.route} />
      <p className="text-xs text-stone-500">
        The coach reads what&apos;s in your CRM, plus any notes folder you&apos;ve named in Settings (goals, strengths,
        pitfalls) — nothing else. The commitments you make when closing a session are carried into the next one, so you&apos;re
        held accountable week over week.
      </p>
    </div>
  );
}
