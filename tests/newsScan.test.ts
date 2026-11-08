import { tmp } from "./helpers/tempdb";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db";
import { NEWS_BATCH_SIZE } from "../lib/newsCore";
import { newsBackingOff, newsEnabled, newsRetryAt, runNewsScan } from "../lib/news";
import { getSetting, setSetting } from "../lib/settings";

// A stand-in for the Claude CLI: counts its runs, optionally asks the scan to
// stop while "searching", then prints whatever stream-json this test wrote.
const outFile = path.join(tmp.dir, "out.jsonl");
const runsFile = path.join(tmp.dir, "runs.txt");
const bin = path.join(tmp.dir, "fake-claude");
const sqlite = path.resolve("node_modules/better-sqlite3");
fs.writeFileSync(
  bin,
  `#!/bin/sh
cat > /dev/null
echo run >> "${runsFile}"
if [ -n "$FAKE_STOP" ]; then node -e "const D=require('${sqlite}');new D(process.env.CRM_DB_PATH).prepare(\\"INSERT OR REPLACE INTO settings (key, value) VALUES ('news.stop','1')\\").run()"; fi
cat "${outFile}"
`,
  { mode: 0o755 }
);
process.env.CLAUDE_BIN = bin;

const searched = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "x" } }] } });
const result = (text: string) => JSON.stringify({ type: "result", result: text, is_error: false });
const cli = (...lines: string[]) => fs.writeFileSync(outFile, lines.join("\n") + "\n");
const runs = () => (fs.existsSync(runsFile) ? fs.readFileSync(runsFile, "utf8").trim().split("\n").length : 0);
const checks = () => (getDb().prepare(`SELECT COUNT(*) n FROM news_checks`).get() as { n: number }).n;

after(() => tmp.cleanup());

describe("runNewsScan", () => {
  const db = getDb();
  // Enough people for two batches.
  for (let i = 0; i <= NEWS_BATCH_SIZE; i++) db.prepare(`INSERT INTO people (slug, name) VALUES (?, ?)`).run(`p${i}`, `Person ${i}`);

  beforeEach(() => {
    db.prepare(`DELETE FROM news_checks`).run();
    fs.rmSync(runsFile, { force: true });
    delete process.env.FAKE_STOP;
    for (const k of ["news.enabled", "news.last_run_at", "news.last_error", "news.stop", "news.fail_streak", "news.failed_at"]) setSetting(k, null);
  });

  test("a batch that searched and found nothing is checked", async () => {
    cli(searched, result('{"items": []}'));
    const r = await runNewsScan(true);
    assert.equal(r.error, null);
    assert.equal(checks(), NEWS_BATCH_SIZE + 1);
  });

  test("a check now never switches the daily search on", async () => {
    cli(searched, result('{"items": []}'));
    await runNewsScan(true);
    assert.ok(getSetting("news.last_run_at"));
    assert.equal(newsEnabled(), false);
  });

  test("scans that keep checking nobody back off, doubling up to a day; one that checks anyone ends it (CR-048)", async () => {
    const H = 3_600_000;
    assert.equal(newsRetryAt(1, 0), H);
    assert.equal(newsRetryAt(2, 0), 2 * H);
    assert.equal(newsRetryAt(10, 0), 22 * H, "never longer than the daily cycle");
    cli(result("no search"));
    await runNewsScan(true);
    await runNewsScan(true);
    assert.equal(getSetting("news.fail_streak"), "2");
    assert.equal(newsBackingOff(), true, "the background loop waits");
    assert.equal(newsBackingOff(Date.now() + 2 * H + 1000), false);
    cli(searched, result('{"items": []}'));
    await runNewsScan(true);
    assert.equal(getSetting("news.fail_streak"), null);
    assert.equal(newsBackingOff(), false);
  });

  test("an answer that never searched is a failure, and nothing is marked checked", async () => {
    cli(result(`I couldn't search, so here is {"items": []}`));
    const r = await runNewsScan(true);
    assert.match(r.error ?? "", /never searched/);
    assert.equal(checks(), 0);
    assert.match(getSetting("news.last_error") ?? "", /never searched/);
  });

  test("a wrong-shaped answer is a failure too", async () => {
    cli(searched, result('{"stories": []}'));
    const r = await runNewsScan(true);
    assert.match(r.error ?? "", /wasn't a list/);
    assert.equal(checks(), 0);
  });

  test("stop takes effect before the next batch, even on a check now", async () => {
    cli(searched, result('{"items": []}'));
    process.env.FAKE_STOP = "1";
    const r = await runNewsScan(true);
    assert.equal(r.stopped, true);
    assert.equal(runs(), 1, "the second batch never went out");
    assert.equal(checks(), NEWS_BATCH_SIZE);
    assert.equal(getSetting("news.stop"), null, "the request is cleared once the scan ends");
  });

  test("a scheduled scan stops when daily search is paused", async () => {
    cli(searched, result('{"items": []}'));
    setSetting("news.enabled", "off");
    const r = await runNewsScan(false);
    assert.equal(r.stopped, true);
    assert.equal(runs(), 0);
  });
});
