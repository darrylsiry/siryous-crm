import type Database from "better-sqlite3";
import { getDb } from "./db";
import {
  buildFetchPrompt,
  buildIntakePrompt,
  buildIntakeIdentityPrompt,
  buildIntakeResearchPrompt,
  researchableIdentity,
  buildLogPrompt,
  extractJsonWithRepair,
  FETCH_NOT_FOUND,
  TOOLS,
  type IntakeAnalysis,
  type LogAnalysis,
} from "./ai";
import { applyLogHintFallback, loadLogHint } from "./logHint";
import { abortRun, noteProgress, runWithProgress } from "./progress";
import { IntakeAnalysisSchema, IntakeIdentitySchema, LogAnalysisSchema, validateModelJson } from "./schemas";
import { RunCancelled } from "./llm";
import { inboxMessageFor } from "./receipts";

/**
 * Discard a draft and drop what it held: the pasted or fetched text, the
 * model's answer and its progress feed. Discarding means "I don't want this
 * kept", so none of it stays in the database (or in later backups).
 * `onlyIf`: discard only from these statuses (e.g. not one already saved).
 * Returns how many rows changed.
 */
export function discardDraft(db: Database.Database, kind: "log" | "intake", id: number, onlyIf?: string[]): number {
  const table = kind === "log" ? "log_drafts" : "intake_drafts";
  const extra = kind === "log" ? ", fetched_text=NULL" : "";
  const guard = onlyIf?.length ? ` AND status IN (${onlyIf.map(() => "?").join(",")})` : "";
  const changed = db
    .prepare(`UPDATE ${table} SET status='discarded', raw_text='', result_json=NULL, progress=NULL, error=NULL${extra} WHERE id=?${guard}`)
    .run(id, ...(onlyIf ?? [])).changes;
  // A run still drafting it stops, rather than holding the local model for minutes on text nobody wants.
  if (changed) abortRun(kind, id);
  return changed;
}

/** How a Log draft's error starts when nobody it mentions is in the CRM (the draft page offers Intake then). */
export const NOBODY_FOUND = "Nobody in these notes is in your CRM yet.";

/** A queued run should only start if its draft is still waiting for it. */
function stillAnalyzing(table: "log_drafts" | "intake_drafts", id: number): () => boolean {
  return () => {
    const r = getDb().prepare(`SELECT status FROM ${table} WHERE id=?`).get(id) as { status: string } | undefined;
    return r?.status === "analyzing";
  };
}

/** Record a failure — unless the draft was discarded meanwhile (then the outcome no longer matters). Never throws. */
function failDraft(table: "log_drafts" | "intake_drafts", id: number, err: unknown) {
  if (err instanceof RunCancelled) return;
  try {
    getDb()
      .prepare(`UPDATE ${table} SET status='error', error=? WHERE id=? AND status='analyzing'`)
      .run(err instanceof Error ? err.message : String(err), id);
  } catch (writeErr) {
    console.error(`[drafts] couldn't record the failure of ${table} #${id}:`, writeErr, "— original error:", err);
  }
}

/**
 * The Intake and Log pipelines, separated from the forms that usually start
 * them so that other entry points (the mail-in inbox) can create the same
 * drafts. Each has two halves: `insert…Draft` writes the row and returns its
 * id (synchronous — the caller redirects to the review page immediately), and
 * `process…Draft` runs the model steps and leaves the row 'ready' or 'error'.
 * The processing half never throws: every failure is recorded on the row.
 */

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

export interface LogDraftInput {
  /** What the person typed (a paste, or a description of what to fetch). */
  raw: string;
  /** 'paste' | 'zoom' | 'meet' | 'gmail' | 'email' — see buildLogPrompt. */
  source: string;
  hintPersonId?: number | null;
  hintCompanyId?: number | null;
  /**
   * Content that is already in hand (the mail-in inbox has the message), so
   * the Claude retrieval step is skipped and the local model logs from this.
   */
  content?: string | null;
  /** "inbox": made from a mail-in email, so it never switches to Claude by itself. */
  origin?: "inbox" | null;
  /** The meeting's date and channel when a form already gave them (Prep's "Log this meeting"). */
  meetingDate?: string | null;
  meetingChannel?: string | null;
}

export function insertLogDraft(db: Database.Database, input: LogDraftInput): number {
  const hint = loadLogHint(db, input.hintPersonId ?? null, input.hintCompanyId ?? null);
  return Number(
    db
      .prepare(
        `INSERT INTO log_drafts (source, raw_text, fetched_text, status, hint_person_id, hint_company_id, origin, meeting_date, meeting_channel) VALUES (?,?,?,'analyzing',?,?,?,?,?)`
      )
      .run(
        input.source,
        input.raw,
        input.content ?? null,
        hint?.kind === "person" ? input.hintPersonId : null,
        hint?.kind === "company" ? input.hintCompanyId : null,
        input.origin ?? null,
        input.meetingDate ?? null,
        input.meetingChannel ?? null
      ).lastInsertRowid
  );
}

/** Which connector a fetch-from source needs; "" for content that is already in hand. */
export function logFetchTools(source: string): string {
  // Meet reads the Calendar to identify the meeting, then Drive for its notes doc — both read-only, no web.
  return source === "zoom"
    ? TOOLS.zoomRead
    : source === "meet"
      ? [TOOLS.calendarRead, TOOLS.driveRead].join(",")
      : source === "gmail"
        ? TOOLS.gmailRead
        : "";
}

export async function processLogDraft(draftId: number): Promise<void> {
  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT source, raw_text, fetched_text, hint_person_id, hint_company_id FROM log_drafts WHERE id=?`)
      .get(draftId) as
      | { source: string; raw_text: string; fetched_text: string | null; hint_person_id: number | null; hint_company_id: number | null }
      | undefined;
    if (!row) return;
    const hint = loadLogHint(db, row.hint_person_id, row.hint_company_id);
    // A draft from the Inbox runs with nobody watching: it never switches to Claude by itself.
    const fallback = !draftFromInbox(db, "log", draftId);
    const allowedTools = row.fetched_text ? "" : logFetchTools(row.source);
    // Step 1 (Claude + connector tools, only for Zoom/Meet/Gmail): fetch the content.
    let content = row.fetched_text ?? row.raw_text;
    if (allowedTools) {
      const fetched = (
        await runWithProgress("log", draftId, buildFetchPrompt(row.raw_text, row.source), {
          allowedTools,
          timeoutMs: 420_000,
        })
      ).trim();
      const nf = fetched.slice(0, 400).indexOf(FETCH_NOT_FOUND);
      if (!fetched || nf !== -1) {
        throw new Error(
          `Couldn't retrieve the ${row.source} content: ${fetched.slice(nf + FETCH_NOT_FOUND.length).replace(/\*+/g, "").trim() || "nothing came back"}. ` +
            "Or paste the transcript/thread directly instead."
        );
      }
      content = fetched;
      // Keep what was retrieved so the review page can show entries next to their source.
      db.prepare(`UPDATE log_drafts SET fetched_text=? WHERE id=? AND status='analyzing'`).run(fetched, draftId);
    }
    // Step 2 (local model): write the log entries.
    const request = row.source === "paste" ? null : row.raw_text;
    const text = await runWithProgress("log", draftId, buildLogPrompt(content, row.source, request, hint), {
      json: true,
      timeoutMs: 420_000,
      stillWanted: stillAnalyzing("log_drafts", draftId),
      fallback,
    });
    const analysis: LogAnalysis = applyLogHintFallback(
      validateModelJson(LogAnalysisSchema, await extractJsonWithRepair(text, { fallback }), text),
      hint,
      content
    );
    if (!analysis?.entries?.length) {
      // Not a fault: the meeting was with someone new. The draft page offers Intake (with this text) instead.
      throw new Error(`${NOBODY_FOUND}${analysis?.summary_md ? ` What the AI understood: ${analysis.summary_md.slice(0, 300)}` : ""}`);
    }
    db.prepare(`UPDATE log_drafts SET result_json=?, status='ready' WHERE id=? AND status='analyzing'`).run(JSON.stringify(analysis), draftId);
  } catch (err) {
    failDraft("log_drafts", draftId, err);
  }
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** `origin` "inbox": made from a mail-in email, so it never switches to Claude by itself. */
export function insertIntakeDraft(db: Database.Database, raw: string, origin: "inbox" | null = null): number {
  return Number(db.prepare(`INSERT INTO intake_drafts (raw_text, status, origin) VALUES (?, 'analyzing', ?)`).run(raw, origin).lastInsertRowid);
}

/** Whether a draft came from a mail-in email: recorded on it, or (for older drafts) linked from the email. */
export function draftFromInbox(db: Database.Database, kind: "log" | "intake", draftId: number): boolean {
  const row = db.prepare(`SELECT origin FROM ${kind === "log" ? "log_drafts" : "intake_drafts"} WHERE id=?`).get(draftId) as
    | { origin: string | null }
    | undefined;
  return row?.origin === "inbox" || inboxMessageFor(db, kind, draftId) !== null;
}

export async function processIntakeDraft(draftId: number, research: boolean): Promise<void> {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT raw_text FROM intake_drafts WHERE id=?`).get(draftId) as { raw_text: string } | undefined;
    if (!row) return;
    const raw = row.raw_text;
    // A draft from the Inbox runs with nobody watching: it never switches to Claude by itself.
    const fallback = !draftFromInbox(db, "intake", draftId);
    // Step 1 (optional): research digest. 1a, on this Mac: who the paste is
    // about. 1b, Claude + web: research that public identity only — the paste
    // itself never goes to a session that can reach the web. A failure here
    // is not fatal — the analysis proceeds from the paste alone and says so.
    let digest: string | null = null;
    if (research) {
      try {
        const idText = await runWithProgress("intake", draftId, buildIntakeIdentityPrompt(raw), {
          json: true,
          stillWanted: stillAnalyzing("intake_drafts", draftId),
          fallback,
        });
        const who = researchableIdentity(IntakeIdentitySchema.parse(await extractJsonWithRepair(idText, { fallback })));
        if (!who) throw new Error("couldn't tell cleanly who the text is about (a name of a few words), so nothing was looked up.");
        digest =
          (
            await runWithProgress("intake", draftId, buildIntakeResearchPrompt(who), {
              allowedTools: TOOLS.web,
              timeoutMs: 300_000,
            })
          ).trim() || null;
      } catch (err) {
        if (err instanceof RunCancelled) throw err;
        noteProgress(
          "intake",
          draftId,
          "Web research skipped — continuing from the pasted text only",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    // Step 2 (local model): the analysis itself.
    const text = await runWithProgress("intake", draftId, buildIntakePrompt(raw, digest), {
      json: true,
      stillWanted: stillAnalyzing("intake_drafts", draftId),
      fallback,
    });
    const analysis: IntakeAnalysis = validateModelJson(IntakeAnalysisSchema, await extractJsonWithRepair(text, { fallback }), text);
    if (research && !digest) {
      analysis.confidence_flags = [
        "Web research was unavailable for this run — nothing here was verified online.",
        ...(analysis.confidence_flags ?? []),
      ];
    }
    db.prepare(`UPDATE intake_drafts SET result_json=?, status='ready' WHERE id=? AND status='analyzing'`).run(JSON.stringify(analysis), draftId);
  } catch (err) {
    failDraft("intake_drafts", draftId, err);
  }
}
