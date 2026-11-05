# Independent review agents

Three Claude agents review this app. Each has one purpose and works alone. Their reports appear on the
**App Tests** page, which shows in the sidebar once a report exists. This is for whoever develops the app:
someone who only uses the CRM never needs it, and nothing runs unless it's started.

| Agent | Purpose | Report (under `data/agent-reports/`) | IDs | Run it |
|---|---|---|---|---|
| `code-auditor` | Bugs and code quality | `code/REPORT.md` | `CR-001` | `scripts/review-run.sh code` |
| `security-reviewer` | Vulnerabilities, and data leaving the machine unannounced | `security/REPORT.md` | `SEC-001` | `scripts/review-run.sh security` |
| `ux-reviewer` | Usability, with before/after mockups | `ux/REPORT.md` | `UX-001` | `scripts/review-run.sh ux` |

The slash commands `/audit`, `/security-audit` and `/ux-audit` run the same thing. A run is skipped when
the code it covers has not changed; add `force` to run anyway. `scripts/review-run.sh all` runs all three at
once, each in its own process. It needs a git checkout, Python 3 and the Claude Code CLI, and costs usage
on your Claude plan: each run reads the whole repository. `REVIEW_MODEL` overrides the model.

## How independence is enforced

1. **Own snapshot.** `scripts/review-run.sh` copies the code to `.review/<agent>/`, with only that agent's
   definition and its own previous report. No other agent's report, definition or mockups, no ledger and no
   memory are in it. What isn't there can't bias it.
2. **Own process.** Each run is a fresh `claude -p` started in the snapshot with a scrubbed environment,
   auto-memory off, project settings only, no MCP servers, no session history, and only Read, Grep, Glob and
   Bash. No tool reaches another agent.
3. **A guard on every tool call.** `scripts/review-guard.py` refuses paths outside the snapshot, memory and
   transcripts, starting another agent, requests to any running app, and anything that writes. It fails
   closed. `tests/reviewGuard.test.ts` checks it.
4. **The operating system.** On a Mac the run is wrapped in `sandbox-exec`, so the agent and anything it
   starts can read only its snapshot and the parts of the home folder its tools need. The repository, memory,
   transcripts and other tools' credentials are refused. Network stays open, because `npm audit` needs it and
   the profile can't allow a single host. Elsewhere only the guard applies, and the run says so.
5. **Results meet only after the agents finish.** The runner saves each final message word for word and folds
   it into `data/agent-reports/AGENT_LEDGER.json`. Only the App Tests page reads across agents, and no agent
   can reach it.

An agent's only link to the past is its own previous report, so it can keep finding IDs stable. Don't pass
one agent's findings, a session's conclusions or anyone's memory into another agent's definition or
snapshot. The definitions are in this repository, written by the same hand as the code: independence
covers their findings, not their brief.

## What protects your data

The snapshot is built from `git ls-files`, so anything gitignored can't get in: `data/` (the database,
backups, the sign-in token), `config/owner.json`, `config/vocab.json`, `.env.local` and `docs/reviews/`.
What an agent sends to Anthropic is the public code, its own last report and the output of its checks.

Agents never look at a running copy of the app, because yours holds real people's details. So the UX agent
reviews from source and sees nothing rendered, and its reports say so.

Reports live in `data/agent-reports/`, gitignored: this repository is public and a report can describe an
open weakness in detail. Don't commit them.

## Scheduling

These run well as Claude Code scheduled tasks. Make each one a short launcher that runs the script and
reports its last line, and run it once by hand while you're at the computer: a scheduled run has no one to
answer a permission prompt, so an unapproved `Bash` call waits forever and blocks that task's later runs.

## Using the reports

Fix items top-down and cite the ID in the commit. Agents mark items resolved when they see the fix. A person
may change a security finding's status to `Accepted`, or a UX finding's to `Declined`, with a reason.
