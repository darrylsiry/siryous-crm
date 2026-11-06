/**
 * Data rules the web app and the MCP server (scripts/mcp-server.mjs) must
 * apply the same way, in one place. Plain JS so both can import it.
 */
import { randomBytes } from "node:crypto";

/**
 * Slug from a person or company name. Latin names keep the ASCII slug they
 * always had (stored slugs and duplicate checks depend on it); a name with no
 * Latin letters or digits at all (Chinese, Arabic, Cyrillic…) keeps its own
 * script instead of coming out empty. Can still be empty for a name of only
 * punctuation or emoji: use `slugFor` for one to store.
 */
export function slugify(name) {
  const base = String(name).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const ascii = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (ascii) return ascii;
  return base.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/** A slug that is never empty: a name with no letters or digits gets `person-…` / `company-…`. */
export function slugFor(name, kind) {
  return slugify(name) || `${kind}-${randomBytes(3).toString("hex")}`;
}

/** The URL path of a profile. Slugs may hold any script, so it is encoded for headers and links. */
export function profilePath(table, slug) {
  return `/${table}/${encodeURIComponent(slug)}`;
}

/**
 * An action item's effective bucket: an open one past its due date is overdue,
 * whatever it was filed under. `alias` is the action_items table's alias.
 */
export function effectiveBucketSql(alias = "") {
  const a = alias ? `${alias}.` : "";
  return `CASE WHEN ${a}status='open' AND ${a}due_date IS NOT NULL AND ${a}due_date < date('now','localtime') THEN 'overdue' ELSE ${a}bucket END`;
}

/** Tick an action item done today. */
export function markActionDone(db, id) {
  db.prepare(`UPDATE action_items SET status='done', completed_at=date('now','localtime') WHERE id=?`).run(id);
}

/** Move a contact's last touch forward to `date` (never back) and clear the free-text note. */
export function bumpLastTouch(db, table, id, date) {
  db.prepare(
    `UPDATE ${table} SET last_touch = ?, last_touch_note = NULL, updated_at = datetime('now')
     WHERE id = ? AND (last_touch IS NULL OR last_touch < ?)`
  ).run(date, id, date);
}

/**
 * After a person's status changes, a keep-warm cadence still at the old
 * status's default (or unset) follows the new status's default. One set by
 * hand stays as it is.
 */
export function applyStatusCadence(db, personId, oldStatus, newStatus, cadence) {
  if (oldStatus === newStatus) return;
  db.prepare(`UPDATE people SET cadence_days = ? WHERE id = ? AND (cadence_days IS NULL OR cadence_days IS ?)`).run(
    cadence[newStatus] ?? null,
    personId,
    cadence[oldStatus] ?? null
  );
}

/** A LIKE pattern matching `q` anywhere, with %, _ and \\ escaped so they match themselves (pair with LIKE_ESCAPE). */
export function likeNeedle(q) {
  return `%${String(q).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
/** The ESCAPE clause that goes with likeNeedle. */
export const LIKE_ESCAPE = "ESCAPE '\\'";
/** `col LIKE <param> ESCAPE '\\' OR …` over `columns`; `param` is "?" (bind one needle per column) or a named "@q". */
export function likeAnySql(columns, param = "?", alias = "") {
  return columns.map((c) => `${alias ? `${alias}.` : ""}${c} LIKE ${param} ${LIKE_ESCAPE}`).join(" OR ");
}

/** Every column a person types into, for search. */
export const PEOPLE_SEARCH_COLUMNS = [
  "name", "role_title", "email", "phone", "location", "company_note", "tags", "status_note", "next_action",
  "relationship_intel", "business_context", "engagement_strategy", "notes", "extra_sections",
];
export const COMPANY_SEARCH_COLUMNS = [
  "name", "industry", "size", "hq", "website", "revenue_stage", "status_note", "next_action",
  "relationship_intel", "business_context", "engagement_strategy", "notes", "extra_sections",
];
