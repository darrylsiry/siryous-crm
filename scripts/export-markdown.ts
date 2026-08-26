/**
 * Export the live database back to readable markdown — a write-only archive in
 * the style of the original Business Development folder. Output goes to
 * `exports/` (gitignored — it contains client data). Not a sync: exports are
 * snapshots; the database remains the system of record.
 *
 * Usage: npx tsx scripts/export-markdown.ts
 */
import fs from "fs";
import path from "path";
import { loadOwner } from "../lib/owner.mjs";
import { getDb, STATUS } from "../lib/db";
import type { Company, Person } from "../lib/types";

const db = getDb();
const OUT = path.join(process.cwd(), "exports");
const stamp = new Date().toISOString().slice(0, 10);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "people"), { recursive: true });
fs.mkdirSync(path.join(OUT, "companies"), { recursive: true });

const statusText = (row: { status_key: string; status_note: string | null }) => {
  const s = STATUS[row.status_key] ?? STATUS.new;
  return `${s.emoji} ${s.label}${row.status_note ? ` (${row.status_note})` : ""}`;
};

const interactionsFor = (col: "person_id" | "company_id", id: number) =>
  db
    .prepare(`SELECT date, channel, summary FROM interactions WHERE ${col} = ? ORDER BY date DESC, id DESC`)
    .all(id) as { date: string; channel: string | null; summary: string }[];

function logSection(rows: { date: string; channel: string | null; summary: string }[]): string {
  if (!rows.length) return "";
  return (
    `\n---\n\n## Interaction Log\n*Newest first.*\n\n` +
    rows.map((i) => `### ${i.date}${i.channel ? ` — ${i.channel}` : ""}\n${i.summary}`).join("\n\n")
  );
}

// --- People ---
const people = db.prepare(`SELECT * FROM people ORDER BY slug`).all() as Person[];
const companiesById = new Map<number, Company>();
for (const c of db.prepare(`SELECT * FROM companies`).all() as Company[]) companiesById.set(c.id, c);

for (const p of people) {
  const company = p.company_id ? companiesById.get(p.company_id) : undefined;
  const parts = [
    `# ${p.name}`,
    ``,
    `> **Status:** ${statusText(p)} · **Last touch:** ${p.last_touch ?? "—"} · **Next action:** ${p.next_action ?? "—"}`,
    ``,
    `## Snapshot`,
    `- **Role / title:** ${p.role_title ?? "—"}`,
    `- **Company:** ${company ? `[${company.name}](../companies/${company.slug}.md)` : "—"}${p.company_note ? ` · ${p.company_note}` : ""}`,
    `- **Location:** ${p.location ?? "—"}`,
    `- **Email:** ${p.email ?? "—"}`,
    `- **Phone:** ${p.phone ?? "—"}`,
    `- **LinkedIn / links:** ${p.linkedin ?? "—"}`,
    `- **Relationship strength:** ${p.relationship_strength ?? "—"}`,
    `- **Tags:** ${p.tags ?? "—"}`,
    `- **Keep-warm cadence:** ${p.cadence_days ? `every ${p.cadence_days} days` : "—"}`,
  ];
  for (const [col, title] of [
    ["relationship_intel", "Relationship Intelligence"],
    ["business_context", "Business Context"],
    ["engagement_strategy", "Engagement Strategy"],
    ["extra_sections", "More"],
    ["notes", "Notes"],
  ] as const) {
    if (p[col]) parts.push(`\n---\n\n## ${title}\n${p[col]}`);
  }
  parts.push(logSection(interactionsFor("person_id", p.id)));
  fs.writeFileSync(path.join(OUT, "people", `${p.slug}.md`), parts.join("\n"));
}

// --- Companies ---
const companies = [...companiesById.values()].sort((a, b) => a.slug.localeCompare(b.slug));
for (const c of companies) {
  const key = people.filter((p) => p.company_id === c.id);
  const parts = [
    `# ${c.name}`,
    ``,
    `> **Status:** ${statusText(c)} · **Last touch:** ${c.last_touch ?? "—"} · **Next action:** ${c.next_action ?? "—"}`,
    ``,
    `## Snapshot`,
    `- **Industry:** ${c.industry ?? "—"}`,
    `- **Size / headcount:** ${c.size ?? "—"}`,
    `- **HQ / locations:** ${c.hq ?? "—"}`,
    `- **Website:** ${c.website ?? "—"}`,
    `- **Revenue / stage:** ${c.revenue_stage ?? "—"}`,
  ];
  if (key.length) {
    parts.push(
      `\n## Key People\n` +
        key.map((p) => `- [${p.name}](../people/${p.slug}.md) — ${p.role_title ?? "—"} — ${p.relationship_strength ?? "?"}`).join("\n")
    );
  }
  for (const [col, title] of [
    ["business_context", "Business Context"],
    ["relationship_intel", "Relationship Intelligence"],
    ["engagement_strategy", "Engagement Strategy"],
    ["extra_sections", "More"],
    ["notes", "Notes"],
  ] as const) {
    if (c[col]) parts.push(`\n---\n\n## ${title}\n${c[col]}`);
  }
  parts.push(logSection(interactionsFor("company_id", c.id)));
  fs.writeFileSync(path.join(OUT, "companies", `${c.slug}.md`), parts.join("\n"));
}

// --- Index ---
const opps = db
  .prepare(
    `SELECT o.*, p.name AS pname, p.slug AS pslug, c.name AS cname, c.slug AS cslug
     FROM opportunities o LEFT JOIN people p ON p.id=o.person_id LEFT JOIN companies c ON c.id=o.company_id
     ORDER BY o.priority, o.stage, o.name`
  )
  .all() as any[];
const actions = db
  .prepare(
    `SELECT a.*, p.name AS pname FROM action_items a LEFT JOIN people p ON p.id=a.person_id
     WHERE a.status='open' ORDER BY a.bucket, a.id`
  )
  .all() as any[];

const index = [
  `# ${loadOwner().appName} — Export ${stamp}`,
  ``,
  `*Snapshot generated from the live database. The database remains the system of record.*`,
  ``,
  `## People`,
  `| Name | Company | Status | Last touch | Next action |`,
  `|------|---------|--------|-----------|-------------|`,
  ...people.map((p) => {
    const company = p.company_id ? companiesById.get(p.company_id) : undefined;
    return `| [${p.name}](people/${p.slug}.md) | ${company ? `[${company.name}](companies/${company.slug}.md)` : p.company_note ?? "—"} | ${statusText(p)} | ${p.last_touch ?? "—"} | ${p.next_action ?? "—"} |`;
  }),
  ``,
  `## Companies`,
  `| Company | Industry | Status | Next action |`,
  `|---------|----------|--------|-------------|`,
  ...companies.map(
    (c) => `| [${c.name}](companies/${c.slug}.md) | ${c.industry ?? "—"} | ${statusText(c)} | ${c.next_action ?? "—"} |`
  ),
  ``,
  `## Pipeline`,
  ...opps.map(
    (o) =>
      `- ${o.priority === 1 ? "★ " : ""}**${o.name}** (${o.kind}, ${o.stage})${o.pname ? ` — ${o.pname}` : ""}${o.cname ? ` / ${o.cname}` : ""}${o.next_step ? ` — next: ${o.next_step}` : ""}`
  ),
  ``,
  `## Open action items`,
  ...actions.map((a) => `- (${a.bucket}${a.due_label ? `, due ${a.due_label}` : ""}) ${a.title}`),
  ``,
].join("\n");
fs.writeFileSync(path.join(OUT, "_index.md"), index);

console.log(
  `Exported ${people.length} people, ${companies.length} companies, ${opps.length} opportunities, ${actions.length} open actions to exports/`
);
