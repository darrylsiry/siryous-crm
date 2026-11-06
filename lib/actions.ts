"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, STATUS, STAGES, KINDS, BUCKETS, DEFAULT_CADENCE } from "./db";
import { isIsoDate, parseDueDate, todayLocal } from "./dates.mjs";
import { applyStatusCadence, bumpLastTouch, markActionDone, profilePath, slugFor } from "./rules.mjs";
import { localPath } from "./params";

/** Keep a form-supplied enum value only if it's one we know; else the fallback. */
const oneOf = (value: FormDataEntryValue | null, allowed: Record<string, unknown>, fallback: string) => {
  const v = String(value ?? "");
  return Object.hasOwn(allowed, v) ? v : fallback;
};

function touch(table: "people" | "companies", id: number) {
  getDb().prepare(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

export async function completeActionItem(id: number) {
  markActionDone(getDb(), id);
  revalidatePath("/");
  revalidatePath("/actions");
}

export async function reopenActionItem(id: number) {
  getDb()
    .prepare(`UPDATE action_items SET status='open', completed_at=NULL WHERE id=?`)
    .run(id);
  revalidatePath("/", "layout");
}

/** Whose next step a to-do repeats, so ticking it can offer to clear that too. */
export type NextStepRef = { entity: "person" | "company"; id: number; name: string; text: string };

/**
 * Tick a to-do done from a list (the toast that follows offers Undo). Says
 * whether the to-do repeats its person's or company's next step word for word.
 */
export async function tickActionItem(id: number): Promise<{ title: string; nextStep: NextStepRef | null } | null> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.title, p.id AS pid, p.name AS pname, p.next_action AS pnext, c.id AS cid, c.name AS cname, c.next_action AS cnext
       FROM action_items a LEFT JOIN people p ON p.id = a.person_id LEFT JOIN companies c ON c.id = a.company_id
       WHERE a.id = ? AND a.status = 'open'`
    )
    .get(id) as
    | { title: string; pid: number | null; pname: string | null; pnext: string | null; cid: number | null; cname: string | null; cnext: string | null }
    | undefined;
  if (!row) return null;
  markActionDone(db, id);
  revalidatePath("/", "layout");
  const same = (s: string | null) => !!s && sameText(s, row.title);
  const nextStep: NextStepRef | null =
    row.pid && same(row.pnext)
      ? { entity: "person", id: row.pid, name: row.pname ?? "", text: row.pnext! }
      : row.cid && same(row.cnext)
        ? { entity: "company", id: row.cid, name: row.cname ?? "", text: row.cnext! }
        : null;
  return { title: row.title, nextStep };
}

/** Clear a person's or company's next step, only if it still reads `expected`. */
export async function clearNextStep(ref: NextStepRef) {
  const table = ref.entity === "company" ? "companies" : "people";
  const db = getDb();
  const row = db.prepare(`SELECT next_action FROM ${table} WHERE id=?`).get(ref.id) as { next_action: string | null } | undefined;
  if (!row || !sameText(row.next_action, ref.text)) return;
  db.prepare(`UPDATE ${table} SET next_action=NULL, updated_at=datetime('now') WHERE id=?`).run(ref.id);
  revalidatePath("/", "layout");
}

export async function deleteActionItem(id: number) {
  if (!id) return;
  getDb().prepare(`DELETE FROM action_items WHERE id=?`).run(id);
  revalidatePath("/", "layout");
}

/**
 * After an interaction disappears, the contact's last_touch may point at a date
 * that no longer has an interaction behind it. Only recompute when the deleted
 * date could have been the one that set it (a last_touch newer than every
 * interaction was set by hand and is left alone). A person's imported
 * "connected on" date is a touch with no interaction behind it, so last_touch
 * never drops below it.
 */
function recomputeLastTouch(table: "people" | "companies", fk: "person_id" | "company_id", id: number, deletedDate: string) {
  const db = getDb();
  const floorCol = table === "people" ? "connected_on" : "NULL";
  const row = db.prepare(`SELECT last_touch, ${floorCol} AS floor FROM ${table} WHERE id=?`).get(id) as
    | { last_touch: string | null; floor: string | null }
    | undefined;
  if (!row || !row.last_touch || deletedDate < row.last_touch) return;
  const newest = (
    db
      .prepare(
        `SELECT MAX(date) AS d FROM interactions WHERE ${fk} = ? AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
      )
      .get(id) as { d: string | null } | undefined
  )?.d;
  const dates = [newest, row.floor].filter((d): d is string => isIsoDate(d)).sort();
  const next = dates.at(-1) ?? null;
  if (next === row.last_touch) return;
  db.prepare(`UPDATE ${table} SET last_touch = ?, last_touch_note = NULL, updated_at = datetime('now') WHERE id = ?`).run(next, id);
}

export async function deleteInteraction(id: number) {
  if (!id) return;
  const db = getDb();
  const row = db.prepare(`SELECT person_id, company_id, date FROM interactions WHERE id=?`).get(id) as
    | { person_id: number | null; company_id: number | null; date: string }
    | undefined;
  if (!row) return;
  db.transaction(() => {
    db.prepare(`DELETE FROM interactions WHERE id=?`).run(id);
    if (row.person_id) recomputeLastTouch("people", "person_id", row.person_id, row.date);
    if (row.company_id) recomputeLastTouch("companies", "company_id", row.company_id, row.date);
  })();
  revalidatePath("/", "layout");
}

/**
 * Permanently remove a person. Foreign keys cascade their interactions and
 * connections and null them out of opportunities and outreach; their action
 * items and briefs would be orphaned nonsense without the person, so those go too.
 */
export async function deletePerson(id: number) {
  if (!id) return;
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM people WHERE id=?`).get(id)) return;
  db.transaction(() => {
    // Their interactions go with them, so a company they were logged against may lose its last touch.
    const companies = db
      .prepare(`SELECT company_id, MAX(date) AS d FROM interactions WHERE person_id=? AND company_id IS NOT NULL GROUP BY company_id`)
      .all(id) as { company_id: number; d: string }[];
    db.prepare(`DELETE FROM action_items WHERE person_id=?`).run(id);
    db.prepare(`DELETE FROM briefs WHERE person_id=?`).run(id);
    // Earlier text of their sections that Claude Desktop replaced goes too (no foreign key to do it).
    db.prepare(`DELETE FROM section_history WHERE entity='person' AND entity_id=?`).run(id);
    db.prepare(`DELETE FROM people WHERE id=?`).run(id);
    for (const c of companies) recomputeLastTouch("companies", "company_id", c.company_id, c.d);
  })();
  revalidatePath("/", "layout");
  redirect("/people");
}

/**
 * Permanently remove a company. Its people stay (company_id nulled by the FK),
 * as do interactions logged on those people; interactions and action items
 * that were only ever attached to the company are deleted.
 */
export async function deleteCompany(id: number) {
  if (!id) return;
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM companies WHERE id=?`).get(id)) return;
  db.transaction(() => {
    db.prepare(`DELETE FROM interactions WHERE company_id=? AND person_id IS NULL`).run(id);
    db.prepare(`DELETE FROM action_items WHERE company_id=? AND person_id IS NULL`).run(id);
    db.prepare(`DELETE FROM section_history WHERE entity='company' AND entity_id=?`).run(id);
    db.prepare(`DELETE FROM companies WHERE id=?`).run(id);
  })();
  revalidatePath("/", "layout");
  redirect("/companies");
}

/** The bucket whose items are meant to carry a date ("Dated — this week & upcoming"). */
const DATED_BUCKET = "this_week";

export type FormResult = { ok: boolean; message: string } | null;

/**
 * Add a to-do. One "due" box takes a date or free text ("Fri 7/25", "ASAP");
 * a dated bucket needs a date the box can read. The older two-field form
 * (due_date + due_label) is still accepted.
 */
export async function addActionItem(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Say what needs doing." };
  const bucket = oneOf(formData.get("bucket"), BUCKETS, DATED_BUCKET);
  const typed = String(formData.get("due") ?? formData.get("due_label") ?? "").trim() || null;
  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const dueDate = isIsoDate(dueDateRaw) ? dueDateRaw : isIsoDate(typed) ? typed : parseDueDate(typed);
  if (bucket === DATED_BUCKET && !dueDate) {
    return {
      ok: false,
      message: typed
        ? `"${typed}" isn't a date I can read. Try "Fri 7/25", "Nov 12" or pick a date, or file it under another group.`
        : "This group is for dated to-dos: give it a due date, or pick another group.",
    };
  }
  const personId = Number(formData.get("person_id")) || null;
  const companyId = Number(formData.get("company_id")) || null;
  getDb()
    .prepare(
      `INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id) VALUES (?,?,?,?,?,?)`
    )
    .run(bucket, typed ?? dueDate, dueDate, title, personId, companyId);
  revalidatePath("/", "layout");
  return { ok: true, message: `Added: ${title}` };
}

/**
 * Edit a to-do's title, group, person or due date (re-date a late one). A
 * blank date clears it; a quick-date button ("Tomorrow") sends quick_due.
 */
export async function updateActionItem(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!id) return;
  const db = getDb();
  const current = db.prepare(`SELECT title, bucket, due_date, due_label, person_id FROM action_items WHERE id=?`).get(id) as
    | { title: string; bucket: string; due_date: string | null; due_label: string | null; person_id: number | null }
    | undefined;
  if (!current) return;
  const quick = String(formData.get("quick_due") ?? "").trim();
  const dueRaw = isIsoDate(quick) ? quick : String(formData.get("due_date") ?? "").trim();
  const dueDate = isIsoDate(dueRaw) ? dueRaw : null;
  const personId = formData.has("person_id") ? Number(formData.get("person_id")) || null : current.person_id;
  db.prepare(`UPDATE action_items SET title=?, bucket=?, due_date=?, due_label=?, person_id=? WHERE id=?`).run(
    str(formData, "title") ?? current.title,
    oneOf(formData.get("bucket"), BUCKETS, current.bucket),
    dueDate,
    // A free-text label ("~late summer") stays until the date itself changes.
    dueDate === current.due_date ? current.due_label : dueDate,
    personId,
    id
  );
  revalidatePath("/", "layout");
}

/**
 * The quick way to record a touch from a list or a profile: a channel, a
 * date, an optional line of what happened and an optional next step (with a
 * date, the next step also becomes a to-do). Saved as typed, no AI.
 */
export async function logTouch(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const db = getDb();
  const personId = Number(formData.get("person_id")) || null;
  const companyId = Number(formData.get("company_id")) || null;
  if (!personId && !companyId) return { ok: false, message: "Nobody to log this on." };
  const date = String(formData.get("date") ?? "").trim();
  if (!isIsoDate(date)) return { ok: false, message: "Pick the date it happened." };
  if (date > todayLocal()) return { ok: false, message: "That date is in the future; log a touch once it has happened." };
  const channel = String(formData.get("channel") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim();
  const nextStep = String(formData.get("next_step") ?? "").trim() || null;
  const nextDueRaw = String(formData.get("next_due") ?? "").trim();
  const nextDue = isIsoDate(nextDueRaw) ? nextDueRaw : null;
  const name =
    (personId && (db.prepare(`SELECT name FROM people WHERE id=?`).get(personId) as { name: string } | undefined)?.name) ||
    (companyId && (db.prepare(`SELECT name FROM companies WHERE id=?`).get(companyId) as { name: string } | undefined)?.name) ||
    "";
  db.transaction(() => {
    db.prepare(`INSERT INTO interactions (person_id, company_id, date, channel, summary) VALUES (?,?,?,?,?)`).run(
      personId,
      companyId,
      date,
      channel,
      note || (channel ? `${channel}.` : "Touch.")
    );
    if (personId) bumpLastTouch(db, "people", personId, date);
    if (companyId) bumpLastTouch(db, "companies", companyId, date);
    if (nextStep) {
      const table = personId ? "people" : "companies";
      db.prepare(`UPDATE ${table} SET next_action=?, updated_at=datetime('now') WHERE id=?`).run(nextStep, personId ?? companyId);
      if (nextDue) {
        db.prepare(
          `INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id, source) VALUES (?,?,?,?,?,?,?)`
        ).run(DATED_BUCKET, nextDue, nextDue, nextStep, personId, personId ? null : companyId, "next step");
      }
    }
  })();
  revalidatePath("/", "layout");
  const what = channel ? `${channel.toLowerCase()} with ${name}` : `a touch with ${name}`;
  return {
    ok: true,
    message: `Logged ${what}${date === todayLocal() ? " today" : ` on ${date}`}${nextStep && nextDue ? " · next step added to your to-dos" : ""}`,
  };
}

/** Set a deal's next step from the Dashboard, without opening the board. */
export async function setDealNextStep(formData: FormData) {
  const id = Number(formData.get("id"));
  const nextStep = str(formData, "next_step");
  if (!id || !nextStep) return;
  getDb().prepare(`UPDATE opportunities SET next_step=?, updated_at=datetime('now') WHERE id=?`).run(nextStep, id);
  revalidatePath("/", "layout");
}

export async function addInteraction(formData: FormData) {
  const db = getDb();
  const personId = Number(formData.get("person_id")) || null;
  const companyId = Number(formData.get("company_id")) || null;
  const date = String(formData.get("date") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim() || null;
  const summary = String(formData.get("summary") ?? "").trim();
  if (!isIsoDate(date) || !summary || (!personId && !companyId)) return;
  db.prepare(
    `INSERT INTO interactions (person_id, company_id, date, channel, summary) VALUES (?,?,?,?,?)`
  ).run(personId, companyId, date, channel, summary);
  if (personId) bumpLastTouch(db, "people", personId, date);
  if (companyId) bumpLastTouch(db, "companies", companyId, date);
  revalidatePath("/", "layout");
}

/**
 * Optimistic concurrency for the profile/opportunity edit forms: the form carries
 * the row's updated_at as rendered; if the DB has moved on since (e.g. Claude
 * wrote to the record via the MCP server), the write is skipped and the caller
 * redirects back with ?stale=1. Absent field = legacy form, no check.
 */
function isStale(table: "people" | "companies" | "opportunities", id: number, formData: FormData): boolean {
  const expected = formData.get("updated_at");
  if (expected == null) return false;
  const row = getDb().prepare(`SELECT updated_at FROM ${table} WHERE id=?`).get(id) as { updated_at: string | null } | undefined;
  if (!row) return false;
  return (row.updated_at ?? "") !== String(expected);
}

function profileHref(table: "people" | "companies", id: number): string {
  const row = getDb().prepare(`SELECT slug FROM ${table} WHERE id=?`).get(id) as { slug: string } | undefined;
  return row ? profilePath(table, row.slug) : `/${table}`;
}

export async function updateStatus(formData: FormData) {
  const table = formData.get("entity") === "company" ? "companies" : "people";
  const id = Number(formData.get("id"));
  const statusKey = oneOf(formData.get("status_key"), STATUS, "new");
  const statusNote = String(formData.get("status_note") ?? "").trim() || null;
  const nextAction = String(formData.get("next_action") ?? "").trim() || null;
  if (!id) return;
  if (isStale(table, id, formData)) redirect(`${profileHref(table, id)}?stale=1`);
  const db = getDb();
  const before = db.prepare(`SELECT status_key FROM ${table} WHERE id=?`).get(id) as { status_key: string } | undefined;
  if (!before) return;
  // "Also add to my to-dos": the next step becomes a to-do too, dated if a date was given.
  const todoDueRaw = String(formData.get("todo_due") ?? "").trim();
  const todoDue = isIsoDate(todoDueRaw) ? todoDueRaw : null;
  const alsoTodo = nextAction && formData.get("also_todo") === "on";
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET status_key=?, status_note=?, next_action=?, updated_at=datetime('now') WHERE id=?`).run(
      statusKey,
      statusNote,
      nextAction,
      id
    );
    if (table === "people") applyStatusCadence(db, id, before.status_key, statusKey, DEFAULT_CADENCE);
    if (alsoTodo) {
      db.prepare(
        `INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id, source) VALUES (?,?,?,?,?,?,?)`
      ).run(
        // Undated, it shows on the Dashboard under "with no date" until it gets one.
        DATED_BUCKET,
        todoDue,
        todoDue,
        nextAction,
        table === "people" ? id : null,
        table === "companies" ? id : null,
        "next step"
      );
    }
  })();
  revalidatePath("/", "layout");
}

/**
 * Change just the status, from the badge on a list row or a profile header.
 * The note and next action are left alone (the full StatusEditor edits those).
 * Returns rather than redirects so the picker can show the outcome inline.
 */
export async function setStatus(
  entity: "person" | "company",
  id: number,
  statusKey: string,
  updatedAt: string | null
): Promise<{ ok: true; cadence?: number | null } | { ok: false; reason: string }> {
  const table = entity === "company" ? "companies" : "people";
  if (!id || !Object.hasOwn(STATUS, statusKey)) return { ok: false, reason: "That status doesn't exist." };
  const db = getDb();
  const row = db.prepare(`SELECT status_key, updated_at FROM ${table} WHERE id=?`).get(id) as
    | { status_key: string; updated_at: string | null }
    | undefined;
  if (!row) return { ok: false, reason: "This profile no longer exists." };
  if (updatedAt !== null && (row.updated_at ?? "") !== updatedAt) {
    return { ok: false, reason: "This profile changed since the page loaded — reload and try again." };
  }
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET status_key=?, updated_at=datetime('now') WHERE id=?`).run(statusKey, id);
    if (table === "people") applyStatusCadence(db, id, row.status_key, statusKey, DEFAULT_CADENCE);
  })();
  revalidatePath("/", "layout");
  if (table !== "people" || row.status_key === statusKey) return { ok: true };
  // Say what Keep Warm will do now (the cadence follows the status unless it was set by hand).
  const after = db.prepare(`SELECT cadence_days FROM people WHERE id=?`).get(id) as { cadence_days: number | null };
  return { ok: true, cadence: STATUS[statusKey]?.keepWarm === false ? null : after.cadence_days };
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
  const original = formData.get("original");
  const db = getDb();
  if (original === null) {
    // A form that doesn't carry the section's text as it was shown: fall back to the whole-row check.
    if (isStale(table, id, formData)) redirect(`${profileHref(table, id)}?stale=1`);
  } else {
    // Only a change to this section counts as a conflict; a last-touch bump or another field doesn't.
    const row = db.prepare(`SELECT ${column} AS v FROM ${table} WHERE id=?`).get(id) as { v: string | null } | undefined;
    if (!row) return;
    if (!sameText(row.v, String(original)) && !sameText(row.v, value)) {
      // Changed elsewhere while open (another window, Claude). Never lose either
      // version: an edit that clears the section is refused, any other is kept
      // below the newer text for the owner to merge.
      if (!value) redirect(`${profileHref(table, id)}?stale=1`);
      db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(`${(row.v ?? "").trim()}\n\n${KEPT_EDIT_MARKER}\n\n${value}`, id);
      touch(table, id);
      revalidatePath("/", "layout");
      redirect(`${profileHref(table, id)}?stale=kept`);
    }
  }
  db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(value, id);
  touch(table, id);
  revalidatePath("/", "layout");
}

const KEPT_EDIT_MARKER =
  "---\n\n**⚠ Your edit, kept below:** this section was changed elsewhere while you were editing it. Merge the two versions and delete this note.";

/** Same text once line endings (a form sends CRLF) and outer whitespace are ignored. */
function sameText(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) => (s ?? "").replace(/\r\n?/g, "\n").trim();
  return norm(a) === norm(b);
}

/**
 * Saves a profile's edit page (app/(app)/people|companies/[slug]/edit): name,
 * status and the snapshot fields. Then goes `back` (the profile, or the list
 * the edit was opened from); a refused stale save returns to the edit page.
 */
export async function updateSnapshot(formData: FormData) {
  const entity = formData.get("entity") === "company" ? "companies" : "people";
  const id = Number(formData.get("id"));
  if (!id) return;
  const back = localPath(formData.get("back"));
  if (isStale(entity, id, formData)) {
    redirect(back ? `${profileHref(entity, id)}/edit?stale=1&back=${encodeURIComponent(back)}` : `${profileHref(entity, id)}?stale=1`);
  }
  const db = getDb();
  const before = db.prepare(`SELECT status_key FROM ${entity} WHERE id=?`).get(id) as { status_key: string } | undefined;
  if (!before) return;
  const statusKey = formData.has("status_key") ? oneOf(formData.get("status_key"), STATUS, before.status_key) : before.status_key;
  db.transaction(() => {
    // A rename keeps the slug, so links and bookmarks to the profile still work.
    const name = str(formData, "name");
    if (name) db.prepare(`UPDATE ${entity} SET name=? WHERE id=?`).run(name, id);
    if (entity === "people") {
      if (formData.has("company_id") || str(formData, "new_company")) {
        const companyId = companyFromForm(formData);
        db.prepare(`UPDATE people SET company_id=? WHERE id=?`).run(companyId, id);
      }
      const cadenceRaw = String(formData.get("cadence_days") ?? "").trim();
      db.prepare(
        `UPDATE people SET role_title=?, location=?, email=?, phone=?, linkedin=?, company_note=?, relationship_strength=?, cadence_days=?, tags=?, status_key=?, updated_at=datetime('now') WHERE id=?`
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
        statusKey,
        id
      );
      // A new status brings its default cadence, as the status picker does, unless the cadence was changed in this form.
      const cadenceWas = formData.get("cadence_was");
      if (cadenceWas === null || String(cadenceWas).trim() === cadenceRaw) {
        applyStatusCadence(db, id, before.status_key, statusKey, DEFAULT_CADENCE);
      }
    } else {
      db.prepare(
        `UPDATE companies SET industry=?, size=?, hq=?, website=?, revenue_stage=?, status_key=?, updated_at=datetime('now') WHERE id=?`
      ).run(
        str(formData, "industry"),
        str(formData, "size"),
        str(formData, "hq"),
        str(formData, "website"),
        str(formData, "revenue_stage"),
        statusKey,
        id
      );
    }
  })();
  revalidatePath("/", "layout");
  if (back) redirect(back);
}

function str(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v || null;
}

/**
 * The company a person form picked: a typed new company name wins (linked to
 * the existing company of that name if there is one, else created), then the
 * picker's company_id, else none.
 */
function companyFromForm(formData: FormData): number | null {
  const db = getDb();
  const typed = str(formData, "new_company");
  if (typed) {
    const slug = slugFor(typed, "company");
    const existing = db.prepare(`SELECT id FROM companies WHERE slug=? OR lower(name)=lower(?)`).get(slug, typed) as { id: number } | undefined;
    if (existing) return existing.id;
    return Number(db.prepare(`INSERT INTO companies (slug, name, status_key) VALUES (?,?,?)`).run(slug, typed, "new").lastInsertRowid);
  }
  return Number(formData.get("company_id")) || null;
}


export async function createPerson(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const db = getDb();
  const slug = slugFor(name, "person");
  if (db.prepare(`SELECT 1 FROM people WHERE slug=?`).get(slug)) {
    // Same rule as Intake and the MCP server: never silently create a twin.
    redirect(`/people?duplicate=${encodeURIComponent(slug)}`);
  }
  const companyId = companyFromForm(formData);
  const statusKey = oneOf(formData.get("status_key"), STATUS, "new");
  try {
    db.prepare(
      `INSERT INTO people (slug, name, status_key, role_title, company_id, email, phone, linkedin, next_action, cadence_days)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      slug,
      name,
      statusKey,
      str(formData, "role_title"),
      companyId,
      str(formData, "email"),
      str(formData, "phone"),
      str(formData, "linkedin"),
      str(formData, "next_action"),
      DEFAULT_CADENCE[statusKey] ?? null
    );
  } catch (err) {
    if (/UNIQUE/.test(String(err))) redirect(`/people?duplicate=${encodeURIComponent(slug)}`);
    throw err;
  }
  revalidatePath("/", "layout");
  redirect(profilePath("people", slug));
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
  if (isStale("opportunities", id, formData)) redirect("/pipeline?stale=1");
  // Stage is owned by the "Move" form / MCP; the edit form omits it so a stage
  // moved elsewhere isn't clobbered. Only honour it when explicitly supplied.
  const stage = formData.has("stage") ? oneOf(formData.get("stage"), STAGES, current.stage) : current.stage;
  getDb()
    .prepare(
      `UPDATE opportunities SET name=?, kind=?, stage=?, value_note=?, priority=?, next_step=?, notes=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      str(formData, "name") ?? current.name,
      oneOf(formData.get("kind"), KINDS, "engagement"),
      stage,
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
  const slug = slugFor(name, "company");
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
  redirect(profilePath("companies", slug));
}

/** Mark an Outreach draft sent (or back to draft), which also clears it from the sidebar badge. */
export async function setOutreachStatus(id: number, status: "sent" | "draft") {
  if (!id || (status !== "sent" && status !== "draft")) return;
  getDb()
    .prepare(`UPDATE outreach SET status=?, date=CASE WHEN ?='sent' THEN COALESCE(date, date('now','localtime')) ELSE date END WHERE id=?`)
    .run(status, status, id);
  revalidatePath("/", "layout");
}
