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
   memory are in it. What isn't there can't bias it. `CLAUDE.md` goes in as `PROJECT_NOTES.md`, so the
   agent reads it as notes rather than loading it as instructions.
2. **Own process.** Each run is a fresh `claude -p` started in the snapshot with a scrubbed environment,
   auto-memory off, project settings only, no MCP servers, no session history, and only Read, Grep, Glob and
   Bash. No tool reaches another agent.
3. **A guard on every tool call.** `scripts/review-guard.py` refuses paths outside the snapshot, memory and
   transcripts, starting another agent, requests to any running app, anything that writes, the package
   manager, command substitution, the `security` (Keychain) tool, and running code of any kind: an
   interpreter or shell may only print its version, so no inline `-e`/`-c`, piped or heredoc code,
   sourced files or repository scripts. It fails closed. `tests/reviewGuard.test.ts` checks it.
4. **Checks run outside the agent.** The runner runs the type-check and the tests (code agent) and
   `npm audit` (security agent) itself, before the agent starts, and puts their output in the snapshot's
   `checks/` folder. No agent runs a package script or anything that needs the network.
5. **The operating system.** On a Mac the run is wrapped in `sandbox-exec`, so the agent and anything it
   starts can read only its snapshot and the parts of the home folder its tools need. The repository, memory,
   transcripts, scheduled tasks and other tools' credentials are refused, and nothing in the home folder can
   be written except caches: not `~/.claude` or `~/.claude.json` (settings, hooks, agents, MCP servers),
   which would run outside the sandbox later. Two things stay open because the CLI needs them: reading
   `~/Library/Keychains`, where its login is (the guard refuses the `security` tool), and the network (the
   CLI talks to Anthropic, and the profile can't allow a single host). Elsewhere only the guard applies, and
   the run says so.
6. **Results meet only after the agents finish.** The runner saves each final message word for word and folds
   it into `data/agent-reports/AGENT_LEDGER.json`. Only the App Tests page reads across agents, and no agent
   can reach it.

A report describes the code as it was when its run started, and the page shows the latest finished one. So
each agent's card also says where that leaves its numbers: **reviewing now** (the runner holds
`.review/lock-<agent>`), **the code has changed since this run** (the fingerprint from
`scripts/review-run.sh <agent> status` differs from the report's code version, so some findings may
already be fixed), or **up to date**. A lock older than two hours is reported as a run that never finished,
since it blocks new runs until it is deleted.

An agent's only link to the past is its own previous report, so it can keep finding IDs stable. Don't pass
one agent's findings, a session's conclusions or anyone's memory into another agent's definition or
snapshot. The definitions are in this repository, written by the same hand as the code: independence
covers their findings, not their brief.

## What protects your data

The snapshot is built from `git ls-files` (tracked files and new ones), so anything gitignored can't get in:
all of `data/` (the database, backups, the sign-in token), `config/*.json` other than the examples,
`.env.local`, `docs/reviews/`, and spreadsheets, databases, backups and mail files anywhere (`*.csv`,
`*.db`, `*.sqlite`, `*.bak`, …). The runner filters those patterns out again on top of `.gitignore`, in case
a file was named or placed so that it slipped past.
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
