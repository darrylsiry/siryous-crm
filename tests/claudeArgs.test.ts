import "./helpers/tempdb";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { claudeArgs, TOOLS } from "../lib/ai";

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};
const denied = (args: string[]) => (flag(args, "--disallowedTools") ?? "").split(",");

describe("claudeArgs — the read-only grant is enforced by the CLI", () => {
  test("ignores the owner's own Claude settings and never waits for approval", () => {
    const a = claudeArgs("sonnet", "");
    assert.equal(flag(a, "--setting-sources"), "project");
    assert.equal(flag(a, "--permission-mode"), "dontAsk");
  });

  test("a step with no grant gets no tools: no web, no connectors, no shell", () => {
    const a = claudeArgs("sonnet", "");
    const d = denied(a);
    assert.equal(flag(a, "--allowedTools"), null);
    for (const t of ["WebFetch", "WebSearch", "Bash", "Read", "Agent", "mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Calendar", "mcp__claude_ai_Google_Drive", "mcp__claude_ai_Zoom_for_Claude"])
      assert.ok(d.includes(t), `${t} should be blocked`);
  });

  test("a Gmail read step can read Gmail but can't send, and can't reach the web", () => {
    const a = claudeArgs("sonnet", TOOLS.gmailRead);
    const d = denied(a);
    assert.equal(flag(a, "--allowedTools"), TOOLS.gmailRead);
    assert.ok(d.includes("mcp__claude_ai_Gmail__send_message"));
    assert.ok(d.includes("mcp__claude_ai_Gmail__create_draft"));
    assert.ok(!d.includes("mcp__claude_ai_Gmail"), "the Gmail server itself stays available for the granted read tools");
    assert.ok(d.includes("WebFetch") && d.includes("WebSearch"));
    for (const t of TOOLS.gmailRead.split(",")) assert.ok(!d.includes(t), `${t} must not be blocked`);
  });

  test("Prep's private step gets Calendar + Gmail read, nothing that writes, no web", () => {
    const grant = [TOOLS.calendarRead, TOOLS.gmailRead].join(",");
    const d = denied(claudeArgs("sonnet", grant));
    assert.ok(d.includes("mcp__claude_ai_Google_Calendar__create_event"));
    assert.ok(d.includes("mcp__claude_ai_Gmail__send_message"));
    assert.ok(d.includes("mcp__claude_ai_Google_Drive") && d.includes("mcp__claude_ai_Zoom_for_Claude"));
    assert.ok(d.includes("WebFetch"));
  });

  test("a web step keeps the web and gets no connector at all", () => {
    const a = claudeArgs("sonnet", TOOLS.web);
    const d = denied(a);
    assert.ok(!d.includes("WebFetch") && !d.includes("WebSearch"));
    assert.ok(d.includes("mcp__claude_ai_Gmail") && d.includes("mcp__claude_ai_Google_Drive"));
  });
});
