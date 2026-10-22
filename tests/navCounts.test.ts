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
  m("open-log", "routed", ids.logReady, null); // unread: draft waiting
  m("open-intake", "routed", ids.logDone, [ids.intakeReady]); // unread: intake still waiting
  m("all-done", "routed", ids.logDone, [ids.intakeDone]); // read: everything dealt with
  m("ignored", "ignored", null, null); // never counts
  m("unrouted", "new", null, null); // unread: nothing done yet

  db.prepare(`INSERT INTO action_items (title, status) VALUES ('a', 'open'), ('b', 'done')`).run();
  db.prepare(`INSERT INTO action_items (title, status, due_date) VALUES ('late', 'open', '2000-01-01')`).run();
  db.prepare(`INSERT INTO opportunities (name, stage) VALUES ('o1','discussing'), ('o2','on_hold'), ('o3','lost'), ('o4','scoping')`).run();
  db.prepare(`INSERT INTO outreach (status) VALUES ('draft'), ('sent')`).run();
});

describe("navCounts", () => {
  test("inbox unread ignores dealt-with and ignored mail, and clears when opened", () => {
    assert.equal(navCounts()["/inbox"]?.n, 3);
    markInboxRead(ids["open-log"]);
    assert.equal(navCounts()["/inbox"]?.n, 2);
  });

  test("draft queues, actions, pipeline and outreach", () => {
    const c = navCounts();
    assert.equal(c["/intake"]?.n, 1);
    assert.deepEqual([c["/log"]?.n, c["/log"]?.tone], [2, "alert"]); // 1 ready + 1 failed
    assert.deepEqual([c["/actions"]?.n, c["/actions"]?.tone], [2, "alert"]); // overdue turns it red
    assert.equal(c["/pipeline"]?.n, 2); // on hold and lost don't count
    assert.equal(c["/outreach"]?.n, 1);
    assert.equal(c["/coach"], undefined); // zero → no badge
  });

  test("news counts only items found since the feed was last opened", () => {
    const db = getDb();
    setSetting("news.enabled", "on");
    db.prepare(`INSERT INTO news_items (url, url_key, headline, headline_key, found_at) VALUES ('u1','u1','h1','h1','2000-01-01 00:00:00')`).run();
    assert.equal(navCounts()["/news"], undefined); // first look starts the clock
    db.prepare(`INSERT INTO news_items (url, url_key, headline, headline_key, found_at) VALUES ('u2','u2','h2','h2', datetime('now','+1 minute'))`).run();
    assert.equal(navCounts()["/news"]?.n, 1);
    db.prepare(`UPDATE news_items SET found_at = datetime('now','-1 minute') WHERE url='u2'`).run();
    markNewsSeen();
    assert.equal(navCounts()["/news"], undefined);
  });
});
