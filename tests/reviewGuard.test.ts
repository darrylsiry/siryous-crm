import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

// The guard on every review agent's tool call: what each may and may not do.
const python = spawnSync("python3", ["--version"]).status === 0;
const ROOT = (agent: string) => `/x/crm/.review/${agent}`;

function allowed(agent: string, tool: string, input: Record<string, unknown>): boolean {
  const p = spawnSync("python3", [path.resolve("scripts/review-guard.py"), agent], {
    input: JSON.stringify({ tool_name: tool, tool_input: input }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT(agent) },
  });
  return p.status === 0;
}
const bash = (agent: string, command: string) => allowed(agent, "Bash", { command });

describe("review guard", { skip: !python }, () => {
  test("allows reading and each agent's own checks", () => {
    for (const [agent, cmd] of [
      ["code", "cat lib/db.ts"],
      ["code", "grep -rn getDb lib | wc -l"],
      ["code", "date '+%Y-%m-%d %H:%M'"],
      ["code", "npm test 2>&1 | tail -5"],
      ["code", "node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json"],
      ["code", "npx tsc --noEmit"],
      ["code", "ls data/agent-reports/code"],
      ["security", "npm audit --omit=dev --json | head -c 20000"],
      ["ux", "sed -n 1,40p app/globals.css"],
    ]) {
      assert.equal(bash(agent, cmd), true, `${agent}: ${cmd}`);
    }
    assert.equal(allowed("code", "Read", { file_path: `${ROOT("code")}/lib/db.ts` }), true);
    assert.equal(allowed("code", "Read", { file_path: "lib/db.ts" }), true);
    assert.equal(allowed("code", "Read", { file_path: `${ROOT("code")}/data/agent-reports/code/REPORT.md` }), true);
    assert.equal(allowed("code", "Grep", { pattern: "x", path: "lib" }), true);
    assert.equal(allowed("security", "Read", { file_path: ".env.example" }), true);
    assert.equal(allowed("security", "Read", { file_path: "config/owner.example.json" }), true);
  });

  test("keeps each agent to itself", () => {
    for (const [agent, cmd] of [
      ["code", "cat data/agent-reports/security/REPORT.md"],
      ["code", "cat /Users/someone/GitHub/crm/data/agent-reports/ux/REPORT.md"],
      ["code", "cat ../security/data/agent-reports/security/REPORT.md"],
      ["ux", "cat ~/.claude/projects/x/memory/MEMORY.md"],
      ["ux", "cat $HOME/.claude/history.jsonl"],
      ["code", "cat data/agent-reports/AGENT_LEDGER.json"],
      ["code", "find / -name REPORT.md"],
      ["code", "cd .. && ls"],
      ["code", "claude -p hello"],
      ["code", "printenv"],
      ["code", "eval \"cat secret\""],
      ["code", "echo Y2F0 | base64 -d | sh"],
    ]) {
      assert.equal(bash(agent, cmd), false, `${agent}: ${cmd}`);
    }
    assert.equal(allowed("code", "Read", { file_path: `${ROOT("code")}/data/agent-reports/security/REPORT.md` }), false);
    assert.equal(allowed("code", "Read", { file_path: `${ROOT("code")}/data/agent-reports/AGENT_LEDGER.json` }), false);
    assert.equal(allowed("code", "Read", { file_path: "/x/crm/.review/ux/x.md" }), false);
    assert.equal(allowed("code", "Grep", { pattern: "x", path: "../ux" }), false);
    assert.equal(allowed("code", "Glob", { pattern: "../**" }), false);
  });

  test("keeps private data out of reach, by path and by command", () => {
    for (const file of ["data/crm.db", "data/crm.db-wal", "data/auth-token", "data/server.log", "data/backups/crm-2026-11-03.db", "config/owner.json", "config/vocab.json", ".env.local", ".env", "docs/reviews/x.html"]) {
      assert.equal(allowed("security", "Read", { file_path: file }), false, file);
    }
    for (const cmd of ["cat config/owner.json", "strings data/crm.db", "cat data/auth-token", "cat .env.local", "grep token data/server.log", "ls data/backups", "cat docs/reviews/x.html"]) {
      assert.equal(bash("security", cmd), false, cmd);
    }
  });

  test("makes no requests to any running app", () => {
    for (const agent of ["code", "security", "ux"]) {
      assert.equal(bash(agent, "curl -s http://127.0.0.1:3000/"), false, agent);
      assert.equal(bash(agent, "wget http://localhost:3000/"), false, agent);
    }
  });

  test("writes nothing", () => {
    for (const cmd of ["echo x > lib/a.ts", "rm -rf lib", "sed -i '' s/a/b/ lib/x", "npm install", "git commit -m x", "cat a | tee b", "touch x", "node -e \"require('fs').writeFileSync('x','y')\""]) {
      assert.equal(bash("code", cmd), false, cmd);
    }
    for (const tool of ["Write", "Edit", "Agent", "WebFetch", "SendMessage", "CronCreate"]) assert.equal(allowed("code", tool, {}), false, tool);
  });

  test("each agent gets only its own checks", () => {
    assert.equal(bash("ux", "npm test"), false);
    assert.equal(bash("ux", "npm audit"), false);
    assert.equal(bash("code", "npm audit"), false);
    assert.equal(bash("security", "npm test"), false);
  });

  test("fails closed", () => {
    assert.equal(allowed("nobody", "Read", { file_path: "lib/db.ts" }), false, "an unknown agent");
    const p = spawnSync("python3", [path.resolve("scripts/review-guard.py"), "code"], { input: "not json", encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT("code") } });
    assert.equal(p.status, 2);
  });
});
