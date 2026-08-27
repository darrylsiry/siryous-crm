"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { slugify } from "./slug";
import { getDb, STATUS, STAGES, KINDS, BUCKETS, DEFAULT_CADENCE } from "./db";
import { isIsoDate, parseDueDate } from "./dates.mjs";

/** Keep a form-supplied enum value only if it's one we know; else the fallback. */
const oneOf = (value: FormDataEntryValue | null, allowed: Record<string, unknown>, fallback: string) => {
  const v = String(value ?? "");
  return Object.hasOwn(allowed, v) ? v : fallback;
};

function touch(table: "people" | "companies", id: number) {
  getDb().prepare(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

export async function completeActionItem(id: number) {
  getDb()
    .prepare(`UPDATE action_items SET status='done', completed_at=date('now','localtime') WHERE id=?`)
    .run(id);
  revalidatePath("/");
  revalidatePath("/actions");
}

export async function reopenActionItem(id: number) {
  getDb()
    .prepare(`UPDATE action_items SET status='open', completed_at=NULL WHERE id=?`)
    .run(id);
  revalidatePath("/");
  revalidatePath("/actions");
}

export async function addActionItem(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const bucket = oneOf(formData.get("bucket"), BUCKETS, "this_week");
  const due = String(formData.get("due_label") ?? "").trim() || null;
  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const dueDate = isIsoDate(dueDateRaw) ? dueDateRaw : parseDueDate(due);
  const personId = Number(formData.get("person_id")) || null;
  const companyId = Number(formData.get("company_id")) || null;
  getDb()
    .prepare(
      `INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id) VALUES (?,?,?,?,?,?)`
    )
    .run(bucket, due ?? dueDate, dueDate, title, personId, companyId);
  revalidatePath("/");
  revalidatePath("/actions");
}

export async function addInteraction(formData: FormData) {
  const db = getDb();
  const personId = Number(formData.get("person_id")) || null;
  const companyId = Number(formData.get("company_id")) || null;
  const date = String(formData.get("date") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim() || null;
  const summary = String(formData.get("summary") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !summary || (!personId && !companyId)) return;
  db.prepare(
    `INSERT INTO interactions (person_id, company_id, date, channel, summary) VALUES (?,?,?,?,?)`
  ).run(personId, companyId, date, channel, summary);
  // bump last_touch if this interaction is the newest
  if (personId) {
    db.prepare(
      `UPDATE people SET last_touch = ?, last_touch_note = NULL, updated_at = datetime('now')
       WHERE id = ? AND (last_touch IS NULL OR last_touch < ?)`
    ).run(date, personId, date);
  }
  if (companyId) {
    db.prepare(
      `UPDATE companies SET last_touch = ?, last_touch_note = NULL, updated_at = datetime('now')
       WHERE id = ? AND (last_touch IS NULL OR last_touch < ?)`
    ).run(date, companyId, date);
  }
  revalidatePath("/", "layout");
}

export async function updateStatus(formData: FormData) {
  const table = formData.get("entity") === "company" ? "companies" : "people";
  const id = Number(formData.get("id"));
  const statusKey = oneOf(formData.get("status_key"), STATUS, "new");
  const statusNote = String(formData.get("status_note") ?? "").trim() || null;
  const nextAction = String(formData.get("next_action") ?? "").trim() || null;
  if (!id) return;
  getDb()
    .prepare(
      `UPDATE ${table} SET status_key=?, status_note=?, next_action=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(statusKey, statusNote, nextAction, id);
  if (table === "people") {
    // A person with no cadence picks up the new status's default so they show in Keep Warm.
    getDb()
      .prepare(`UPDATE people SET cadence_days=? WHERE id=? AND cadence_days IS NULL`)
      .run(DEFAULT_CADENCE[statusKey] ?? null, id);
  }
  revalidatePath("/", "layout");
}

export async function updateSection(formData: FormData) {
  const table = formData.get("entity") === "company" ? "companies" : "people";
  const id = Number(formData.get("id"));
  const column = String(formData.get("column"));
  const allowed = new Set([
    "relationship_intel",
    "business_context",
    "engagement_strategy",
    "notes",
    "extra_sections",
  ]);
  if (!id || !allowed.has(column)) return;
  const value = String(formData.get("value") ?? "").trim() || null;
  getDb().prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(value, id);
  touch(table, id);
  revalidatePath("/", "layout");
}

export async function updateSnapshot(formData: FormData) {
  const entity = formData.get("entity") === "company" ? "companies" : "people";
  const id = Number(formData.get("id"));
  if (!id) return;
  const db = getDb();
  if (entity === "people") {
    const cadenceRaw = String(formData.get("cadence_days") ?? "").trim();
    db.prepare(
      `UPDATE people SET role_title=?, location=?, email=?, phone=?, linkedin=?, company_note=?, relationship_strength=?, cadence_days=?, tags=?, updated_at=datetime('now') WHERE id=?`
    ).run(
      str(formData, "role_title"),
      str(formData, "location"),
      str(formData, "email"),
      str(formData, "phone"),
      str(formData, "linkedin"),
      str(formData, "company_note"),
      str(formData, "relationship_strength"),
      cadenceRaw ? Number(cadenceRaw) || null : null,
      str(formData, "tags"),
      id
    );
  } else {
    db.prepare(
      `UPDATE companies SET industry=?, size=?, hq=?, website=?, revenue_stage=?, updated_at=datetime('now') WHERE id=?`
    ).run(
      str(formData, "industry"),
      str(formData, "size"),
      str(formData, "hq"),
      str(formData, "website"),
      str(formData, "revenue_stage"),
      id
    );
  }
  revalidatePath("/", "layout");
}

function str(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v || null;
}


export async function createPerson(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const db = getDb();
  const slug = slugify(name);
  if (db.prepare(`SELECT 1 FROM people WHERE slug=?`).get(slug)) {
    // Same rule as Intake and the MCP server: never silently create a twin.
    redirect(`/people?duplicate=${encodeURIComponent(slug)}`);
  }
  const companyId = Number(formData.get("company_id")) || null;
  const statusKey = oneOf(formData.get("status_key"), STATUS, "new");
  try {
    db.prepare(
      `INSERT INTO people (slug, name, status_key, role_title, company_id, email, linkedin, next_action, cadence_days)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      slug,
      name,
      statusKey,
      str(formData, "role_title"),
      companyId,
      str(formData, "email"),
      str(formData, "linkedin"),
      str(formData, "next_action"),
      DEFAULT_CADENCE[statusKey] ?? null
    );
  } catch (err) {
    if (/UNIQUE/.test(String(err))) redirect(`/people?duplicate=${encodeURIComponent(slug)}`);
    throw err;
  }
  revalidatePath("/", "layout");
  redirect(`/people/${slug}`);
}

export async function setOpportunityStage(formData: FormData) {
  const id = Number(formData.get("id"));
  const stage = String(formData.get("stage") ?? "");
  if (!id || !Object.hasOwn(STAGES, stage)) return;
  getDb()
    .prepare(`UPDATE opportunities SET stage=?, updated_at=datetime('now') WHERE id=?`)
    .run(stage, id);
  revalidatePath("/", "layout");
}

export async function updateOpportunity(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!id) return;
  const current = getDb().prepare(`SELECT name, stage FROM opportunities WHERE id=?`).get(id) as { name: string; stage: string } | undefined;
  if (!current) return;
  getDb()
    .prepare(
      `UPDATE opportunities SET name=?, kind=?, stage=?, value_note=?, priority=?, next_step=?, notes=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      str(formData, "name") ?? current.name,
      oneOf(formData.get("kind"), KINDS, "engagement"),
      oneOf(formData.get("stage"), STAGES, current.stage),
      str(formData, "value_note"),
      Number(formData.get("priority")) || 2,
      str(formData, "next_step"),
      str(formData, "notes"),
      id
    );
  revalidatePath("/", "layout");
}

export async function createOpportunity(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  getDb()
    .prepare(
      `INSERT INTO opportunities (name, kind, stage, person_id, company_id, value_note, priority, next_step)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      name,
      oneOf(formData.get("kind"), KINDS, "engagement"),
      oneOf(formData.get("stage"), STAGES, "identified"),
      Number(formData.get("person_id")) || null,
      Number(formData.get("company_id")) || null,
      str(formData, "value_note"),
      Number(formData.get("priority")) || 2,
      str(formData, "next_step")
    );
  revalidatePath("/", "layout");
}

export async function deleteOpportunity(id: number) {
  getDb().prepare(`DELETE FROM opportunities WHERE id=?`).run(id);
  revalidatePath("/", "layout");
}

export async function createCompany(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const db = getDb();
  const slug = slugify(name);
  if (db.prepare(`SELECT 1 FROM companies WHERE slug=?`).get(slug)) {
    redirect(`/companies?duplicate=${encodeURIComponent(slug)}`);
  }
  try {
    db.prepare(
      `INSERT INTO companies (slug, name, status_key, industry, website, next_action) VALUES (?,?,?,?,?,?)`
    ).run(
      slug,
      name,
      oneOf(formData.get("status_key"), STATUS, "new"),
      str(formData, "industry"),
      str(formData, "website"),
      str(formData, "next_action")
    );
  } catch (err) {
    if (/UNIQUE/.test(String(err))) redirect(`/companies?duplicate=${encodeURIComponent(slug)}`);
    throw err;
  }
  revalidatePath("/", "layout");
  redirect(`/companies/${slug}`);
}
