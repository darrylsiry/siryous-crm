"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import { buildIntakePrompt, buildIntakeResearchPrompt, extractJsonWithRepair, TOOLS, type IntakeAnalysis } from "./ai";
import { noteProgress, runWithProgress } from "./progress";
import { slugify } from "./slug";
import { DEFAULT_CADENCE } from "./db";
import { parseDueDate } from "./dates.mjs";

export async function analyzeIntake(formData: FormData) {
  const raw = String(formData.get("raw_text") ?? "").trim();
  const research = !!formData.get("research");
  if (raw.length < 40) return;
  const db = getDb();
  const draftId = Number(
    db
      .prepare(`INSERT INTO intake_drafts (raw_text, status) VALUES (?, 'analyzing')`)
      .run(raw).lastInsertRowid
  );
  after(async () => {
    try {
      // Step 1 (optional, Claude + web): research digest. A failure here is
      // not fatal — the analysis proceeds from the paste alone and says so.
      let digest: string | null = null;
      if (research) {
        try {
          digest = (await runWithProgress("intake", draftId, buildIntakeResearchPrompt(raw), {
            allowedTools: TOOLS.web,
            timeoutMs: 300_000,
          })).trim() || null;
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
      const text = await runWithProgress("intake", draftId, buildIntakePrompt(raw, digest), { json: true });
      const analysis = (await extractJsonWithRepair(text)) as IntakeAnalysis;
      if (!analysis?.person?.name) throw new Error("The analysis had no person name.");
      if (research && !digest) {
        analysis.confidence_flags = [
          "Web research was unavailable for this run — nothing here was verified online.",
          ...(analysis.confidence_flags ?? []),
        ];
      }
      db.prepare(`UPDATE intake_drafts SET result_json=?, status='ready' WHERE id=?`).run(
        JSON.stringify(analysis),
        draftId
      );
    } catch (err) {
      db.prepare(`UPDATE intake_drafts SET status='error', error=? WHERE id=?`).run(
        err instanceof Error ? err.message : String(err),
        draftId
      );
    }
  });
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

async function confirmIntakeInner(db: ReturnType<typeof getDb>, draftId: number, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

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
  // Refuse to silently create a second profile for a name that already exists
  // unless the reviewer explicitly opted in on the review screen.
  let slug = slugify(name);
  if (db.prepare(`SELECT 1 FROM people WHERE slug=?`).get(slug)) {
    if (!formData.get("allow_duplicate")) redirect(`/intake/${draftId}?duplicate=${encodeURIComponent(slug)}`);
    slug = `${slug}-${draftId}`;
  }
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
