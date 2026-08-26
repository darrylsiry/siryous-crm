import { getDb } from "./db";
import { runClaudeStream, runModel, type ProgressEvent } from "./ai";

/** Whitelist: feed kind → draft table. Keys double as API route segments. */
export const PROGRESS_TABLES = {
  intake: "intake_drafts",
  log: "log_drafts",
  prep: "briefs",
  coach: "coach_sessions",
} as const;

export type ProgressKind = keyof typeof PROGRESS_TABLES;

export function readProgress(kind: ProgressKind, id: number) {
  const table = PROGRESS_TABLES[kind];
  const row = getDb()
    .prepare(`SELECT status, error, progress FROM ${table} WHERE id=?`)
    .get(id) as { status: string; error: string | null; progress: string | null } | undefined;
  if (!row) return null;
  let events: ProgressEvent[] = [];
  try {
    events = row.progress ? (JSON.parse(row.progress) as ProgressEvent[]) : [];
  } catch {}
  return { status: row.status, error: row.error, events };
}

/**
 * Run one model step, mirroring every progress event into the draft row so
 * the UI can poll it. Events accumulate across steps on the same row (a
 * feature may run a Claude fetch step and then a local write step).
 *
 * Routing: `allowedTools` set → this step needs external data → Claude CLI
 * with exactly that grant. Otherwise → runModel (local model, Claude fallback).
 * Returns the final text; errors propagate.
 */
export function runWithProgress(
  kind: ProgressKind,
  id: number,
  prompt: string,
  opts: { allowedTools?: string; timeoutMs?: number; json?: boolean } = {}
): Promise<string> {
  const table = PROGRESS_TABLES[kind];
  const db = getDb();
  const events: ProgressEvent[] = readProgress(kind, id)?.events ?? [];
  const update = db.prepare(`UPDATE ${table} SET progress=? WHERE id=?`);
  const onEvent = (e: ProgressEvent) => {
    events.push(e);
    try {
      update.run(JSON.stringify(events), id);
    } catch {}
  };
  if (opts.allowedTools) {
    return runClaudeStream(prompt, { allowedTools: opts.allowedTools, timeoutMs: opts.timeoutMs, onEvent });
  }
  return runModel(prompt, { json: opts.json, timeoutMs: opts.timeoutMs, onEvent });
}

/** Append a one-off note to a draft row's activity feed (e.g. "research skipped: …"). */
export function noteProgress(kind: ProgressKind, id: number, label: string, detail?: string) {
  const table = PROGRESS_TABLES[kind];
  const events = readProgress(kind, id)?.events ?? [];
  events.push({ t: "info", label, detail, ts: Date.now() });
  try {
    getDb().prepare(`UPDATE ${table} SET progress=? WHERE id=?`).run(JSON.stringify(events), id);
  } catch {}
}
