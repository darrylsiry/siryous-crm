import { tmp } from "./helpers/tempdb";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getInboxSettings, INBOX_MAX_PER_POLL, openInboxItems, pollInbox, routeMessage } from "../lib/inbox";
import { inboxCheckDue } from "../lib/inboxRoute";
import { getDb } from "../lib/db";
import { getSetting, noteAppActivity, setSetting } from "../lib/settings";

// A stand-in for the Claude CLI: records its arguments and prompt for each of
// the poll's two runs (headers, then bodies), then prints whatever stream-json
// this test wrote for that run. Real poll code, no tokens spent.
const file = (name: string) => path.join(tmp.dir, name);
const bin = file("fake-claude");
fs.writeFileSync(
  bin,
  `#!/bin/sh
cat > "${file("prompt-now.txt")}"
if grep -q "call get_message once for each" "${file("prompt-now.txt")}"; then step=bodies; else step=headers; fi
printf '%s\\n' "$@" > "${tmp.dir}/args-$step.txt"
mv "${file("prompt-now.txt")}" "${tmp.dir}/prompt-$step.txt"
cat "${tmp.dir}/out-$step.jsonl"
`,
  { mode: 0o755 }
);
process.env.CLAUDE_BIN = bin;
// Drafts that routed mail starts run in the background: a closed port makes them fail fast, offline.
setSetting("ai.ollama_url", "http://127.0.0.1:9");

const searched = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "mcp__claude_ai_Gmail__search_threads", input: { query: "x" } }] },
});
const opened = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "mcp__claude_ai_Gmail__get_message", input: { messageId: "x" } }] },
});
const result = (text: string) => JSON.stringify({ type: "result", result: text, is_error: false });
/** What the headers run prints. */
const cli = (...lines: string[]) => fs.writeFileSync(file("out-headers.jsonl"), lines.join("\n") + "\n");
/** What the bodies run prints. */
const cliBodies = (...lines: string[]) => fs.writeFileSync(file("out-bodies.jsonl"), lines.join("\n") + "\n");
const promptOf = (step: "headers" | "bodies") => fs.readFileSync(file(`prompt-${step}.txt`), "utf8");
const argsOf = (step: "headers" | "bodies") => fs.readFileSync(file(`args-${step}.txt`), "utf8").split("\n");
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

after(() => tmp.cleanup());

describe("pollInbox", () => {
  beforeEach(() => {
    for (const k of ["inbox.last_poll_at", "inbox.last_attempt_at", "inbox.last_error", "inbox.follow_up_at"]) setSetting(k, null);
    getDb().prepare(`DELETE FROM inbox_messages`).run();
    setSetting("inbox.address", "me+crm@example.com");
    cliBodies(opened, result('{"messages": []}'));
    for (const f of ["prompt-bodies.txt", "args-bodies.txt"]) fs.rmSync(file(f), { force: true });
  });

  test("a check that reached Gmail and found nothing is a success", async () => {
    cli(searched, result('{"messages": []}'));
    const r = await pollInbox();
    assert.equal(r.error, null);
    assert.ok(getSetting("inbox.last_poll_at"));
    assert.ok(getSetting("inbox.last_attempt_at"));
  });

  test("runs on the cheap model, tells it to load the Gmail tools, and lists headers only", async () => {
    cli(searched, result('{"messages": []}'));
    await pollInbox();
    const args = argsOf("headers");
    assert.equal(flag(args, "--model"), "haiku");
    assert.equal(flag(args, "--allowedTools"), "mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread");
    assert.match(flag(args, "--settings"), /gmail-guard\.mjs' 'headers'/);
    assert.match(promptOf("headers"), /^The tools for this task load on demand.*mcp__claude_ai_Gmail__search_threads/);
    assert.match(promptOf("headers"), /THREAD_VIEW_METADATA_ONLY/);
    assert.ok(!fs.existsSync(file("args-bodies.txt")), "nothing of the owner's to read, so no second run");
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
      from: "Someone <someone@elsewhere.example>",
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
    const prompt = promptOf("headers");
    assert.match(prompt, /after:2026\/10\/30/, "the next check still looks back from the old date");
    assert.match(prompt, /\bcap-0\b/, "and skips what the first one stored");
  });

  test("a full answer of mail already stored isn't capped, and moves the look-back on instead of looping", async () => {
    setSetting("inbox.last_poll_at", "2026-11-01T00:00:00.000Z");
    const db = getDb();
    const insert = db.prepare(`INSERT INTO inbox_messages (gmail_id, subject, body, date, status) VALUES (?, 's', 'b', ?, 'ignored')`);
    // More stored mail inside the window than one check returns.
    for (let i = 0; i < 80; i++) insert.run(`old-${i}`, "2026-11-01");
    const messages = Array.from({ length: INBOX_MAX_PER_POLL }, (_, i) => ({ id: `old-${i}`, date: "2026-11-03", from: "s@x.example" }));
    cli(searched, result(JSON.stringify({ messages })));
    const r = await pollInbox();
    assert.equal(r.capped, false);
    assert.equal(r.skipped, INBOX_MAX_PER_POLL);
    assert.equal(getSetting("inbox.follow_up_at"), null, "no follow-up");
    assert.equal(getSetting("inbox.last_poll_at"), "2026-11-05T00:00:00.000Z", "the next look-back starts at the newest returned day");
    // Every stored id in the window was offered as already recorded, not just the newest 60.
    const prompt = promptOf("headers");
    assert.match(prompt, /\bold-0\b/);
    assert.match(prompt, /\bold-79\b/);
  });

  test("a full answer with no dates keeps the look-back where it was and says why (CR-044)", async () => {
    const before = "2026-11-01T00:00:00.000Z";
    setSetting("inbox.last_poll_at", before);
    const db = getDb();
    const insert = db.prepare(`INSERT INTO inbox_messages (gmail_id, subject, body, status) VALUES (?, 's', 'b', 'ignored')`);
    for (let i = 0; i < INBOX_MAX_PER_POLL; i++) insert.run(`undated-${i}`);
    const messages = Array.from({ length: INBOX_MAX_PER_POLL }, (_, i) => ({ id: `undated-${i}`, from: "s@x.example" }));
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
            { id: "odd-1", from: "A <a@x.example>", to: "Me <me+crm@example.com>", cc: null, labels: null },
            { id: "odd-2", from: "B <b@x.example>", to: ["me+crm@example.com"], thread_id: null },
            { from: "no id" },
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

  describe("only the owner's own messages are ever read (SEC-003, SEC-002)", () => {
    const me = "Me <me+crm@example.com>";
    const header = (id: string, from: string, labels: string[]) => ({ id, thread_id: "t1", date: "2026-11-05", from, to: ["me+crm@example.com"], cc: [], labels });
    const body = (id: string, from: string) => ({ id, thread_id: "t1", date: "2026-11-05", subject: "Catch-up", from, to: ["me+crm@example.com"], cc: [], body: "Notes from the call." });
    const row = (id: string) =>
      getDb().prepare(`SELECT status, route, subject, body, verified, log_draft_id FROM inbox_messages WHERE gmail_id=?`).get(id) as
        | { status: string; route: string | null; subject: string; body: string; verified: number | null; log_draft_id: number | null }
        | undefined;

    test("a stranger's reply-all in a thread the owner copied is kept as headers and never read", async () => {
      cli(searched, result(JSON.stringify({ messages: [header("own-1", me, ["SENT", "INBOX"]), header("reply-1", "Pat <pat@x.example>", ["INBOX"])] })));
      cliBodies(opened, result(JSON.stringify({ messages: [body("own-1", me)] })));
      const r = await pollInbox();
      assert.equal(r.error, null);
      assert.deepEqual([r.routed, r.ignored], [1, 1]);
      // The reading step was asked for the owner's message only, and the guard allows only that id.
      assert.match(promptOf("bodies"), /\bown-1\b/);
      assert.doesNotMatch(promptOf("bodies"), /reply-1/);
      const args = argsOf("bodies");
      assert.equal(flag(args, "--allowedTools"), "mcp__claude_ai_Gmail__get_message");
      assert.match(flag(args, "--settings"), /'bodies' 'own-1'"/);
      assert.deepEqual({ ...row("reply-1") }, { status: "ignored", route: "unknown sender", subject: "", body: "", verified: null, log_draft_id: null });
      assert.equal(row("own-1")?.status, "routed");
      assert.equal(row("own-1")?.verified, 1);
    });

    test("a reading whose sender disagrees with the headers is kept out", async () => {
      cli(searched, result(JSON.stringify({ messages: [header("own-2", me, ["SENT"])] })));
      cliBodies(opened, result(JSON.stringify({ messages: [body("own-2", "Mallory <m@evil.example>")] })));
      const r = await pollInbox();
      assert.deepEqual([r.routed, r.ignored], [0, 1]);
      assert.equal(row("own-2")?.status, "ignored");
      assert.equal(row("own-2")?.body, "");
    });

    test("owner mail Gmail didn't file as Sent is logged as data only", async () => {
      cli(searched, result(JSON.stringify({ messages: [header("own-3", me, ["INBOX"]), header("own-4", me, ["SENT"])] })));
      cliBodies(opened, result(JSON.stringify({ messages: [body("own-3", me), body("own-4", me)] })));
      await pollInbox();
      const content = (id: string) =>
        (getDb().prepare(`SELECT fetched_text FROM log_drafts WHERE id=?`).get(row(id)!.log_draft_id) as { fetched_text: string }).fetched_text;
      assert.match(content("own-3"), /\(unverified\)/);
      assert.match(content("own-4"), /\(verified\)/);
    });

    test("a message the reading step didn't return isn't stored, so the next check lists it again", async () => {
      cli(searched, result(JSON.stringify({ messages: [header("own-5", me, ["SENT"])] })));
      cliBodies(opened, result('{"messages": []}'));
      await pollInbox();
      assert.equal(row("own-5"), undefined);
    });
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
