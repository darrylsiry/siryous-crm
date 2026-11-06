import { tmp } from "./helpers/tempdb";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getInboxSettings, INBOX_MAX_PER_POLL, openInboxItems, pollInbox, routeMessage } from "../lib/inbox";
import { inboxCheckDue } from "../lib/inboxRoute";
import { getDb } from "../lib/db";
import { getSetting, noteAppActivity, setSetting } from "../lib/settings";

// A stand-in for the Claude CLI: records its arguments and prompt, then prints
// whatever stream-json this test wrote. Real poll code, no tokens spent.
const argsFile = path.join(tmp.dir, "args.txt");
const promptFile = path.join(tmp.dir, "prompt.txt");
const outFile = path.join(tmp.dir, "out.jsonl");
const bin = path.join(tmp.dir, "fake-claude");
fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\ncat > "${promptFile}"\ncat "${outFile}"\n`, { mode: 0o755 });
process.env.CLAUDE_BIN = bin;

const searched = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "mcp__claude_ai_Gmail__search_threads", input: { query: "x" } }] },
});
const result = (text: string) => JSON.stringify({ type: "result", result: text, is_error: false });
const cli = (...lines: string[]) => fs.writeFileSync(outFile, lines.join("\n") + "\n");

after(() => tmp.cleanup());

describe("pollInbox", () => {
  beforeEach(() => {
    for (const k of ["inbox.last_poll_at", "inbox.last_attempt_at", "inbox.last_error", "inbox.follow_up_at"]) setSetting(k, null);
    getDb().prepare(`DELETE FROM inbox_messages`).run();
    setSetting("inbox.address", "me+crm@example.com");
  });

  test("a check that reached Gmail and found nothing is a success", async () => {
    cli(searched, result('{"messages": []}'));
    const r = await pollInbox();
    assert.equal(r.error, null);
    assert.ok(getSetting("inbox.last_poll_at"));
    assert.ok(getSetting("inbox.last_attempt_at"));
  });

  test("runs on the cheap model and tells it to load the Gmail tools", async () => {
    cli(searched, result('{"messages": []}'));
    await pollInbox();
    const args = fs.readFileSync(argsFile, "utf8").split("\n");
    assert.equal(args[args.indexOf("--model") + 1], "haiku");
    assert.match(fs.readFileSync(promptFile, "utf8"), /^The tools for this task load on demand.*mcp__claude_ai_Gmail__search_threads/);
  });

  test("an answer that never touched Gmail is an error, even when it parses as an empty mailbox", async () => {
    cli(result(`I couldn't reach Gmail, so I won't return {"messages": []}.`));
    const r = await pollInbox();
    assert.match(r.error ?? "", /never reached Gmail/);
    assert.equal(getSetting("inbox.last_poll_at"), null, "a failed check must not move the look-back window");
    assert.match(getSetting("inbox.last_error") ?? "", /never reached Gmail/);
  });

  test("a failed check still counts as an attempt, so it can't retry every minute", async () => {
    cli(result("nope"));
    await pollInbox();
    const s = getInboxSettings();
    assert.equal(s.lastPollAt, null);
    assert.ok(s.lastAttemptAt);
  });

  test("a full check doesn't move the look-back window past mail it left behind, and asks to go again", async () => {
    const before = "2026-11-01T00:00:00.000Z";
    setSetting("inbox.last_poll_at", before);
    const messages = Array.from({ length: INBOX_MAX_PER_POLL }, (_, i) => ({
      id: `cap-${i}`,
      date: "2026-11-02",
      subject: `Note ${i}`,
      from: "Someone <someone@elsewhere.example>",
      body: "hello",
    }));
    cli(searched, result(JSON.stringify({ messages })));
    const r = await pollInbox();
    assert.equal(r.capped, true);
    assert.equal(getSetting("inbox.last_poll_at"), before);
    const s = getInboxSettings();
    const now = Date.now();
    const due = (at: number) =>
      inboxCheckDue({ now: at, lastAttemptAt: s.lastAttemptAt, lastActiveAt: null, pollMinutes: s.pollMinutes, followUpAt: getSetting("inbox.follow_up_at") });
    assert.equal(due(now), false, "not straight away");
    assert.equal(due(now + 3 * 60_000), true, "but within a few minutes, not hours");
    await pollInbox();
    const prompt = fs.readFileSync(promptFile, "utf8");
    assert.match(prompt, /after:2026\/10\/30/, "the next check still looks back from the old date");
    assert.match(prompt, /\bcap-0\b/, "and skips what the first one stored");
  });

  test("a full answer of mail already stored isn't capped, and moves the look-back on instead of looping", async () => {
    setSetting("inbox.last_poll_at", "2026-11-01T00:00:00.000Z");
    const db = getDb();
    const insert = db.prepare(`INSERT INTO inbox_messages (gmail_id, subject, body, date, status) VALUES (?, 's', 'b', ?, 'ignored')`);
    // More stored mail inside the window than one check returns.
    for (let i = 0; i < 80; i++) insert.run(`old-${i}`, "2026-11-01");
    const messages = Array.from({ length: INBOX_MAX_PER_POLL }, (_, i) => ({ id: `old-${i}`, date: "2026-11-03", subject: "s", body: "b" }));
    cli(searched, result(JSON.stringify({ messages })));
    const r = await pollInbox();
    assert.equal(r.capped, false);
    assert.equal(r.skipped, INBOX_MAX_PER_POLL);
    assert.equal(getSetting("inbox.follow_up_at"), null, "no follow-up");
    assert.equal(getSetting("inbox.last_poll_at"), "2026-11-05T00:00:00.000Z", "the next look-back starts at the newest returned day");
    // Every stored id in the window was offered as already recorded, not just the newest 60.
    const prompt = fs.readFileSync(promptFile, "utf8");
    assert.match(prompt, /\bold-0\b/);
    assert.match(prompt, /\bold-79\b/);
  });

  test("a full answer with no dates keeps the look-back where it was and says why (CR-044)", async () => {
    const before = "2026-11-01T00:00:00.000Z";
    setSetting("inbox.last_poll_at", before);
    const db = getDb();
    const insert = db.prepare(`INSERT INTO inbox_messages (gmail_id, subject, body, status) VALUES (?, 's', 'b', 'ignored')`);
    for (let i = 0; i < INBOX_MAX_PER_POLL; i++) insert.run(`undated-${i}`);
    const messages = Array.from({ length: INBOX_MAX_PER_POLL }, (_, i) => ({ id: `undated-${i}`, subject: "s", body: "b" }));
    cli(searched, result(JSON.stringify({ messages })));
    const r = await pollInbox();
    assert.equal(getSetting("inbox.last_poll_at"), before, "not moved to now");
    assert.match(r.error ?? "", /no dates/);
    assert.match(getSetting("inbox.last_error") ?? "", /no dates/);
  });

  test("one oddly shaped message doesn't fail the check; one that can't be read is left out and counted", async () => {
    cli(
      searched,
      result(
        JSON.stringify({
          messages: [
            { id: "odd-1", subject: "Hi", from: "A <a@x.example>", to: "Me <me+crm@example.com>", cc: null, body: "hello" },
            { id: "odd-2", subject: null, from: "B <b@x.example>", to: ["me+crm@example.com"], body: "there", thread_id: null },
            { subject: "no id", body: "lost" },
          ],
        })
      )
    );
    const r = await pollInbox();
    assert.equal(r.error, null);
    assert.equal(r.fetched, 2);
    assert.equal(r.dropped, 1);
    const row = getDb().prepare(`SELECT recipients FROM inbox_messages WHERE gmail_id='odd-1'`).get() as { recipients: string };
    assert.deepEqual(JSON.parse(row.recipients), { to: ["Me <me+crm@example.com>"], cc: [] });
  });

  test("before the attempt key existed, the last success stands in for it", () => {
    setSetting("inbox.last_poll_at", "2026-11-01T00:00:00.000Z");
    assert.equal(getInboxSettings().lastAttemptAt, "2026-11-01T00:00:00.000Z");
  });
});

describe("noteAppActivity", () => {
  beforeEach(() => setSetting("app.last_active_at", null));

  test("records the time, and doesn't rewrite it on every click", () => {
    const t0 = Date.parse("2026-11-03T12:00:00Z");
    noteAppActivity(t0);
    assert.equal(getSetting("app.last_active_at"), new Date(t0).toISOString());
    noteAppActivity(t0 + 60_000);
    assert.equal(getSetting("app.last_active_at"), new Date(t0).toISOString());
    noteAppActivity(t0 + 6 * 60_000);
    assert.equal(getSetting("app.last_active_at"), new Date(t0 + 6 * 60_000).toISOString());
  });
});

describe("open Inbox items", () => {
  test("an older open email isn't crowded out by newer resolved ones", () => {
    const db = getDb();
    db.prepare(`DELETE FROM inbox_messages`).run();
    db.prepare(`INSERT INTO inbox_messages (gmail_id, body, status) VALUES ('old-open', 'x', 'new')`).run();
    const insert = db.prepare(`INSERT INTO inbox_messages (gmail_id, body, status) VALUES (?, 'x', 'routed')`);
    for (let i = 0; i < 150; i++) insert.run(`resolved-${i}`);
    assert.deepEqual(openInboxItems(100).map((i) => i.state), ["unrouted"]);
  });

  test("only emails with a draft still open count, worked out in the query; a bad draft list doesn't break it (CR-047)", () => {
    const db = getDb();
    db.prepare(`DELETE FROM inbox_messages`).run();
    const draft = (table: string, status: string) =>
      Number(db.prepare(`INSERT INTO ${table} (raw_text, status) VALUES ('x', ?)`).run(status).lastInsertRowid);
    const mail = db.prepare(`INSERT INTO inbox_messages (gmail_id, subject, body, status, log_draft_id, intake_draft_ids) VALUES (?, ?, 'x', 'routed', ?, ?)`);
    mail.run("saved", "Saved", draft("log_drafts", "confirmed"), JSON.stringify([draft("intake_drafts", "discarded")]));
    mail.run("waiting", "Waiting", null, JSON.stringify([draft("intake_drafts", "confirmed"), draft("intake_drafts", "ready")]));
    mail.run("broken", "Broken list", draft("log_drafts", "error"), "not json");
    assert.deepEqual(
      openInboxItems().map((i) => [i.subject, i.state]),
      [
        ["Broken list", "error"],
        ["Waiting", "ready"],
      ]
    );
    assert.equal(openInboxItems(1).length, 1);
  });
});

describe("redoing an email keeps what was saved (CR-042)", () => {
  test("no second Log draft once one is saved, and Redo as Intake keeps the link to it", () => {
    // Drafts start in the background: point them at a closed port so they fail fast, offline.
    setSetting("ai.ollama_url", "http://127.0.0.1:9");
    const db = getDb();
    db.prepare(`DELETE FROM inbox_messages`).run();
    const id = Number(
      db
        .prepare(`INSERT INTO inbox_messages (gmail_id, subject, sender, recipients, body, status) VALUES ('redo-1', 'Catch-up', 'Pat <pat@elsewhere.example>', '{}', 'notes', 'new')`)
        .run().lastInsertRowid
    );
    const link = () => db.prepare(`SELECT log_draft_id, intake_draft_ids FROM inbox_messages WHERE id=?`).get(id) as { log_draft_id: number | null; intake_draft_ids: string | null };
    const logDrafts = () => (db.prepare(`SELECT COUNT(*) n FROM log_drafts`).get() as { n: number }).n;

    routeMessage(db, id, "log");
    const logId = link().log_draft_id!;
    db.prepare(`UPDATE log_drafts SET status='confirmed' WHERE id=?`).run(logId);
    const made = logDrafts();

    routeMessage(db, id, "log");
    assert.equal(logDrafts(), made, "a saved Log draft is not made again");
    assert.equal(link().log_draft_id, logId);

    routeMessage(db, id, "intake");
    assert.equal(logDrafts(), made);
    assert.equal(link().log_draft_id, logId, "the email still links to what was saved");
    assert.equal((JSON.parse(link().intake_draft_ids ?? "[]") as number[]).length, 1);
  });
});
