#!/usr/bin/env node
/**
 * CRM MCP server (stdio).
 *
 * Exposes the CRM database to Claude (Desktop or Code) as tools, so
 * conversational work ("log my call with Sam", "what's overdue?") reads and
 * writes the same live SQLite database the web app uses.
 *
 * Design principles:
 *  - Every prose-writing tool accepts arbitrary markdown — the rich profile
 *    style of a hand-written profile carries over unchanged.
 *  - write_profile_section has an append mode so information is never dropped
 *    because it "doesn't fit a field".
 *  - Nothing here can delete a person, company, or interaction.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase } from "../lib/schema.mjs";
import { loadOwner } from "../lib/owner.mjs";
import { loadVocab, kindList, stageList, bucketList } from "../lib/vocab.mjs";
import { parseDueDate } from "../lib/dates.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = openDatabase(Database, process.env.CRM_DB_PATH || path.join(ROOT, "data", "crm.db"));

// Vocabulary is shared with the app via lib/vocab.mjs (defaults + config/vocab.json).
const VOCAB = loadVocab(ROOT);
/** status key → "🌱 New" */
const STATUS = Object.fromEntries(Object.entries(VOCAB.status).map(([k, s]) => [k, `${s.emoji} ${s.label}`.trim()]));
const DEFAULT_CADENCE = VOCAB.cadence;
const STAGES = Object.keys(VOCAB.stages);
const BUCKETS = Object.keys(VOCAB.buckets);
const KINDS = Object.keys(VOCAB.kinds);
const SECTIONS = ["relationship_intel", "business_context", "engagement_strategy", "notes", "extra_sections"];

// ---------- helpers ----------

/**
 * Resolve a slug or name fragment to one row. Exact slug first; then a name
 * match — but only if it is unambiguous. An ambiguous or empty reference
 * returns null so a write never lands on the wrong "John". Use
 * `lastLookupError` for the reason.
 */
let lastLookupError = "";
function findOne(table, ref) {
  lastLookupError = "";
  const r = String(ref ?? "").trim();
  if (!r) { lastLookupError = "empty reference"; return null; }
  const bySlug = db.prepare(`SELECT * FROM ${table} WHERE slug = ?`).get(r);
  if (bySlug) return bySlug;
  const exact = db.prepare(`SELECT * FROM ${table} WHERE lower(name) = lower(?)`).all(r);
  if (exact.length === 1) return exact[0];
  const like = db.prepare(`SELECT * FROM ${table} WHERE name LIKE ? ORDER BY length(name) LIMIT 5`).all(`%${r}%`);
  if (like.length === 1) return like[0];
  if (like.length > 1) lastLookupError = `"${r}" is ambiguous — matches ${like.map((x) => x.slug).join(", ")}; use the slug`;
  return null;
}
const findPerson = (ref) => findOne("people", ref);
const findCompany = (ref) => findOne("companies", ref);
function whyNot(kind, ref) {
  return lastLookupError || `No ${kind} matching "${ref}"`;
}
function slugify(name) {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function text(s) {
  return { content: [{ type: "text", text: s }] };
}
function fail(s) {
  return { content: [{ type: "text", text: `ERROR: ${s}` }], isError: true };
}
function statusLine(row) {
  return `${STATUS[row.status_key] ?? row.status_key}${row.status_note ? ` (${row.status_note})` : ""}`;
}
function personCard(p) {
  const company = p.company_id
    ? db.prepare(`SELECT name, slug FROM companies WHERE id = ?`).get(p.company_id)
    : null;
  const lines = [
    `# ${p.name}  [slug: ${p.slug}]`,
    `Status: ${statusLine(p)} · Strength: ${p.relationship_strength ?? "—"} · Last touch: ${p.last_touch ?? (p.last_touch_note ? `undated (${p.last_touch_note})` : "—")}${p.last_touch && p.last_touch_note ? ` (${p.last_touch_note})` : ""}`,
    `Role: ${p.role_title ?? "—"}${company ? ` · Company: ${company.name} [${company.slug}]` : ""}${p.company_note ? ` · ${p.company_note}` : ""}`,
    `Email: ${p.email ?? "—"} · Phone: ${p.phone ?? "—"} · Location: ${p.location ?? "—"}`,
    `LinkedIn: ${p.linkedin ?? "—"}`,
    `Tags: ${p.tags ?? "—"} · Keep-warm cadence: ${p.cadence_days ? `${p.cadence_days}d` : "—"}`,
    `Next action: ${p.next_action ?? "—"}`,
  ];
  for (const [col, label] of [
    ["relationship_intel", "Relationship Intelligence"],
    ["business_context", "Business Context"],
    ["engagement_strategy", "Engagement Strategy"],
    ["extra_sections", "More"],
    ["notes", "Notes"],
  ]) {
    if (p[col]) lines.push(`\n## ${label}\n${p[col]}`);
  }
  const opps = db.prepare(`SELECT name, stage, priority FROM opportunities WHERE person_id = ?`).all(p.id);
  if (opps.length) {
    lines.push(`\n## Opportunities\n` + opps.map((o) => `- ${o.name} — ${o.stage}${o.priority === 1 ? " ★" : ""}`).join("\n"));
  }
  const actions = db.prepare(`SELECT id, CASE WHEN due_date IS NOT NULL AND due_date < date('now','localtime') THEN 'overdue' ELSE bucket END AS bucket, COALESCE(due_date, due_label) AS due_label, title FROM action_items WHERE person_id = ? AND status='open'`).all(p.id);
  if (actions.length) {
    lines.push(`\n## Open action items\n` + actions.map((a) => `- [id ${a.id}] (${a.bucket}${a.due_label ? `, due ${a.due_label}` : ""}) ${a.title}`).join("\n"));
  }
  const log = db.prepare(`SELECT date, channel, summary FROM interactions WHERE person_id = ? ORDER BY date DESC, id DESC LIMIT 10`).all(p.id);
  if (log.length) {
    lines.push(`\n## Interaction log (newest first)\n` + log.map((i) => `### ${i.date}${i.channel ? ` — ${i.channel}` : ""}\n${i.summary}`).join("\n\n"));
  }
  return lines.join("\n");
}
function companyCard(c) {
  const lines = [
    `# ${c.name}  [slug: ${c.slug}]`,
    `Status: ${statusLine(c)} · Last touch: ${c.last_touch ?? (c.last_touch_note ? `undated (${c.last_touch_note})` : "—")}`,
    `Industry: ${c.industry ?? "—"} · HQ: ${c.hq ?? "—"} · Size: ${c.size ?? "—"} · Website: ${c.website ?? "—"}`,
    `Next action: ${c.next_action ?? "—"}`,
  ];
  const people = db.prepare(`SELECT name, slug, role_title, relationship_strength FROM people WHERE company_id = ?`).all(c.id);
  if (people.length) {
    lines.push(`\n## Key people\n` + people.map((p) => `- ${p.name} [${p.slug}] — ${p.role_title ?? "—"} (${p.relationship_strength ?? "?"})`).join("\n"));
  }
  for (const [col, label] of [
    ["business_context", "Business Context"],
    ["relationship_intel", "Relationship Intelligence"],
    ["engagement_strategy", "Engagement Strategy"],
    ["extra_sections", "More"],
    ["notes", "Notes"],
  ]) {
    if (c[col]) lines.push(`\n## ${label}\n${c[col]}`);
  }
  const opps = db.prepare(`SELECT name, stage, priority FROM opportunities WHERE company_id = ?`).all(c.id);
  if (opps.length) {
    lines.push(`\n## Opportunities\n` + opps.map((o) => `- ${o.name} — ${o.stage}${o.priority === 1 ? " ★" : ""}`).join("\n"));
  }
  const log = db.prepare(`SELECT date, channel, summary FROM interactions WHERE company_id = ? ORDER BY date DESC, id DESC LIMIT 10`).all(c.id);
  if (log.length) {
    lines.push(`\n## Interaction log (newest first)\n` + log.map((i) => `### ${i.date}${i.channel ? ` — ${i.channel}` : ""}\n${i.summary}`).join("\n\n"));
  }
  return lines.join("\n");
}
function bumpLastTouch(table, id, date) {
  // last_touch is always an ISO date (or NULL); a newer dated touch also retires any free-text note.
  db.prepare(
    `UPDATE ${table} SET last_touch = ?, last_touch_note = NULL, updated_at = datetime('now')
     WHERE id = ? AND (last_touch IS NULL OR last_touch < ?)`
  ).run(date, id, date);
}

// ---------- server ----------

const OWNER = loadOwner(ROOT);
const server = new McpServer({ name: OWNER.mcpServerName, version: "1.0.0" });

server.registerTool(
  "search_crm",
  {
    title: "Search the CRM",
    description:
      "Full-text search across people, companies, profile sections, interactions, action items, and pipeline opportunities. Use this first when unsure of a slug or where something lives.",
    inputSchema: { query: z.string().describe("Search term (name, company, topic, keyword)") },
  },
  async ({ query }) => {
    const like = `%${query}%`;
    const people = db.prepare(`SELECT slug, name, status_key FROM people WHERE name LIKE ? OR role_title LIKE ? OR tags LIKE ? OR notes LIKE ? OR relationship_intel LIKE ? OR business_context LIKE ? OR engagement_strategy LIKE ? LIMIT 15`).all(like, like, like, like, like, like, like);
    const companies = db.prepare(`SELECT slug, name, status_key FROM companies WHERE name LIKE ? OR industry LIKE ? OR notes LIKE ? OR business_context LIKE ? LIMIT 15`).all(like, like, like, like);
    const interactions = db.prepare(`SELECT i.date, i.summary, p.name AS pname, c.name AS cname FROM interactions i LEFT JOIN people p ON p.id=i.person_id LEFT JOIN companies c ON c.id=i.company_id WHERE i.summary LIKE ? ORDER BY i.date DESC LIMIT 10`).all(like);
    const actions = db.prepare(`SELECT id, title, status, bucket FROM action_items WHERE title LIKE ? OR detail LIKE ? LIMIT 10`).all(like, like);
    const opps = db.prepare(`SELECT id, name, stage FROM opportunities WHERE name LIKE ? OR value_note LIKE ? OR next_step LIKE ? OR notes LIKE ? LIMIT 10`).all(like, like, like, like);
    const out = [];
    if (people.length) out.push("## People\n" + people.map((p) => `- ${p.name} [${p.slug}] — ${STATUS[p.status_key]}`).join("\n"));
    if (companies.length) out.push("## Companies\n" + companies.map((c) => `- ${c.name} [${c.slug}] — ${STATUS[c.status_key]}`).join("\n"));
    if (opps.length) out.push("## Pipeline\n" + opps.map((o) => `- [id ${o.id}] ${o.name} — ${o.stage}`).join("\n"));
    if (actions.length) out.push("## Action items\n" + actions.map((a) => `- [id ${a.id}] (${a.status}, ${a.bucket}) ${a.title}`).join("\n"));
    if (interactions.length) out.push("## Interactions\n" + interactions.map((i) => `- ${i.date} (${i.pname ?? i.cname ?? "?"}): ${i.summary.slice(0, 140).replace(/\n/g, " ")}`).join("\n"));
    return text(out.length ? out.join("\n\n") : "No matches.");
  }
);

server.registerTool(
  "get_person",
  {
    title: "Get a person's full profile",
    description: "Full profile: snapshot, all sections, opportunities, open action items, recent interaction log. Accepts a slug (e.g. 'sam-lee') or a name fragment.",
    inputSchema: { person: z.string() },
  },
  async ({ person }) => {
    const p = findPerson(person);
    return p ? text(personCard(p)) : fail(`${whyNot("person", person)}. Try search_crm.`);
  }
);

server.registerTool(
  "get_company",
  {
    title: "Get a company's full profile",
    description: "Full company profile incl. key people, sections, opportunities, interaction log. Accepts slug or name fragment.",
    inputSchema: { company: z.string() },
  },
  async ({ company }) => {
    const c = findCompany(company);
    return c ? text(companyCard(c)) : fail(`${whyNot("company", company)}. Try search_crm.`);
  }
);

server.registerTool(
  "list_people",
  {
    title: "List people",
    description: "Compact list of all people with status, company, last touch, next action. Optional filters.",
    inputSchema: {
      status: z.enum(Object.keys(STATUS)).optional().describe("Filter by pipeline status"),
      tag: z.string().optional().describe("Filter by tag substring, e.g. 'connector'"),
    },
  },
  async ({ status, tag }) => {
    let rows = db.prepare(
      `SELECT p.slug, p.name, p.status_key, p.status_note, p.last_touch, p.last_touch_note, p.next_action, p.tags, c.name AS company
       FROM people p LEFT JOIN companies c ON c.id = p.company_id ORDER BY p.name`
    ).all();
    if (status) rows = rows.filter((r) => r.status_key === status);
    if (tag) rows = rows.filter((r) => (r.tags ?? "").includes(tag));
    return text(rows.map((r) =>
      `- ${r.name} [${r.slug}] — ${statusLine(r)} · ${r.company ?? "no company"} · last touch ${r.last_touch ?? (r.last_touch_note ? `undated (${r.last_touch_note})` : "—")}${r.next_action ? ` · next: ${r.next_action}` : ""}`
    ).join("\n") || "No matches.");
  }
);

server.registerTool(
  "get_agenda",
  {
    title: "Get the working agenda",
    description: "What needs attention now: overdue actions, dated/this-week items, awaiting-other-party, missing-outcome logs, and contacts due for a keep-warm touch. The right tool for 'what should I do today / who should I follow up with?'",
    inputSchema: {},
  },
  async () => {
    const open = db.prepare(
      `SELECT a.id,
              CASE WHEN a.due_date IS NOT NULL AND a.due_date < date('now','localtime') THEN 'overdue' ELSE a.bucket END AS bucket,
              COALESCE(a.due_date, a.due_label) AS due_label, a.title, p.name AS pname, c.name AS cname
       FROM action_items a LEFT JOIN people p ON p.id=a.person_id LEFT JOIN companies c ON c.id=a.company_id
       WHERE a.status='open' ORDER BY a.due_date IS NULL, a.due_date, a.id`
    ).all();
    const out = [];
    // The action-oriented buckets only; outreach/keep-warm/data-gap lists are the app's job.
    for (const bucket of ["overdue", "this_week", "awaiting", "log_gap"].filter((b) => VOCAB.buckets[b])) {
      const label = `${VOCAB.buckets[bucket].icon} ${VOCAB.buckets[bucket].label}`.trim();
      const items = open.filter((a) => a.bucket === bucket);
      if (items.length) out.push(`## ${label}\n` + items.map((a) =>
        `- [id ${a.id}]${a.due_label ? ` (due ${a.due_label})` : ""} ${a.title}${a.pname ? ` — ${a.pname}` : ""}${a.cname ? ` / ${a.cname}` : ""}`
      ).join("\n"));
    }
    const due = db.prepare(
      `SELECT name, slug, cadence_days, last_touch, last_touch_note,
              CAST(julianday('now','localtime') - julianday(last_touch) AS INTEGER) AS days_since
       FROM people WHERE cadence_days IS NOT NULL AND status_key NOT IN ('lost')`
    ).all().map((r) => ({ ...r, over: r.days_since == null ? 9999 : r.days_since - r.cadence_days }))
      .filter((r) => r.over > 0).sort((a, b) => b.over - a.over).slice(0, 12);
    if (due.length) out.push(`## ♨ Due for a keep-warm touch\n` + due.map((r) =>
      `- ${r.name} [${r.slug}] — ${r.over >= 9999 ? (r.last_touch_note ? "no dated touch" : "never touched") : `${r.over}d over cadence`} (last: ${r.last_touch ?? r.last_touch_note ?? "never"})`
    ).join("\n"));
    return text(out.join("\n\n") || "Agenda is clear.");
  }
);

server.registerTool(
  "get_pipeline",
  {
    title: "Get the opportunity pipeline",
    description: "All opportunities grouped by stage, with kind, who, economics, priority, and next step.",
    inputSchema: {},
  },
  async () => {
    const rows = db.prepare(
      `SELECT o.*, p.name AS pname, c.name AS cname FROM opportunities o
       LEFT JOIN people p ON p.id=o.person_id LEFT JOIN companies c ON c.id=o.company_id
       ORDER BY o.priority, o.name`
    ).all();
    const out = [];
    for (const stage of STAGES) {
      const items = rows.filter((o) => o.stage === stage);
      if (items.length) out.push(`## ${stage}\n` + items.map((o) =>
        `- [id ${o.id}]${o.priority === 1 ? " ★" : ""} ${o.name} (${o.kind})${o.pname ? ` — ${o.pname}` : ""}${o.cname ? ` / ${o.cname}` : ""}${o.value_note ? `\n  value: ${o.value_note}` : ""}${o.next_step ? `\n  next: ${o.next_step}` : ""}`
      ).join("\n"));
    }
    return text(out.join("\n\n") || "Pipeline is empty.");
  }
);

server.registerTool(
  "log_interaction",
  {
    title: "Log an interaction",
    description: "Record a call/email/meeting on a person (and optionally their company). Bumps last-touch and resets the keep-warm clock. Capture substance: what was discussed, decisions, surprises, agreed next step. Markdown supported; preserve important inbound messages verbatim in a blockquote.",
    inputSchema: {
      person: z.string().optional().describe("Person slug or name (at least one of person/company required)"),
      company: z.string().optional().describe("Company slug or name"),
      date: z.string().describe("YYYY-MM-DD"),
      channel: z.string().optional().describe("Call · Email · Meeting · LinkedIn…"),
      summary: z.string().describe("Markdown summary of substance and next step"),
      next_action: z.string().optional().describe("If set, updates the person's next action"),
    },
  },
  async ({ person, company, date, channel, summary, next_action }) => {
    const p = person ? findPerson(person) : null;
    const c = company ? findCompany(company) : p?.company_id ? db.prepare(`SELECT * FROM companies WHERE id=?`).get(p.company_id) : null;
    if (person && !p) return fail(`${whyNot("person", person)}.`);
    if (company && !c) return fail(`${whyNot("company", company)}.`);
    if (!p && !c) return fail("Provide person and/or company.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("date must be YYYY-MM-DD.");
    db.prepare(`INSERT INTO interactions (person_id, company_id, date, channel, summary) VALUES (?,?,?,?,?)`)
      .run(p?.id ?? null, c?.id ?? null, date, channel ?? null, summary);
    if (p) bumpLastTouch("people", p.id, date);
    if (c) bumpLastTouch("companies", c.id, date);
    if (next_action && p) db.prepare(`UPDATE people SET next_action=? WHERE id=?`).run(next_action, p.id);
    return text(`Logged ${date} interaction on ${[p?.name, c?.name].filter(Boolean).join(" / ")}. Last-touch updated.${next_action && p ? " Next action updated." : ""}`);
  }
);

server.registerTool(
  "write_profile_section",
  {
    title: "Write a profile section",
    description: "Write or append markdown to a profile section of a person or company. Sections: relationship_intel, business_context, engagement_strategy, notes, extra_sections (catch-all for anything that doesn't fit — never drop information). mode 'append' adds to the end; 'replace' overwrites the whole section.",
    inputSchema: {
      entity_type: z.enum(["person", "company"]),
      entity: z.string().describe("Slug or name"),
      section: z.enum(SECTIONS),
      markdown: z.string(),
      mode: z.enum(["append", "replace"]).default("append"),
    },
  },
  async ({ entity_type, entity, section, markdown, mode }) => {
    const row = entity_type === "person" ? findPerson(entity) : findCompany(entity);
    if (!row) return fail(`${whyNot(entity_type, entity)}.`);
    const table = entity_type === "person" ? "people" : "companies";
    const current = row[section];
    const value = mode === "replace" || !current ? markdown : `${current}\n${markdown}`;
    db.prepare(`UPDATE ${table} SET ${section}=?, updated_at=datetime('now') WHERE id=?`).run(value, row.id);
    return text(`${mode === "replace" ? "Replaced" : "Appended to"} ${section} on ${row.name}.`);
  }
);

server.registerTool(
  "update_person",
  {
    title: "Update a person's structured fields",
    description: "Update snapshot fields, status, next action, cadence, or tags. Only provided fields change. To move someone to a company, pass company (slug/name) — it must already exist (create_company first if not).",
    inputSchema: {
      person: z.string(),
      status: z.enum(Object.keys(STATUS)).optional(),
      status_note: z.string().optional().describe("Qualifier, e.g. 'retainer offer'"),
      next_action: z.string().optional(),
      role_title: z.string().optional(),
      company: z.string().optional(),
      company_note: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      location: z.string().optional(),
      linkedin: z.string().optional(),
      relationship_strength: z.enum(["Cold", "Acquaintance", "Warm", "Trusted"]).optional(),
      cadence_days: z.number().int().positive().optional(),
      tags: z.string().optional().describe("Comma-separated; replaces existing tags"),
    },
  },
  async (args) => {
    const p = findPerson(args.person);
    if (!p) return fail(`${whyNot("person", args.person)}.`);
    const sets = [];
    const vals = [];
    const map = {
      status: "status_key", status_note: "status_note", next_action: "next_action",
      role_title: "role_title", company_note: "company_note", email: "email", phone: "phone",
      location: "location", linkedin: "linkedin", relationship_strength: "relationship_strength",
      cadence_days: "cadence_days", tags: "tags",
    };
    for (const [k, col] of Object.entries(map)) {
      if (args[k] !== undefined && args[k] !== "") { sets.push(`${col}=?`); vals.push(args[k]); }
    }
    if (args.company !== undefined && args.company !== "") {
      const c = findCompany(args.company);
      if (!c) return fail(`${whyNot("company", args.company)} — create_company first.`);
      sets.push("company_id=?"); vals.push(c.id);
    }
    if (!sets.length) return fail("No fields provided.");
    db.prepare(`UPDATE people SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?`).run(...vals, p.id);
    return text(`Updated ${p.name}: ${sets.map((s) => s.split("=")[0]).join(", ")}.`);
  }
);

server.registerTool(
  "create_person",
  {
    title: "Create a person",
    description: "Create a new person profile. Before creating, search first to avoid duplicates. Enrich via web research when possible; put narrative into the section fields (markdown), and flag inferences vs. confirmed facts rather than inventing details.",
    inputSchema: {
      name: z.string(),
      role_title: z.string().optional(),
      company: z.string().optional().describe("Existing company slug/name to link"),
      status: z.enum(Object.keys(STATUS)).default("new"),
      email: z.string().optional(),
      linkedin: z.string().optional(),
      location: z.string().optional(),
      tags: z.string().optional(),
      cadence_days: z.number().int().positive().optional(),
      next_action: z.string().optional(),
      relationship_intel: z.string().optional().describe("Markdown: how you met, introduced by, strength, their role in decisions"),
      business_context: z.string().optional().describe("Markdown: their priorities, pain points, where the practice can help"),
      engagement_strategy: z.string().optional().describe("Markdown: next best action, value to offer, talking points"),
      notes: z.string().optional(),
    },
  },
  async (args) => {
    let slug = slugify(args.name);
    if (db.prepare(`SELECT 1 FROM people WHERE slug=?`).get(slug)) {
      return fail(`Slug '${slug}' already exists — is this a duplicate? Use get_person/update_person, or create with a differentiated name.`);
    }
    const c = args.company ? findCompany(args.company) : null;
    if (args.company && !c) return fail(`${whyNot("company", args.company)} — create_company first.`);
    db.prepare(
      `INSERT INTO people (slug, name, status_key, role_title, company_id, email, linkedin, location, tags, cadence_days, next_action, relationship_intel, business_context, engagement_strategy, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(slug, args.name, args.status ?? "new", args.role_title ?? null, c?.id ?? null,
      args.email ?? null, args.linkedin ?? null, args.location ?? null, args.tags ?? null,
      args.cadence_days ?? DEFAULT_CADENCE[args.status ?? "new"] ?? null, args.next_action ?? null, args.relationship_intel ?? null,
      args.business_context ?? null, args.engagement_strategy ?? null, args.notes ?? null);
    return text(`Created ${args.name} [${slug}].`);
  }
);

server.registerTool(
  "create_company",
  {
    title: "Create a company",
    description: "Create a new company profile. Search first to avoid duplicates.",
    inputSchema: {
      name: z.string(),
      industry: z.string().optional(),
      website: z.string().optional(),
      hq: z.string().optional(),
      status: z.enum(Object.keys(STATUS)).default("new"),
      business_context: z.string().optional().describe("Markdown"),
      next_action: z.string().optional(),
    },
  },
  async (args) => {
    let slug = slugify(args.name);
    if (db.prepare(`SELECT 1 FROM companies WHERE slug=?`).get(slug)) {
      return fail(`Slug '${slug}' already exists — likely a duplicate. Use get_company/update details instead.`);
    }
    db.prepare(
      `INSERT INTO companies (slug, name, status_key, industry, website, hq, business_context, next_action) VALUES (?,?,?,?,?,?,?,?)`
    ).run(slug, args.name, args.status ?? "new", args.industry ?? null, args.website ?? null,
      args.hq ?? null, args.business_context ?? null, args.next_action ?? null);
    return text(`Created ${args.name} [${slug}].`);
  }
);

server.registerTool(
  "update_company",
  {
    title: "Update a company's structured fields",
    description: "Update company snapshot fields, status, or next action. Only provided fields change.",
    inputSchema: {
      company: z.string(),
      status: z.enum(Object.keys(STATUS)).optional(),
      status_note: z.string().optional(),
      next_action: z.string().optional(),
      industry: z.string().optional(),
      website: z.string().optional(),
      hq: z.string().optional(),
      size: z.string().optional(),
      revenue_stage: z.string().optional(),
    },
  },
  async (args) => {
    const c = findCompany(args.company);
    if (!c) return fail(`${whyNot("company", args.company)}.`);
    const map = { status: "status_key", status_note: "status_note", next_action: "next_action", industry: "industry", website: "website", hq: "hq", size: "size", revenue_stage: "revenue_stage" };
    const sets = []; const vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (args[k] !== undefined) { sets.push(`${col}=?`); vals.push(args[k]); }
    }
    if (!sets.length) return fail("No fields provided.");
    db.prepare(`UPDATE companies SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?`).run(...vals, c.id);
    return text(`Updated ${c.name}: ${sets.map((s) => s.split("=")[0]).join(", ")}.`);
  }
);

server.registerTool(
  "add_action_item",
  {
    title: "Add an action item",
    description: `Add a to-do. Buckets: ${bucketList(VOCAB)}.`,
    inputSchema: {
      title: z.string(),
      bucket: z.enum(BUCKETS).default("this_week"),
      due: z.string().optional().describe("Due date (YYYY-MM-DD preferred) or freeform: '07-30', 'Fri 7/25', '~late summer', 'ASAP'"),
      person: z.string().optional(),
      company: z.string().optional(),
    },
  },
  async ({ title, bucket, due, person, company }) => {
    const p = person ? findPerson(person) : null;
    const c = company ? findCompany(company) : null;
    if (person && !p) return fail(`${whyNot("person", person)}.`);
    if (company && !c) return fail(`${whyNot("company", company)}.`);
    const r = db.prepare(`INSERT INTO action_items (bucket, due_label, due_date, title, person_id, company_id) VALUES (?,?,?,?,?,?)`)
      .run(bucket ?? "this_week", due ?? null, parseDueDate(due), title, p?.id ?? null, c?.id ?? null);
    return text(`Added action item [id ${r.lastInsertRowid}] to ${bucket}.`);
  }
);

server.registerTool(
  "complete_action_item",
  {
    title: "Complete (or reopen) an action item",
    description: "Mark an action item done by id (get ids from get_agenda or search_crm). Set reopen=true to un-complete.",
    inputSchema: { id: z.number().int(), reopen: z.boolean().default(false) },
  },
  async ({ id, reopen }) => {
    const row = db.prepare(`SELECT title, status FROM action_items WHERE id=?`).get(id);
    if (!row) return fail(`No action item with id ${id}.`);
    if (reopen) {
      db.prepare(`UPDATE action_items SET status='open', completed_at=NULL WHERE id=?`).run(id);
      return text(`Reopened [id ${id}] "${row.title}".`);
    }
    db.prepare(`UPDATE action_items SET status='done', completed_at=date('now','localtime') WHERE id=?`).run(id);
    return text(`Completed [id ${id}] "${row.title}".`);
  }
);

server.registerTool(
  "update_opportunity",
  {
    title: "Update a pipeline opportunity",
    description: `Move stage or update fields of an opportunity (ids from get_pipeline). Stages: ${stageList(VOCAB)}.`,
    inputSchema: {
      id: z.number().int(),
      stage: z.enum(STAGES).optional(),
      priority: z.number().int().min(1).max(3).optional().describe("1=high ★, 2=normal, 3=low"),
      value_note: z.string().optional(),
      next_step: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (args) => {
    const o = db.prepare(`SELECT * FROM opportunities WHERE id=?`).get(args.id);
    if (!o) return fail(`No opportunity with id ${args.id}.`);
    const map = { stage: "stage", priority: "priority", value_note: "value_note", next_step: "next_step", notes: "notes" };
    const sets = []; const vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (args[k] !== undefined) { sets.push(`${col}=?`); vals.push(args[k]); }
    }
    if (!sets.length) return fail("No fields provided.");
    db.prepare(`UPDATE opportunities SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?`).run(...vals, args.id);
    return text(`Updated "${o.name}": ${sets.map((s) => s.split("=")[0]).join(", ")}.`);
  }
);

server.registerTool(
  "create_opportunity",
  {
    title: "Create a pipeline opportunity",
    description: `Add a deal/engagement/partnership/venture to the pipeline. Kinds: ${kindList(VOCAB)}. Stages: ${stageList(VOCAB)}.`,
    inputSchema: {
      name: z.string(),
      kind: z.enum(KINDS).default(KINDS[0]),
      stage: z.enum(STAGES).default("identified"),
      person: z.string().optional(),
      company: z.string().optional(),
      value_note: z.string().optional().describe("Economics: retainer, % fee, project fee…"),
      priority: z.number().int().min(1).max(3).default(2),
      next_step: z.string().optional(),
    },
  },
  async (args) => {
    const p = args.person ? findPerson(args.person) : null;
    const c = args.company ? findCompany(args.company) : null;
    if (args.person && !p) return fail(`${whyNot("person", args.person)}.`);
    if (args.company && !c) return fail(`${whyNot("company", args.company)}.`);
    const r = db.prepare(
      `INSERT INTO opportunities (name, kind, stage, person_id, company_id, value_note, priority, next_step) VALUES (?,?,?,?,?,?,?,?)`
    ).run(args.name, args.kind ?? "engagement", args.stage ?? "identified", p?.id ?? null, c?.id ?? null,
      args.value_note ?? null, args.priority ?? 2, args.next_step ?? null);
    return text(`Created opportunity [id ${r.lastInsertRowid}] "${args.name}".`);
  }
);

await server.connect(new StdioServerTransport());

// Ensure today's backup exists whenever the CRM is being worked on.
import("../lib/backup.mjs").then(({ startBackupLoop }) => startBackupLoop(db)).catch(() => {});
