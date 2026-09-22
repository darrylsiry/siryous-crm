import type Database from "better-sqlite3";
import { getDb } from "./db";
import {
  buildFetchPrompt,
  buildIntakePrompt,
  buildIntakeResearchPrompt,
  buildLogPrompt,
  extractJsonWithRepair,
  FETCH_NOT_FOUND,
  TOOLS,
  type IntakeAnalysis,
  type LogAnalysis,
} from "./ai";
import { applyLogHintFallback, loadLogHint } from "./logHint";
import { noteProgress, runWithProgress } from "./progress";
import { IntakeAnalysisSchema, LogAnalysisSchema, validateModelJson } from "./schemas";
import { RunCancelled } from "./llm";

/** A queued run should only start if its draft is still waiting for it. */
function stillAnalyzing(table: "log_drafts" | "intake_drafts", id: number): () => boolean {
  return () => {
    const r = getDb().prepare(`SELECT status FROM ${table} WHERE id=?`).get(id) as { status: string } | undefined;
    return r?.status === "analyzing";
  };
}

/** Record a failure — unless the draft was discarded meanwhile (then the outcome no longer matters). */
function failDraft(table: "log_drafts" | "intake_drafts", id: number, err: unknown) {
  if (err instanceof RunCancelled) return;
  getDb()
    .prepare(`UPDATE ${table} SET status='error', error=? WHERE id=? AND status='analyzing'`)
    .run(err instanceof Error ? err.message : String(err), id);
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
}

export function insertLogDraft(db: Database.Database, input: LogDraftInput): number {
  const hint = loadLogHint(db, input.hintPersonId ?? null, input.hintCompanyId ?? null);
  return Number(
    db
      .prepare(
        `INSERT INTO log_drafts (source, raw_text, fetched_text, status, hint_person_id, hint_company_id) VALUES (?,?,?,'analyzing',?,?)`
      )
      .run(
        input.source,
        input.raw,
        input.content ?? null,
        hint?.kind === "person" ? input.hintPersonId : null,
        hint?.kind === "company" ? input.hintCompanyId : null
      ).lastInsertRowid
  );
}

/** Which connector a fetch-from source needs; "" for content that is already in hand. */
export function logFetchTools(source: string): string {
  return source === "zoom" ? TOOLS.zoomRead : source === "meet" ? TOOLS.driveRead : source === "gmail" ? TOOLS.gmailRead : "";
}

export async function processLogDraft(draftId: number): Promise<void> {
  const db = getDb();
  const row = db
    .prepare(`SELECT source, raw_text, fetched_text, hint_person_id, hint_company_id FROM log_drafts WHERE id=?`)
    .get(draftId) as
    | { source: string; raw_text: string; fetched_text: string | null; hint_person_id: number | null; hint_company_id: number | null }
    | undefined;
  if (!row) return;
  const hint = loadLogHint(db, row.hint_person_id, row.hint_company_id);
  const allowedTools = row.fetched_text ? "" : logFetchTools(row.source);
  try {
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
            "You can paste the transcript/thread directly instead."
        );
      }
      content = fetched;
      // Keep what was retrieved so the review page can show entries next to their source.
      db.prepare(`UPDATE log_drafts SET fetched_text=? WHERE id=?`).run(fetched, draftId);
    }
    // Step 2 (local model): write the log entries.
    const request = row.source === "paste" ? null : row.raw_text;
    const text = await runWithProgress("log", draftId, buildLogPrompt(content, row.source, request, hint), {
      json: true,
      timeoutMs: 420_000,
      stillWanted: stillAnalyzing("log_drafts", draftId),
    });
    const analysis: LogAnalysis = applyLogHintFallback(
      validateModelJson(LogAnalysisSchema, await extractJsonWithRepair(text), text),
      hint,
      content
    );
    if (!analysis?.entries?.length) {
      throw new Error(
        "No roster contacts were found to log against. " +
          (analysis?.summary_md ? `Its summary: ${analysis.summary_md.slice(0, 300)}` : "")
      );
    }
    db.prepare(`UPDATE log_drafts SET result_json=?, status='ready' WHERE id=? AND status='analyzing'`).run(JSON.stringify(analysis), draftId);
  } catch (err) {
    failDraft("log_drafts", draftId, err);
  }
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

export function insertIntakeDraft(db: Database.Database, raw: string): number {
  return Number(db.prepare(`INSERT INTO intake_drafts (raw_text, status) VALUES (?, 'analyzing')`).run(raw).lastInsertRowid);
}

export async function processIntakeDraft(draftId: number, research: boolean): Promise<void> {
  const db = getDb();
  const row = db.prepare(`SELECT raw_text FROM intake_drafts WHERE id=?`).get(draftId) as { raw_text: string } | undefined;
  if (!row) return;
  const raw = row.raw_text;
  try {
    // Step 1 (optional, Claude + web): research digest. A failure here is
    // not fatal — the analysis proceeds from the paste alone and says so.
    let digest: string | null = null;
    if (research) {
      try {
        digest =
          (
            await runWithProgress("intake", draftId, buildIntakeResearchPrompt(raw), {
              allowedTools: TOOLS.web,
              timeoutMs: 300_000,
            })
          ).trim() || null;
      } catch (err) {
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
    });
    const analysis: IntakeAnalysis = validateModelJson(IntakeAnalysisSchema, await extractJsonWithRepair(text), text);
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
