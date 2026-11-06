"use server";

import { getDb } from "./db";
import { readReceipt, readyDrafts, receiptLine } from "./receipts";

/**
 * The banner text for a "?receipt=log-12" landing, and the next draft waiting
 * for review (so a queue can be cleared without the sidebar). Only ids travel
 * in the URL; the names come from the draft row.
 */
export async function receiptFor(ref: string): Promise<{ line: string; next: { href: string; remaining: number } | null } | null> {
  const m = /^(log|intake)-(\d+)$/.exec(ref);
  if (!m) return null;
  const kind = m[1] as "log" | "intake";
  const db = getDb();
  const r = readReceipt(db, kind, Number(m[2]));
  if (!r) return null;
  const waiting = readyDrafts(db);
  return { line: receiptLine(kind, r), next: waiting.length ? { href: waiting[0].href, remaining: waiting.length } : null };
}
