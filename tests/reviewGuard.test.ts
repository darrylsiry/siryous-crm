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
      ["code", "cat checks/tests.txt | tail -5"],
      ["code", "ls data/agent-reports/code"],
      ["security", "head -c 20000 checks/npm-audit.json"],
      ["code", "node --version"],
      ["code", "grep -rn \"node\" lib | head"],
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

  test("no agent runs checks, package scripts or the repository's code: the runner does (checks/)", () => {
    for (const agent of ["code", "security", "ux"]) {
      for (const cmd of [
        "npm test",
        "npm audit",
        "npm audit fix",
        "npx tsc --noEmit",
        "node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json",
        "node scripts/agent-ledger.ts",
        "python3 scripts/review-save.py",
        "node -e \"require('./lib/db')\"",
      ]) {
        assert.equal(bash(agent, cmd), false, `${agent}: ${cmd}`);
      }
    }
  });

  test("closes the gaps a deny-list leaves: find -delete, in-place perl, command substitution", () => {
    for (const cmd of ["find . -name x -delete", "find . -exec rm {} \\;", "perl -pi -e s/a/b/ lib/x", "cat $(echo lib/db.ts)", "cat `echo x`"]) {
      assert.equal(bash("code", cmd), false, cmd);
    }
  });

  test("runs no code at all: no inline scripts, piped or heredoc code, shells or sourcing; no Keychain tool (SEC-016)", () => {
    for (const cmd of [
      "node -e \"require('fs').appendFileSync(require('os').homedir()+'/.claude.json', 'x')\"",
      "node -e 1",
      "node -p 1+1",
      "python3 -c \"print(1)\"",
      "echo 'print(1)' | python3",
      "python3 <<EOF\nprint(1)\nEOF",
      "/usr/bin/python3 -c 1",
      "env FOO=1 node -e 1",
      "xargs -0 node",
      "bash scripts/review-run.sh",
      "sh -x x.sh",
      "source x.sh",
      ". ./x.sh",
      "security find-generic-password -s x -w",
      "awk 'BEGIN{system(\"id\")}' /dev/null",
      "awk '{print > \"x\"}' lib/db.ts",
    ]) {
      assert.equal(bash("security", cmd), false, cmd);
    }
    for (const cmd of ["python3 --version", "awk '{print $1}' lib/db.ts | head", "grep -rn 'security' lib | head", "ls ./lib"]) {
      assert.equal(bash("security", cmd), true, cmd);
    }
  });

  test("fails closed", () => {
    assert.equal(allowed("nobody", "Read", { file_path: "lib/db.ts" }), false, "an unknown agent");
    const p = spawnSync("python3", [path.resolve("scripts/review-guard.py"), "code"], { input: "not json", encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT("code") } });
    assert.equal(p.status, 2);
  });
});
