import type Database from "better-sqlite3";

/**
 * What a confirmed Log or Intake draft saved, stored on the draft so the page
 * it lands on can say so ("Saved 2 entries (Sam Lee, Priya Rao) · closed 1
 * to-do · added 1 follow-up") and offer the next draft to review.
 */
export interface Receipt {
  /** Names of the people/companies an entry or profile was saved on. */
  saved: string[];
  /** Profiles created (Intake). */
  created?: string[];
  closed: number;
  added: number;
  /** Entries left out because their contact isn't in the CRM. */
  skipped: number;
}

export function receiptLine(kind: "log" | "intake", r: Receipt): string {
  const parts: string[] = [];
  if (kind === "intake" && r.created?.length) parts.push(`Created ${r.created.join(", ")}`);
  if (r.saved.length) {
    const n = r.saved.length;
    parts.push(`${kind === "intake" ? "Updated" : "Saved"} ${n} ${kind === "intake" ? (n === 1 ? "profile" : "profiles") : n === 1 ? "entry" : "entries"} (${r.saved.join(", ")})`);
  }
  if (r.closed) parts.push(`closed ${r.closed} to-do${r.closed === 1 ? "" : "s"}`);
  if (r.added) parts.push(`added ${r.added} follow-up${r.added === 1 ? "" : "s"}`);
  if (r.skipped) parts.push(`${r.skipped} skipped (not in your CRM)`);
  return parts.join(" · ") || "Saved.";
}

export function readReceipt(db: Database.Database, kind: "log" | "intake", id: number): Receipt | null {
  const row = db.prepare(`SELECT receipt FROM ${kind === "log" ? "log_drafts" : "intake_drafts"} WHERE id=?`).get(id) as
    | { receipt: string | null }
    | undefined;
  if (!row?.receipt) return null;
  try {
    return JSON.parse(row.receipt) as Receipt;
  } catch {
    return null;
  }
}

/** The Inbox email a draft came from, if any. */
export function inboxMessageFor(db: Database.Database, kind: "log" | "intake", draftId: number): number | null {
  if (kind === "log") {
    return (db.prepare(`SELECT id FROM inbox_messages WHERE log_draft_id = ?`).get(draftId) as { id: number } | undefined)?.id ?? null;
  }
  // intake_draft_ids is a JSON list: narrow with LIKE, then check the id is really in it (12 vs 112).
  const rows = db.prepare(`SELECT id, intake_draft_ids FROM inbox_messages WHERE intake_draft_ids LIKE ?`).all(`%${draftId}%`) as {
    id: number;
    intake_draft_ids: string;
  }[];
  for (const r of rows) {
    try {
      if ((JSON.parse(r.intake_draft_ids) as unknown[]).map(Number).includes(draftId)) return r.id;
    } catch {
      /* not JSON: skip */
    }
  }
  return null;
}

/** Ready drafts still waiting for review, oldest first, as review-page links. */
export function readyDrafts(db: Database.Database): { href: string }[] {
  return db
    .prepare(
      `SELECT '/log/' || id AS href, created_at FROM log_drafts WHERE status='ready'
       UNION ALL
       SELECT '/intake/' || id AS href, created_at FROM intake_drafts WHERE status='ready'
       ORDER BY created_at`
    )
    .all() as { href: string }[];
}
