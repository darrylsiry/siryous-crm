import { tmp } from "./helpers/tempdb";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getInboxSettings, pollInbox } from "../lib/inbox";
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
    for (const k of ["inbox.last_poll_at", "inbox.last_attempt_at", "inbox.last_error"]) setSetting(k, null);
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
