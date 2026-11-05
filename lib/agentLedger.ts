import { AGENTS, localDate, runDate, type AgentInfo, type AgentKey, type ItemStatus, type ParsedReport } from "./agentReports";

/**
 * The review agents' history for App Tests. Each report is overwritten by its
 * next run and lists only what is open plus what closed since the run before,
 * so the history lives in a ledger (data/agent-reports/AGENT_LEDGER.json):
 * every finding ever reported, its last known status, and every run. The runner
 * folds each new run in (scripts/agent-ledger.ts); the page folds the reports
 * on disk over it, so it is current even before the ledger is rewritten. Agents
 * never see this. Pure.
 */
const NOTE_MAX = 400; // the reviewer's closing note; the full text stays in the report

export interface LedgerItem {
  id: string;
  agent: AgentKey;
  title: string;
  severity: string;
  status: ItemStatus;
  /** The agent's word (Open, New, Improved) or how it closed (Resolved, No longer reported). */
  statusText: string;
  /** YYYY-MM-DD. */
  firstSeen: string;
  /** ISO: the latest run that said anything about it. */
  lastSeen: string;
  closedAt: string | null;
  closedNote: string;
}

export interface LedgerRun {
  agent: AgentKey;
  run: string;
  runAt: string | null;
  version: string | null;
  open: number;
  closed: number;
}

export interface Ledger {
  version: 1;
  updatedAt: string | null;
  runs: LedgerRun[];
  items: Record<string, LedgerItem>;
}

export const emptyLedger = (): Ledger => ({ version: 1, updatedAt: null, runs: [], items: {} });

/** A ledger read from JSON, or an empty one when it is missing or unreadable. */
export function readLedger(json: string | null): Ledger {
  if (!json) return emptyLedger();
  try {
    const l = JSON.parse(json) as Ledger;
    return l && l.version === 1 && l.items && Array.isArray(l.runs) ? l : emptyLedger();
  } catch {
    return emptyLedger();
  }
}

function close(item: LedgerItem, status: Exclude<ItemStatus, "open">, at: string, statusText: string, note: string) {
  item.status = status;
  item.statusText = statusText;
  item.closedAt = at;
  item.closedNote = note.slice(0, NOTE_MAX);
  item.lastSeen = at;
}

/**
 * Fold one run's report into the ledger, as of `at` (the run's time). What it
 * lists updates the item; what it closes is closed; anything this agent had
 * open before and the run no longer mentions is closed as "No longer reported".
 * Older information never overwrites newer, so folding is idempotent.
 */
export function foldReport(l: Ledger, r: ParsedReport, at: string): Ledger {
  const mentioned = new Set<string>();
  const runDay = runDate(r.run) ?? localDate(at);

  for (const it of r.items) {
    mentioned.add(it.id);
    const firstSeen = it.firstSeen ?? runDay;
    const cur = l.items[it.id];
    if (!cur) {
      l.items[it.id] = {
        id: it.id,
        agent: r.agent,
        title: it.title,
        severity: it.severity,
        status: it.status,
        statusText: it.statusText,
        firstSeen,
        lastSeen: at,
        closedAt: it.status === "open" ? null : at,
        closedNote: "",
      };
      continue;
    }
    if (firstSeen < cur.firstSeen) cur.firstSeen = firstSeen;
    if (at < cur.lastSeen) continue;
    cur.title = it.title || cur.title;
    cur.severity = it.severity || cur.severity;
    if (it.status === "open") Object.assign(cur, { status: "open", statusText: it.statusText, closedAt: null, closedNote: "", lastSeen: at });
    else if (cur.status !== it.status) close(cur, it.status, at, it.statusText, "");
    else cur.lastSeen = at;
  }

  for (const c of r.closed) {
    mentioned.add(c.id);
    const cur = l.items[c.id];
    const label = c.status === "resolved" ? "Resolved" : c.status === "declined" ? "Declined" : "Accepted";
    if (!cur) {
      l.items[c.id] = {
        id: c.id,
        agent: r.agent,
        title: c.title,
        severity: "",
        status: c.status,
        statusText: label,
        firstSeen: runDay,
        lastSeen: at,
        closedAt: at,
        closedNote: c.note.slice(0, NOTE_MAX),
      };
      continue;
    }
    cur.title ||= c.title;
    if (at < cur.lastSeen) continue;
    if (cur.status === c.status) {
      cur.closedNote ||= c.note.slice(0, NOTE_MAX);
      cur.lastSeen = at;
      continue;
    }
    close(cur, c.status, at, label, c.note);
  }

  for (const item of Object.values(l.items)) {
    if (item.agent !== r.agent || mentioned.has(item.id) || item.status !== "open" || item.lastSeen >= at) continue;
    close(item, "resolved", at, "No longer reported", "");
  }

  if (r.run && !l.runs.some((x) => x.agent === r.agent && x.run === r.run)) {
    l.runs.push({ agent: r.agent, run: r.run, runAt: r.runAt ?? at, version: r.version, open: r.items.filter((i) => i.status === "open").length, closed: r.closed.length });
    l.runs.sort((a, b) => (a.runAt ?? "").localeCompare(b.runAt ?? ""));
  }
  return l;
}

// ---------------------------------------------------------------------------
// What the page shows
// ---------------------------------------------------------------------------

export interface AgentView {
  info: AgentInfo;
  report: ParsedReport | null;
  open: LedgerItem[];
  resolved: LedgerItem[];
  /** Declined or accepted by a person, with a reason. */
  setAside: LedgerItem[];
  runs: LedgerRun[];
  openBySeverity: { severity: string; count: number }[];
}

export interface ActivityView {
  agents: AgentView[];
  totals: { raised: number; open: number; resolved: number; setAside: number; runs: number; since: string | null };
}

const severityRank = (info: AgentInfo, s: string) => {
  const i = info.severities.indexOf(s);
  return i < 0 ? info.severities.length : i;
};
const idNumber = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

/** Fold the reports on disk over the stored ledger and arrange it per agent for the page. */
export function activityView(stored: Ledger, reports: Partial<Record<AgentKey, ParsedReport>>, now: Date = new Date()): ActivityView {
  const l: Ledger = structuredClone(stored);
  for (const a of AGENTS) {
    const r = reports[a.key];
    if (r) foldReport(l, r, r.runAt ?? now.toISOString());
  }
  const items = Object.values(l.items);
  const byClosed = (a: LedgerItem, b: LedgerItem) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || idNumber(a.id) - idNumber(b.id);
  const agents = AGENTS.map((info): AgentView => {
    const mine = items.filter((i) => i.agent === info.key);
    const open = mine
      .filter((i) => i.status === "open")
      .sort((a, b) => severityRank(info, a.severity) - severityRank(info, b.severity) || idNumber(a.id) - idNumber(b.id));
    return {
      info,
      report: reports[info.key] ?? null,
      open,
      resolved: mine.filter((i) => i.status === "resolved").sort(byClosed),
      setAside: mine.filter((i) => i.status === "declined" || i.status === "accepted").sort(byClosed),
      runs: l.runs.filter((x) => x.agent === info.key),
      openBySeverity: info.severities.map((severity) => ({ severity, count: open.filter((i) => i.severity === severity).length })).filter((s) => s.count),
    };
  });
  const firstDates = [...items.map((i) => i.firstSeen), ...l.runs.map((r) => (r.runAt ?? "").slice(0, 10))].filter(Boolean).sort();
  return {
    agents,
    totals: {
      raised: items.length,
      open: items.filter((i) => i.status === "open").length,
      resolved: items.filter((i) => i.status === "resolved").length,
      setAside: items.filter((i) => i.status === "declined" || i.status === "accepted").length,
      runs: l.runs.length,
      since: firstDates[0] ?? null,
    },
  };
}
