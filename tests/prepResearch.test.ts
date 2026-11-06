import { tmp } from "./helpers/tempdb";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db";
import { gatherResearch } from "../lib/prepResearch";

// A fake Claude CLI that plays back out-1.jsonl on its first run, out-2.jsonl
// on its second: the Calendar/Gmail step runs first, then the web step.
const countFile = path.join(tmp.dir, "count");
const out = (n: number) => path.join(tmp.dir, `out-${n}.jsonl`);
const bin = path.join(tmp.dir, "fake-claude");
fs.writeFileSync(
  bin,
  `#!/bin/sh
cat > /dev/null
n=$(cat "${countFile}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${countFile}"
cat "${tmp.dir}/out-$n.jsonl"
`,
  { mode: 0o755 }
);
process.env.CLAUDE_BIN = bin;

const used = (name: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input: { query: "x" } }] } });
const answer = (text: string) => JSON.stringify({ type: "result", result: text, is_error: false });
const runs = (...outputs: string[][]) => outputs.forEach((lines, i) => fs.writeFileSync(out(i + 1), lines.join("\n") + "\n"));

after(() => tmp.cleanup());

describe("Prep research", () => {
  const db = getDb();
  let personId = 0;
  let briefId = 0;
  beforeEach(() => {
    fs.rmSync(countFile, { force: true });
    db.exec(`DELETE FROM briefs; DELETE FROM people;`);
    personId = Number(db.prepare(`INSERT INTO people (slug, name) VALUES ('sam-lee', 'Sam Lee')`).run().lastInsertRowid);
    briefId = Number(db.prepare(`INSERT INTO briefs (person_id, title, status) VALUES (?, 'Prep: Sam Lee', 'analyzing')`).run(personId).lastInsertRowid);
  });
  const found = JSON.stringify({ person_slug: "sam-lee", meeting: null, whats_changed_md: "- Moved to a new role", confidence_flags: [] });

  test("a web step that searched but answered nothing is reported as not checked", async () => {
    runs([used("mcp__claude_ai_Gmail__search_threads"), answer(found)], [used("WebSearch"), answer("")]);
    const { research } = await gatherResearch(db, briefId, personId, "");
    assert.ok(research);
    assert.match(research.whats_changed_md, /new role/);
    assert.ok(research.confidence_flags.some((f) => /The web was not checked \(Empty response/.test(f)));
  });

  test("with both steps empty there is no research block at all", async () => {
    const empty = JSON.stringify({ person_slug: "sam-lee", meeting: null, whats_changed_md: "", confidence_flags: [] });
    runs([used("mcp__claude_ai_Gmail__search_threads"), answer(empty)], [used("WebSearch"), answer("")]);
    const { research, researchNote } = await gatherResearch(db, briefId, personId, "");
    assert.equal(research, null);
    assert.match(researchNote ?? "", /Calendar\/Gmail: .*without its findings\.; web: Empty response/);
  });

  test("both steps with findings are merged without caveats", async () => {
    runs([used("mcp__claude_ai_Gmail__search_threads"), answer(found)], [used("WebSearch"), answer("- Spoke at a conference")]);
    const { research } = await gatherResearch(db, briefId, personId, "");
    assert.equal(research?.whats_changed_md, "- Moved to a new role\n- Spoke at a conference");
    assert.deepEqual(research?.confidence_flags, []);
  });
});
