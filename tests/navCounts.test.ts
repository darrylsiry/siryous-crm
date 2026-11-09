import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
// Must come first: points CRM_DB_PATH at a temp file before lib/db is loaded.
import "./helpers/tempdb";
import { getDb } from "../lib/db";
import { navCounts, markNewsSeen } from "../lib/navCounts";
import { markInboxRead } from "../lib/inbox";
import { setSetting } from "../lib/settings";

const ids: Record<string, number> = {};

before(() => {
  const db = getDb();
  const log = db.prepare(`INSERT INTO log_drafts (raw_text, status) VALUES ('x', ?)`);
  const intake = db.prepare(`INSERT INTO intake_drafts (raw_text, status) VALUES ('x', ?)`);
  ids.logReady = Number(log.run("ready").lastInsertRowid);
  ids.logDone = Number(log.run("confirmed").lastInsertRowid);
  log.run("error");
  ids.intakeReady = Number(intake.run("ready").lastInsertRowid);
  ids.intakeDone = Number(intake.run("discarded").lastInsertRowid);

  const msg = db.prepare(
    `INSERT INTO inbox_messages (gmail_id, body, status, log_draft_id, intake_draft_ids) VALUES (?, 'b', ?, ?, ?)`
  );
  const m = (k: string, status: string, logId: number | null, intakeIds: number[] | null) =>
    (ids[k] = Number(msg.run(k, status, logId, intakeIds ? JSON.stringify(intakeIds) : null).lastInsertRowid));
  m("open-log", "routed", ids.logReady, null); // a draft to review
  m("open-intake", "routed", ids.logDone, [ids.intakeReady]); // its intake still waits
  m("all-done", "routed", ids.logDone, [ids.intakeDone]); // everything dealt with
  m("ignored", "ignored", null, null); // never counts
  m("unrouted", "new", null, null); // nothing to review yet

  db.prepare(`INSERT INTO action_items (title, status) VALUES ('a', 'open'), ('b', 'done')`).run();
  db.prepare(`INSERT INTO action_items (title, status, due_date) VALUES ('late', 'open', '2000-01-01')`).run();
  db.prepare(`INSERT INTO opportunities (name, stage) VALUES ('o1','discussing'), ('o2','on_hold'), ('o3','lost'), ('o4','scoping')`).run();
  db.prepare(`INSERT INTO outreach (status) VALUES ('draft'), ('sent')`).run();
});

describe("navCounts", () => {
  test("inbox counts emails with a draft to review, opened or not", () => {
    assert.equal(navCounts()["/inbox"]?.n, 2);
    markInboxRead(ids["open-log"]);
    assert.equal(navCounts()["/inbox"]?.n, 2); // opening it doesn't hide a draft still waiting
    assert.equal(navCounts()["/inbox"]?.dot, undefined); // nothing failed: no red dot
  });

  test("an email waiting to be read counts, and the badge says so (SEC-031)", () => {
    const db = getDb();
    const id = db.prepare(`INSERT INTO inbox_messages (gmail_id, body, status) VALUES ('waiting', '', 'held')`).run().lastInsertRowid;
    const c = navCounts()["/inbox"];
    assert.equal(c?.n, 3);
    assert.match(c?.title ?? "", /2 to review, 1 not read yet/);
    assert.equal(c?.dot, undefined, "nothing failed");
    db.prepare(`DELETE FROM inbox_messages WHERE id=?`).run(id);
  });

  test("draft queues leave email drafts to the Inbox; actions count overdue only; pipeline counts slipping deals", () => {
    const c = navCounts();
    assert.equal(c["/intake"], undefined); // its one ready draft came from an email
    assert.deepEqual([c["/log"]?.n, c["/log"]?.tone, c["/log"]?.dot], [1, "alert", true]); // the failed one; the ready one is the Inbox's
    assert.deepEqual([c["/actions"]?.n, c["/actions"]?.tone, c["/actions"]?.dot], [1, "alert", true]); // 1 overdue of 2 open
    assert.deepEqual([c["/pipeline"]?.n, c["/pipeline"]?.tone], [2, "warn"]); // open deals with no next step; on hold and lost don't count
    assert.equal(c["/outreach"]?.n, 1);
    assert.equal(c["/coach"], undefined); // zero → no badge
  });

  test("a deal with a next step and a recent contact isn't slipping", () => {
    const db = getDb();
    const p = Number(db.prepare(`INSERT INTO people (slug, name, status_key) VALUES ('deal-p', 'Deal P', 'active')`).run().lastInsertRowid);
    db.prepare(`UPDATE opportunities SET next_step='send proposal', person_id=? WHERE name='o1'`).run(p);
    db.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, date('now','localtime'), 'call')`).run(p);
    assert.equal(navCounts()["/pipeline"]?.n, 1);
  });

  test("news counts only items found since the feed was last opened", () => {
    const db = getDb();
    setSetting("news.enabled", "on");
    db.prepare(`INSERT INTO news_items (url, url_key, headline, headline_key, found_at) VALUES ('u1','u1','h1','h1','2000-01-01 00:00:00')`).run();
    assert.equal(navCounts()["/news"], undefined); // first look starts the clock
    db.prepare(`INSERT INTO news_items (url, url_key, headline, headline_key, found_at) VALUES ('u2','u2','h2','h2', datetime('now','+1 minute'))`).run();
    assert.deepEqual([navCounts()["/news"]?.n, navCounts()["/news"]?.tone], [1, "muted"]); // news isn't urgent
    db.prepare(`UPDATE news_items SET found_at = datetime('now','-1 minute') WHERE url='u2'`).run();
    markNewsSeen();
    assert.equal(navCounts()["/news"], undefined);
  });
});
