"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import type { IntakeAnalysis } from "./ai";
import { insertIntakeDraft, processIntakeDraft } from "./drafts";
import { IntakeAnalysisSchema } from "./schemas";
import { slugify } from "./slug";
import { DEFAULT_CADENCE } from "./db";
import { parseDueDate } from "./dates.mjs";

export async function analyzeIntake(formData: FormData) {
  const raw = String(formData.get("raw_text") ?? "").trim();
  const research = !!formData.get("research");
  // Too little to analyze: say so on the page instead of silently reloading.
  if (raw.length < 40) redirect("/intake?short=1");
  const draftId = insertIntakeDraft(getDb(), raw);
  after(() => processIntakeDraft(draftId, research));
  redirect(`/intake/${draftId}`);
}

export async function discardIntake(id: number) {
  getDb().prepare(`UPDATE intake_drafts SET status='discarded' WHERE id=?`).run(id);
  revalidatePath("/intake");
  redirect("/intake");
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

export async function confirmIntake(formData: FormData) {
  const db = getDb();
  const draftId = Number(formData.get("draft_id"));
  if (!draftId) return;
  // Claim the draft atomically so a double-click can't create everything twice;
  // release the claim if anything short of "confirmed" happens.
  const claimed = db
    .prepare(`UPDATE intake_drafts SET status='confirming' WHERE id=? AND status='ready'`)
    .run(draftId).changes;
  if (!claimed) redirect(`/intake/${draftId}`);
  try {
    await confirmIntakeInner(db, draftId, formData);
  } finally {
    db.prepare(`UPDATE intake_drafts SET status='ready' WHERE id=? AND status='confirming'`).run(draftId);
  }
}

/**
 * Write the review form's editable fields back onto the draft's analysis JSON
 * so that a redirect back to the review page (duplicate name) shows what the
 * reviewer typed, not the model's original answer. Only the fields the form
 * renders as inputs are mapped; suggested connections / actions are kept as
 * they were. The result is re-validated with IntakeAnalysisSchema and the
 * draft is left untouched if it somehow fails.
 */
function saveReviewEdits(db: ReturnType<typeof getDb>, draftId: number, formData: FormData) {
  const row = db.prepare(`SELECT result_json FROM intake_drafts WHERE id=?`).get(draftId) as
    | { result_json: string | null }
    | undefined;
  if (!row?.result_json) return;
  let original: IntakeAnalysis;
  try {
    original = JSON.parse(row.result_json) as IntakeAnalysis;
  } catch {
    return;
  }

  // Company choice: the radio decides which of existing_company_slug /
  // new_company the page will pre-select on re-render.
  const companyName = str(formData, "company_name");
  const formCompany = companyName
    ? {
        name: companyName,
        industry: str(formData, "company_industry"),
        website: str(formData, "company_website"),
        hq: str(formData, "company_hq"),
        business_context_md: str(formData, "company_context"),
      }
    : null;
  const companyMode = String(formData.get("company_mode") ?? "none");
  let existingCompanySlug: string | null = null;
  let newCompany = original.person?.new_company ?? null;
  if (companyMode === "existing") {
    const c = db
      .prepare(`SELECT slug FROM companies WHERE id=?`)
      .get(Number(formData.get("existing_company_id")) || 0) as { slug: string } | undefined;
    existingCompanySlug = c?.slug ?? null;
    if (formCompany) newCompany = formCompany;
  } else if (companyMode === "new") {
    newCompany = formCompany;
  } else {
    newCompany = null;
  }

  // The interaction block is only rendered when the analysis found one; keep
  // its text as typed (falling back to the original if it was blanked).
  const interaction = original.interaction
    ? {
        date: str(formData, "interaction_date"),
        channel: str(formData, "interaction_channel"),
        summary_md: str(formData, "interaction_summary") ?? original.interaction.summary_md,
      }
    : null;

  const candidate = {
    ...original,
    person: {
      ...original.person,
      name: String(formData.get("name") ?? "").trim() || original.person?.name,
      role_title: str(formData, "role_title"),
      location: str(formData, "location"),
      email: str(formData, "email"),
      linkedin: str(formData, "linkedin"),
      tags: str(formData, "tags"),
      status_suggestion: str(formData, "status_key") ?? original.person?.status_suggestion ?? "new",
      status_note: str(formData, "status_note"),
      relationship_strength: str(formData, "relationship_strength"),
      cadence_days: str(formData, "cadence_days"),
      next_action: str(formData, "next_action"),
      relationship_intel_md: str(formData, "relationship_intel"),
      business_context_md: str(formData, "business_context"),
      engagement_strategy_md: str(formData, "engagement_strategy"),
      notes_md: str(formData, "notes"),
      existing_company_slug: existingCompanySlug,
      new_company: newCompany,
    },
    interaction,
  };
  const parsed = IntakeAnalysisSchema.safeParse(candidate);
  if (!parsed.success) return;
  db.prepare(`UPDATE intake_drafts SET result_json=? WHERE id=?`).run(JSON.stringify(parsed.data), draftId);
}

async function confirmIntakeInner(db: ReturnType<typeof getDb>, draftId: number, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  // --- duplicate guard (before anything is written) ---
  // Refuse to silently create a second profile for a name that already exists
  // unless the reviewer explicitly opted in on the review screen. The bounce
  // back to the review page re-renders from result_json, so the reviewer's
  // edits are written there first and survive the round trip.
  let slug = slugify(name);
  const slugTaken = !!db.prepare(`SELECT 1 FROM people WHERE slug=?`).get(slug);
  if (slugTaken && !formData.get("allow_duplicate")) {
    saveReviewEdits(db, draftId, formData);
    redirect(`/intake/${draftId}?duplicate=${encodeURIComponent(slug)}`);
  }
  if (slugTaken) slug = `${slug}-${draftId}`;

  // --- company ---
  let companyId: number | null = null;
  const companyMode = String(formData.get("company_mode") ?? "none");
  if (companyMode === "existing") {
    companyId = Number(formData.get("existing_company_id")) || null;
  } else if (companyMode === "new") {
    const cname = str(formData, "company_name");
    if (cname) {
      let cslug = slugify(cname);
      const exists = db.prepare(`SELECT id FROM companies WHERE slug=?`).get(cslug) as { id: number } | undefined;
      if (exists) {
        companyId = exists.id;
      } else {
        companyId = Number(
          db
            .prepare(
              `INSERT INTO companies (slug, name, status_key, industry, website, hq, business_context) VALUES (?,?,?,?,?,?,?)`
            )
            .run(
              cslug,
              cname,
              "new",
              str(formData, "company_industry"),
              str(formData, "company_website"),
              str(formData, "company_hq"),
              str(formData, "company_context")
            ).lastInsertRowid
        );
      }
    }
  }

  // --- person ---
  const cadenceRaw = String(formData.get("cadence_days") ?? "").trim();
  db.prepare(
    `INSERT INTO people (slug, name, status_key, status_note, role_title, company_id, location, email, phone,
       linkedin, relationship_strength, tags, cadence_days, next_action,
       relationship_intel, business_context, engagement_strategy, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    slug,
    name,
    String(formData.get("status_key") ?? "new"),
    str(formData, "status_note"),
    str(formData, "role_title"),
    companyId,
    str(formData, "location"),
    str(formData, "email"),
    null,
    str(formData, "linkedin"),
    str(formData, "relationship_strength"),
    str(formData, "tags"),
    cadenceRaw ? Number(cadenceRaw) || null : DEFAULT_CADENCE[String(formData.get("status_key") ?? "new")] ?? null,
    str(formData, "next_action"),
    str(formData, "relationship_intel"),
    str(formData, "business_context"),
    str(formData, "engagement_strategy"),
    str(formData, "notes")
  );
  const personId = (db.prepare(`SELECT id FROM people WHERE slug=?`).get(slug) as { id: number }).id;

  // --- interaction described in the paste (optional, sets last_touch) ---
  if (formData.get("interaction_include")) {
    const isum = str(formData, "interaction_summary");
    if (isum) {
      const idateRaw = String(formData.get("interaction_date") ?? "").trim();
      const idate = /^\d{4}-\d{2}-\d{2}$/.test(idateRaw)
        ? idateRaw
        : new Date().toLocaleDateString("sv-SE");
      db.prepare(`INSERT INTO interactions (person_id, company_id, date, channel, summary) VALUES (?,?,?,?,?)`).run(
        personId,
        companyId,
        idate,
        str(formData, "interaction_channel"),
        isum
      );
      db.prepare(`UPDATE people SET last_touch=?, last_touch_note=NULL, updated_at=datetime('now') WHERE id=? AND (last_touch IS NULL OR last_touch < ?)`).run(
        idate,
        personId,
        idate
      );
      if (companyId) {
        db.prepare(`UPDATE companies SET last_touch=?, last_touch_note=NULL, updated_at=datetime('now') WHERE id=? AND (last_touch IS NULL OR last_touch < ?)`).run(
          idate,
          companyId,
          idate
        );
      }
    }
  }

  // --- accepted connections (checkboxes named conn_<slug>, labels in conn_label_<slug>) ---
  for (const [key] of formData.entries()) {
    if (!key.startsWith("conn_") || key.startsWith("conn_label_")) continue;
    const otherSlug = key.slice(5);
    const other = db.prepare(`SELECT id FROM people WHERE slug=?`).get(otherSlug) as { id: number } | undefined;
    if (other) {
      db.prepare(`INSERT INTO connections (from_person_id, to_person_id, label) VALUES (?,?,?)`).run(
        personId,
        other.id,
        str(formData, `conn_label_${otherSlug}`) ?? "related"
      );
    }
  }

  // --- accepted action items (checkboxes action_<i>, fields action_title_<i>, action_bucket_<i>, action_due_<i>) ---
  for (const [key] of formData.entries()) {
    const m = key.match(/^action_(\d+)$/);
    if (!m) continue;
    const i = m[1];
    const title = str(formData, `action_title_${i}`);
    if (!title) continue;
    const due = str(formData, `action_due_${i}`);
    db.prepare(`INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id) VALUES (?,?,?,?,?,?)`).run(
      String(formData.get(`action_bucket_${i}`) ?? "this_week"),
      due,
      parseDueDate(due),
      title,
      personId,
      companyId
    );
  }

  db.prepare(`UPDATE intake_drafts SET status='confirmed' WHERE id=?`).run(draftId);
  revalidatePath("/", "layout");
  redirect(`/people/${slug}`);
}
