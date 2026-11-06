#!/usr/bin/env node
/**
 * PreToolUse hook for the Inbox's two Gmail runs (lib/inbox.ts, wired up by
 * claudeArgs in lib/ai.ts). The Claude CLI runs it before every connector
 * call; exit 2 blocks the call before it reaches Gmail, and what is written
 * to stderr goes back to the model.
 *
 *   gmail-guard.mjs headers        listing step: senders, recipients, dates and
 *                                  labels only, never a subject or any text
 *   gmail-guard.mjs bodies <ids>   reading step: get_message for these ids only
 *
 * So a stranger's message is never read by the model: the listing can't
 * return text, and only the owner's own messages are fetched by id. Fails
 * closed: anything unexpected, including unreadable input, is blocked.
 */
const [step, idList = ""] = process.argv.slice(2);

function refuse(why) {
  process.stderr.write(`Blocked by the CRM: ${why}`);
  process.exit(2);
}

let raw = "";
try {
  for await (const chunk of process.stdin) raw += chunk;
} catch {
  refuse("the tool call couldn't be read.");
}

let name = "";
let input = {};
try {
  const call = JSON.parse(raw);
  name = String(call.tool_name ?? "");
  input = call.tool_input && typeof call.tool_input === "object" ? call.tool_input : {};
} catch {
  refuse("the tool call couldn't be read.");
}
const tool = name.split("__").pop();

if (step === "headers") {
  if (tool === "search_threads" && ["THREAD_VIEW_METADATA_ONLY", "THREAD_VIEW_IDS_ONLY"].includes(input.view)) process.exit(0);
  if (tool === "get_thread" && input.messageFormat === "METADATA_ONLY") process.exit(0);
  refuse(
    'this step may only call search_threads with view "THREAD_VIEW_METADATA_ONLY" and get_thread with messageFormat "METADATA_ONLY". Message text is never read here.'
  );
} else if (step === "bodies") {
  const allowed = new Set(idList.split(",").filter(Boolean));
  if (tool === "get_message" && allowed.has(String(input.messageId ?? ""))) process.exit(0);
  refuse(`this step may only call get_message, for these message ids: ${[...allowed].join(", ") || "(none)"}.`);
}
refuse("no Gmail access was granted for this step.");
