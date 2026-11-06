import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { activityView, readLedger, type ActivityView } from "./agentLedger";
import { AGENTS, parseReport, urgentSeverities, type AgentKey, type ParsedReport } from "./agentReports";

/**
 * Server side of App Tests: find the review agents' reports and the ledger,
 * read them, and hand the parsed result to the page. Read on every request, so
 * the page is as current as the files. They live in the gitignored
 * data/agent-reports because a report can describe an open weakness in detail,
 * and this repository is public.
 */
export function reportsDir(): string {
  return process.env.AGENT_REPORTS_DIR || path.join(process.cwd(), "data", "agent-reports");
}

function readOptional(file: string): { text: string; mtime: Date } | null {
  try {
    return { text: fs.readFileSync(file, "utf8"), mtime: fs.statSync(file).mtime };
  } catch {
    return null;
  }
}

function readReports(): Partial<Record<AgentKey, ParsedReport>> {
  const reports: Partial<Record<AgentKey, ParsedReport>> = {};
  for (const a of AGENTS) {
    const f = readOptional(path.join(reportsDir(), a.file));
    if (f) reports[a.key] = parseReport(a.key, f.text);
  }
  return reports;
}

/** Most people who download the app never run these agents, so the menu leaves the page out until a report exists. */
export function hasReports(): boolean {
  return AGENTS.some((a) => fs.existsSync(path.join(reportsDir(), a.file)));
}

export function loadAgentActivity(): { view: ActivityView; ledgerUpdatedAt: string | null } {
  const ledger = readLedger(readOptional(path.join(reportsDir(), "AGENT_LEDGER.json"))?.text ?? null);
  return { view: activityView(ledger, readReports()), ledgerUpdatedAt: ledger.updatedAt };
}

/** One agent's latest report as it wrote it, with any absolute path shortened to a repository path. */
export function readReport(agent: AgentKey): { text: string; mtime: Date } | null {
  const info = AGENTS.find((a) => a.key === agent);
  if (!info) return null;
  const f = readOptional(path.join(reportsDir(), info.file));
  return f && { text: f.text.replace(/\/(?:Users|home|private)\/[^\s`'"]*?\.review\/(?:code|security|ux)\//g, ""), mtime: f.mtime };
}

/**
 * Where an agent's review stands against the code as it is now, so the page
 * can say when its numbers are behind. `runningSince`: scripts/review-run.sh
 * holds .review/lock-<agent> while a run is under way. `codeNow`: the
 * fingerprint of the files that agent covers, from `review-run.sh <agent>
 * status`; when it differs from the report's code version, the code has
 * changed since that report. null when it can't be told (no bash or git).
 */
export interface ReviewFreshness {
  runningSince: Date | null;
  codeNow: string | null;
}

const run = promisify(execFile);
/** A lock older than this is a run that died without cleaning up (the runner stops an agent at 90 minutes). */
export const STALE_LOCK_MS = 2 * 60 * 60 * 1000;

export async function reviewFreshness(agent: AgentKey): Promise<ReviewFreshness> {
  const root = process.cwd();
  let runningSince: Date | null = null;
  try {
    runningSince = fs.statSync(path.join(root, ".review", `lock-${agent}`)).mtime;
  } catch {
    /* not running */
  }
  let codeNow: string | null = null;
  try {
    const { stdout } = await run("bash", [path.join(root, "scripts", "review-run.sh"), agent, "status"], { cwd: root, timeout: 10_000 });
    codeNow = /: code ([0-9a-f]{8});/.exec(stdout)?.[1] ?? null;
  } catch {
    /* no bash or git: say nothing rather than guess */
  }
  return { runningSince, codeNow };
}

/** Whether a report's numbers are current: what App Tests says under each agent. */
export type ReviewStanding =
  | { kind: "running"; since: Date }
  | { kind: "stuck"; since: Date }
  | { kind: "behind" }
  | { kind: "current" }
  | { kind: "unknown" };

/** `version`: the code version the latest report reviewed. Pure. */
export function reviewStanding(version: string | null, f: ReviewFreshness, now: number): ReviewStanding {
  if (f.runningSince) {
    return now - f.runningSince.getTime() > STALE_LOCK_MS ? { kind: "stuck", since: f.runningSince } : { kind: "running", since: f.runningSince };
  }
  if (!version || !f.codeNow) return { kind: "unknown" };
  return f.codeNow === version ? { kind: "current" } : { kind: "behind" };
}

/** A UX before/after mockup, or null. The strict id keeps this inside the mockups folder. */
export function readMockup(id: string): string | null {
  if (!/^UX-\d{3,4}$/.test(id)) return null;
  return readOptional(path.join(reportsDir(), "ux", "mockups", `${id}.html`))?.text ?? null;
}

/** Which UX findings have a mockup on file. */
export function mockupIds(): Set<string> {
  try {
    return new Set(
      fs
        .readdirSync(path.join(reportsDir(), "ux", "mockups"))
        .filter((f) => /^UX-\d{3,4}\.html$/.test(f))
        .map((f) => f.replace(/\.html$/, ""))
    );
  } catch {
    return new Set();
  }
}

/** Open findings at the top two severities in the agents' latest reports: the sidebar badge. */
export function urgentFindingCount(): number {
  const reports = readReports();
  let n = 0;
  for (const a of AGENTS) {
    const urgent = urgentSeverities(a);
    n += (reports[a.key]?.items ?? []).filter((i) => i.status === "open" && urgent.includes(i.severity)).length;
  }
  return n;
}
