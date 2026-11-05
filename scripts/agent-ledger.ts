/**
 * Fold the review agents' reports into data/agent-reports/AGENT_LEDGER.json, so
 * history survives each report being overwritten. scripts/review-run.sh runs
 * this after every run. Idempotent.
 *
 *   npx tsx scripts/agent-ledger.ts [--check]
 *
 * --check prints the totals and writes nothing.
 */
import "./repo-root";
import fs from "fs";
import path from "path";
import { reportsDir } from "../lib/agentActivity";
import { foldReport, readLedger } from "../lib/agentLedger";
import { AGENTS, parseReport } from "../lib/agentReports";

const check = process.argv.includes("--check");
const dir = reportsDir();
const ledgerPath = path.join(dir, "AGENT_LEDGER.json");

const stored = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8") : null;
const ledger = readLedger(stored);
for (const a of AGENTS) {
  const file = path.join(dir, a.file);
  if (!fs.existsSync(file)) continue;
  const r = parseReport(a.key, fs.readFileSync(file, "utf8"));
  foldReport(ledger, r, r.runAt ?? fs.statSync(file).mtime.toISOString());
}

const order = (k: string) => AGENTS.findIndex((a) => a.key === k);
const num = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
const items = Object.values(ledger.items).sort((a, b) => order(a.agent) - order(b.agent) || num(a.id) - num(b.id));
const body = (updatedAt: string | null) => JSON.stringify({ ...ledger, updatedAt, items: Object.fromEntries(items.map((i) => [i.id, i])) }, null, 2) + "\n";
const changed = !stored || body(null) !== JSON.stringify({ ...readLedger(stored), updatedAt: null }, null, 2) + "\n";
const count = (s: string) => items.filter((i) => i.status === s).length;
if (!check && changed) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ledgerPath, body(new Date().toISOString()));
}
console.log(`agent ledger: ${items.length} findings (${count("open")} open, ${count("resolved")} resolved) across ${ledger.runs.length} runs${changed ? (check ? " (would update)" : " (updated)") : " (no change)"}`);
