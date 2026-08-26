import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { getDb } from "./db";
import { rosterBlock } from "./ai";
import { loadOwner } from "./owner.mjs";

// ---------------------------------------------------------------------------
// Weekly coaching: context assembly + prompts. Server actions live in coach.ts.
// ---------------------------------------------------------------------------

const iso = (d: Date) => d.toLocaleDateString("sv-SE");

/** Monday of the week containing `date`, as YYYY-MM-DD. */
export function mondayOf(date: Date): string {
  const d = new Date(date);
  const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift);
  return iso(d);
}

export type CoachKind = "weekly" | "checkin";

const longDate = (isoDay: string) =>
  new Date(`${isoDay}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export function weekLabel(weekStart: string): string {
  return `Week of ${longDate(weekStart)}`;
}

/** Display label for a session: weekly → "Week of …", check-in → "Check-in — …". */
export function sessionLabel(s: { week_start: string; kind?: string | null; created_at?: string | null }): string {
  if ((s.kind ?? "weekly") === "checkin") {
    return `Check-in — ${longDate((s.created_at ?? s.week_start).slice(0, 10))}`;
  }
  return weekLabel(s.week_start);
}

export interface CoachMessage {
  role: string; // 'owner' | 'coach' | 'crm' (older rows may carry the original owner's first name; schema.mjs normalises them)
  content_md: string;
  created_at: string;
}

/** Everything the coach needs to see: this week's activity + full book of business. */
export function weekSnapshot(weekStart: string, kind: CoachKind = "weekly"): string {
  const db = getDb();
  const end = new Date(`${weekStart}T12:00:00`);
  end.setDate(end.getDate() + 6);
  const weekEnd = iso(end);
  const prevStart = new Date(`${weekStart}T12:00:00`);
  prevStart.setDate(prevStart.getDate() - 7);
  const prevWeekStart = iso(prevStart);

  const interactions = db
    .prepare(
      `SELECT i.date, i.channel, i.summary, COALESCE(p.name, c2.name, '?') AS who
       FROM interactions i
       LEFT JOIN people p ON p.id = i.person_id
       LEFT JOIN companies c2 ON c2.id = i.company_id
       WHERE i.date >= ? AND i.date <= ? ORDER BY i.date`
    )
    .all(weekStart, weekEnd) as { date: string; channel: string | null; summary: string; who: string }[];
  const prevCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM interactions WHERE date >= ? AND date < ?`).get(prevWeekStart, weekStart) as { n: number }
  ).n;

  const opps = db
    .prepare(
      `SELECT o.name, o.kind, o.stage, o.priority, o.value_note, o.next_step, o.updated_at,
              COALESCE(p.name, '') AS person, COALESCE(c.name, '') AS company
       FROM opportunities o
       LEFT JOIN people p ON p.id = o.person_id
       LEFT JOIN companies c ON c.id = o.company_id
       ORDER BY o.priority, o.stage`
    )
    .all() as Record<string, string | number | null>[];

  const openActions = db
    .prepare(
      `SELECT a.id, a.bucket, a.title, a.due_label, a.created_at, COALESCE(p.name,'') AS person
       FROM action_items a LEFT JOIN people p ON p.id = a.person_id
       WHERE a.status = 'open' ORDER BY a.bucket, a.id`
    )
    .all() as { id: number; bucket: string; title: string; due_label: string | null; created_at: string; person: string }[];
  const doneThisWeek = db
    .prepare(
      `SELECT a.title, a.completed_at, COALESCE(p.name,'') AS person
       FROM action_items a LEFT JOIN people p ON p.id = a.person_id
       WHERE a.status = 'done' AND a.completed_at >= ? AND a.completed_at <= ?`
    )
    .all(weekStart, weekEnd) as { title: string; completed_at: string; person: string }[];

  const overdueTouches = db
    .prepare(
      `SELECT name, status_key, last_touch, cadence_days,
              CAST(julianday('now','localtime') - julianday(substr(last_touch,1,10)) AS INTEGER) AS days_since
       FROM people
       WHERE cadence_days IS NOT NULL AND last_touch IS NOT NULL
         AND julianday('now','localtime') - julianday(substr(last_touch,1,10)) > cadence_days
       ORDER BY days_since - cadence_days DESC`
    )
    .all() as { name: string; status_key: string; last_touch: string; cadence_days: number; days_since: number }[];

  const statusCounts = db
    .prepare(`SELECT status_key, COUNT(*) AS n FROM people GROUP BY status_key ORDER BY n DESC`)
    .all() as { status_key: string; n: number }[];

  const newPeople = db
    .prepare(`SELECT name FROM people WHERE created_at >= ?`)
    .all(weekStart) as { name: string }[];

  const outreachDrafts = db
    .prepare(`SELECT COALESCE(title, topic, 'untitled') AS t FROM outreach WHERE status = 'draft'`)
    .all() as { t: string }[];

  // Weekly sessions answer to the previous week's commitments; a check-in
  // answers to whatever session closed most recently (possibly this week's).
  const priorSummary = (
    kind === "checkin"
      ? db
          .prepare(
            `SELECT week_start, kind, created_at, closed_at, summary_md FROM coach_sessions
             WHERE status = 'closed' AND summary_md IS NOT NULL
             ORDER BY closed_at DESC LIMIT 1`
          )
          .get()
      : db
          .prepare(
            `SELECT week_start, kind, created_at, closed_at, summary_md FROM coach_sessions
             WHERE status = 'closed' AND week_start < ? AND summary_md IS NOT NULL
             ORDER BY week_start DESC, closed_at DESC LIMIT 1`
          )
          .get(weekStart)
  ) as { week_start: string; kind: string | null; created_at: string | null; closed_at: string | null; summary_md: string } | undefined;

  return [
    `## This week (${weekStart} → ${weekEnd})`,
    ``,
    `### Interactions logged this week: ${interactions.length} (previous week: ${prevCount})`,
    ...interactions.map((i) => `- ${i.date}${i.channel ? ` [${i.channel}]` : ""} — **${i.who}**: ${i.summary}`),
    ``,
    `### Action items completed this week: ${doneThisWeek.length}`,
    ...doneThisWeek.map((a) => `- ${a.title}${a.person ? ` (${a.person})` : ""}`),
    ``,
    `### New contacts added this week: ${newPeople.length ? newPeople.map((p) => p.name).join(", ") : "none"}`,
    ``,
    `## Full book of business (current state)`,
    ``,
    `### Pipeline opportunities (${opps.length})`,
    ...opps.map(
      (o) =>
        `- **${o.name}** — ${o.kind}, stage: ${o.stage}${o.priority === 1 ? ", HIGH PRIORITY" : ""}${o.person ? ` · ${o.person}` : ""}${o.company ? ` @ ${o.company}` : ""}${o.value_note ? ` · ${o.value_note}` : ""}${o.next_step ? ` · next: ${o.next_step}` : ""} (last updated ${String(o.updated_at).slice(0, 10)})`
    ),
    ``,
    `### Open action items (${openActions.length}) — ids are stable, use them to mark completions`,
    ...openActions.map((a) => `- [#${a.id}] [${a.bucket}] ${a.title}${a.person ? ` (${a.person})` : ""}${a.due_label ? ` — due ${a.due_label}` : ""} (created ${a.created_at.slice(0, 10)})`),
    ``,
    `### Keep-warm cadences overdue (${overdueTouches.length})`,
    ...overdueTouches.map(
      (p) => `- **${p.name}** (${p.status_key}) — last touch ${p.last_touch}, ${p.days_since} days ago vs ${p.cadence_days}-day cadence`
    ),
    ``,
    `### Roster by status: ${statusCounts.map((s) => `${s.status_key}: ${s.n}`).join(" · ")}`,
    `### Outreach drafts sitting unsent: ${outreachDrafts.length ? outreachDrafts.map((o) => o.t).join("; ") : "none"}`,
    ``,
    priorSummary
      ? `## Last session's summary & commitments (${sessionLabel(priorSummary)}${priorSummary.closed_at ? `, closed ${priorSummary.closed_at.slice(0, 10)}` : ""}) — hold them accountable to these\n${priorSummary.summary_md}`
      : `## Last session: none on record — this is the first coaching session.`,
  ].join("\n");
}

/**
 * The owner's own coaching context — a folder of notes on strengths, pitfalls,
 * goals (config/owner.json → coachContextDir). Read live so edits flow into
 * the next session. Markdown is read directly; .docx via `pandoc` or macOS
 * `textutil` when available. Best effort: a missing folder or unreadable file
 * drops out of the context. Cached by directory mtime so it isn't re-read (or
 * re-converted) on every chat turn.
 */
let contextCache: { dir: string; mtimeMs: number; text: string } | null = null;

function convertDocx(full: string): string | null {
  for (const [bin, args] of [
    ["pandoc", ["-t", "plain", "--wrap=none", full]],
    ["textutil", ["-convert", "txt", "-stdout", full]],
  ] as [string, string[]][]) {
    try {
      return execFileSync(bin, args, { maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    } catch {
      /* try the next converter */
    }
  }
  return null;
}

export function careerProfile(): string {
  const dir = loadOwner().coachContextDir;
  if (!dir) return "";
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(dir).mtimeMs;
  } catch {
    return ""; // folder missing — coach runs on CRM data alone
  }
  if (contextCache && contextCache.dir === dir && contextCache.mtimeMs === mtimeMs) return contextCache.text;
  const parts: string[] = [];
  try {
    for (const f of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, f);
      try {
        if (f.endsWith(".md") || f.endsWith(".txt")) {
          parts.push(`--- ${f} ---\n${fs.readFileSync(full, "utf8")}`);
        } else if (f.endsWith(".docx")) {
          const txt = convertDocx(full);
          if (txt) parts.push(`--- ${f} ---\n${txt}`);
        }
      } catch {
        /* skip unreadable file */
      }
    }
  } catch {
    /* unreadable folder */
  }
  const text = parts.join("\n\n");
  contextCache = { dir, mtimeMs, text };
  return text;
}

function profileBlock(): string {
  const profile = careerProfile();
  if (!profile) return "";
  const O = loadOwner();
  const guidance =
    O.coachContextGuidance ||
    `${O.Possessive} own notes on strengths, pitfalls, and what this phase of their career is for. Treat them as ground truth about how ${O.first} works: hold them to THEIR definition of success, and when you see one of their documented pitfalls in the week's CRM data, name it as such.`;
  return `
${guidance}
---
${profile}
---
`;
}

function persona(): string {
  const O = loadOwner();
  if (O.coachPersona) return O.coachPersona;
  return `You are ${O.ownerName === "the owner" ? "the executive coach for the owner of" : `${O.ownerName}'s executive coach. ${O.First} is the owner and principal of`} ${O.practiceIntro}. ${O.First} sells a small number of high-trust engagements and needs to keep a healthy pipeline while delivering.

Your coaching style: encouraging but very direct and objective. You are not a cheerleader — you tell ${O.first} plainly where they are dropping the ball, where their attention is misallocated, and what the owner of a premium practice should be doing that they are not. Ground every observation in the actual data provided; name specific people, deals, and numbers. Never invent activity that isn't in the data. When the data is thin, say so — a thin week of logged activity is itself a coaching observation.`;
}

export function buildCoachAdvicePrompt(weekStart: string, kind: CoachKind = "weekly"): string {
  const today = iso(new Date());
  const O = loadOwner();
  const structure =
    kind === "checkin"
      ? `This is an AD-HOC CHECK-IN ${O.first} initiated — not the weekly review. Keep it tighter and more immediate than a weekly session: weigh what has moved since the last session's summary most heavily, acknowledge progress made since then, and focus on the next few days, not the whole week.

Write the check-in as Markdown with exactly these sections:

# Coach's check-in — ${longDate(today)}
## What's moved since last session (the objective read)
Progress against the last session's commitments first — kept, in motion, or untouched. Then anything new in the data.
## What you're doing well
Specific, earned praise only — tied to real activity above.
## Where you're dropping the ball
The direct section. Name names.
## What to focus on right now
2-4 concrete priorities for the next few days, each with a first action they can take today.`
      : `Write this week's coaching advice as Markdown with exactly these sections:

# Coach's advice — ${weekLabel(weekStart)}
## Where you are (the objective read)
3-6 bullets: pipeline reality, activity level vs. what a premium practice needs, revenue-generating motion vs. busywork. Numbers where possible.
## What you're doing well
Specific, earned praise only — tied to real activity above.
## Where you're dropping the ball
The direct section. Stalled deals, overdue keep-warm touches, commitments from last session not kept, neglected high-priority items, weak pipeline top-of-funnel — whatever the data shows. Name names.
## What to work on this week
3-5 concrete priorities for the owner of a premium consulting firm, each with a first action they can take Monday morning. Prioritize revenue and relationship leverage over administration.`;

  return `${persona()}
${profileBlock()}
Today is ${today}. Below is the complete, factual snapshot of ${O.possessive} CRM: this week's activity and the current state of their entire book of business.

${weekSnapshot(weekStart, kind)}

${structure}

Respond with ONLY the Markdown advice, no preamble.`;
}

/** What a chat turn (or session close) may change in the CRM. */
export interface CoachCrmUpdates {
  completed_action_ids: number[];
  new_actions: { title: string; bucket: string; due_label: string | null; person_slug: string | null }[];
}

export interface CoachTurn extends CoachCrmUpdates {
  reply_md: string;
}

const crmUpdateRules = (O: ReturnType<typeof loadOwner>) => `CRM UPDATE RULES (be conservative — the changes apply automatically):
- completed_action_ids: ids (from the "[#id]" open-action list) of items ${O.first} CLEARLY STATES are already done ("I sent it", "done", "booked it"). Intent or agreement is NOT completion. Empty array if none.
- new_actions: commitments ${O.first} explicitly makes in this conversation ("I'll send the proposal Monday"). Do NOT add near-duplicates of existing open items — if an open item already covers it, leave it alone (or complete it if they did it). title: short imperative. bucket: one of overdue, this_week, awaiting, high_potential, keep_warm, venture, data_gap (usually this_week). due_label: e.g. "Fri 7/25" or null. person_slug: the roster slug it concerns, or null.
- Items the transcript shows were already recorded (📌 notes) must not be recorded again.`;

const transcriptOf = (history: CoachMessage[]) => {
  const O = loadOwner();
  return history
    .map((m) => `${m.role === "coach" ? "COACH" : m.role === "crm" ? "📌 (recorded in CRM)" : O.First.toUpperCase()}: ${m.content_md}`)
    .join("\n\n");
};

export function buildCoachReplyPrompt(
  weekStart: string,
  adviceMd: string,
  history: CoachMessage[],
  newMessage: string,
  kind: CoachKind = "weekly"
): string {
  const O = loadOwner();
  return `${persona()}
${profileBlock()}
You are mid-session. The written advice you gave them at the start of this ${kind === "checkin" ? "check-in" : "session"}:
---
${adviceMd}
---

Fresh data snapshot for reference:
${weekSnapshot(weekStart, kind)}

ROSTER SLUGS (for linking new actions to people):
${rosterBlock()}

Conversation so far:
${transcriptOf(history) || "(no messages yet)"}

${O.First.toUpperCase()}: ${newMessage}

Reply as the coach: conversational Markdown, direct and specific, usually under 250 words. Push back where they are rationalizing; concede where they make a fair point; drive toward concrete commitments. Ask at most one question per reply.

${crmUpdateRules(O)}

Respond with ONLY a JSON object matching exactly:
{
  "reply_md": "",
  "completed_action_ids": [],
  "new_actions": [{"title": "", "bucket": "this_week", "due_label": null, "person_slug": null}]
}`;
}

export interface CoachClose extends CoachCrmUpdates {
  summary_md: string;
}

export function buildCoachSummaryPrompt(
  weekStart: string,
  adviceMd: string,
  history: CoachMessage[],
  kind: CoachKind = "weekly"
): string {
  const O = loadOwner();
  return `${persona()}

The ${kind === "checkin" ? "ad-hoc coaching check-in" : `coaching session for ${weekLabel(weekStart)}`} is ending. Your written advice was:
---
${adviceMd}
---

Fresh data snapshot for reference (open action ids are current):
${weekSnapshot(weekStart, kind)}

ROSTER SLUGS (for linking new actions to people):
${rosterBlock()}

Session conversation:
${transcriptOf(history) || `(${O.first} did not discuss anything — the advice was read only.)`}

Produce the closing record. summary_md is Markdown with exactly these sections:

## Session summary
What was discussed and decided, honestly including any pushback or open disagreements. If there was no conversation, summarize the advice's key points instead.
## Commitments${kind === "checkin" ? "" : " for next week"}
A checklist ("- [ ] …") of the specific commitments ${O.first} made in the conversation${
    history.length
      ? ""
      : " — there was no conversation this session, so list the " + (kind === "checkin" ? "2-3" : "3-4") + " most important actions from the advice as SUGGESTED next steps (not commitments)"
  }. These will be read back to them at the next session, so make each one concrete and checkable.

${crmUpdateRules(O)}
Additionally for the close: any commitment ${O.first} actually made in the conversation that is not yet represented by an open action item (including 📌-recorded ones from this session) goes into new_actions so the CRM tracks it. Suggested steps they never agreed to do NOT become action items — new_actions must be empty if there was no conversation.

Respond with ONLY a JSON object matching exactly:
{
  "summary_md": "",
  "completed_action_ids": [],
  "new_actions": [{"title": "", "bucket": "this_week", "due_label": null, "person_slug": null}]
}`;
}
