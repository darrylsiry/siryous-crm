import Link from "next/link";
import { loadAgentActivity, mockupIds, reviewFreshness, reviewStanding, type ReviewStanding } from "@/lib/agentActivity";
import type { AgentView, LedgerItem, LedgerRun } from "@/lib/agentLedger";
import { AGENTS, type AgentKey } from "@/lib/agentReports";
import { first, type Param } from "@/lib/params";

export const dynamic = "force-dynamic";

export const metadata = { title: "App Tests" };

// App Tests: what the independent review agents have found and what became of
// it, read from their reports and the ledger on every request. Nothing here
// changes anything.

const TONE: Record<string, string> = {
  Critical: "bg-rose-100 text-rose-800",
  "P1 Blocker": "bg-rose-100 text-rose-800",
  High: "bg-orange-100 text-orange-800",
  "P2 Major": "bg-orange-100 text-orange-800",
  Medium: "bg-amber-100 text-amber-800",
  "P3 Minor": "bg-amber-100 text-amber-800",
  Low: "bg-stone-100 text-stone-700",
  "P4 Polish": "bg-stone-100 text-stone-700",
  Suggestion: "bg-stone-100 text-stone-600",
  Informational: "bg-sky-50 text-sky-800",
};

function Severity({ s, count }: { s: string; count?: number }) {
  if (!s) return <span className="text-xs text-stone-500">—</span>;
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${TONE[s] ?? "bg-stone-100 text-stone-700"}`}>
      {s}
      {count !== undefined ? <span className="ml-1 tabular-nums">{count}</span> : null}
    </span>
  );
}

function Status({ item }: { item: LedgerItem }) {
  const tone =
    item.status === "resolved"
      ? "bg-emerald-50 text-emerald-700"
      : item.status === "accepted"
        ? "bg-amber-50 text-amber-800"
        : item.status === "declined"
          ? "bg-stone-100 text-stone-600"
          : /^new/i.test(item.statusText)
            ? "bg-indigo-50 text-indigo-700"
            : "bg-white text-stone-700 ring-1 ring-stone-200";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{item.statusText}</span>;
}

function stamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A calendar date (`2026-10-30`) as `Oct 30`, with the year when it isn't this year. */
function day(d: string): string {
  const date = new Date(`${d.slice(0, 10)}T12:00:00`);
  if (isNaN(date.getTime())) return d;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** Text with the agents' `code` spans set as code. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, n) =>
        n % 2 ? (
          <code key={n} className="rounded bg-stone-100 px-1 font-mono text-[12px] text-stone-800">
            {part}
          </code>
        ) : (
          part
        )
      )}
    </>
  );
}

const Version = ({ value }: { value: string }) => <code className="rounded bg-stone-100 px-1 text-xs text-stone-700">{value}</code>;

const th = "px-2 py-2 font-medium";
const firstTh = "px-4 py-2 font-medium";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <h3 className="border-b border-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-800">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{value}</div>
      <div className="mt-0.5 text-xs text-stone-500">{sub}</div>
    </div>
  );
}

/** Under an agent's numbers: are they for the code as it is now? */
function StandingNote({ a, s }: { a: AgentView; s: ReviewStanding }) {
  if (!a.report) return null;
  if (s.kind === "running") {
    return <p className="mt-1 text-xs font-medium text-indigo-700">Reviewing the current code now, since {stamp(s.since.toISOString())}: these numbers change when it finishes.</p>;
  }
  if (s.kind === "stuck") {
    return (
      <p className="mt-1 text-xs font-medium text-red-700">
        A run started {stamp(s.since.toISOString())} never finished, which stops new ones. Delete the folder <code>.review/lock-{a.info.key}</code> in the CRM folder to clear it.
      </p>
    );
  }
  if (s.kind === "behind") {
    return (
      <p className="mt-1 text-xs font-medium text-amber-800">
        The code has changed since this run, so some of these may already be fixed. The next run updates them (scheduled, or <code>{a.info.command}</code>).
      </p>
    );
  }
  if (s.kind === "current") return <p className="mt-1 text-xs text-emerald-700">Up to date with the current code.</p>;
  return null;
}

function AgentCard({ a, selected, now, standing }: { a: AgentView; selected: boolean; now: number; standing: ReviewStanding }) {
  const r = a.report;
  return (
    <Link
      href={`/app-tests?agent=${a.info.key}#findings`}
      aria-current={selected ? "true" : undefined}
      className={`group flex flex-col rounded-xl border bg-white p-4 transition hover:border-indigo-300 ${selected ? "border-indigo-400 ring-1 ring-indigo-200" : "border-stone-200"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-stone-900 group-hover:text-indigo-700">{a.info.name}</h2>
        <span className="font-mono text-xs text-stone-500">{a.info.agent}</span>
      </div>
      <p className="mt-0.5 text-xs text-stone-500">{a.info.what}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <span className="text-2xl font-semibold tabular-nums text-stone-900">{a.open.length}</span>
          <span className="ml-1 text-xs text-stone-500">open</span>
        </div>
        <div>
          <span className="text-2xl font-semibold tabular-nums text-emerald-700">{a.resolved.length}</span>
          <span className="ml-1 text-xs text-stone-500">resolved</span>
        </div>
      </div>
      <div className="mt-2 flex min-h-6 flex-wrap gap-1">
        {a.openBySeverity.map((s) => (
          <Severity key={s.severity} s={s.severity} count={s.count} />
        ))}
      </div>
      <p className="mt-auto pt-3 text-xs text-stone-500">
        {r?.runAt ? (
          <>
            Last run {stamp(r.runAt)} · {ago(r.runAt, now)}
            {r.version ? (
              <>
                {" "}
                · <Version value={r.version} />
              </>
            ) : null}
          </>
        ) : (
          "No report yet"
        )}
      </p>
      <StandingNote a={a} s={standing} />
    </Link>
  );
}

function OpenTable({ a, mockups }: { a: AgentView; mockups: Set<string> }) {
  if (!a.report && !a.open.length) {
    return (
      <p className="px-4 py-3 text-sm text-stone-500">
        This agent hasn&apos;t run yet. Start it from a terminal in the CRM folder with <Version value={a.info.command} />.
      </p>
    );
  }
  if (!a.open.length) return <p className="px-4 py-3 text-sm text-stone-500">Nothing open: every finding from this agent has been resolved, declined or accepted.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="whitespace-nowrap text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className={firstTh}>ID</th>
            <th className={th}>Severity</th>
            <th className={th}>Finding</th>
            <th className={th}>First seen</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {a.open.map((i) => (
            <tr key={i.id} className="border-t border-stone-100 align-top">
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-stone-700">{i.id}</td>
              <td className="px-2 py-2">
                <Severity s={i.severity} />
              </td>
              <td className="min-w-0 px-2 py-2 text-stone-800">
                <Inline text={i.title} />
                {mockups.has(i.id) ? (
                  <a href={`/app-tests/mockups/${i.id}`} target="_blank" rel="noopener" className="ml-2 whitespace-nowrap text-xs text-indigo-600 hover:underline">
                    Before / after mockup ↗
                  </a>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-stone-600">{day(i.firstSeen)}</td>
              <td className="px-2 py-2">
                <Status item={i} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClosedTable({ items }: { items: LedgerItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="whitespace-nowrap text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className={firstTh}>ID</th>
            <th className={th}>Finding</th>
            <th className={th}>Raised</th>
            <th className={th}>Closed</th>
            <th className={th}>How</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-stone-100 align-top">
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-stone-700">{i.id}</td>
              <td className="px-2 py-2 text-stone-800">
                {i.title ? <Inline text={i.title} /> : <span className="text-stone-500">—</span>}
                {i.severity ? (
                  <span className="ml-2">
                    <Severity s={i.severity} />
                  </span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-stone-600">{day(i.firstSeen)}</td>
              <td className="whitespace-nowrap px-2 py-2 text-stone-600">{stamp(i.closedAt)}</td>
              <td className="px-2 py-2 text-xs text-stone-600">
                <Status item={i} />
                {i.closedNote ? (
                  <span className="mt-1 block max-w-md truncate" title={i.closedNote.replace(/`/g, "")}>
                    {i.closedNote.replace(/`/g, "")}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Findings({ a, mockups }: { a: AgentView; mockups: Set<string> }) {
  const r = a.report;
  return (
    <div id="findings" className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {a.info.name}{" "}
          <span className="font-normal text-stone-500">
            · {a.open.length} open · {a.resolved.length} resolved
            {a.setAside.length ? ` · ${a.setAside.length} declined or accepted` : ""}
          </span>
        </h2>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-xs text-stone-500">
            Runs with <Version value={a.info.command} />
          </span>
          {r ? (
            <Link href={`/app-tests/${a.info.key}`} className="text-indigo-600 hover:underline">
              Full report →
            </Link>
          ) : null}
        </div>
      </div>
      {r?.headline ? (
        <p className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-stone-500">Latest run says</span>
          {r.headline.replace(/`/g, "").replace(/\*\*/g, "").slice(0, 600)}
          {r.headline.length > 600 ? "…" : ""}
        </p>
      ) : null}
      <Section title={`Open · ${a.open.length}`}>
        <OpenTable a={a} mockups={mockups} />
      </Section>
      <Section title={`Resolved · ${a.resolved.length}`}>
        {a.resolved.length ? (
          <details>
            <summary className="cursor-pointer px-4 py-2 text-sm text-indigo-600 hover:underline">Show all {a.resolved.length}, newest first</summary>
            <ClosedTable items={a.resolved} />
          </details>
        ) : (
          <p className="px-4 py-3 text-sm text-stone-500">Nothing resolved yet.</p>
        )}
      </Section>
      {a.setAside.length ? (
        <Section title={`Declined or accepted · ${a.setAside.length}`}>
          <ClosedTable items={a.setAside} />
        </Section>
      ) : null}
    </div>
  );
}

function RunsLog({ runs, now }: { runs: LedgerRun[]; now: number }) {
  const recent = [...runs].sort((a, b) => (b.runAt ?? "").localeCompare(a.runAt ?? "")).slice(0, 12);
  if (!recent.length) return <p className="px-4 py-3 text-sm text-stone-500">No runs recorded yet.</p>;
  const nameOf = (key: AgentKey) => AGENTS.find((a) => a.key === key)?.name ?? key;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="whitespace-nowrap text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className={firstTh}>When</th>
            <th className={th}>Agent</th>
            <th className={th}>Code version</th>
            <th className={`${th} text-right`}>Listed open</th>
            <th className={`${th} text-right`}>Closed in the run</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r) => (
            <tr key={`${r.agent}-${r.run}`} className="border-t border-stone-100">
              <td className="whitespace-nowrap px-4 py-2 text-stone-600">
                {stamp(r.runAt)} <span className="text-xs text-stone-500">· {ago(r.runAt, now)}</span>
              </td>
              <td className="px-2 py-2">
                <Link href={`/app-tests?agent=${r.agent}#findings`} className="text-stone-900 hover:text-indigo-600 hover:underline">
                  {nameOf(r.agent)}
                </Link>
              </td>
              <td className="px-2 py-2">{r.version ? <Version value={r.version} /> : "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.open}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.closed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AppTestsPage({ searchParams }: { searchParams: Promise<{ agent?: Param }> }) {
  const agent = first((await searchParams).agent);
  const { view, ledgerUpdatedAt } = loadAgentActivity();
  const mockups = mockupIds();
  const now = Date.now();
  // Each report is for the code as it was when its run started: say where that leaves the numbers.
  const freshness = await Promise.all(view.agents.map((a) => reviewFreshness(a.info.key)));
  const standings = view.agents.map((a, i) => reviewStanding(a.report?.version ?? null, freshness[i], now));
  const named = (kind: ReviewStanding["kind"]) => view.agents.filter((_, i) => standings[i].kind === kind).map((a) => a.info.name);
  const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);
  const running = named("running");
  const behind = named("behind");
  const selected: AgentKey = AGENTS.some((a) => a.key === agent) ? (agent as AgentKey) : "code";
  const current = view.agents.find((a) => a.info.key === selected)!;
  const t = view.totals;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">✓ App Tests</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-500">
          Three Claude agents review this app, each on its own, for code quality, security and usability. This page reads their reports as they change and keeps the history of
          every finding, open or closed. Read only: nothing here changes the app.
        </p>
      </header>

      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
        <span className="font-medium text-stone-900">How they stay independent.</span> Each run is a separate process in its own copy of the code, holding only that agent&apos;s
        instructions and its own last report. Agents get no memory, no other agent&apos;s findings and no way to reach each other, and never your contacts or settings. This page is the
        only place their results meet, and no agent can read it.
      </div>

      <p className="text-xs text-stone-500">
        Reports stay on this computer in <code>data/agent-reports</code>
        {t.since ? <> · history since {day(t.since)}</> : null}
        {ledgerUpdatedAt ? <> · ledger updated {stamp(ledgerUpdatedAt)}</> : null}
      </p>

      {running.length || behind.length ? (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {running.length ? <>Running now: {and(running)}. </> : null}
          {behind.length ? (
            <>
              The code has changed since the latest {and(behind)} run{behind.length > 1 ? "s" : ""}, so the counts below can include findings that are already
              fixed until {behind.length > 1 ? "they run" : "it runs"} again.
            </>
          ) : (
            <>The counts below change when {running.length > 1 ? "they finish" : "it finishes"}.</>
          )}
        </p>
      ) : null}

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Findings raised" value={t.raised} sub="all time, all agents" />
        <Stat label="Resolved" value={t.resolved} sub={t.raised ? `${Math.round((t.resolved / t.raised) * 100)}% of everything raised` : "—"} />
        <Stat label="Open now" value={t.open} sub="in the agents' latest runs" />
        <Stat label="Declined or accepted" value={t.setAside} sub="by a person, with a reason" />
        <Stat label="Agent runs" value={t.runs} sub="recorded in the ledger" />
      </section>

      <section aria-label="Agents" className="grid gap-3 md:grid-cols-3">
        {view.agents.map((a) => (
          <AgentCard key={a.info.key} a={a} selected={a.info.key === selected} now={now} standing={standings[view.agents.indexOf(a)]} />
        ))}
      </section>

      <Findings a={current} mockups={mockups} />

      <Section title="Recent runs · all agents">
        <RunsLog runs={view.agents.flatMap((a) => a.runs)} now={now} />
      </Section>
    </div>
  );
}
