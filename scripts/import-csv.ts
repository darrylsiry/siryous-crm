/**
 * Bulk-import people (and the companies they mention) from a CSV file.
 *
 *   npx tsx scripts/import-csv.ts <file.csv> [--update] [--dry-run]
 *
 * Columns are matched by header (case/space-insensitive, with synonyms):
 * name (or first name + last name), email, linkedin/url, role/title/position,
 * company, location, phone, tags, notes, status, cadence days, last touch /
 * "connected on". LinkedIn's Connections.csv export works as-is. People whose
 * slug already exists are skipped and listed — never overwritten; --update
 * fills blank contact fields (email, linkedin, role, company, location, phone)
 * on them instead. --dry-run runs the whole import and rolls it back.
 * The database is data/crm.db (or CRM_DB_PATH).
 */
import "./repo-root";
import fs from "fs";
import { getDb } from "../lib/db";
import { importPeople, parseImportCsv } from "../lib/importCsv";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const files = args.filter((a) => !a.startsWith("--"));
const known = new Set(["--update", "--dry-run"]);
const unknown = [...flags].filter((f) => !known.has(f));
if (files.length !== 1 || unknown.length) {
  if (unknown.length) console.error(`unknown option(s): ${unknown.join(", ")}`);
  console.error("usage: npx tsx scripts/import-csv.ts <file.csv> [--update] [--dry-run]");
  process.exit(1);
}
const file = files[0];
if (!fs.existsSync(file)) {
  console.error(`No such file: ${file}`);
  process.exit(1);
}

const text = fs.readFileSync(file, "utf8");
let parsed;
try {
  parsed = parseImportCsv(text);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const fieldFor = Object.fromEntries(Object.entries(parsed.mapping).map(([field, idx]) => [idx, field]));
console.log(`Columns:`);
parsed.headers.forEach((h, i) => console.log(`  ${JSON.stringify(h)} → ${fieldFor[i] ?? "(ignored)"}`));

const report = importPeople(getDb(), parsed, {
  update: flags.has("--update"),
  dryRun: flags.has("--dry-run"),
});

console.log(report.dryRun ? `\nDRY RUN — nothing changed. Would have:` : `\nImported from ${file}:`);
console.log(`  rows:              ${report.rows}`);
console.log(`  people created:    ${report.created}`);
if (flags.has("--update")) console.log(`  people updated:    ${report.updated}`);
console.log(`  companies linked:  ${report.linkedCompanies}`);
console.log(`  companies created: ${report.createdCompanies}`);
console.log(`  skipped (exist):   ${report.skippedExisting.length}`);
for (const n of report.skippedExisting) console.log(`    - ${n}`);
console.log(`  errors:            ${report.errors.length}`);
for (const e of report.errors) console.log(`    - line ${e.row}: ${e.message}`);
if (report.errors.length) process.exitCode = 2;
