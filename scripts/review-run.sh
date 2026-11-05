#!/usr/bin/env bash
# Run one review agent, completely on its own.
#
#   scripts/review-run.sh code|security|ux [force]
#   scripts/review-run.sh all [force]        each agent in its own process, at the same time
#   scripts/review-run.sh <agent> status     what would run, without running it
#
# Independence, by construction rather than by asking nicely:
#  - Its own snapshot (.review/<agent>): the files git tracks, its own agent definition, its own previous
#    report, and nothing else. No other agent's report, definition or mockups, no ledger and no memory.
#    Everything gitignored stays out, so that includes data/, config/owner.json and .env.local: the
#    database and the owner's details never reach an agent.
#  - Its own process: a fresh `claude -p` started in that folder with a scrubbed environment, no memory,
#    no user settings, no session history, no MCP servers, and only Read, Grep, Glob and Bash. There is
#    no tool that reaches another agent, and nothing is passed between runs.
#  - A guard on every tool call (scripts/review-guard.py) keeps it inside the snapshot and read-only.
#  - The runner writes the agent's final message to data/agent-reports/<agent>/REPORT.md as it stands and
#    folds it into the ledger. Agents never see the ledger, which is the only place results meet.
#
# A run is skipped when the code it covers has not changed since its last run, unless `force`.
# Costs usage on your Claude plan. REVIEW_MODEL overrides the model. Logs: .review/logs/.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WHAT="${1:-}"; MODE="${2:-}"
case "$MODE" in force|status|"") ;; *) echo "Unknown option $MODE"; exit 2 ;; esac

if [ "$WHAT" = all ]; then
  status=0; pids=()
  for k in code security ux; do "$0" "$k" $MODE & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p" || status=1; done
  exit $status
fi

case "$WHAT" in
  code) AGENT=code-auditor ;;
  security) AGENT=security-reviewer ;;
  ux) AGENT=ux-reviewer ;;
  *) echo "Usage: scripts/review-run.sh code|security|ux|all [force]"; exit 2 ;;
esac
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "The review agents work from a git checkout (they copy the files git tracks)."; exit 2; }

KEY="$WHAT"
WS="$ROOT/.review/$KEY"
REPORTS="$ROOT/data/agent-reports"
STATE="$ROOT/.review/state/$KEY"
LOGS="$ROOT/.review/logs"
STAMP="$(date '+%Y%m%d-%H%M%S')"
LOG="$LOGS/$KEY-$STAMP.log"
CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"
mkdir -p "$ROOT/.review/state" "$LOGS"

# Tracked files plus new ones, never ignored ones. Agent definitions are copied one at a time, below.
repo_files() {
  git -c core.quotepath=off ls-files -co --exclude-standard | grep -v -E '^\.claude/' | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done
}
# What a newcomer meets before the first page: part of the UX agent's first-run flow.
FIRST_RUN='^(proxy\.ts|instrumentation\.ts|(Start|Stop|Restart) CRM\.command)$'
# What each agent covers: a change elsewhere doesn't trigger it.
scope_files() {
  if [ "$KEY" = ux ]; then repo_files | grep -E "^(app|components)/|^lib/vocab\.mjs$|$FIRST_RUN"
  else repo_files | grep -v -E '^docs/|^(README\.md|LICENSE|CLAUDE\.md)$'; fi
}
# What each agent can read. UX judges what users see, so it gets no scripts or tests.
snapshot_files() {
  if [ "$KEY" = ux ]; then repo_files | grep -E "^(app|components|lib)/|^(README\.md|CLAUDE\.md|docs/DEVELOPING\.md)$|^config/.*\.example\.json$|$FIRST_RUN"
  else repo_files; fi
}
fingerprint() {  # a hash of the covered files' names and contents
  scope_files | LC_ALL=C sort | tr '\n' '\0' | xargs -0 shasum -a 256 2>/dev/null | shasum -a 256 | cut -c1-8
}

NOW_FP="$(fingerprint)"
if [ "$MODE" = status ]; then
  echo "$KEY: code $NOW_FP; last run on $(sed -n 1p "$STATE" 2>/dev/null || echo none) at $(sed -n 2p "$STATE" 2>/dev/null || echo never)"
  exit 0
fi
if [ "$MODE" != force ] && [ -f "$STATE" ] && [ "$(sed -n 1p "$STATE")" = "$NOW_FP" ]; then
  echo "$KEY: no changes since its last run ($(sed -n 2p "$STATE"), code $NOW_FP). Skipped. Add 'force' to run anyway."
  exit 0
fi

LOCK="$ROOT/.review/lock-$KEY"
if ! mkdir "$LOCK" 2>/dev/null; then echo "$KEY: a run is already in progress ($LOCK)."; exit 1; fi
trap 'rmdir "$LOCK" 2>/dev/null; [ "${REVIEW_KEEP:-0}" = 1 ] || rm -rf "$WS"' EXIT

# ---- The snapshot: only what this agent is meant to see ----
rm -rf "$WS"; mkdir -p "$WS/data/agent-reports/$KEY" "$WS/.claude/agents" "$WS/.claude/hooks"
snapshot_files | tr '\n' '\0' | tar --null -T - -cf - | tar -xf - -C "$WS"
[ -d "$REPORTS/$KEY" ] && cp -R "$REPORTS/$KEY/." "$WS/data/agent-reports/$KEY/"
cp ".claude/agents/$AGENT.md" "$WS/.claude/agents/"
cp scripts/review-guard.py "$WS/.claude/hooks/review-guard.py"
cat > "$WS/.claude/settings.json" <<JSON
{
  "permissions": { "deny": ["Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task", "SendMessage"] },
  "hooks": { "PreToolUse": [ { "matcher": "Read|Grep|Glob|Bash", "hooks": [ { "type": "command",
    "command": "python3 \"\$CLAUDE_PROJECT_DIR/.claude/hooks/review-guard.py\" $KEY", "timeout": 20 } ] } ] }
}
JSON
# Checks need installed tools. A copy, so nothing in a snapshot leads back to the repository (cheap clones on APFS).
if [ "$KEY" != ux ]; then cp -cR "$ROOT/node_modules" "$WS/node_modules" 2>/dev/null || cp -R "$ROOT/node_modules" "$WS/node_modules"; fi

FP="$NOW_FP"
PROMPT="Run your review now, following your instructions in full. The code version is $FP. Return the complete report in the required Markdown format as your final message, with nothing before or after it."

echo "$KEY: started on code $FP ($(date '+%H:%M')), log $LOG"
OUT="$LOGS/$KEY-$STAMP.out"
# The operating system's word on it, not just the guard's: on a Mac the agent's whole process tree can
# read only the parts of the home folder its tools need, so not the repository (and the database in it),
# anyone's memory and transcripts, or other tools' credentials. Network stays open: `npm audit` needs it,
# and the profile language can't allow one host.
SANDBOX=()
if [ "$(uname)" = Darwin ] && command -v sandbox-exec >/dev/null; then
  PROFILE="$ROOT/.review/state/sandbox-$KEY.sb"
  cat > "$PROFILE" <<SB
(version 1)
(allow default)
(deny file-read* file-write* (subpath "$HOME"))
(allow file-read-metadata (literal "$HOME") (literal "$(dirname "$HOME")"))
(allow file-read* file-write* (subpath "$HOME/.claude") (regex #"^$HOME/\.claude\.json") (subpath "$HOME/.npm") (subpath "$HOME/.cache") (subpath "$HOME/Library/Caches"))
(allow file-read* (subpath "$HOME/.local") (subpath "$HOME/Library/Keychains") (subpath "$HOME/Library/Preferences") (literal "$HOME/.gitconfig"))
(deny file-read* file-write* (subpath "$HOME/.claude/projects") (literal "$HOME/.claude/history.jsonl"))
(allow file-read* file-write* (subpath "$WS"))
(allow file-read* (literal "$ROOT") (literal "$(dirname "$ROOT")") (literal "$ROOT/.review"))
SB
  SANDBOX=(sandbox-exec -f "$PROFILE")
else
  echo "$KEY: no OS sandbox on this machine; the guard is the only confinement."
fi
# A scrubbed environment: nothing from the session that launched this comes along.
(
  cd "$WS" || exit 1
  exec ${SANDBOX[@]+"${SANDBOX[@]}"} env -i HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-${USER:-}}" PATH="$PATH" LANG="${LANG:-en_US.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
    CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
    "$CLAUDE_BIN" -p "$PROMPT" --agent "$AGENT" --model "${REVIEW_MODEL:-claude-opus-5-5}" \
      --tools "Read,Grep,Glob,Bash" --allowedTools "Read,Grep,Glob,Bash" \
      --strict-mcp-config --setting-sources project --no-session-persistence --permission-mode dontAsk \
      < /dev/null > "$OUT" 2> "$LOG"
) &
RUN=$!
# The sleep goes when the watcher does, or it would outlive the run and hold this script's output open.
( sleep "${REVIEW_TIMEOUT:-5400}" & S=$!; trap 'kill "$S" 2>/dev/null' EXIT TERM; wait "$S" && kill "$RUN" 2>/dev/null ) & WATCH=$!
wait "$RUN"; RC=$?
kill "$WATCH" 2>/dev/null; wait "$WATCH" 2>/dev/null
if [ $RC -ne 0 ]; then echo "$KEY: the agent exited with code $RC. Nothing written. See $LOG and $OUT."; exit 1; fi

python3 scripts/review-save.py "$KEY" "$OUT" "$REPORTS" || { echo "$KEY: see $OUT"; exit 1; }
{ echo "$FP"; date '+%Y-%m-%d %H:%M'; } > "$STATE"
node --import tsx scripts/agent-ledger.ts || echo "$KEY: report saved, but the ledger was not updated."
echo "$KEY: finished. Report: data/agent-reports/$KEY/REPORT.md"
