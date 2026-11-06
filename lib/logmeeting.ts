"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb, BUCKETS } from "./db";
import { COMPANY_TARGET } from "./logHint";
import { insertIntakeDraft, insertLogDraft, processIntakeDraft, processLogDraft } from "./drafts";
import { isIsoDate, parseDueDate } from "./dates.mjs";
import { bumpLastTouch, markActionDone, profilePath } from "./rules.mjs";
import { inboxMessageFor, type Receipt } from "./receipts";

export async function analyzeLog(formData: FormData) {
  const notes = String(formData.get("raw_text") ?? "").trim();
  const source = String(formData.get("source") ?? "paste");
  if (notes.length < 10) return;
  // A form that knows the meeting (Prep's "Log this meeting") sends it as a header line.
  const context = String(formData.get("context") ?? "").trim();
  const raw = context ? `${context}\n\n${notes}` : notes;
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

/** "Log it on someone else": run a failed draft again with a person preset, from its own text. */
export async function retryLogOn(formData: FormData) {
  const id = Number(formData.get("draft_id"));
  const personId = Number(formData.get("person_id")) || null;
  if (!id || !personId) redirect(`/log/${id}`);
  const changed = getDb()
    .prepare(
      `UPDATE log_drafts SET status='analyzing', error=NULL, progress=NULL, result_json=NULL, hint_person_id=?, hint_company_id=NULL
       WHERE id=? AND status='error'`
    )
    .run(personId, id).changes;
  if (changed) after(() => processLogDraft(id));
  redirect(`/log/${id}`);
}

/**
 * "Create a profile from these notes": hand a Log draft's text (what was
 * pasted, or what was fetched) to Intake, without pasting it again. Intake's
 * web look-up stays off: these are private notes.
 */
export async function logToIntake(id: number) {
  const db = getDb();
  const row = db.prepare(`SELECT raw_text, fetched_text FROM log_drafts WHERE id=?`).get(id) as
    | { raw_text: string; fetched_text: string | null }
    | undefined;
  if (!row) redirect("/intake");
  const intakeId = insertIntakeDraft(db, row.fetched_text ?? row.raw_text);
  db.prepare(`UPDATE log_drafts SET status='discarded' WHERE id=? AND status IN ('error','ready')`).run(id);
  after(() => processIntakeDraft(intakeId, false));
  revalidatePath("/", "layout");
  redirect(`/intake/${intakeId}`);
}

/** Where to go after a draft is saved or discarded: back to the Inbox queue when it came from an email. */
function landing(draftId: number, fallback: string, receipt = false): string {
  const fromInbox = inboxMessageFor(getDb(), "log", draftId);
  const base = fromInbox ? "/inbox" : fallback;
  return receipt ? `${base}${base.includes("?") ? "&" : "?"}receipt=log-${draftId}` : base;
}

export async function discardLog(id: number) {
  getDb().prepare(`UPDATE log_drafts SET status='discarded' WHERE id=?`).run(id);
  revalidatePath("/", "layout");
  redirect(landing(id, "/log"));
}

/**
 * "Save as typed": keep a failed draft's own text as the interaction, on the
 * contact it was opened from, with no AI involved.
 */
export async function saveLogAsTyped(formData: FormData) {
  const db = getDb();
  const id = Number(formData.get("draft_id"));
  const date = String(formData.get("date") ?? "").trim();
  const row = db
    .prepare(`SELECT raw_text, fetched_text, source, hint_person_id, hint_company_id, status FROM log_drafts WHERE id=?`)
    .get(id) as
    | { raw_text: string; fetched_text: string | null; source: string; hint_person_id: number | null; hint_company_id: number | null; status: string }
    | undefined;
  if (!row || row.status !== "error" || !isIsoDate(date) || (!row.hint_person_id && !row.hint_company_id)) redirect(`/log/${id}`);
  const person = row.hint_person_id
    ? (db.prepare(`SELECT id, slug, name, company_id FROM people WHERE id=?`).get(row.hint_person_id) as
        | { id: number; slug: string; name: string; company_id: number | null }
        | undefined)
    : undefined;
  const company = !person && row.hint_company_id
    ? (db.prepare(`SELECT id, slug, name FROM companies WHERE id=?`).get(row.hint_company_id) as { id: number; slug: string; name: string } | undefined)
    : undefined;
  if (!person && !company) redirect(`/log/${id}`);
  const channel = String(formData.get("channel") ?? "").trim() || null;
  const companyId = person ? person.company_id : company!.id;
  db.transaction(() => {
    db.prepare(`INSERT INTO interactions (person_id, company_id, date, channel, summary) VALUES (?,?,?,?,?)`).run(
      person?.id ?? null,
      companyId,
      date,
      channel,
      (row.fetched_text ?? row.raw_text).trim()
    );
    if (person) bumpLastTouch(db, "people", person.id, date);
    if (companyId) bumpLastTouch(db, "companies", companyId, date);
    const receipt: Receipt = { saved: [person?.name ?? company!.name], closed: 0, added: 0, skipped: 0 };
    db.prepare(`UPDATE log_drafts SET status='confirmed', receipt=? WHERE id=?`).run(JSON.stringify(receipt), id);
  })();
  revalidatePath("/", "layout");
  redirect(landing(id, person ? profilePath("people", person.slug) : profilePath("companies", company!.slug), true));
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
  const receipt: Receipt = { saved: [], closed: 0, added: 0, skipped: 0 };
  // Entries the model wrote for someone who isn't in the roster (a
  // hallucinated or stale slug) that the reviewer didn't re-target: nothing
  // is logged for them, and the receipt says so.

  // Entries: target entry_slug_<i> (select; "" = not in the CRM), checkbox entry_<i>,
  // fields entry_summary_<i>, entry_next_<i>, entry_keep_next_<i>, entry_todo_<i>, entry_todo_due_<i>
  for (const [key] of formData.entries()) {
    const m = key.match(/^entry_slug_(\d+)$/);
    if (!m) continue;
    const i = m[1];
    const slug = str(formData, `entry_slug_${i}`);
    // A target is a person slug, or "company:<slug>" for a company-level entry.
    const companySlug = slug?.startsWith(COMPANY_TARGET) ? slug.slice(COMPANY_TARGET.length) : null;
    const person =
      slug && !companySlug
        ? (db.prepare(`SELECT id, name, company_id FROM people WHERE slug=?`).get(slug) as { id: number; name: string; company_id: number | null } | undefined)
        : undefined;
    const company = companySlug
      ? (db.prepare(`SELECT id, name FROM companies WHERE slug=?`).get(companySlug) as { id: number; name: string } | undefined)
      : undefined;
    if (!slug || (!person && !company)) {
      receipt.skipped++;
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
    receipt.saved.push(person?.name ?? company!.name);
    const next = formData.has(`entry_keep_next_${i}`) ? null : str(formData, `entry_next_${i}`);
    if (next && personId) {
      // updated_at too, so a profile form opened before this can't overwrite the new next step unnoticed.
      db.prepare(`UPDATE people SET next_action=?, updated_at=datetime('now') WHERE id=?`).run(next, personId);
      if (formData.has(`entry_todo_${i}`)) {
        const dueRaw = str(formData, `entry_todo_due_${i}`);
        const due = isIsoDate(dueRaw) ? dueRaw : null;
        db.prepare(
          `INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id, source) VALUES (?,?,?,?,?,?,?)`
        ).run("this_week" in BUCKETS ? "this_week" : Object.keys(BUCKETS)[0], due, due, next, personId, null, "next step");
        receipt.added++;
      }
    }
    if (!firstTarget) firstTarget = companySlug ? profilePath("companies", companySlug) : profilePath("people", slug);
  }

  // Resolved to-dos: checkbox resolve_<id>
  for (const [key] of formData.entries()) {
    const m = key.match(/^resolve_(\d+)$/);
    if (!m) continue;
    markActionDone(db, Number(m[1]));
    receipt.closed++;
  }

  // Suggested follow-ups: checkbox action_<i>, fields action_title_<i>, action_bucket_<i>,
  // action_due_<i> (a date, or the AI's words when the reviewer left it), action_slug_<i>
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
    const dueDate = isIsoDate(due) ? due : parseDueDate(due);
    const bucket = String(formData.get(`action_bucket_${i}`) ?? "");
    db.prepare(`INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id) VALUES (?,?,?,?,?,?)`).run(
      Object.hasOwn(BUCKETS, bucket) ? bucket : "this_week",
      due,
      dueDate,
      title,
      person?.id ?? null,
      person?.company_id ?? null
    );
    receipt.added++;
  }

  if (!receipt.saved.length && !receipt.closed && !receipt.added) {
    // Nothing ticked: say so on the review page rather than marking the draft done with nothing saved.
    return `/log/${draftId}?nothing=1`;
  }
  db.prepare(`UPDATE log_drafts SET status='confirmed', receipt=? WHERE id=?`).run(JSON.stringify(receipt), draftId);
  return landing(draftId, firstTarget ?? "/", true);
}
