import { tmp } from "./helpers/tempdb";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../lib/db";
import { confirmLog } from "../lib/logmeeting";
import { confirmIntake } from "../lib/intake";

after(() => tmp.cleanup());

const db = getDb();
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
/** Outside a request, Next's redirect/revalidate throw once the work is done: only the database matters here. */
const run = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch {
    /* redirect or revalidate after a successful commit, or the failure under test */
  }
};
const failActionInserts = () =>
  db.exec(`CREATE TRIGGER IF NOT EXISTS fail_actions BEFORE INSERT ON action_items BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);
const allowActionInserts = () => db.exec(`DROP TRIGGER IF EXISTS fail_actions`);

describe("confirming a Log draft", () => {
  beforeEach(() => {
    allowActionInserts();
    db.exec(`DELETE FROM interactions; DELETE FROM action_items; DELETE FROM log_drafts; DELETE FROM people;`);
    db.prepare(`INSERT INTO people (slug, name, last_touch, updated_at) VALUES ('sam-lee', 'Sam Lee', '2026-11-01', '2026-01-01 00:00:00')`).run();
    db.prepare(`INSERT INTO log_drafts (id, raw_text, status, result_json) VALUES (1, 'notes', 'ready', '{}')`).run();
  });
  const fields = {
    draft_id: "1",
    date: "2026-10-30",
    entry_slug_0: "sam-lee",
    entry_0: "on",
    entry_summary_0: "Talked about the renewal.",
    entry_next_0: "Send the proposal",
    action_0: "on",
    action_title_0: "Send the proposal",
  };

  test("a failure part-way writes nothing and leaves the draft ready to confirm again", async () => {
    failActionInserts();
    await assert.rejects(confirmLog(form(fields)), /simulated failure/);
    assert.equal(count(`SELECT COUNT(*) n FROM interactions`), 0);
    assert.equal((db.prepare(`SELECT next_action FROM people WHERE slug='sam-lee'`).get() as { next_action: string | null }).next_action, null);
    assert.equal((db.prepare(`SELECT status FROM log_drafts WHERE id=1`).get() as { status: string }).status, "ready");
  });

  test("a success writes everything, marks the draft confirmed, and bumps updated_at with the next action", async () => {
    await run(() => confirmLog(form(fields)));
    assert.equal(count(`SELECT COUNT(*) n FROM interactions`), 1);
    assert.equal(count(`SELECT COUNT(*) n FROM action_items`), 1);
    assert.equal((db.prepare(`SELECT status FROM log_drafts WHERE id=1`).get() as { status: string }).status, "confirmed");
    const p = db.prepare(`SELECT next_action, updated_at FROM people WHERE slug='sam-lee'`).get() as { next_action: string; updated_at: string };
    assert.equal(p.next_action, "Send the proposal");
    assert.notEqual(p.updated_at, "2026-01-01 00:00:00", "an older interaction doesn't bump last touch, but the next action still counts as an edit");
  });
});

describe("confirming an Intake draft", () => {
  beforeEach(() => {
    allowActionInserts();
    db.exec(`DELETE FROM interactions; DELETE FROM action_items; DELETE FROM intake_drafts; DELETE FROM people; DELETE FROM companies;`);
    db.prepare(`INSERT INTO intake_drafts (id, raw_text, status, result_json) VALUES (1, 'profile', 'ready', '{}')`).run();
  });
  const fields = {
    draft_id: "1",
    name: "Jordan Vale",
    status_key: "new",
    company_mode: "new",
    company_name: "Vale Analytics",
    action_0: "on",
    action_title_0: "Say hello",
  };

  test("a failure part-way leaves no half-created person or company", async () => {
    failActionInserts();
    await assert.rejects(confirmIntake(form(fields)), /simulated failure/);
    assert.equal(count(`SELECT COUNT(*) n FROM people`), 0);
    assert.equal(count(`SELECT COUNT(*) n FROM companies`), 0);
    assert.equal((db.prepare(`SELECT status FROM intake_drafts WHERE id=1`).get() as { status: string }).status, "ready");
  });

  test("a success creates the person, the company and the to-do together", async () => {
    await run(() => confirmIntake(form(fields)));
    assert.equal(count(`SELECT COUNT(*) n FROM people`), 1);
    assert.equal(count(`SELECT COUNT(*) n FROM companies`), 1);
    assert.equal(count(`SELECT COUNT(*) n FROM action_items`), 1);
    assert.equal((db.prepare(`SELECT status FROM intake_drafts WHERE id=1`).get() as { status: string }).status, "confirmed");
  });
});
