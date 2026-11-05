import { todayLocal } from "./dates.mjs";

/**
 * The three review agents' reports (data/agent-reports/<agent>/REPORT.md) read
 * into one shape for the App Tests page. Pure: no file access, so tests drive
 * it with fixtures. The agents write Markdown, so the reader keys on the few
 * things every run repeats (the Run line, `### ID — title` headings,
 * `- **Status:**` bullets, the resolved / declined / accepted sections) and
 * ignores the rest.
 */
export type AgentKey = "code" | "security" | "ux";

export interface AgentInfo {
  key: AgentKey;
  name: string;
  /** The agent's name in .claude/agents. */
  agent: string;
  /** Its report, under data/agent-reports/. */
  file: string;
  /** Finding IDs: CR-001, SEC-001, UX-001. */
  prefix: string;
  command: string;
  what: string;
  /** Display order, most urgent first. */
  severities: string[];
}

export const AGENTS: AgentInfo[] = [
  {
    key: "code",
    name: "Code quality",
    agent: "code-auditor",
    file: "code/REPORT.md",
    prefix: "CR",
    command: "scripts/review-run.sh code",
    what: "Reads the whole repository for bugs and quality problems",
    severities: ["Critical", "High", "Medium", "Low", "Suggestion"],
  },
  {
    key: "security",
    name: "Security",
    agent: "security-reviewer",
    file: "security/REPORT.md",
    prefix: "SEC",
    command: "scripts/review-run.sh security",
    what: "Looks for vulnerabilities and for data leaving the machine unannounced",
    severities: ["Critical", "High", "Medium", "Low", "Informational"],
  },
  {
    key: "ux",
    name: "UX",
    agent: "ux-reviewer",
    file: "ux/REPORT.md",
    prefix: "UX",
    command: "scripts/review-run.sh ux",
    what: "Walks every screen and flow from the user's side, with before/after mockups",
    severities: ["P1 Blocker", "P2 Major", "P3 Minor", "P4 Polish"],
  },
];

/** The two most urgent severities per agent: what the sidebar badge counts. */
export const urgentSeverities = (info: AgentInfo) => info.severities.slice(0, 2);

export type ItemStatus = "open" | "resolved" | "declined" | "accepted";

export interface ReportItem {
  id: string;
  title: string;
  severity: string;
  status: ItemStatus;
  /** As the agent wrote it: Open, New, Improved, Accepted… */
  statusText: string;
  /** YYYY-MM-DD, when the report says. */
  firstSeen: string | null;
}

export interface ClosedNote {
  id: string;
  title: string;
  status: Exclude<ItemStatus, "open">;
  note: string;
}

export interface ParsedReport {
  agent: AgentKey;
  /** As written: "2026-10-31 20:21". */
  run: string | null;
  /** That local time as an ISO instant. */
  runAt: string | null;
  /** The code version the run reviewed. */
  version: string | null;
  /** The paragraph under the summary table. */
  headline: string;
  /** What the run lists: open, plus any marked Accepted or Declined in place. */
  items: ReportItem[];
  /** Resolved since last run, declined, accepted risks. */
  closed: ClosedNote[];
}

const ID = String.raw`(?:CR|SEC|UX)-\d+`;
const ITEM_HEADING = new RegExp(`^###\\s+(${ID})\\b[\\s:—–-]*(.*)$`);
const CLOSED_BULLET = new RegExp(`^-\\s+\\*\\*(${ID})\\s*[—–:-]*\\s*(.*?)\\*\\*\\s*[—–:-]*\\s*(.*)$`);
// A short finding written as a paragraph: "**UX-024 — Format dates one way.** Raw ISO dates…".
const ITEM_PARAGRAPH = new RegExp(`^\\*\\*(${ID})\\s*[—–:-]+\\s*(.+?)\\.?\\*\\*`);
const FACT = /^-\s+\*\*([^*:]+):\*\*\s*(.*)$/;

/** The calendar date of an instant on this machine. */
export function localDate(iso: string): string {
  return todayLocal(new Date(iso));
}

/** The date a run's header names (`2026-10-31 20:21`), if any. */
export const runDate = (run: string | null) => (run && /(\d{4}-\d{2}-\d{2})/.exec(run)?.[1]) || null;

/** Agents run on this machine and write its local time, so read it back as local. */
function runInstant(run: string | null): string | null {
  const m = run && /(\d{4})-(\d{2})-(\d{2})[,\sT]+(\d{1,2}):(\d{2})/.exec(run);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).toISOString();
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

function statusOf(text: string): { status: ItemStatus; label: string; firstSeen: string | null } {
  const word = text.replace(/\s*[(—–:;,].*$/, "").trim() || "Open";
  const firstSeen = /first seen (\d{4}-\d{2}-\d{2})/i.exec(text)?.[1] ?? null;
  const status: ItemStatus = /^accepted/i.test(word)
    ? "accepted"
    : /^declined/i.test(word)
      ? "declined"
      : /^(resolved|fixed|closed)/i.test(word)
        ? "resolved"
        : "open";
  // A chip, not a sentence: "Declined on 2026-10-31 by…" reads "Declined"; open items keep the agent's word.
  const label = status === "open" ? word.split(/\s+/).slice(0, 3).join(" ").slice(0, 24) : status[0].toUpperCase() + status.slice(1);
  return { status, label, firstSeen };
}

const severityOf = (section: string) => (section.trim() === "Suggestions" ? "Suggestion" : section.trim());

/** Read one agent's report. Anything the reader doesn't recognise is skipped, never fatal. */
export function parseReport(agent: AgentKey, markdown: string): ParsedReport {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: ParsedReport = { agent, run: null, runAt: null, version: null, headline: "", items: [], closed: [] };
  let section = "";
  let item: ReportItem | null = null;
  let inFence = false;
  const firstSeenById = new Map<string, string>();
  const statusById = new Map<string, string>(); // from the Outstanding items table, for paragraph findings
  const paragraphs = new Map<string, string>(); // first paragraph of each ## section

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // A wireframe or quoted code can hold anything: it is never structure.
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (!section) {
      const fact = FACT.exec(trimmed);
      if (fact) {
        const [, key, value] = fact;
        if (/^run$/i.test(key)) out.run = value.trim();
        else if (/^code version$/i.test(key)) out.version = /`?([0-9a-f]{7,40})`?/.exec(value)?.[1] ?? null;
        continue;
      }
    }

    if (trimmed.startsWith("## ")) {
      section = trimmed.slice(3).trim();
      item = null;
      continue;
    }

    const heading = ITEM_HEADING.exec(trimmed);
    if (heading) {
      item = { id: heading[1], title: heading[2].trim(), severity: severityOf(section), status: "open", statusText: "Open", firstSeen: null };
      out.items.push(item);
      continue;
    }
    const para = ITEM_PARAGRAPH.exec(trimmed);
    if (para && !/^(resolved|declined|accepted)/i.test(section)) {
      item = { id: para[1], title: para[2].trim(), severity: severityOf(section), status: "open", statusText: "Open", firstSeen: null };
      out.items.push(item);
      continue;
    }
    if (trimmed.startsWith("### ") || trimmed.startsWith("# ")) {
      item = null;
      continue;
    }

    // "- **CR-069 — title** — resolved: what changed."
    const closedKind = /^resolved/i.test(section) ? "resolved" : /^declined/i.test(section) ? "declined" : /^accepted/i.test(section) ? "accepted" : null;
    if (closedKind) {
      const b = CLOSED_BULLET.exec(trimmed);
      if (b) out.closed.push({ id: b[1], title: b[2].trim(), status: closedKind, note: b[3].trim() });
      continue;
    }

    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        if (!/^\|?[\s:|-]+\|?$/.test(lines[i].trim())) rows.push(cells(lines[i]));
        i++;
      }
      i--;
      const columns = rows[0] ?? [];
      const idCol = columns.findIndex((c) => /^id$/i.test(c));
      const seenCol = columns.findIndex((c) => /first seen/i.test(c));
      const statusCol = columns.findIndex((c) => /^status$/i.test(c));
      for (const r of rows.slice(1)) {
        if (idCol >= 0 && seenCol >= 0 && r[idCol] && r[seenCol]) firstSeenById.set(r[idCol], r[seenCol]);
        if (idCol >= 0 && statusCol >= 0 && r[idCol] && r[statusCol]) statusById.set(r[idCol], r[statusCol]);
      }
      continue;
    }

    if (item && !line.startsWith(" ") && !line.startsWith("\t")) {
      const fact = FACT.exec(trimmed);
      if (fact && /^status$/i.test(fact[1])) {
        const s = statusOf(fact[2]);
        item.status = s.status;
        item.statusText = s.label;
        item.firstSeen = s.firstSeen;
      }
      continue;
    }

    if (!item && section && trimmed && !trimmed.startsWith("-") && !paragraphs.has(section)) paragraphs.set(section, trimmed);
  }

  for (const it of out.items) {
    if (!it.firstSeen && firstSeenById.has(it.id)) it.firstSeen = firstSeenById.get(it.id)!;
    if (it.statusText === "Open" && statusById.has(it.id)) it.statusText = statusById.get(it.id)!.split(/\s+/)[0];
  }
  out.runAt = runInstant(out.run);
  out.headline = paragraphs.get("Summary") ?? "";
  return out;
}
