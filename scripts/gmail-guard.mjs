#!/usr/bin/env node
/**
 * Hook for the Inbox's two Gmail runs (lib/inbox.ts, wired up by claudeArgs
 * in lib/ai.ts). The Claude CLI runs it around every connector call:
 *
 *   PreToolUse   decides: exit 2 blocks the call before it reaches Gmail, and
 *                what is written to stderr goes back to the model.
 *   PostToolUse  records Gmail's raw answer (one JSON line per message) in
 *                <run-dir>/gmail.jsonl, so the CRM reads who sent a message,
 *                its labels and its text from Gmail itself, never from what
 *                the model says Gmail returned.
 *
 *   gmail-guard.mjs headers <run-dir>         listing step: Gmail's metadata
 *                                             views only (senders, recipients,
 *                                             dates, labels; no subject or text)
 *   gmail-guard.mjs bodies <run-dir> <ids>    reading step: get_message for
 *                                             these ids only
 *
 * So a stranger's message is never read by the model: the listing can't
 * return text, and only the owner's own messages are fetched by id. Fails
 * closed: anything unexpected, including unreadable input, is blocked, and
 * the command line adds `|| exit 2` in case this script can't start at all.
 */
import fs from "node:fs";
import path from "node:path";

const [step, runDir = "", idList = ""] = process.argv.slice(2);

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

let call = {};
try {
  call = JSON.parse(raw) ?? {};
} catch {
  refuse("the tool call couldn't be read.");
}
const name = String(call.tool_name ?? "");
const input = call.tool_input && typeof call.tool_input === "object" ? call.tool_input : {};
const tool = name.split("__").pop();
const record = (line) => fs.appendFileSync(path.join(runDir, "gmail.jsonl"), JSON.stringify(line) + "\n", { mode: 0o600 });

if (call.hook_event_name === "PostToolUse") {
  // Only calls this guard allowed get here. Record the call, then each message in Gmail's answer.
  try {
    const answer = parse(call.tool_response);
    record({ call: tool, ...(Array.isArray(answer?.threads) ? { threads: answer.threads.length } : {}) });
    for (const m of messagesIn(answer)) record(m);
  } catch {
    /* nothing recorded: the CRM treats the run as unreadable */
  }
  process.exit(0);
}

if (!runDir || !fs.existsSync(runDir)) refuse("this run has nowhere to record Gmail's answers.");
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

/** A connector answer as an object: it may arrive as JSON text or as content blocks holding it. */
function parse(response) {
  let v = response;
  if (Array.isArray(v) && v.every((b) => b && typeof b === "object" && "text" in b)) v = v.map((b) => b.text).join("");
  if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.content)) v = v.content.map((b) => b?.text ?? "").join("");
  return typeof v === "string" ? JSON.parse(v) : v;
}

/** The messages in an answer: a thread list, one thread, or one message. */
function messagesIn(v) {
  const out = [];
  const add = (m) => {
    if (!m || typeof m !== "object" || typeof m.id !== "string") return;
    const list = (x) => (Array.isArray(x) ? x.map(String) : typeof x === "string" && x ? [x] : []);
    const pick = (...keys) => keys.map((k) => m[k]).find((x) => x != null);
    out.push({
      id: m.id,
      threadId: pick("threadId", "thread_id") ?? null,
      sender: String(pick("sender") ?? ""),
      to: list(pick("toRecipients", "to_recipients")),
      cc: list(pick("ccRecipients", "cc_recipients")),
      bcc: list(pick("bccRecipients", "bcc_recipients")),
      labels: list(pick("labelIds", "label_ids")),
      date: pick("date") ?? null,
      internalDate: pick("internalDate", "internal_date") ?? null,
      names: Array.isArray(m.addressDisplayNames) ? m.addressDisplayNames : [],
      ...(pick("subject") != null ? { subject: String(pick("subject")) } : {}),
      ...(pick("plaintextBody", "plaintext_body") != null ? { body: String(pick("plaintextBody", "plaintext_body")) } : {}),
    });
  };
  for (const t of v?.threads ?? []) for (const m of t?.messages ?? []) add(m);
  for (const m of v?.messages ?? []) add(m);
  if (v?.id && (v.sender !== undefined || v.labelIds !== undefined)) add(v);
  return out;
}
