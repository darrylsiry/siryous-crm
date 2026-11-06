"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import { COMPANY_TARGET } from "./logHint";
import { insertLogDraft, processLogDraft } from "./drafts";
import { parseDueDate } from "./dates.mjs";
import { bumpLastTouch, markActionDone, profilePath } from "./rules.mjs";

export async function analyzeLog(formData: FormData) {
  const raw = String(formData.get("raw_text") ?? "").trim();
  const source = String(formData.get("source") ?? "paste");
  if (raw.length < 10) return;
  const draftId = insertLogDraft(getDb(), {
    raw,
    source,
    hintPersonId: Number(formData.get("hint_person_id")) || null,
    hintCompanyId: Number(formData.get("hint_company_id")) || null,
  });
  after(() => processLogDraft(draftId));
  redirect(`/log/${draftId}`);
}

/** Run a failed draft again on what it already has (the paste, or the fetched content), so nothing needs pasting twice. */
export async function retryLog(id: number) {
  const changed = getDb()
    .prepare(`UPDATE log_drafts SET status='analyzing', error=NULL, progress=NULL, result_json=NULL WHERE id=? AND status='error'`)
    .run(id).changes;
  if (changed) after(() => processLogDraft(id));
  redirect(`/log/${id}`);
}

export async function discardLog(id: number) {
  getDb().prepare(`UPDATE log_drafts SET status='discarded' WHERE id=?`).run(id);
  revalidatePath("/log");
  redirect("/log");
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

export async function confirmLog(formData: FormData) {
  const db = getDb();
  const draftId = Number(formData.get("draft_id"));
  if (!draftId) return;
  // Claim the draft atomically so a double-click can't log everything twice.
  const claimed = db
    .prepare(`UPDATE log_drafts SET status='confirming' WHERE id=? AND status='ready'`)
    .run(draftId).changes;
  if (!claimed) redirect(`/log/${draftId}`);
  let target: string | null = null;
  try {
    // All or nothing: a failure part-way must not leave half a meeting logged,
    // to be logged again when the draft is confirmed a second time.
    target = db.transaction(() => writeLog(db, draftId, formData))();
  } finally {
    db.prepare(`UPDATE log_drafts SET status='ready' WHERE id=? AND status='confirming'`).run(draftId);
  }
  if (!target) return;
  revalidatePath("/", "layout");
  redirect(target);
}

/** The confirmation's writes, run inside one transaction. Returns where to go next, or null when nothing was done. */
function writeLog(db: ReturnType<typeof getDb>, draftId: number, formData: FormData): string | null {
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const channel = str(formData, "channel");

  let firstTarget: string | null = null;
  // Entries the model wrote for someone who isn't in the roster (a
  // hallucinated or stale slug) that the reviewer didn't re-target: nothing
  // is logged for them, and the count is reported back on the draft page.
  let skipped = 0;

  // Entries: target entry_slug_<i> (select; "" = not in the CRM), checkbox entry_<i>,
  // fields entry_summary_<i>, entry_next_<i>
  for (const [key] of formData.entries()) {
    const m = key.match(/^entry_slug_(\d+)$/);
    if (!m) continue;
    const i = m[1];
    const slug = str(formData, `entry_slug_${i}`);
    // A target is a person slug, or "company:<slug>" for a company-level entry.
    const companySlug = slug?.startsWith(COMPANY_TARGET) ? slug.slice(COMPANY_TARGET.length) : null;
    const person =
      slug && !companySlug
        ? (db.prepare(`SELECT id, company_id FROM people WHERE slug=?`).get(slug) as { id: number; company_id: number | null } | undefined)
        : undefined;
    const company = companySlug
      ? (db.prepare(`SELECT id FROM companies WHERE slug=?`).get(companySlug) as { id: number } | undefined)
      : undefined;
    if (!slug || (!person && !company)) {
      skipped++;
      continue;
    }
    if (!formData.has(`entry_${i}`)) continue; // unticked on purpose
    const summary = str(formData, `entry_summary_${i}`);
    if (!summary) continue;
    const personId = person?.id ?? null;
    const companyId = person ? person.company_id : (company?.id ?? null);
    db.prepare(`INSERT INTO interactions (person_id, company_id, date, channel, summary) VALUES (?,?,?,?,?)`).run(
      personId,
      companyId,
      date,
      channel,
      summary
    );
    if (personId) bumpLastTouch(db, "people", personId, date);
    if (companyId) bumpLastTouch(db, "companies", companyId, date);
    const next = str(formData, `entry_next_${i}`);
    // updated_at too, so a profile form opened before this can't overwrite the new next action unnoticed.
    if (next && personId) db.prepare(`UPDATE people SET next_action=?, updated_at=datetime('now') WHERE id=?`).run(next, personId);
    if (!firstTarget) firstTarget = companySlug ? profilePath("companies", companySlug) : profilePath("people", slug);
  }

  // Resolved action items: checkbox resolve_<id>
  for (const [key] of formData.entries()) {
    const m = key.match(/^resolve_(\d+)$/);
    if (!m) continue;
    markActionDone(db, Number(m[1]));
  }

  // Suggested actions: checkbox action_<i>, fields action_title_<i>, action_bucket_<i>, action_due_<i>, action_slug_<i>
  for (const [key] of formData.entries()) {
    const m = key.match(/^action_(\d+)$/);
    if (!m) continue;
    const i = m[1];
    const title = str(formData, `action_title_${i}`);
    if (!title) continue;
    const slug = str(formData, `action_slug_${i}`);
    const person = slug
      ? (db.prepare(`SELECT id, company_id FROM people WHERE slug=?`).get(slug) as { id: number; company_id: number | null } | undefined)
      : undefined;
    const due = str(formData, `action_due_${i}`);
    db.prepare(`INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id) VALUES (?,?,?,?,?,?)`).run(
      String(formData.get(`action_bucket_${i}`) ?? "this_week"),
      due,
      parseDueDate(due),
      title,
      person?.id ?? null,
      person?.company_id ?? null
    );
  }

  db.prepare(`UPDATE log_drafts SET status='confirmed' WHERE id=?`).run(draftId);
  return skipped ? `/log/${draftId}?skipped=${skipped}` : (firstTarget ?? "/");
}
