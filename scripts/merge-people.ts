/**
 * Merge a duplicate person profile into the one you want to keep.
 *
 *   npx tsx scripts/merge-people.ts <duplicate-slug> <keep-slug> [--dry-run]
 *
 * Everything attached to the duplicate (interactions, action items, outreach,
 * opportunities, briefs, connections) is re-pointed at the kept profile. Scalar
 * fields on the kept profile win unless empty; tags are unioned; status, status
 * note, next action and last touch come from whichever profile was touched more
 * recently. Narrative sections from the duplicate are appended to the kept
 * profile under a "merged from" marker so nothing is lost. The duplicate row is
 * then deleted. Runs in one transaction; --dry-run prints the plan and rolls back.
 */
import "./repo-root";
import Database from "better-sqlite3";
import fs from "fs";
import { DB_PATH } from "../lib/db";

const [dupSlug, keepSlug, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (!dupSlug || !keepSlug || dupSlug === keepSlug) {
  console.error("usage: npx tsx scripts/merge-people.ts <duplicate-slug> <keep-slug> [--dry-run]");
  process.exit(1);
}

// data/crm.db (or CRM_DB_PATH); never create an empty database by mistake.
if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH} — nothing to merge. Run the app once, or set CRM_DB_PATH.`);
  process.exit(1);
}
const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

type Person = Record<string, string | number | null> & { id: number; slug: string; name: string };
const getPerson = (slug: string) => db.prepare(`SELECT * FROM people WHERE slug=?`).get(slug) as Person | undefined;
const dup = getPerson(dupSlug);
const keep = getPerson(keepSlug);
if (!dup) { console.error(`No person with slug '${dupSlug}'.`); process.exit(1); }
if (!keep) { console.error(`No person with slug '${keepSlug}'.`); process.exit(1); }

const SCALARS = ["email", "phone", "linkedin", "location", "role_title", "relationship_strength", "company_id", "company_note", "cadence_days"] as const;
const SECTIONS = ["relationship_intel", "business_context", "engagement_strategy", "extra_sections", "notes"] as const;
const REFS: [table: string, col: string][] = [
  ["interactions", "person_id"],
  ["action_items", "person_id"],
  ["outreach", "person_id"],
  ["opportunities", "person_id"],
  ["briefs", "person_id"],
  ["connections", "from_person_id"],
  ["connections", "to_person_id"],
];

/** First ISO date in a free-text last_touch, for "which profile is newer" comparisons. */
const touchDate = (s: string | number | null) => (typeof s === "string" && s.match(/\d{4}-\d{2}-\d{2}/)?.[0]) || "";
const dupIsNewer = touchDate(dup.last_touch) > touchDate(keep.last_touch);

const receipt: string[] = [];
const merge = db.transaction(() => {
  for (const [table, col] of REFS) {
    const n = db.prepare(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`).run(keep.id, dup.id).changes;
    if (n) receipt.push(`${table}.${col}: moved ${n}`);
  }
  // Connections that became self-links or duplicates of an existing pair.
  const selfLinks = db.prepare(`DELETE FROM connections WHERE from_person_id = to_person_id`).run().changes;
  if (selfLinks) receipt.push(`connections: dropped ${selfLinks} self-link(s)`);
  const dupPairs = db
    .prepare(
      `DELETE FROM connections WHERE id NOT IN (
         SELECT MIN(id) FROM connections GROUP BY from_person_id, to_person_id)`
    )
    .run().changes;
  if (dupPairs) receipt.push(`connections: dropped ${dupPairs} duplicate pair(s)`);

  const updates: Record<string, string | number | null> = {};
  for (const f of SCALARS) {
    if ((keep[f] === null || keep[f] === "") && dup[f] !== null && dup[f] !== "") updates[f] = dup[f];
  }
  const tags = new Set(
    [keep.tags, dup.tags]
      .flatMap((t) => String(t ?? "").split(","))
      .map((t) => t.trim())
      .filter(Boolean)
  );
  if (tags.size) updates.tags = [...tags].join(",");
  if (dupIsNewer) {
    for (const f of ["status_key", "status_note", "next_action", "last_touch"] as const) {
      if (dup[f] !== null && dup[f] !== "") updates[f] = dup[f];
    }
  }
  for (const s of SECTIONS) {
    const extra = dup[s];
    if (typeof extra !== "string" || !extra.trim()) continue;
    const marker = `\n\n---\n_Merged from duplicate profile \`${dup.slug}\` (created ${dup.created_at}):_\n\n`;
    updates[s] = keep[s] ? `${keep[s]}${marker}${extra}` : extra;
  }
  const keys = Object.keys(updates);
  if (keys.length) {
    db.prepare(`UPDATE people SET ${keys.map((k) => `${k}=@${k}`).join(", ")}, updated_at=datetime('now') WHERE id=@id`).run({ ...updates, id: keep.id });
    receipt.push(`people[${keep.slug}]: updated ${keys.join(", ")}`);
  }
  db.prepare(`DELETE FROM people WHERE id=?`).run(dup.id);
  receipt.push(`people[${dup.slug}] (id ${dup.id}): deleted`);
  if (dryRun) throw new Error("__dry_run__");
});

try {
  merge();
  console.log(`Merged '${dup.slug}' into '${keep.slug}':`);
} catch (err) {
  if (!(err instanceof Error && err.message === "__dry_run__")) throw err;
  console.log(`DRY RUN — would merge '${dup.slug}' into '${keep.slug}' (nothing changed):`);
}
for (const line of receipt) console.log("  - " + line);
