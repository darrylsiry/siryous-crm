import { getDb } from "./db";
import { runClaudeStream, runModel, type ProgressEvent } from "./ai";
import type { Provider } from "./settings";
import { shared } from "./serverState";

/** One AbortController per running draft ("log:12"), so Cancel can stop whichever step is running. */
const runs = shared("progress.runs", () => new Map<string, AbortController>());

function signalFor(kind: ProgressKind, id: number): AbortSignal {
  const key = `${kind}:${id}`;
  let c = runs.get(key);
  // A cancelled run's later steps get the same aborted signal and stop at once;
  // only a retry (the row is drafting again) gets a fresh one.
  if (!c || (c.signal.aborted && readProgress(kind, id)?.status === "analyzing")) {
    c = new AbortController();
    runs.set(key, c);
  }
  return c.signal;
}

/** The message a cancelled draft keeps, so its page offers Try again with the text intact. */
export const CANCELLED = "You cancelled this run. Your text is kept: try again, or discard it.";

/**
 * Cancel a running draft or brief: mark it failed (with CANCELLED, so the
 * page offers Try again) and stop the step in progress. A run still waiting
 * in the queue sees its row is no longer 'analyzing' and never starts.
 */
export function cancelRun(kind: Exclude<ProgressKind, "coach">, id: number): boolean {
  const table = PROGRESS_TABLES[kind];
  const changed = getDb().prepare(`UPDATE ${table} SET status='error', error=? WHERE id=? AND status IN ('analyzing','pending')`).run(CANCELLED, id).changes;
  runs.get(`${kind}:${id}`)?.abort();
  return changed > 0;
}

/**
 * How long a run of this kind usually takes here, in seconds: the median of
 * the last finished ones (first to last progress event). Null with too few.
 */
export function typicalRunSeconds(kind: Exclude<ProgressKind, "coach">): number | null {
  const table = PROGRESS_TABLES[kind];
  const rows = getDb()
    .prepare(`SELECT progress FROM ${table} WHERE status IN ('ready','confirmed') AND progress IS NOT NULL ORDER BY id DESC LIMIT 10`)
    .all() as { progress: string }[];
  const secs: number[] = [];
  for (const r of rows) {
    try {
      const ev = JSON.parse(r.progress) as ProgressEvent[];
      if (ev.length > 1) secs.push((ev[ev.length - 1].ts - ev[0].ts) / 1000);
    } catch {
      /* skip */
    }
  }
  if (secs.length < 3) return null;
  secs.sort((a, b) => a - b);
  return Math.round(secs[Math.floor(secs.length / 2)]);
}

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
  opts: {
    allowedTools?: string;
    timeoutMs?: number;
    json?: boolean;
    provider?: Provider;
    model?: string;
    stillWanted?: () => boolean;
    /** false: no Claude fallback for this step (see runModel). */
    fallback?: boolean;
  } = {}
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
  // Coach turns aren't cancellable; every other kind can be stopped from its page.
  const signal = kind === "coach" ? undefined : signalFor(kind, id);
  if (opts.allowedTools) {
    return runClaudeStream(prompt, { allowedTools: opts.allowedTools, timeoutMs: opts.timeoutMs, onEvent, signal });
  }
  return runModel(prompt, {
    json: opts.json,
    timeoutMs: opts.timeoutMs,
    onEvent,
    provider: opts.provider,
    model: opts.model,
    stillWanted: opts.stillWanted,
    signal,
    fallback: opts.fallback,
  });
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
