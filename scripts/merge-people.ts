/**
 * Merge a duplicate person profile into the one you want to keep.
 *
 *   npx tsx scripts/merge-people.ts <duplicate-slug> <keep-slug> [--dry-run]
 *
 * Everything attached to the duplicate (interactions, action items, outreach,
 * opportunities, briefs, connections, News Feed refs, Coach proposals) is
 * re-pointed at the kept profile. Scalar fields on the kept profile win unless
 * empty; tags are unioned; status, status note, next action and last touch come
 * from whichever profile was touched more recently. Narrative sections from the
 * duplicate are appended to the kept profile under a "merged from" marker so
 * nothing is lost. The duplicate row is then deleted. Runs in one transaction;
 * --dry-run prints the plan and rolls back. The logic is in lib/mergePeople.ts.
 */
import "./repo-root";
import Database from "better-sqlite3";
import fs from "fs";
import { DB_PATH } from "../lib/db";
import { MergeError, mergePeople, type MergeResult } from "../lib/mergePeople";

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

let result: MergeResult;
try {
  result = mergePeople(db, dupSlug, keepSlug, { dryRun });
} catch (err) {
  if (!(err instanceof MergeError)) throw err;
  console.error(err.message);
  process.exit(1);
}
const { dup, keep, receipt } = result;
console.log(
  result.dryRun
    ? `DRY RUN — would merge '${dup.slug}' into '${keep.slug}' (nothing changed):`
    : `Merged '${dup.slug}' into '${keep.slug}':`
);
for (const line of receipt) console.log("  - " + line);
