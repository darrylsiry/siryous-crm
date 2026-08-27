# Developing Siryous CRM

The technical companion to the [README](../README.md), which is written for
people who have never opened a terminal. Everything here assumes you have.
[CLAUDE.md](../CLAUDE.md) has the ground rules for AI coding sessions in this
repository (where the system of record is, how vocabulary and owner config
must be read, what to run before committing).

## Requirements

- **Node 20–26** (`.nvmrc` says 22; `engines` in `package.json` enforces the
  range). `better-sqlite3` ships prebuilt binaries for common platforms
  (macOS arm64/x64, Linux x64, Windows x64 on current Node); anywhere else it
  compiles from source and needs a C++ toolchain — Xcode Command Line Tools on
  macOS, `build-essential` + Python on Linux, Visual Studio Build Tools on
  Windows.
- **[Ollama](https://ollama.com)** with a pulled model for the AI features.
  The default is `gemma4:26b` (~16 GB download, comfortable on 32 GB of RAM);
  `gemma4:12b` or `qwen3:8b` fit a 16 GB machine. Pick whatever Ollama has
  pulled on the Settings page. Without Ollama every non-AI feature still works.
- **Optional: the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)**
  (`curl -fsSL https://claude.ai/install.sh | bash`, then `claude` → `/login`)
  signed in to a Claude subscription, with the claude.ai Gmail / Google
  Calendar / Google Drive / Zoom connectors enabled (`claude mcp list` shows
  them). Needed only for the steps that fetch external data; everything else
  works from pasted text and CRM data.

Windows and Linux work the same way as macOS from a shell (`npm install`,
`npm run build`, `npm start`). `Start CRM.bat` / `Stop CRM.bat` wrap those for
Windows the way `Start CRM.command` / `Stop CRM.command` do for macOS; the
`.bat` files were written alongside the Mac ones but have not been exercised on
a real Windows machine — treat them as a starting point and report what breaks.

## Run it

```bash
npm install
npm run dev        # Next.js dev server with Turbopack at http://127.0.0.1:3000
```

Production:

```bash
npm run build
npm start          # next start -H 127.0.0.1
```

The server binds to **127.0.0.1 only** (both `dev` and `start` pass
`-H 127.0.0.1`). Use `127.0.0.1`, not `localhost`, in the browser: the access
cookie is host-scoped and the startup log prints a `127.0.0.1` sign-in link.

### The launchers

`Start CRM.command` (macOS, double-clickable) is the whole first-run path for
non-technical users, so keep it boring and idempotent. In order it:

1. exits early (just opening the browser) if something already answers on
   `http://127.0.0.1:3000/`;
2. checks `node` and `npm` are on PATH (it prepends `/usr/local/bin`,
   `/opt/homebrew/bin` and `~/.local/bin`) and that Node is ≥ 20, with a
   nodejs.org pointer if not;
3. runs `npm install --no-audit --no-fund` when `node_modules` is missing or
   `package-lock.json` is newer than `node_modules/.package-lock.json`;
4. runs `npm run build` when `.next/BUILD_ID` is missing or older than anything
   in `app/`, `lib/`, `components/`, `package.json`, `next.config.ts` or
   `tsconfig.json`;
5. starts `npm start` under `nohup` with output in `data/server.log`, waits up
   to 60 s for the port, prints the tail of the log on failure, and opens
   `http://127.0.0.1:3000/?token=<data/auth-token>` so the browser is signed in.

`Stop CRM.command` kills whatever is listening on TCP 3000 (via `lsof`, or
`pkill -f "next start"` when `lsof` is missing). `Start CRM.bat` does the same
sequence on Windows using PowerShell for the timestamp comparisons and runs the
server in a separate minimised window; `Stop CRM.bat` kills the PID `netstat`
reports on `127.0.0.1:3000`.

Deploying a code change locally: `./Stop\ CRM.command && ./Start\ CRM.command`
(rebuilds because the source is newer than `BUILD_ID`), or `npm run build &&
npm start`.

## Environment variables

Copy `.env.example` to `.env.local` (gitignored) to change defaults. Everything
is optional, and the AI and backup settings are normally changed on the
Settings page, which stores them in the database and overrides the environment.

| Variable | Default | Meaning |
|---|---|---|
| `CRM_AUTH` | `on` | `off` disables the access token (see below). |
| `CRM_DB_PATH` | `data/crm.db` | Where the SQLite database lives. `data/auth-token` and the default backup folder are placed next to it. |
| `CRM_BACKUP_DIR` | `data/backups` next to the DB | Daily backup folder; `off` disables; `~/` is expanded. The Settings page's value wins over this. |
| `LOCAL_LLM_URL` | `http://127.0.0.1:11434` | Ollama endpoint. |
| `LOCAL_LLM_MODEL` | `gemma4:26b` | Model name as Ollama lists it. |
| `LOCAL_LLM_NUM_CTX` | `32768` | Context window passed to Ollama. |
| `LOCAL_LLM_TEMPERATURE` | `0.3` | Sampling temperature. |
| `LOCAL_LLM_ALLOW_REMOTE` | unset | Set to `1` to allow a non-private Ollama host. The prompt carries the whole roster, so the URL guard in `lib/llm.ts` refuses public hosts otherwise. |
| `AI_PROVIDER` | `local` | `local` or `claude` for the tool-less write steps. |
| `AI_FALLBACK` | `claude` | `claude` or `none`: what to do when Ollama is unavailable. |
| `CLAUDE_BIN` | unset | Path to the Claude Code CLI if it isn't on PATH, in `~/.local/bin` or `/opt/homebrew/bin`. |
| `PORT` | `3000` | Only affects the sign-in link printed at startup; the launchers assume 3000. |
| `NEXT_TELEMETRY_DISABLED` | unset | The launchers and CI set it to `1`. |

## Access token

There are no user accounts. On first start `lib/auth.mjs` generates a random
24-byte token in `data/auth-token` (mode 0600, next to the database, never
leaves the machine). `proxy.ts` (the Next.js middleware, matched on everything
except static assets) checks, in order:

1. a valid `crm_auth` cookie → through, cookie refreshed (one-year max age,
   `httpOnly`, `sameSite: strict`);
2. a valid `?token=` query parameter → set the cookie and redirect to the
   clean URL; an invalid one → `/signin?bad=1`;
3. otherwise → the `/signin` page (API routes get a 401 instead).

Token comparison is constant-time. `Start CRM.command` opens the app with the
token applied; `npm run dev` / `npm start` print the sign-in link in the
terminal (`instrumentation.ts`); the Settings page shows it for signing in
another browser. The point is not multi-user security — it stops other
software on the same machine, and a web page using **DNS rebinding** against
the loopback address, from reading or changing the CRM. `CRM_AUTH=off` in
`.env.local` disables it (CI does this). Delete the token file and restart to
rotate it.

## How the AI features work

The AI features run on a **local open-weight model** by default (Ollama,
`gemma4:26b` unless configured), with the **locally installed Claude Code CLI**
used only where a step needs data the local model can't reach (Gmail, Calendar,
Zoom, Drive, the web) and as an automatic fallback when Ollama isn't running.
Nothing needs an API key; the Claude steps use the same subscription as Claude
Desktop.

Every feature is split into a *fetch* step (Claude, read-only connector tools)
and a *write* step (local model, no tools). `lib/llm.ts` is the Ollama client
(streaming, context-overflow detection, the URL guard), `runModel` in
`lib/ai.ts` does the local-first / Claude-fallback routing, and
`runWithProgress` in `lib/progress.ts` routes each step by whether it carries a
tool grant and streams a live activity feed to the UI.

| Feature | Fetch step (Claude, read-only tools) | Write step (local model) |
|---------|--------------------------------------|--------------------------|
| Intake  | optional web-research digest (checkbox on the form; skipped gracefully if Claude fails) | extract the profile, connections, actions, log entry |
| Log     | paste: none · Zoom / Gmail / Meet-via-Drive: retrieve the transcript or thread | write the interaction-log entries |
| Prep    | two separate runs: (1) Calendar + Gmail, no web — what's changed since last touch (and which meeting is next, in auto mode); (2) web only, given just the person's public name/role/company — recent public news. Kept apart so a session that reads your email never holds a tool that can send data out | write the brief |
| Coach   | none | advice, chat replies, closing summary |

If a fetch step fails (expired Claude login, connector hiccup), Intake and Prep
continue from local data and say so in the result; Log needs the content, so it
asks you to paste it instead. JSON repair also runs locally first.

Claude steps run with an explicit, **read-only** tool grant (`TOOLS` in
`lib/ai.ts`: `web`, `gmailRead`, `calendarRead`, `zoomRead`, `driveRead` —
one kind per run) and are blocked from spawning subagents and from any local
shell/file tools (`DISALLOWED_TOOLS`). Subagents are excluded because the
claude.ai connector tools don't exist inside them, so delegated research
silently comes back empty; shell/file tools because a CRM analysis has no
business touching the machine. Zoom/Gmail/Calendar/Drive access comes from the
claude.ai connectors already authorised for the CLI. Nothing the AI produces
touches the database until it has passed a human review step (the Intake and
Log review screens, the Coach's tick-to-record proposals), and no granted tool
can send, write, or delete anything external. `explainClaudeError` turns the
CLI's raw failures into the messages the README's troubleshooting section keys
on (expired login, CLI missing).

### What leaves the machine, precisely

- **Nothing**, for a run that stays on the local model — the database, the
  prompts and the results never leave the box.
- **To Anthropic (via your Claude login):** the pasted text when Intake's
  "research on the web" box is ticked; your request plus the retrieved
  transcript/thread for Log's Zoom/Meet/Gmail sources; the counterparty's name,
  company, role, last-touch date and next action for Prep's Calendar/Gmail
  step, and their public name/role/company for its web step (never the dossier
  or interaction log); and — only if Ollama is unavailable and the Claude
  fallback is enabled in Settings — the entire prompt of a write step, which
  includes the contact roster. Turn the fallback off in Settings if that isn't
  acceptable.
- **To wherever backups point:** a daily copy of the whole database goes to the
  backup folder (default `data/backups`; a synced cloud folder only if you set
  one).

### Settings

The **Settings** page (`/settings`) picks the model from whatever Ollama has
pulled, and sets the context window (default 32768 — raise it if a long
transcript or the coach snapshot hits the "ran out of room" error), temperature,
the Ollama URL (point it at another machine to run models there), the provider
(local vs. Claude for everything), whether to fall back to Claude, and the
backup folder, plus the coach's tone and notes folder. Values are stored in
the `settings` table (`lib/settings.ts`, keys `ai.model`, `ai.ollama_url`,
`ai.num_ctx`, `ai.temperature`, `ai.provider`, `ai.fallback`, `backup.dir`,
`coach.tone`, `coach.use_profile`, `coach.context_dir`) and apply to the next
run; the defaults come from the environment. The three coach tones are defined
in `lib/coachTone.ts` as behavioural rules plus a section plan for the advice
and a reply style; every coach prompt in `lib/coachai.ts` is assembled from
them, so adding a level is a matter of adding a spec there. The model must be pulled
(`ollama pull gemma4:26b`) and Ollama running (`ollama serve`, or the menu-bar
app).

Intake refuses to create a second profile for a name that already exists
unless you explicitly opt in on the review screen; if a duplicate slips through
anyway, `npm run merge-people -- <dup-slug> <keep-slug> [--dry-run]` folds it
into the profile you want to keep.

## Make it yours: owner and vocabulary config

Copy `config/owner.example.json` to `config/owner.json` (gitignored) and fill
in your name, practice, a one-line description, the research triggers that
matter in your field, and optionally a coach persona (identity only — tone is
a Setting) and a folder of your own notes for the coach to read
(`coachContextDir`, `coachContextGuidance`; Settings → Coach can override or
switch the folder off without editing the file). Every
AI prompt, the app name and the MCP server name come from this file via
`loadOwner()` in `lib/owner.mjs`; with no file the wording is generic. Restart
the app after changing it.

Statuses, action buckets, pipeline stages, opportunity kinds, relationship
strengths and default keep-warm cadences are configurable the same way: copy
`config/vocab.example.json` to `config/vocab.json` (gitignored) and keep only
the parts you want to change. `DEFAULT_VOCAB` in `lib/vocab.mjs` is merged with
it. An entry whose key matches a built-in one replaces just the fields you give
(so `"new": {"label": "Prospect"}` renames a status without touching its emoji
or colour), a new key adds an entry, and a `"remove": ["venture"]` list drops
built-in ones. Colours are palette names (`emerald`, `sky`, `rose`, …; the
example file lists them all) mapped to Tailwind classes inside `lib/vocab.mjs`.
The app (`lib/db.ts` re-exports `STATUS`/`BUCKETS`/`STAGES`/`KINDS`/
`STRENGTHS`/`DEFAULT_CADENCE`), the MCP server's tool descriptions
(`loadVocab(ROOT)`) and every AI prompt (`bucketList(VOCAB)` and friends) are
generated from the merged result, so nothing can drift. Restart the app and the
MCP server after changing the file.

Two cautions. The *keys* (`new`, `this_week`, `identified`, …) are what the
database stores, so renaming a key of a status, stage or bucket that rows
already use would orphan those rows — change the label instead. And removing a
key that rows still use does not delete anything, but those rows fall into the
closed/unknown group in the UI (statuses sort last, stages leave the board,
actions disappear from the bucket view) until you edit them. Keep the keys the
app falls back to (`new`, `this_week`, `identified`, `engagement`).

## One database, three ways in

**The SQLite database (`data/crm.db`, WAL mode) is the single source of
truth.** Schema and migrations live in `lib/schema.mjs`, shared by the app and
the MCP server. Everything reads and writes the one database:

- the **web app** (this repo, port 3000);
- **Claude Desktop**, via the `siryous-crm` MCP server
  (`scripts/mcp-server.mjs`, also `npm run mcp`) — 16 tools for conversational
  CRM work: search, full profiles, agenda ("what's overdue?"), pipeline, logging
  interactions, building/updating profiles with arbitrary markdown, action
  items, and deals. There are deliberately no delete tools. Register it in
  Claude Desktop's config with the absolute path to this folder:

  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

  ```json
  { "mcpServers": { "siryous-crm": { "command": "node", "args": ["/absolute/path/to/siryous-crm/scripts/mcp-server.mjs"] } } }
  ```

  The server creates the database and schema itself if the web app hasn't run
  yet, and honours `CRM_DB_PATH`;
- **Claude Code** sessions in this folder, directly.

Because there is only one copy of the data, there is no sync and no staleness:
a checkbox clicked in the app is instantly visible to Claude, and vice versa.
Never write to the database with ad-hoc scripts while the app or the MCP server
may be running.

## Backups & export

- **Automatic backups:** the web app (`instrumentation.ts` → `startBackupLoop`)
  and the MCP server each ensure a daily snapshot of the database exists in the
  backup folder (`lib/backup.mjs`; resolution order: the `backup.dir` setting,
  then `CRM_BACKUP_DIR`, then `data/backups` next to the database; `off`
  disables). Snapshots use SQLite's online-backup API, are named
  `crm-YYYY-MM-DD.db`, and the newest 30 are kept. A backup happens on any day
  the data can change — because only those two processes change it.
  `scripts/backup.sh` does the same manually (uses `sqlite3` if present,
  otherwise `better-sqlite3`).
- **Readable archive on demand:** `npm run export` regenerates a full markdown
  folder (profiles, index, pipeline) into `exports/` — gitignored, write-only,
  snapshot-in-time; the folder is wiped and rewritten each run.
- **Duplicates:** `npm run merge-people -- <dup-slug> <keep-slug> [--dry-run]`
  folds one person profile into another: everything attached to the duplicate
  (interactions, action items, outreach, opportunities, briefs, connections)
  is re-pointed at the kept profile; scalar fields on the kept profile win
  unless empty; tags are unioned; status, status note, next action and last
  touch come from whichever was touched more recently; narrative sections from
  the duplicate are appended under a "merged from" marker; then the duplicate
  row is deleted. One transaction; `--dry-run` prints the plan and rolls back.

## Getting data in

- **CSV import (bulk).** The **Import** page (`/import`) takes a CSV, shows a
  preview (how each column was matched, the first ten rows as they would be
  saved, and the counts) and then imports on a second click. A LinkedIn
  **Connections.csv** export works as-is: First/Last Name become the name, URL
  the LinkedIn link, Position the role, Company is linked or created, and
  "Connected On" becomes the last-touch date. Any spreadsheet with a header row
  works too — columns are matched case- and punctuation-insensitively with
  synonyms: name (or first name + last name), email, linkedin/url,
  role/title/position, company, location, phone, tags (comma-separated), notes,
  status (a `STATUS` key or label; default `new`), cadence (days; default by
  status), last touch / connected on (ISO, `12 Jul 2026`, `Jul 12, 2026`,
  `7/12/2026`; anything else is kept as a last-touch note). Unrecognised
  columns are ignored. The same import runs from the terminal:

  ```bash
  npm run import-csv -- path/to/file.csv [--update] [--dry-run]
  ```

  Semantics: the whole import is one transaction. Companies are matched by slug
  and created (as 🌱 New, no profile text) when missing. **People whose slug
  already exists are skipped and listed — never overwritten.** With `--update`
  (or the "update existing" box) an existing person's *blank* email / LinkedIn
  / role / company / location / phone are filled from the file; filled fields
  and the narrative sections are never touched. Rows without a name, or with an
  unknown status or a non-numeric cadence, are reported and skipped while the
  rest go in. `--dry-run` runs everything and rolls it back. The web page is
  best for files under about 1 MB (a server-action body limit); use the CLI for
  anything bigger. The importer only inserts/updates rows — it never wipes
  tables.
- **One at a time.** The **Intake** page: paste a LinkedIn profile, an email
  thread, or your notes about someone, review what the model extracted, and
  confirm — this is the route that also writes the profile narrative. The
  **People** and **Companies** pages have plain forms too, and Claude Desktop
  can create and update profiles through the MCP server.

All scripts in `scripts/` import `scripts/repo-root.ts` first, which `chdir`s
to the repo root, so they can be run from any directory; `CRM_DB_PATH` still
overrides the database location, and the export and merge scripts refuse to run
when the database file doesn't exist rather than creating an empty one.

## Stack

Next.js 16 (App Router) · React 19 Server Components + server actions ·
better-sqlite3 · Tailwind CSS v4 · zod for model-output schemas · `docx` for
the Word export · Ollama (local open-weight model) for AI reasoning/writing ·
headless Claude Code CLI for external-data steps (read-only claude.ai
connector grants) and fallback · `@modelcontextprotocol/sdk` for the MCP
server. No client-side state libraries; forms are plain HTML `<details>`
disclosures posting to server actions.

## Tests and CI

```bash
npm test          # node --test via tsx; no extra framework
npm run typecheck # tsc --noEmit
node --check scripts/mcp-server.mjs
```

The suite lives in `tests/` and uses Node's built-in test runner. It covers
date parsing (`lib/dates.mjs`), slugs, the model-output schemas, the Ollama URL
guard and settings storage, the schema bootstrap and its date-normalisation
migration, the effective-bucket / keep-warm queries, markdown sanitisation, and
the access-token proxy. Every suite that touches disk points `CRM_DB_PATH` at a
temp directory first (`tests/helpers/tempdb.ts`), so `data/crm.db` and
`data/auth-token` are never opened; each test file runs in its own process and
cleans up after itself. The GitHub Actions workflow in
`.github/workflows/ci.yml` runs the type-check, `node --check
scripts/mcp-server.mjs`, the tests, and a production build with `CRM_AUTH=off`
and a throwaway `CRM_DB_PATH` on every push and pull request.

Before committing, run the three commands above (CLAUDE.md says the same).
