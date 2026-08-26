"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb, BUCKETS } from "./db";
import { runModel, extractJsonWithRepair } from "./ai";
import { runWithProgress } from "./progress";
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

function loadMessages(sessionId: number): CoachMessage[] {
  return getDb()
    .prepare(`SELECT role, content_md, created_at FROM coach_messages WHERE session_id=? ORDER BY id`)
    .all(sessionId) as CoachMessage[];
}

/**
 * Apply the CRM changes a coach turn extracted (completions + new
 * commitments). Returns a human-readable receipt, or null if nothing changed.
 * Conservative by design: only ids that are genuinely open complete; new
 * actions are tagged source='coach'.
 */
function applyCrmUpdates(sessionId: number, updates: CoachCrmUpdates): string | null {
  const db = getDb();
  const lines: string[] = [];
  const apply = db.transaction(() => {
    for (const id of updates.completed_action_ids ?? []) {
      const row = db.prepare(`SELECT title FROM action_items WHERE id=? AND status='open'`).get(Number(id)) as
        | { title: string }
        | undefined;
      if (!row) continue;
      db.prepare(`UPDATE action_items SET status='done', completed_at=date('now','localtime') WHERE id=?`).run(Number(id));
      lines.push(`✅ Completed: ${row.title}`);
    }
    for (const a of updates.new_actions ?? []) {
      const title = String(a.title ?? "").trim();
      if (!title) continue;
      const person = a.person_slug
        ? (db.prepare(`SELECT id, company_id FROM people WHERE slug=?`).get(a.person_slug) as
            | { id: number; company_id: number | null }
            | undefined)
        : undefined;
      db.prepare(
        `INSERT INTO action_items (bucket, due_label, title, person_id, company_id, source) VALUES (?,?,?,?,?,'coach')`
      ).run(Object.hasOwn(BUCKETS, String(a.bucket)) ? a.bucket : "this_week", a.due_label ?? null, title, person?.id ?? null, person?.company_id ?? null);
      lines.push(`➕ Committed: ${title}${a.due_label ? ` (due ${a.due_label})` : ""}`);
    }
  });
  apply();
  if (!lines.length) return null;
  const receipt = lines.join("\n");
  db.prepare(`INSERT INTO coach_messages (session_id, role, content_md) VALUES (?,?,?)`).run(
    sessionId,
    "crm",
    receipt
  );
  return receipt;
}

function generateAdvice(sessionId: number, weekStart: string, kind: "weekly" | "checkin") {
  const db = getDb();
  after(async () => {
    try {
      const md = await runWithProgress("coach", sessionId, buildCoachAdvicePrompt(weekStart, kind), {
        timeoutMs: 420_000,
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

/** Start (or resume) this week's weekly session: generate the coach's advice. */
export async function startCoachSession() {
  const db = getDb();
  const weekStart = mondayOf(new Date());
  const existing = db
    .prepare(`SELECT id FROM coach_sessions WHERE week_start=? AND kind='weekly'`)
    .get(weekStart) as { id: number } | undefined;
  if (existing) redirect(`/coach/${existing.id}`);

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

/** One chat turn: store the owner's message, get the coach's reply. */
export async function sendCoachMessage(formData: FormData) {
  const sessionId = Number(formData.get("session_id"));
  const message = String(formData.get("message") ?? "").trim();
  if (!sessionId || message.length < 2) return;
  const db = getDb();
  const session = db
    .prepare(`SELECT id, week_start, kind, advice_md, status FROM coach_sessions WHERE id=?`)
    .get(sessionId) as
    | { id: number; week_start: string; kind: "weekly" | "checkin"; advice_md: string | null; status: string }
    | undefined;
  if (!session || session.status !== "ready" || !session.advice_md) return;

  const history = loadMessages(sessionId);
  db.prepare(`INSERT INTO coach_messages (session_id, role, content_md) VALUES (?,?,?)`).run(
    sessionId,
    "owner",
    message
  );
  try {
    const raw = await runModel(
      buildCoachReplyPrompt(session.week_start, session.advice_md, history, message, session.kind),
      { json: true, timeoutMs: 300_000 }
    );
    const turn = (await extractJsonWithRepair(raw)) as CoachTurn;
    if (!turn.reply_md?.trim()) throw new Error("Empty reply.");
    db.prepare(`INSERT INTO coach_messages (session_id, role, content_md) VALUES (?,?,?)`).run(
      sessionId,
      "coach",
      turn.reply_md.trim()
    );
    applyCrmUpdates(sessionId, turn);
    db.prepare(`UPDATE coach_sessions SET error=NULL WHERE id=?`).run(sessionId);
  } catch (err) {
    db.prepare(`UPDATE coach_sessions SET error=? WHERE id=?`).run(
      `Coach reply failed: ${err instanceof Error ? err.message : String(err)} — send your message again.`,
      sessionId
    );
  }
  revalidatePath("/", "layout"); // action items may have changed — refresh dashboard/actions too
}

/** End the session: coach writes the summary + commitments, session closes. */
export async function endCoachSession(formData: FormData) {
  const sessionId = Number(formData.get("session_id"));
  if (!sessionId) return;
  const db = getDb();
  const session = db
    .prepare(`SELECT id, week_start, kind, advice_md, status FROM coach_sessions WHERE id=?`)
    .get(sessionId) as
    | { id: number; week_start: string; kind: "weekly" | "checkin"; advice_md: string | null; status: string }
    | undefined;
  if (!session || session.status !== "ready" || !session.advice_md) return;

  try {
    const raw = await runModel(
      buildCoachSummaryPrompt(session.week_start, session.advice_md, loadMessages(sessionId), session.kind),
      { json: true, timeoutMs: 300_000 }
    );
    const close = (await extractJsonWithRepair(raw)) as CoachClose;
    if (!close.summary_md?.trim()) throw new Error("Empty summary.");
    applyCrmUpdates(sessionId, close);
    db.prepare(
      `UPDATE coach_sessions SET summary_md=?, status='closed', closed_at=datetime('now'), error=NULL WHERE id=?`
    ).run(close.summary_md.trim(), sessionId);
  } catch (err) {
    db.prepare(`UPDATE coach_sessions SET error=? WHERE id=?`).run(
      `Closing summary failed: ${err instanceof Error ? err.message : String(err)} — try ending the session again.`,
      sessionId
    );
  }
  revalidatePath("/", "layout");
}

/** Remove a session entirely (stale error runs, do-overs). */
export async function deleteCoachSession(id: number) {
  getDb().prepare(`DELETE FROM coach_sessions WHERE id=?`).run(id);
  revalidatePath("/coach");
  redirect("/coach");
}
