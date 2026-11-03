import "./helpers/tempdb";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildInboxFetchPrompt, claudeArgs, connectorPreamble, TOOLS } from "../lib/ai";

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

  test("built-ins that need no approval are blocked on every run", () => {
    for (const grant of ["", TOOLS.web, TOOLS.gmailRead]) {
      const d = denied(claudeArgs("sonnet", grant));
      for (const t of ["CronCreate", "CronDelete", "RemoteTrigger", "SendMessage", "Workflow", "PushNotification", "ScheduleWakeup", "ListAgents", "ReportFindings", "Skill", "EnterWorktree"])
        assert.ok(d.includes(t), `${t} should be blocked`);
    }
  });

  test("connector tools stay reachable: ToolSearch and one harmless deferred tool are left on", () => {
    const d = denied(claudeArgs("sonnet", TOOLS.gmailRead));
    assert.ok(!d.includes("ToolSearch"));
    assert.ok(!d.includes("CronList"), "the CLI drops ToolSearch when nothing else is deferred");
    assert.equal(flag(claudeArgs("sonnet", TOOLS.gmailRead), "--tools"), null, "--tools removes the connectors");
  });

  test("runs keep no transcript", () => {
    assert.ok(claudeArgs("sonnet", "").includes("--no-session-persistence"));
  });
});

describe("connectorPreamble", () => {
  test("names exactly the granted connector tools", () => {
    const p = connectorPreamble(TOOLS.gmailRead);
    assert.match(p, /ToolSearch/);
    for (const t of TOOLS.gmailRead.split(",")) assert.ok(p.includes(t));
    assert.ok(!p.includes("Calendar"));
  });

  test("a run with no connector gets none", () => {
    assert.equal(connectorPreamble(""), "");
    assert.equal(connectorPreamble(TOOLS.web), "");
  });
});

describe("buildInboxFetchPrompt", () => {
  test("searches delivered, to and cc at once, so one match can't hide another", () => {
    const p = buildInboxFetchPrompt("me+crm@example.com", "2026/10/01", []);
    assert.ok(p.includes("{deliveredto:me+crm@example.com to:me+crm@example.com cc:me+crm@example.com} after:2026/10/01"));
    assert.doesNotMatch(p, /if it returns nothing/);
  });

  test("opens every thread: a new message can sit in a thread whose id is already recorded", () => {
    assert.match(buildInboxFetchPrompt("me+crm@example.com", "2026/10/01", ["abc123"]), /always call get_thread/);
  });
});
