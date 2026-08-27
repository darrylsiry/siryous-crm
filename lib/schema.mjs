/**
 * Database schema + lightweight migrations, shared by the web app (lib/db.ts)
 * and the MCP server (scripts/mcp-server.mjs) so either can bootstrap a fresh
 * database. Plain JS so both TypeScript and .mjs callers can import it.
 */
import fs from "node:fs";
import path from "node:path";
import { isIsoDate, parseDueDate, splitLastTouch } from "./dates.mjs";

/** Open (creating the data directory if needed), set pragmas, and migrate. */
export function openDatabase(Database, dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status_key TEXT NOT NULL DEFAULT 'new',
      status_note TEXT,
      industry TEXT,
      size TEXT,
      hq TEXT,
      website TEXT,
      revenue_stage TEXT,
      business_context TEXT,
      relationship_intel TEXT,
      engagement_strategy TEXT,
      extra_sections TEXT,
      notes TEXT,
      last_touch TEXT,
      next_action TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status_key TEXT NOT NULL DEFAULT 'new',
      status_note TEXT,
      role_title TEXT,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      company_note TEXT,
      location TEXT,
      email TEXT,
      phone TEXT,
      linkedin TEXT,
      relationship_strength TEXT,
      relationship_intel TEXT,
      business_context TEXT,
      engagement_strategy TEXT,
      extra_sections TEXT,
      notes TEXT,
      last_touch TEXT,
      next_action TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY,
      person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      channel TEXT,
      summary TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY,
      bucket TEXT NOT NULL DEFAULT 'this_week',
      due_label TEXT,
      title TEXT NOT NULL,
      detail TEXT,
      person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outreach (
      id INTEGER PRIMARY KEY,
      person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      date TEXT,
      topic TEXT,
      title TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'engagement',
      stage TEXT NOT NULL DEFAULT 'identified',
      person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      value_note TEXT,
      priority INTEGER NOT NULL DEFAULT 2,
      next_step TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY,
      from_person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      to_person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      label TEXT
    );

    CREATE TABLE IF NOT EXISTS intake_drafts (
      id INTEGER PRIMARY KEY,
      raw_text TEXT NOT NULL,
      result_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS log_drafts (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'paste',
      raw_text TEXT NOT NULL,
      result_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS briefs (
      id INTEGER PRIMARY KEY,
      person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      focus TEXT,
      content_md TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS coach_sessions (
      id INTEGER PRIMARY KEY,
      week_start TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'weekly',
      status TEXT NOT NULL DEFAULT 'analyzing',
      advice_md TEXT,
      summary_md TEXT,
      error TEXT,
      progress TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS coach_messages (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES coach_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content_md TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_proposals (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES coach_sessions(id) ON DELETE CASCADE,
      message_id INTEGER REFERENCES coach_messages(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      action_id INTEGER,
      title TEXT NOT NULL,
      bucket TEXT,
      due_label TEXT,
      person_slug TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Chat role used to be stored under the owner's first name; normalise it.
  try {
    db.prepare(`UPDATE coach_messages SET role='owner' WHERE role NOT IN ('owner','coach','crm')`).run();
  } catch {
    /* table not there yet on a brand-new DB (created above) */
  }

  // Lightweight migrations for columns added after the first release.
  for (const stmt of [
    `ALTER TABLE people ADD COLUMN cadence_days INTEGER`,
    `ALTER TABLE people ADD COLUMN tags TEXT`,
    `ALTER TABLE intake_drafts ADD COLUMN progress TEXT`,
    `ALTER TABLE log_drafts ADD COLUMN progress TEXT`,
    `ALTER TABLE log_drafts ADD COLUMN fetched_text TEXT`,
    `ALTER TABLE people ADD COLUMN last_touch_note TEXT`,
    `ALTER TABLE companies ADD COLUMN last_touch_note TEXT`,
    `ALTER TABLE action_items ADD COLUMN due_date TEXT`,
    `ALTER TABLE briefs ADD COLUMN progress TEXT`,
  ]) {
    try {
      db.exec(stmt);
    } catch (err) {
      if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
    }
  }

  // coach_sessions v1 had UNIQUE(week_start); ad-hoc check-ins mean multiple
  // sessions per week, so rebuild the table without the constraint (+ kind).
  const coachDdl = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_sessions'`)
    .get();
  if (coachDdl?.sql.includes("UNIQUE")) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      BEGIN;
      CREATE TABLE coach_sessions_v2 (
        id INTEGER PRIMARY KEY,
        week_start TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'weekly',
        status TEXT NOT NULL DEFAULT 'analyzing',
        advice_md TEXT,
        summary_md TEXT,
        error TEXT,
        progress TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        closed_at TEXT
      );
      INSERT INTO coach_sessions_v2 (id, week_start, status, advice_md, summary_md, error, progress, created_at, closed_at)
        SELECT id, week_start, status, advice_md, summary_md, error, progress, created_at, closed_at FROM coach_sessions;
      DROP TABLE coach_sessions;
      ALTER TABLE coach_sessions_v2 RENAME TO coach_sessions;
      COMMIT;
    `);
    db.pragma("foreign_keys = ON");
  }

  normaliseDates(db);
}

/**
 * One-off, idempotent: last_touch must be an ISO date (or NULL) so keep-warm
 * math and the "newest interaction wins" bump work; any free text that used
 * to live there ("recent call", "2026-06-23 (phone catch-up)") moves to
 * last_touch_note, and an undated value falls back to the newest dated
 * interaction. Action items get a machine-readable due_date parsed from their
 * free-text due_label so "overdue" can be computed instead of hand-labelled.
 */
function normaliseDates(db) {
  const tx = db.transaction(() => {
    for (const [table, fk] of [["people", "person_id"], ["companies", "company_id"]]) {
      const rows = db
        .prepare(`SELECT id, last_touch FROM ${table} WHERE last_touch IS NOT NULL AND last_touch NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)
        .all();
      for (const r of rows) {
        const { date, note } = splitLastTouch(r.last_touch);
        const newest = db
          .prepare(`SELECT MAX(date) AS d FROM interactions WHERE ${fk} = ? AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)
          .get(r.id)?.d;
        const finalDate = date ?? (isIsoDate(newest) ? newest : null);
        db.prepare(`UPDATE ${table} SET last_touch = ?, last_touch_note = COALESCE(last_touch_note, ?) WHERE id = ?`).run(finalDate, note, r.id);
      }
    }
    const items = db
      .prepare(`SELECT id, due_label, created_at FROM action_items WHERE due_date IS NULL AND due_label IS NOT NULL`)
      .all();
    for (const a of items) {
      const due = parseDueDate(a.due_label, String(a.created_at ?? "").slice(0, 10));
      if (due) db.prepare(`UPDATE action_items SET due_date = ? WHERE id = ?`).run(due, a.id);
    }
  });
  tx();
}

