#!/usr/bin/env python3
"""PreToolUse hook for the review agents. The runner (scripts/review-run.sh) copies this into each
agent's private snapshot and names the agent as the argument. It enforces, in the harness rather than
only in the agents' instructions:

  independence  every tool stays inside the snapshot, so an agent cannot reach another agent's report,
                the ledger, memory (~/.claude), transcripts or the real repository; no agent can start
                another agent.
  private data  nothing under data/ except the agent's own last report, and no requests to any running
                app: the owner's copy of the CRM holds real people's details.
  read-only     no writes, installs or network writes. Each agent gets only the few checks its job needs.

Exit 0 allows, exit 2 refuses with the reason on stderr. It fails closed: any error here refuses.
A deny-list with an inside-the-snapshot rule, not a sandbox: it stops mistakes and casual reach, not a
determined program. The separation that matters most is structural: the snapshot simply does not
contain anyone else's work, or anyone's data.
"""
import json
import os
import re
import sys

ALL = {"code", "security", "ux"}
SECRET_FILE = re.compile(r"(^|/)(\.env(\.[^/]*)?|crm\.db(-wal|-shm)?|auth-token|owner\.json|vocab\.json)$")
SECRET_ALLOWED = re.compile(r"(^|/)\.env\.example$")
OUTSIDE_ROOTS = r"Users|home|private|tmp|var|etc|root|Volumes|Library|System|Applications|opt"

# What each agent may run that the read-only rules would otherwise refuse.
PERMITTED = {
    "code": [r"\bnpx\s+tsc\s+--noEmit\b[^|;&]*", r"\bnpm\s+test\b", r"\bnpm\s+run\s+typecheck\b"],
    "security": [r"\bnpm\s+audit\b[^|;&]*"],
    "ux": [],
}


def refuse(reason):
    print(f"Refused by the review guard: {reason}", file=sys.stderr)
    sys.exit(2)


def own_tool_result(root, full):
    """A long tool output the harness saved for this agent's own session, and nothing else under ~/.claude."""
    slug = re.sub(r"[^A-Za-z0-9]", "-", root)
    base = os.path.join(os.path.expanduser("~"), ".claude", "projects", slug) + os.sep
    return full.startswith(base) and "/tool-results/" in full


def check_path(root, agent, path, tool=""):
    raw = os.path.expanduser(str(path))
    full = os.path.normpath(os.path.join(root, raw))
    if tool == "Read" and ".." not in raw.split(os.sep) and own_tool_result(root, full):
        return
    # ".." is refused outright: through a symlink it resolves somewhere else than it appears to.
    if ".." in raw.split(os.sep) or not (full == root or full.startswith(root + os.sep)):
        refuse(f"{path} is outside this review's private snapshot.")
    real, real_root = os.path.realpath(full), os.path.realpath(root)
    # node_modules is a copy, so nothing legitimate in a snapshot resolves outside it.
    if not (real == real_root or real.startswith(real_root + os.sep)):
        refuse(f"{path} resolves outside this review's private snapshot.")
    if SECRET_FILE.search(full) and not SECRET_ALLOWED.search(full):
        refuse(f"{path} may hold private data or secrets.")
    rel = os.path.relpath(full, root)
    if rel.startswith("data" + os.sep) and rel != os.path.join("data", "agent-reports") and not rel.startswith(os.path.join("data", "agent-reports", agent)):
        refuse(f"{path} is private data, or another agent's work.")
    if rel.startswith(os.path.join("docs", "reviews")):
        refuse(f"{path} is private working notes.")


def check_files(root, agent, tool, inp):
    for key in ("file_path", "path"):
        if inp.get(key):
            check_path(root, agent, inp[key], tool)
    if ".." in str(inp.get("pattern", "")) and tool == "Glob" or ".." in str(inp.get("glob", "")):
        refuse("the pattern climbs out of the snapshot.")


def check_bash(root, agent, cmd):
    # Independence: nothing outside the snapshot.
    scrubbed = cmd.replace(root, "")
    if re.search(rf"(^|[\s='\"(:,])/({OUTSIDE_ROOTS})(/|\b)", scrubbed):
        refuse("the command names a path outside this review's private snapshot.")
    if re.search(r"\b(cd|find|ls|du|tree|rg|grep\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+\S+)\s+/(\s|$|;|&|\|)", scrubbed):
        refuse("the command searches from the root of the disk.")
    if re.search(r"(^|[\s/'\"=])\.\.(/|\s|$|'|\"|;|&|\|)", scrubbed):
        refuse("the command climbs out of the snapshot.")
    if re.search(r"~|\$\{?HOME\b|\$\{?OLDPWD\b|\bpushd\b|\bpopd\b|\$\{!|\beval\b|\bexport\s+-p\b|(^|[;&|]\s*)(set|declare|compgen)(\s|$)|\|\s*(ba|z|da)?sh\b|\b(ba|z|da)?sh\s+-c\b", scrubbed):
        refuse("the command reaches outside the snapshot or hides what it runs.")
    if re.search(r"\.claude/(projects|scheduled-tasks|memory)|MEMORY\.md|AGENT_LEDGER", scrubbed):
        refuse("memory and the shared ledger are off limits.")
    for other in ALL - {agent}:
        if re.search(rf"agent-reports/{other}\b", scrubbed):
            refuse("another agent's report is off limits.")
    if re.search(r"(^|[;&|(]\s*|\bxargs\s+)claude\b|\bosascript\b|\bprintenv\b|(^|[;&|]\s*)env(\s*$|\s*[;&|])|/proc/", scrubbed):
        refuse("no starting other agents, no scripting the desktop, no dumping the environment.")
    if re.search(r"(^|[\s/'\"])\.env(\.(?!example)\w+)?(\s|$|'|\")|(^|[\s/'\"])(owner|vocab)\.json\b|\bcrm\.db\b|\bauth-token\b|\bserver\.log\b|\bdata/backups\b|\bdocs/reviews\b", scrubbed):
        refuse("private data and secret files are off limits.")

    # Remove what this agent is permitted, then apply the read-only rules to the rest.
    rest = scrubbed
    for pattern in PERMITTED[agent]:
        rest = re.sub(pattern, " ", rest)
    unquoted = re.sub(r"'[^']*'|\"[^\"]*\"", "''", rest)  # a > inside a quoted pattern is not a redirect
    if re.search(r"(^|[^<>0-9&])>{1,2}\s*(?!&|/dev/null)[^\s&]|\btee\b|\bsed\b[^|;&]*\s-[a-zA-Z]*i\b|\bdd\b", unquoted):
        refuse("the review agents write nothing.")
    if re.search(r"(^|[;&|(]\s*|\bsudo\s+|\bxargs\s+(-[^ ]+\s+)*)(rm|rmdir|mv|cp|ln|mkdir|touch|truncate|chmod|chown|chgrp|install|mkfs|kill|killall|pkill|shutdown|reboot|launchctl|crontab|open)\b", rest):
        refuse("the command changes files or the system.")
    if re.search(r"\bgit\s+(-[^ ]+\s+)*(add|commit|push|pull|fetch|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|clean|rm|mv|tag|filter-branch|gc|prune|worktree|submodule|am|apply|init|clone)\b", rest):
        refuse("the command changes version control.")
    if re.search(r"\b(npm|pnpm|yarn|bun)\s+(-[^ ]+\s+)*\w|\bnpx\s|\bpip3?\s|\buv\s|\bpoetry\s|\bbrew\s|\bdocker\b|\bfly(ctl)?\s|\bgh\s", rest):
        if not re.search(r"\b(npm|pnpm|yarn|bun)\s+(ls|list|view|outdated)\b", rest):
            refuse("package managers and deploys are not part of this agent's job.")
    if re.search(r"\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b|\bnc\b|\bncat\b|\btelnet\b|\bftp\b", rest):
        refuse("this agent reviews code and makes no requests: the owner's running copy holds real people's details.")
    if re.search(r"\b(python3?|node|ruby|perl|php)\b", rest) and re.search(
        r"open\([^()]*(,|mode=)\s*\\?[\"'](w|a|x|r\+)|write_text|writeFile|unlink|rename\(|rmSync|rmdir|os\.remove|os\.system|shutil|subprocess|child_process|socket|urllib|requests|https?\.request|fetch\(", rest):
        refuse("a script that writes files or reaches the network.")


def main():
    agent = sys.argv[1]
    if agent not in ALL:
        refuse(f"unknown agent {agent}")
    root = os.path.normpath(os.environ["CLAUDE_PROJECT_DIR"])
    data = json.load(sys.stdin)
    tool = data.get("tool_name", "")
    inp = data.get("tool_input", {}) or {}
    if tool == "Bash":
        check_bash(root, agent, inp.get("command", ""))
    elif tool in ("Read", "Grep", "Glob"):
        check_files(root, agent, tool, inp)
    else:
        refuse(f"{tool} is not available to the review agents.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:
        refuse(f"the guard failed, so it refuses: {err}")
