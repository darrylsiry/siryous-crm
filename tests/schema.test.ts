import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema, openDatabase } from "../lib/schema.mjs";
import { makeTmpDir } from "./helpers/tmp";

const tmp = makeTmpDir("schema");
after(() => tmp.cleanup());

const EXPECTED_TABLES = [
  "companies",
  "people",
  "interactions",
  "action_items",
  "outreach",
  "opportunities",
  "connections",
  "intake_drafts",
  "log_drafts",
  "briefs",
  "coach_sessions",
  "coach_messages",
  "coach_proposals",
  "inbox_messages",
  "settings",
];

function tableNames(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map(
    (r) => r.name
  );
}

function columns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

describe("openDatabase", () => {
  test("creates the parent directory, the schema, and sets pragmas", () => {
    const dbPath = path.join(tmp.dir, "nested", "deeper", "crm.db");
    assert.equal(fs.existsSync(path.dirname(dbPath)), false);
    const db = openDatabase(Database, dbPath) as Database.Database;
    try {
      assert.ok(fs.existsSync(dbPath));
      assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
      assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
      const names = tableNames(db);
      for (const t of EXPECTED_TABLES) assert.ok(names.includes(t), `missing table ${t}`);

      // Columns added by the ALTER TABLE migration list exist on a fresh DB too.
      assert.ok(columns(db, "people").includes("cadence_days"));
      assert.ok(columns(db, "people").includes("tags"));
      assert.ok(columns(db, "people").includes("last_touch_note"));
      assert.ok(columns(db, "companies").includes("last_touch_note"));
      assert.ok(columns(db, "action_items").includes("due_date"));
      assert.ok(columns(db, "briefs").includes("progress"));
      assert.ok(columns(db, "log_drafts").includes("fetched_text"));
      assert.ok(columns(db, "log_drafts").includes("hint_person_id"));
      assert.ok(columns(db, "log_drafts").includes("hint_company_id"));
    } finally {
      db.close();
    }
  });

  test("running it twice on the same file is idempotent and keeps data", () => {
    const dbPath = path.join(tmp.dir, "twice.db");
    const first = openDatabase(Database, dbPath) as Database.Database;
    first.prepare(`INSERT INTO people (slug, name) VALUES ('sam-lee', 'Sam Lee')`).run();
    const before = { tables: tableNames(first), peopleCols: columns(first, "people") };
    first.close();

    const second = openDatabase(Database, dbPath) as Database.Database;
    try {
      assert.deepEqual(tableNames(second), before.tables);
      assert.deepEqual(columns(second, "people"), before.peopleCols);
      assert.equal((second.prepare(`SELECT COUNT(*) AS n FROM people`).get() as { n: number }).n, 1);
      // And a third initSchema on an open connection is harmless.
      initSchema(second);
      assert.equal((second.prepare(`SELECT COUNT(*) AS n FROM people`).get() as { n: number }).n, 1);
    } finally {
      second.close();
    }
  });
});

describe("date normalisation migration", () => {
  test("legacy last_touch values and due labels are normalised on the next initSchema", () => {
    const dbPath = path.join(tmp.dir, "migrate.db");
    const db = openDatabase(Database, dbPath) as Database.Database;
    try {
      const insertPerson = db.prepare(`INSERT INTO people (slug, name, last_touch) VALUES (?, ?, ?)`);
      insertPerson.run("dated-note", "Dated Note", "2026-06-23 (phone catch-up)");
      insertPerson.run("undated", "Undated", "recent call");
      insertPerson.run("undated-with-log", "Undated With Log", "recent call");
      insertPerson.run("clean", "Clean", "2026-07-15");
      insertPerson.run("kept-note", "Kept Note", "2026-05-01 — lunch");

      const withLog = db.prepare(`SELECT id FROM people WHERE slug='undated-with-log'`).get() as { id: number };
      db.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, '2026-05-02', 'older')`).run(withLog.id);
      db.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, '2026-06-10', 'newest')`).run(withLog.id);
      db.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, 'sometime', 'undated')`).run(withLog.id);

      // An existing note must not be overwritten by the migration.
      db.prepare(`UPDATE people SET last_touch_note='already here' WHERE slug='kept-note'`).run();

      db.prepare(`INSERT INTO companies (slug, name, last_touch) VALUES ('acme', 'Acme', '2026-06-01 (site visit)')`).run();

      const insertItem = db.prepare(`INSERT INTO action_items (title, due_label, created_at) VALUES (?, ?, ?)`);
      insertItem.run("Approximate", "~07-22", "2026-07-17 10:00:00");
      insertItem.run("Named month", "Aug 31", "2026-07-17 10:00:00");
      insertItem.run("Rolls over", "01-05", "2026-07-17 10:00:00");
      insertItem.run("Vague", "ASAP", "2026-07-17 10:00:00");
      insertItem.run("No label", null, "2026-07-17 10:00:00");

      initSchema(db);

      const person = (slug: string) =>
        db.prepare(`SELECT last_touch, last_touch_note FROM people WHERE slug=?`).get(slug) as {
          last_touch: string | null;
          last_touch_note: string | null;
        };
      assert.deepEqual(person("dated-note"), { last_touch: "2026-06-23", last_touch_note: "phone catch-up" });
      assert.deepEqual(person("undated"), { last_touch: null, last_touch_note: "recent call" });
      assert.deepEqual(person("undated-with-log"), { last_touch: "2026-06-10", last_touch_note: "recent call" });
      assert.deepEqual(person("clean"), { last_touch: "2026-07-15", last_touch_note: null });
      assert.deepEqual(person("kept-note"), { last_touch: "2026-05-01", last_touch_note: "already here" });

      const company = db.prepare(`SELECT last_touch, last_touch_note FROM companies WHERE slug='acme'`).get();
      assert.deepEqual(company, { last_touch: "2026-06-01", last_touch_note: "site visit" });

      const due = (title: string) => (db.prepare(`SELECT due_date FROM action_items WHERE title=?`).get(title) as { due_date: string | null }).due_date;
      assert.equal(due("Approximate"), "2026-07-22");
      assert.equal(due("Named month"), "2026-08-31");
      assert.equal(due("Rolls over"), "2027-01-05");
      assert.equal(due("Vague"), null);
      assert.equal(due("No label"), null);

      // Idempotent: a second run changes nothing.
      const snapshot = () => ({
        people: db.prepare(`SELECT slug, last_touch, last_touch_note FROM people ORDER BY id`).all(),
        items: db.prepare(`SELECT title, due_date FROM action_items ORDER BY id`).all(),
      });
      const before = snapshot();
      initSchema(db);
      assert.deepEqual(snapshot(), before);
    } finally {
      db.close();
    }
  });

  test("a v1 coach_sessions table with UNIQUE(week_start) is rebuilt with a kind column", () => {
    const dbPath = path.join(tmp.dir, "coach-v1.db");
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE coach_sessions (
          id INTEGER PRIMARY KEY,
          week_start TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'analyzing',
          advice_md TEXT, summary_md TEXT, error TEXT, progress TEXT,
          created_at TEXT DEFAULT (datetime('now')), closed_at TEXT
        );
        INSERT INTO coach_sessions (week_start, status, advice_md) VALUES ('2026-07-13', 'closed', 'Old advice');
      `);
      initSchema(db);
      const ddl = (db.prepare(`SELECT sql FROM sqlite_master WHERE name='coach_sessions'`).get() as { sql: string }).sql;
      assert.doesNotMatch(ddl, /UNIQUE/);
      assert.ok(columns(db, "coach_sessions").includes("kind"));
      const row = db.prepare(`SELECT week_start, kind, advice_md FROM coach_sessions`).get();
      assert.deepEqual(row, { week_start: "2026-07-13", kind: "weekly", advice_md: "Old advice" });
      // Two sessions in one week are now allowed.
      db.prepare(`INSERT INTO coach_sessions (week_start, kind) VALUES ('2026-07-13', 'checkin')`).run();
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM coach_sessions`).get() as { n: number }).n, 2);
    } finally {
      db.close();
    }
  });
});
