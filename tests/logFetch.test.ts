import "./helpers/tempdb";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildFetchPrompt, claudeArgs, TOOLS } from "../lib/ai";
import { logFetchTools } from "../lib/drafts";

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};

describe("Log fetch for Google Meet", () => {
  test("gets Calendar + Drive read, nothing that writes, no web", () => {
    const grant = logFetchTools("meet");
    for (const t of [...TOOLS.calendarRead.split(","), ...TOOLS.driveRead.split(",")]) assert.ok(grant.split(",").includes(t), `${t} granted`);
    const d = (flag(claudeArgs("sonnet", grant), "--disallowedTools") ?? "").split(",");
    assert.ok(d.includes("WebFetch") && d.includes("WebSearch"));
    assert.ok(d.includes("mcp__claude_ai_Google_Calendar__create_event"));
    assert.ok(d.includes("mcp__claude_ai_Google_Drive__share_file"));
    assert.ok(d.includes("mcp__claude_ai_Gmail"), "no Gmail for a Meet fetch");
  });

  test("the prompt identifies the meeting on the Calendar first and never filters Drive by owner", () => {
    const p = buildFetchPrompt("meeting with the COO of Acme", "meet");
    assert.match(p, /Google Calendar tools first/);
    assert.match(p, /NOW: /);
    assert.doesNotMatch(p, /owner = '/);
    assert.match(p, /still being generated/);
  });

  test("other sources keep their own single grant", () => {
    assert.equal(logFetchTools("zoom"), TOOLS.zoomRead);
    assert.equal(logFetchTools("gmail"), TOOLS.gmailRead);
    assert.equal(logFetchTools("paste"), "");
  });
});
