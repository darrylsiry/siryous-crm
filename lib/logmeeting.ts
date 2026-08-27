"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import { buildFetchPrompt, buildLogPrompt, extractJsonWithRepair, FETCH_NOT_FOUND, TOOLS, type LogAnalysis } from "./ai";
import { applyLogHintFallback, COMPANY_TARGET, loadLogHint } from "./logHint";
import { runWithProgress } from "./progress";
import { parseDueDate } from "./dates.mjs";
import { LogAnalysisSchema, validateModelJson } from "./schemas";

export async function analyzeLog(formData: FormData) {
  const raw = String(formData.get("raw_text") ?? "").trim();
  const source = String(formData.get("source") ?? "paste");
  if (raw.length < 10) return;
  const db = getDb();
  const hintPersonId = Number(formData.get("hint_person_id")) || null;
  const hintCompanyId = Number(formData.get("hint_company_id")) || null;
  const hint = loadLogHint(db, hintPersonId, hintCompanyId);
  const draftId = Number(
    db
      .prepare(`INSERT INTO log_drafts (source, raw_text, status, hint_person_id, hint_company_id) VALUES (?,?,'analyzing',?,?)`)
      .run(source, raw, hint?.kind === "person" ? hintPersonId : null, hint?.kind === "company" ? hintCompanyId : null).lastInsertRowid
  );
  const allowedTools =
    source === "zoom"
      ? TOOLS.zoomRead
      : source === "meet"
        ? TOOLS.driveRead
        : source === "gmail"
          ? TOOLS.gmailRead
          : "";
  after(async () => {
    try {
      // Step 1 (Claude + connector tools, only for Zoom/Meet/Gmail): fetch the content.
      let content = raw;
      if (allowedTools) {
        const fetched = (await runWithProgress("log", draftId, buildFetchPrompt(raw, source), {
          allowedTools,
          timeoutMs: 420_000,
        })).trim();
        const nf = fetched.slice(0, 400).indexOf(FETCH_NOT_FOUND);
        if (!fetched || nf !== -1) {
          throw new Error(
            `Couldn't retrieve the ${source} content: ${fetched.slice(nf + FETCH_NOT_FOUND.length).replace(/\*+/g, "").trim() || "nothing came back"}. ` +
              "You can paste the transcript/thread directly instead."
          );
        }
        content = fetched;
        // Keep what was retrieved so the review page can show entries next to their source.
        db.prepare(`UPDATE log_drafts SET fetched_text=? WHERE id=?`).run(fetched, draftId);
      }
      // Step 2 (local model): write the log entries.
      const text = await runWithProgress("log", draftId, buildLogPrompt(content, source, allowedTools ? raw : null, hint), {
        json: true,
        timeoutMs: 420_000,
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
      db.prepare(`UPDATE log_drafts SET result_json=?, status='ready' WHERE id=?`).run(
        JSON.stringify(analysis),
        draftId
      );
    } catch (err) {
      db.prepare(`UPDATE log_drafts SET status='error', error=? WHERE id=?`).run(
        err instanceof Error ? err.message : String(err),
        draftId
      );
    }
  });
  redirect(`/log/${draftId}`);
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
  try {
    await confirmLogInner(db, draftId, formData);
  } finally {
    db.prepare(`UPDATE log_drafts SET status='ready' WHERE id=? AND status='confirming'`).run(draftId);
  }
}

async function confirmLogInner(db: ReturnType<typeof getDb>, draftId: number, formData: FormData) {
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
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
    if (personId) {
      db.prepare(
        `UPDATE people SET last_touch=?, last_touch_note=NULL, updated_at=datetime('now') WHERE id=? AND (last_touch IS NULL OR last_touch < ?)`
      ).run(date, personId, date);
    }
    if (companyId) {
      db.prepare(
        `UPDATE companies SET last_touch=?, last_touch_note=NULL, updated_at=datetime('now') WHERE id=? AND (last_touch IS NULL OR last_touch < ?)`
      ).run(date, companyId, date);
    }
    const next = str(formData, `entry_next_${i}`);
    if (next && personId) db.prepare(`UPDATE people SET next_action=? WHERE id=?`).run(next, personId);
    if (!firstTarget) firstTarget = companySlug ? `/companies/${companySlug}` : `/people/${slug}`;
  }

  // Resolved action items: checkbox resolve_<id>
  for (const [key] of formData.entries()) {
    const m = key.match(/^resolve_(\d+)$/);
    if (!m) continue;
    db.prepare(`UPDATE action_items SET status='done', completed_at=date('now','localtime') WHERE id=?`).run(Number(m[1]));
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
  revalidatePath("/", "layout");
  if (skipped) redirect(`/log/${draftId}?skipped=${skipped}`);
  redirect(firstTarget ?? "/");
}
