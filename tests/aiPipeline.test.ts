import { tmp } from "./helpers/tempdb";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { getDb } from "../lib/db";
import { buildIntakePrompt, buildLogPrompt, extractJson, extractJsonWithRepair, rosterBlock, runClaudeStream, runModel } from "../lib/ai";
import { careerProfile, weekSnapshot, mondayOf } from "../lib/coachai";
import { routeUsable, type AiStatus } from "../lib/aiStatus";
import { LocalUnavailable, localQueueDepth, RunCancelled, runLocalStream } from "../lib/llm";
import { setSetting } from "../lib/settings";

// A fake Claude CLI: notes that it ran, then does whatever FAKE_MODE says.
const ranFile = path.join(tmp.dir, "claude-ran");
const bin = path.join(tmp.dir, "fake-claude");
fs.writeFileSync(
  bin,
  `#!/bin/sh
cat > /dev/null
touch "${ranFile}"
if [ "$FAKE_MODE" = "logged-out" ]; then echo "Not logged in · Please run /login" >&2; exit 1; fi
echo '{"type":"result","result":"from claude","is_error":false}'
`,
  { mode: 0o755 }
);
process.env.CLAUDE_BIN = bin;

// A stub Ollama: the model is "pulled"; /api/chat does whatever `chat` says.
let chat: (res: http.ServerResponse) => void = () => {};
const server = http.createServer((req, res) => {
  if (req.url === "/api/tags") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "stub:latest" }] }));
    return;
  }
  req.resume();
  req.on("end", () => chat(res));
});

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  setSetting("ai.ollama_url", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  setSetting("ai.model", "stub");
  setSetting("ai.provider", "local");
  setSetting("ai.fallback", "claude");
});
after(() => {
  server.close();
  tmp.cleanup();
});

describe("falling back to Claude", () => {
  const claudeRan = () => fs.existsSync(ranFile);

  test("a running Ollama that fails a request is an error, not a reason to send the prompt to Claude", async () => {
    fs.rmSync(ranFile, { force: true });
    chat = (res) => {
      res.statusCode = 500;
      res.end("out of memory");
    };
    await assert.rejects(runLocalStream("hi"), (err: Error) => !(err instanceof LocalUnavailable) && /failed \(Ollama answered 500\)/.test(err.message));
    await assert.rejects(runModel("hi"), /Ollama answered 500/);
    assert.equal(claudeRan(), false);
  });

  test("an error reported mid-stream doesn't fall back either", async () => {
    fs.rmSync(ranFile, { force: true });
    chat = (res) => {
      res.write(JSON.stringify({ message: { content: "partial" } }) + "\n");
      res.end(JSON.stringify({ error: "model runner crashed" }) + "\n");
    };
    await assert.rejects(runModel("hi"), /stopped with an error: model runner crashed/);
    assert.equal(claudeRan(), false);
  });

  test("a model that isn't downloaded still may", async () => {
    fs.rmSync(ranFile, { force: true });
    setSetting("ai.model", "not-pulled");
    try {
      assert.equal(await runModel("hi"), "from claude");
      assert.equal(claudeRan(), true);
    } finally {
      setSetting("ai.model", "stub");
    }
  });

  test("a Claude login problem reported only on stderr still gets the login instructions", async () => {
    process.env.FAKE_MODE = "logged-out";
    try {
      await assert.rejects(runClaudeStream("hi", { allowedTools: "" }), /login has expired/);
    } finally {
      delete process.env.FAKE_MODE;
    }
  });
});

describe("a roster that fits the prompt", () => {
  const db = getDb();
  before(() => {
    const insert = db.prepare(`INSERT INTO people (slug, name, role_title, status_key, cadence_days, last_touch) VALUES (?, ?, 'Analyst', 'new', 21, '2020-01-01')`);
    db.transaction(() => {
      for (let i = 0; i < 5000; i++) insert.run(`imported-${i}`, `Imported Person ${i}`);
    })();
    db.prepare(`INSERT INTO people (slug, name, email) VALUES ('zelda-quill', 'Zelda Quill', 'zq@example.com')`).run();
    db.prepare(`INSERT INTO people (slug, name) VALUES ('busy-bee', 'Busy Bee')`).run();
    db.prepare(`INSERT INTO action_items (title, person_id) VALUES ('Call back', (SELECT id FROM people WHERE slug='busy-bee'))`).run();
  });

  test("Intake and Log stay inside the context window and keep who the input names", () => {
    const limitChars = (32768 - 1024) * 4;
    const intake = buildIntakePrompt("Notes from a call with Zelda Quill about her new role.");
    assert.ok(intake.length < limitChars, `${intake.length} chars`);
    assert.match(intake, /zelda-quill \| Zelda Quill/);
    assert.match(intake, /more people and companies are in the CRM but not listed/);
    const log = buildLogPrompt("From: zq@example.com\nThanks for the chat.", "paste");
    assert.ok(log.length < limitChars);
    assert.match(log, /zelda-quill/, "matched by email too");
  });

  test("open work comes before the long tail", () => {
    assert.match(rosterBlock("", 3000), /busy-bee/);
  });

  test("a small roster is listed whole", () => {
    const block = rosterBlock("", 10_000_000);
    assert.doesNotMatch(block, /not listed/);
    assert.match(block, /imported-4999/);
  });

  test("Coach lists the most overdue and counts the rest", () => {
    const snap = weekSnapshot(mondayOf(new Date()));
    const listed = snap.split("\n").filter((l) => /^- \*\*Imported Person/.test(l)).length;
    assert.ok(listed <= 25, `${listed} listed`);
    assert.match(snap, /…and \d+ more/);
  });
});

describe("Coach's overdue list matches Keep Warm", () => {
  test("lost contacts are left out and never-touched ones with a cadence are in", () => {
    const db = getDb();
    db.prepare(`DELETE FROM people`).run();
    db.prepare(`INSERT INTO people (slug, name, status_key, cadence_days, last_touch) VALUES ('gone', 'Gone Lost', 'lost', 30, '2020-01-01')`).run();
    db.prepare(`INSERT INTO people (slug, name, status_key, cadence_days, last_touch) VALUES ('never', 'Never Touched', 'new', 21, NULL)`).run();
    const snap = weekSnapshot(mondayOf(new Date()));
    assert.doesNotMatch(snap, /\*\*Gone Lost\*\*/, "not in the overdue list (it may still be a new contact this week)");
    assert.match(snap, /\*\*Never Touched\*\* \(new\) — no dated touch logged/);
  });
});

describe("the coach's notes folder", () => {
  test("an in-place edit shows up without a restart", () => {
    const dir = path.join(tmp.dir, "notes");
    fs.mkdirSync(dir);
    const file = path.join(dir, "goals.md");
    fs.writeFileSync(file, "first draft");
    setSetting("coach.context_dir", dir);
    assert.match(careerProfile(), /first draft/);
    fs.writeFileSync(file, "final draft");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    fs.utimesSync(dir, new Date(0), new Date(0)); // the folder itself looks unchanged
    assert.match(careerProfile(), /final draft/);
  });
});

describe("whether the coach can run", () => {
  const status = (over: Partial<AiStatus>): AiStatus => ({
    ollama: { ok: true, reason: null, installedHint: null, url: "" },
    model: { ok: true, name: "small", available: [{ name: "small:latest", size: 0, modified_at: null, parameter_size: null, quantization: null, family: null }] },
    claude: { ok: true },
    provider: "local",
    fallbackToClaude: false,
    aiUsable: true,
    ...over,
  });

  test("judges the coach's own route, not the app-wide one", () => {
    // Coach on Claude, while the app-wide local model can't run.
    assert.equal(routeUsable(status({ ollama: { ok: false, reason: "down", installedHint: null, url: "" }, aiUsable: false }), { provider: "claude", model: "small" }), true);
    // Coach on a local model that isn't downloaded, while the app-wide one is fine.
    assert.equal(routeUsable(status({}), { provider: "local", model: "big" }), false);
    assert.equal(routeUsable(status({ fallbackToClaude: true }), { provider: "local", model: "big" }), true);
    assert.equal(routeUsable(status({ claude: { ok: false } }), { provider: "claude", model: "small" }), false);
  });
});

/** A stub reply: the whole answer in one streamed chunk, after `delayMs`. */
const answer = (content: string, delayMs = 0) => (res: http.ServerResponse) =>
  setTimeout(() => res.end(JSON.stringify({ message: { content }, done: true }) + "\n"), delayMs);

describe("reading JSON out of a model's answer", () => {
  test("a fenced block, prose around the object, and braces inside strings", () => {
    assert.deepEqual(extractJson('Here you go:\n```json\n{"a": 1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Sure! {"note": "use {braces} and \\"quotes\\""} Hope that helps {'), { note: 'use {braces} and "quotes"' });
    assert.throws(() => extractJson('{"cut": "off'), SyntaxError);
    assert.throws(() => extractJson("I can't help with that."), /No JSON object/);
  });

  test("an answer with no JSON at all fails without asking a model to 'repair' it", async () => {
    fs.rmSync(ranFile, { force: true });
    let asked = false;
    chat = (res) => {
      asked = true;
      answer("{}")(res);
    };
    await assert.rejects(extractJsonWithRepair("Sorry, I couldn't find anything."), /No JSON object/);
    assert.equal(asked, false);
    assert.equal(fs.existsSync(ranFile), false);
  });

  test("a syntax slip is repaired by the local model", async () => {
    chat = answer('{"items": ["a", "b"]}');
    assert.deepEqual(await extractJsonWithRepair('{"items": ["a", "b",]'), { items: ["a", "b"] });
  });

  test("a repair runs on the AI the caller names (the Coach's), not the app-wide one", async () => {
    fs.rmSync(ranFile, { force: true });
    setSetting("ai.provider", "claude");
    try {
      let asked = false;
      chat = (res) => {
        asked = true;
        answer('{"reply_md": "fixed"}')(res);
      };
      assert.deepEqual(await extractJsonWithRepair('{"reply_md": "fixed",', { provider: "local", model: "stub" }), { reply_md: "fixed" });
      assert.equal(asked, true, "the local model was asked");
      assert.equal(fs.existsSync(ranFile), false, "Claude never was");
    } finally {
      setSetting("ai.provider", "local");
    }
  });
});

describe("the local model's queue", () => {
  test("runs one at a time, in the order asked", async () => {
    let active = 0;
    let most = 0;
    const order: string[] = [];
    chat = (res) => {
      active++;
      most = Math.max(most, active);
      setTimeout(() => {
        active--;
        res.end(JSON.stringify({ message: { content: `run ${order.length}` }, done: true }) + "\n");
        order.push(`run ${order.length}`);
      }, 30);
    };
    const results = await Promise.all([runLocalStream("one"), runLocalStream("two"), runLocalStream("three")]);
    assert.deepEqual(results, ["run 0", "run 1", "run 2"]);
    assert.equal(most, 1);
    assert.equal(localQueueDepth(), 0);
  });

  test("a queued run whose work was discarded is cancelled before it reaches the model", async () => {
    let calls = 0;
    chat = (res) => {
      calls++;
      answer("done", 30)(res);
    };
    let wanted = true;
    const first = runLocalStream("first");
    const second = runLocalStream("second", { stillWanted: () => wanted });
    wanted = false;
    assert.equal(await first, "done");
    await assert.rejects(second, (err: Error) => err instanceof RunCancelled);
    assert.equal(calls, 1);
    assert.equal(localQueueDepth(), 0);
  });
});

