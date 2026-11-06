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
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  tightenPermissions(dbPath);
  return db;
}

/**
 * Make the database (and its WAL), and the private files beside it, readable
 * by this account only; and the folder too when it is the CRM's own `data`
 * folder (never a folder the owner chose for something else). Best effort,
 * and a no-op on Windows.
 */
export function tightenPermissions(dbPath) {
  if (process.platform === "win32") return;
  const dir = path.dirname(dbPath);
  const chmod = (p, mode) => {
    try {
      fs.chmodSync(p, mode);
    } catch {
      /* not there (yet), or not ours */
    }
  };
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) chmod(f, 0o600);
  for (const f of ["auth-token", "signin-once", "sessions.json", "server.log"]) chmod(path.join(dir, f), 0o600);
  if (path.basename(dir) === "data") chmod(dir, 0o700);
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
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
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

  // Mail-in: emails forwarded/copied to the CRM address, one row per Gmail
  // message, with the draft(s) they were routed to.
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
      id INTEGER PRIMARY KEY,
      gmail_id TEXT NOT NULL UNIQUE,
      thread_id TEXT,
      subject TEXT,
      sender TEXT,
      recipients TEXT,
      date TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      route TEXT,
      log_draft_id INTEGER,
      intake_draft_ids TEXT,
      note TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    -- News Feed: web news about roster people and companies, found by a
    -- daily Claude run with web search only. Dismissed items are kept (so the
    -- same story never comes back) but hidden. about = JSON list of refs
    -- ("p:<slug>" / "c:<slug>").
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      url_key TEXT NOT NULL UNIQUE,
      headline TEXT NOT NULL,
      headline_key TEXT NOT NULL,
      source TEXT,
      summary TEXT,
      published TEXT,
      about TEXT NOT NULL DEFAULT '[]',
      found_at TEXT DEFAULT (datetime('now')),
      dismissed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS news_items_headline ON news_items(headline_key);

    -- When each person/company was last searched for news (kind 'p' or 'c').
    CREATE TABLE IF NOT EXISTS news_checks (
      kind TEXT NOT NULL,
      subject_id INTEGER NOT NULL,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (kind, subject_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // News Feed became opt-in. An install that had already run it by then (a
  // last-run stamp and no explicit choice) keeps it on. Done once, behind a
  // marker, so a later one-off "Check now" can't switch the daily search on.
  db.exec(`
    INSERT OR IGNORE INTO settings (key, value)
      SELECT 'news.enabled', 'on'
      WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'news.last_run_at')
        AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'migrated.news_opt_in');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('migrated.news_opt_in', '1');
  `);

  // Chat role used to be stored under the owner's first name; normalise it.
  try {
    db.prepare(`UPDATE coach_messages SET role='owner' WHERE role NOT IN ('owner','coach','crm')`).run();
  } catch {
    /* table not there yet on a brand-new DB (created above) */
  }

  // A profile section's previous text whenever Claude Desktop (the MCP
  // server) replaces it, so a replace is never a silent delete.
  db.exec(`
    CREATE TABLE IF NOT EXISTS section_history (
      id INTEGER PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      section TEXT NOT NULL,
      value TEXT,
      replaced_by TEXT,
      replaced_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Lightweight migrations for columns added after the first release.
  for (const stmt of [
    `ALTER TABLE people ADD COLUMN cadence_days INTEGER`,
    `ALTER TABLE people ADD COLUMN tags TEXT`,
    `ALTER TABLE intake_drafts ADD COLUMN progress TEXT`,
    `ALTER TABLE log_drafts ADD COLUMN progress TEXT`,
    `ALTER TABLE log_drafts ADD COLUMN fetched_text TEXT`,
    // Set when the Log page was opened from a profile ("Draft with AI" link):
    // the model attributes the content to that contact even if unnamed.
    `ALTER TABLE log_drafts ADD COLUMN hint_person_id INTEGER`,
    `ALTER TABLE log_drafts ADD COLUMN hint_company_id INTEGER`,
    `ALTER TABLE people ADD COLUMN last_touch_note TEXT`,
    `ALTER TABLE companies ADD COLUMN last_touch_note TEXT`,
    `ALTER TABLE action_items ADD COLUMN due_date TEXT`,
    `ALTER TABLE briefs ADD COLUMN progress TEXT`,
    // 'reply' | 'close' while a chat turn / closing summary is running; NULL otherwise.
    `ALTER TABLE coach_sessions ADD COLUMN in_flight TEXT`,
    // Mail-in: people on the email who were NOT sent to Intake (JSON list of
    // {name, email}); the queue offers a per-person "add" button for them.
    `ALTER TABLE inbox_messages ADD COLUMN pending_people TEXT`,
    // What a confirmed Log or Intake draft saved (JSON), for the "Saved …" receipt.
    `ALTER TABLE log_drafts ADD COLUMN receipt TEXT`,
    `ALTER TABLE intake_drafts ADD COLUMN receipt TEXT`,
    // Which steps of a brief ran ("checked" / "not checked: why"), shown above it (JSON).
    `ALTER TABLE briefs ADD COLUMN checks TEXT`,
    // 'inbox' for a draft made from a mail-in email (or handed over from one):
    // it never switches to Claude by itself. Set when the draft is created, so
    // it holds before the email row records the draft.
    `ALTER TABLE log_drafts ADD COLUMN origin TEXT`,
    `ALTER TABLE intake_drafts ADD COLUMN origin TEXT`,
    // 1 when Gmail filed the email as Sent from the owner's own account: only
    // then is a note at its top read as the owner's instructions.
    `ALTER TABLE inbox_messages ADD COLUMN verified INTEGER`,
  ]) {
    try {
      db.exec(stmt);
    } catch (err) {
      if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
    }
  }

  // Inbox unread badge: set when an email is opened (or "Mark all read").
  // Everything that arrived before this column existed counts as read.
  try {
    db.exec(`ALTER TABLE inbox_messages ADD COLUMN read_at TEXT`);
    db.exec(`UPDATE inbox_messages SET read_at = datetime('now')`);
  } catch (err) {
    if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
  }

  // A touch date with no interaction behind it (an imported "connected on"):
  // deleting interactions never takes last_touch below it. When the column is
  // added, a last_touch that no interaction backs (import, early data) is one.
  try {
    db.exec(`ALTER TABLE people ADD COLUMN connected_on TEXT`);
    db.exec(`
      UPDATE people SET connected_on = last_touch
      WHERE last_touch GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.person_id = people.id AND i.date >= people.last_touch)
    `);
  } catch (err) {
    if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
  }

  // A name with no Latin letters used to give an empty slug, and a profile at
  // "/people/" that couldn't be opened. Give any such row one that works.
  db.exec(`
    UPDATE people SET slug = 'person-' || id || '-' || lower(hex(randomblob(3))) WHERE slug = '';
    UPDATE companies SET slug = 'company-' || id || '-' || lower(hex(randomblob(3))) WHERE slug = '';
  `);

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
        closed_at TEXT,
        in_flight TEXT
      );
      INSERT INTO coach_sessions_v2 (id, week_start, status, advice_md, summary_md, error, progress, created_at, closed_at)
        SELECT id, week_start, status, advice_md, summary_md, error, progress, created_at, closed_at FROM coach_sessions;
      DROP TABLE coach_sessions;
      ALTER TABLE coach_sessions_v2 RENAME TO coach_sessions;
      COMMIT;
    `);
    db.pragma("foreign_keys = ON");
  }

  // Check-ins used to store created_at in local time; every other row is UTC
  // (SQLite's default), and screens read it as UTC. Converted once, behind a marker.
  db.exec(`
    UPDATE coach_sessions SET created_at = datetime(created_at, 'utc')
      WHERE kind = 'checkin' AND created_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'migrated.checkin_utc');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('migrated.checkin_utc', '1');
  `);

  // interactions v1 had company_id ON DELETE CASCADE, so deleting a company
  // silently wiped every interaction logged against one of its people. Rebuild
  // with ON DELETE SET NULL (person_id keeps CASCADE). Detected from the stored
  // DDL, so this runs once per database.
  const interactionsDdl = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='interactions'`)
    .get();
  if (
    interactionsDdl?.sql &&
    /company_id INTEGER REFERENCES companies\(id\) ON DELETE CASCADE/.test(interactionsDdl.sql)
  ) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec(`
        BEGIN;
        DROP TABLE IF EXISTS interactions_v2;
        CREATE TABLE interactions_v2 (
          id INTEGER PRIMARY KEY,
          person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
          company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          date TEXT NOT NULL,
          channel TEXT,
          summary TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO interactions_v2 (id, person_id, company_id, date, channel, summary, created_at)
          SELECT id, person_id, company_id, date, channel, summary, created_at FROM interactions;
        DROP TABLE interactions;
        ALTER TABLE interactions_v2 RENAME TO interactions;
        COMMIT;
      `);
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* no open transaction */
      }
      throw err;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  // Foreign keys the list pages, the Dashboard and Keep Warm look up by
  // (after the table rebuilds above, which would drop an index on the old table).
  db.exec(`
    CREATE INDEX IF NOT EXISTS people_company ON people(company_id);
    CREATE INDEX IF NOT EXISTS interactions_person_date ON interactions(person_id, date);
    CREATE INDEX IF NOT EXISTS interactions_company_date ON interactions(company_id, date);
    CREATE INDEX IF NOT EXISTS action_items_person ON action_items(person_id);
    CREATE INDEX IF NOT EXISTS opportunities_person ON opportunities(person_id);
  `);

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

