"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb, BUCKETS } from "./db";
import { runModel, extractJsonWithRepair } from "./ai";
import { runWithProgress } from "./progress";
import { getCoachSettings } from "./settings";
import { loadProposals, type CoachProposal } from "./coachData";
import { parseDueDate } from "./dates.mjs";
import { CoachCloseSchema, CoachTurnSchema, validateModelJson } from "./schemas";
import {
  buildCoachAdvicePrompt,
  buildCoachReplyPrompt,
  buildCoachSummaryPrompt,
  mondayOf,
  type CoachMessage,
  type CoachCrmUpdates,
  type CoachTurn,
  type CoachClose,
} from "./coachai";

/**
 * The conversation as the model should see it: the chat plus, in order, the
 * CRM proposals and their fate — so it neither re-proposes something that is
 * awaiting review nor "forgets" something you rejected.
 */
function loadMessages(sessionId: number): CoachMessage[] {
  const db = getDb();
  const msgs = db
    .prepare(`SELECT id, role, content_md, created_at FROM coach_messages WHERE session_id=? ORDER BY id`)
    .all(sessionId) as (CoachMessage & { id: number })[];
  const proposals = loadProposals(sessionId);
  const out: CoachMessage[] = [];
  const describe = (p: CoachProposal) =>
    `${p.kind === "complete" ? "complete" : "add"}: ${p.title}${p.due_label ? ` (due ${p.due_label})` : ""}`;
  const attach = (list: CoachProposal[]) => {
    if (!list.length) return;
    const lines = list.map((p) =>
      p.status === "applied"
        ? `📌 recorded — ${describe(p)}`
        : p.status === "rejected"
          ? `❌ rejected by the owner — ${describe(p)}`
          : `⏳ proposed, awaiting the owner's review — ${describe(p)}`
    );
    out.push({ role: "crm", content_md: lines.join("\n"), created_at: list[0].created_at });
  };
  for (const m of msgs) {
    out.push({ role: m.role, content_md: m.content_md, created_at: m.created_at });
    attach(proposals.filter((p) => p.message_id === m.id));
  }
  attach(proposals.filter((p) => p.message_id === null));
  return out;
}

/**
 * Turn the CRM changes a coach turn extracted (completions + new commitments)
 * into pending proposals for the owner to accept or reject. Nothing is written
 * to action_items here. Returns how many proposals were created.
 */
function proposeCrmUpdates(sessionId: number, messageId: number | null, updates: CoachCrmUpdates): number {
  const db = getDb();
  let n = 0;
  const insert = db.prepare(
    `INSERT INTO coach_proposals (session_id, message_id, kind, action_id, title, bucket, due_label, person_slug)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const run = db.transaction(() => {
    for (const id of updates.completed_action_ids ?? []) {
      const row = db.prepare(`SELECT title FROM action_items WHERE id=? AND status='open'`).get(Number(id)) as
        | { title: string }
        | undefined;
      if (!row) continue;
      const dup = db
        .prepare(`SELECT 1 FROM coach_proposals WHERE session_id=? AND kind='complete' AND action_id=? AND status<>'rejected'`)
        .get(sessionId, Number(id));
      if (dup) continue;
      insert.run(sessionId, messageId, "complete", Number(id), row.title, null, null, null);
      n++;
    }
    for (const a of updates.new_actions ?? []) {
      const title = String(a.title ?? "").trim();
      if (!title) continue;
      const dup = db
        .prepare(`SELECT 1 FROM coach_proposals WHERE session_id=? AND kind='create' AND lower(title)=lower(?) AND status<>'rejected'`)
        .get(sessionId, title);
      if (dup) continue;
      const slug = a.person_slug && db.prepare(`SELECT 1 FROM people WHERE slug=?`).get(a.person_slug) ? a.person_slug : null;
      insert.run(
        sessionId,
        messageId,
        "create",
        null,
        title,
        Object.hasOwn(BUCKETS, String(a.bucket)) ? String(a.bucket) : "this_week",
        a.due_label ?? null,
        slug
      );
      n++;
    }
  });
  run();
  return n;
}

/**
 * Review step: the owner ticks the proposals to record; everything else in the
 * same group is rejected. Applies the ticked ones to action_items and posts a
 * 📌 receipt into the transcript.
 */
export async function reviewCoachProposals(formData: FormData) {
  const sessionId = Number(formData.get("session_id"));
  const group = String(formData.get("group") ?? ""); // message id or "close"
  const rejectAll = formData.get("decision") === "reject";
  if (!sessionId || !group) return;
  const db = getDb();
  const pending = loadProposals(sessionId).filter(
    (p) => p.status === "pending" && (group === "close" ? p.message_id === null : p.message_id === Number(group))
  );
  if (!pending.length) return;
  const chosen = new Set(
    rejectAll ? [] : pending.filter((p) => formData.get(`apply_${p.id}`)).map((p) => p.id)
  );
  const lines: string[] = [];
  let rejected = 0;
  const apply = db.transaction(() => {
    for (const p of pending) {
      if (!chosen.has(p.id)) {
        db.prepare(`UPDATE coach_proposals SET status='rejected', resolved_at=datetime('now') WHERE id=?`).run(p.id);
        rejected++;
        continue;
      }
      if (p.kind === "complete" && p.action_id) {
        const row = db.prepare(`SELECT title FROM action_items WHERE id=? AND status='open'`).get(p.action_id) as
          | { title: string }
          | undefined;
        if (row) {
          db.prepare(`UPDATE action_items SET status='done', completed_at=date('now','localtime') WHERE id=?`).run(p.action_id);
          lines.push(`✅ Completed: ${row.title}`);
        } else {
          lines.push(`✅ Already done: ${p.title}`);
        }
      } else if (p.kind === "create") {
        const person = p.person_slug
          ? (db.prepare(`SELECT id, company_id FROM people WHERE slug=?`).get(p.person_slug) as
              | { id: number; company_id: number | null }
              | undefined)
          : undefined;
        db.prepare(
          `INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id, source) VALUES (?,?,?,?,?,?,'coach')`
        ).run(p.bucket ?? "this_week", p.due_label, parseDueDate(p.due_label), p.title, person?.id ?? null, person?.company_id ?? null);
        lines.push(`➕ Committed: ${p.title}${p.due_label ? ` (due ${p.due_label})` : ""}`);
      }
      db.prepare(`UPDATE coach_proposals SET status='applied', resolved_at=datetime('now') WHERE id=?`).run(p.id);
    }
    if (lines.length || rejected) {
      const receipt = [...lines, rejected ? `↩︎ ${rejected} proposal${rejected === 1 ? "" : "s"} rejected` : ""].filter(Boolean).join("\n");
      db.prepare(`INSERT INTO coach_messages (session_id, role, content_md) VALUES (?,?,?)`).run(sessionId, "crm", receipt);
    }
  });
  apply();
  revalidatePath("/", "layout");
}

function generateAdvice(sessionId: number, weekStart: string, kind: "weekly" | "checkin") {
  const db = getDb();
  after(async () => {
    try {
      const md = await runWithProgress("coach", sessionId, buildCoachAdvicePrompt(weekStart, kind), {
        timeoutMs: 420_000,
        ...getCoachSettings().route,
      });
      if (!md.trim()) throw new Error("Empty advice returned.");
      db.prepare(`UPDATE coach_sessions SET advice_md=?, status='ready', error=NULL WHERE id=?`).run(
        md.trim(),
        sessionId
      );
    } catch (err) {
      db.prepare(`UPDATE coach_sessions SET status='error', error=? WHERE id=?`).run(
        err instanceof Error ? err.message : String(err),
        sessionId
      );
    }
  });
}

/**
 * Start (or resume) this week's weekly session: generate the coach's advice.
 * A weekly session that failed to generate (Ollama was down, the model timed
 * out) is thrown away and replaced, so one bad run doesn't block the week.
 */
export async function startCoachSession() {
  const db = getDb();
  const weekStart = mondayOf(new Date());
  const existing = db
    .prepare(`SELECT id, status FROM coach_sessions WHERE week_start=? AND kind='weekly'`)
    .get(weekStart) as { id: number; status: string } | undefined;
  if (existing && existing.status !== "error") redirect(`/coach/${existing.id}`);
  if (existing) db.prepare(`DELETE FROM coach_sessions WHERE id=?`).run(existing.id);

  const sessionId = Number(
    db
      .prepare(`INSERT INTO coach_sessions (week_start, kind, status) VALUES (?, 'weekly', 'analyzing')`)
      .run(weekStart).lastInsertRowid
  );
  generateAdvice(sessionId, weekStart, "weekly");
  redirect(`/coach/${sessionId}`);
}

/** Start an ad-hoc check-in right now — any number per week. */
export async function startCheckinSession() {
  const db = getDb();
  const weekStart = mondayOf(new Date());
  const sessionId = Number(
    db
      .prepare(
        `INSERT INTO coach_sessions (week_start, kind, status, created_at)
         VALUES (?, 'checkin', 'analyzing', datetime('now','localtime'))`
      )
      .run(weekStart).lastInsertRowid
  );
  generateAdvice(sessionId, weekStart, "checkin");
  redirect(`/coach/${sessionId}`);
}

type ReadySession = { id: number; week_start: string; kind: "weekly" | "checkin"; advice_md: string | null; status: string };

const BUSY_MESSAGE: Record<"reply" | "close", string> = {
  reply: "The coach is still replying — wait a moment, then try again.",
  close: "The session is being closed — wait a moment.",
};

/**
 * Claim the session for one model run. The UPDATE is the lock: it only
 * succeeds when no other run holds the row, so a double-submit or a Send
 * racing an End loses cleanly. Returns the session when claimed; otherwise
 * leaves a friendly note in session.error (when someone else holds it) and
 * returns null.
 */
function claimSession(sessionId: number, mode: "reply" | "close"): ReadySession | null {
  const db = getDb();
  const claimed = db
    .prepare(`UPDATE coach_sessions SET in_flight=? WHERE id=? AND in_flight IS NULL AND status='ready'`)
    .run(mode, sessionId).changes;
  if (!claimed) {
    const holder = db.prepare(`SELECT in_flight FROM coach_sessions WHERE id=? AND status='ready'`).get(sessionId) as
      | { in_flight: "reply" | "close" | null }
      | undefined;
    if (holder?.in_flight) db.prepare(`UPDATE coach_sessions SET error=? WHERE id=?`).run(BUSY_MESSAGE[holder.in_flight], sessionId);
    return null;
  }
  const session = db
    .prepare(`SELECT id, week_start, kind, advice_md, status FROM coach_sessions WHERE id=?`)
    .get(sessionId) as ReadySession | undefined;
  if (!session?.advice_md) {
    releaseSession(sessionId);
    return null;
  }
  return session;
}

function releaseSession(sessionId: number) {
  getDb().prepare(`UPDATE coach_sessions SET in_flight=NULL WHERE id=?`).run(sessionId);
}

/**
 * One chat turn: get the coach's reply, then store the owner's message and
 * the reply together — so a failed turn leaves nothing in the transcript and
 * sending the same message again doesn't duplicate it.
 */
export async function sendCoachMessage(formData: FormData): Promise<{ ok: boolean }> {
  const sessionId = Number(formData.get("session_id"));
  const message = String(formData.get("message") ?? "").trim();
  if (!sessionId || message.length < 2) return { ok: false };
  const db = getDb();
  const session = claimSession(sessionId, "reply");
  if (!session) {
    revalidatePath(`/coach/${sessionId}`);
    return { ok: false };
  }

  let ok = false;
  try {
    const history = loadMessages(sessionId);
    const raw = await runModel(
      buildCoachReplyPrompt(session.week_start, session.advice_md!, history, message, session.kind),
      { json: true, timeoutMs: 300_000, ...getCoachSettings().route }
    );
    const turn: CoachTurn = validateModelJson(CoachTurnSchema, await extractJsonWithRepair(raw), raw);
    const insert = db.prepare(`INSERT INTO coach_messages (session_id, role, content_md) VALUES (?,?,?)`);
    db.transaction(() => {
      insert.run(sessionId, "owner", message);
      const replyId = Number(insert.run(sessionId, "coach", turn.reply_md.trim()).lastInsertRowid);
      proposeCrmUpdates(sessionId, replyId, turn);
      db.prepare(`UPDATE coach_sessions SET error=NULL WHERE id=?`).run(sessionId);
    })();
    ok = true;
  } catch (err) {
    db.prepare(`UPDATE coach_sessions SET error=? WHERE id=?`).run(
      `Coach reply failed: ${err instanceof Error ? err.message : String(err)} — your message was not saved; send it again.`,
      sessionId
    );
  } finally {
    releaseSession(sessionId);
  }
  revalidatePath("/", "layout"); // action items may have changed — refresh dashboard/actions too
  return { ok };
}

/** End the session: coach writes the summary + commitments, session closes. */
export async function endCoachSession(formData: FormData): Promise<{ ok: boolean }> {
  const sessionId = Number(formData.get("session_id"));
  if (!sessionId) return { ok: false };
  const db = getDb();
  const session = claimSession(sessionId, "close");
  if (!session) {
    revalidatePath(`/coach/${sessionId}`);
    return { ok: false };
  }

  let ok = false;
  try {
    const raw = await runModel(
      buildCoachSummaryPrompt(session.week_start, session.advice_md!, loadMessages(sessionId), session.kind),
      { json: true, timeoutMs: 300_000, ...getCoachSettings().route }
    );
    const close: CoachClose = validateModelJson(CoachCloseSchema, await extractJsonWithRepair(raw), raw);
    db.transaction(() => {
      proposeCrmUpdates(sessionId, null, close);
      db.prepare(
        `UPDATE coach_sessions SET summary_md=?, status='closed', closed_at=datetime('now'), error=NULL WHERE id=?`
      ).run(close.summary_md.trim(), sessionId);
    })();
    ok = true;
  } catch (err) {
    db.prepare(`UPDATE coach_sessions SET error=? WHERE id=?`).run(
      `Closing summary failed: ${err instanceof Error ? err.message : String(err)} — try ending the session again.`,
      sessionId
    );
  } finally {
    releaseSession(sessionId);
  }
  revalidatePath("/", "layout");
  return { ok };
}

/** Remove a session entirely (stale error runs, do-overs). */
export async function deleteCoachSession(id: number) {
  getDb().prepare(`DELETE FROM coach_sessions WHERE id=?`).run(id);
  revalidatePath("/coach");
  redirect("/coach");
}
