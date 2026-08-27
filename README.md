# Siryous CRM

A local-first personal CRM for a solo advisor or consultant: relationship
intelligence, a keep-warm cadence, a pipeline, and AI features that run on a
local open-weight model. Built by [Darryl Siry](https://github.com/darrylsiry)
for his own advisory practice and open-sourced as-is.

Runs on your own machine — no accounts, no hosted service. Data lives in a SQLite
file at `data/crm.db`. See **What leaves your machine** below for the honest
version of "local".

## Requirements

- Node 20–26 (`.nvmrc` says 22). `better-sqlite3` ships prebuilt binaries for
  common platforms; otherwise it needs a C++ toolchain (Xcode Command Line
  Tools on macOS, `build-essential` + Python on Linux, VS Build Tools on Windows).
- [Ollama](https://ollama.com) with a pulled model for the AI features
  (`ollama pull gemma4:26b` — about 16 GB of RAM; pick something smaller on the
  Settings page if you have less).
- Optional: the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)
  logged in to a Claude subscription, with the claude.ai Gmail / Calendar /
  Zoom / Drive connectors enabled, for the steps that fetch external data.
  Without it everything still works from pasted text and CRM data.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:3000
```

Or, on a Mac, double-click `Start CRM.command` (builds the production bundle
and starts it in the background, and opens it signed in; `Stop CRM.command`
stops it). The server binds to **127.0.0.1 only**.

### Access

There are no user accounts. On first start the app generates a random token
in `data/auth-token` (never leaves the machine) and every browser must present
it once — after that a cookie keeps you signed in for a year. `Start
CRM.command` opens the app with the token already applied; `npm run dev`
prints a sign-in link in the terminal; the Settings page shows the link for
signing in another browser. This is what stops other software on the same
machine (or a web page using DNS rebinding) from reading or changing the CRM.
Set `CRM_AUTH=off` in `.env.local` to run without it. Delete the token file
and restart to rotate it.

## What's inside

- **Dashboard** — overdue items (your move), pipeline summary with high-priority
  deals, "due for a touch" list, dated follow-ups, awaiting-other-party,
  log-gap reminders, active relationship cards, recent activity.
- **✨ Intake (AI)** — paste anything (a LinkedIn profile, an email thread, raw
  notes) and Claude extracts the person and company, researches them on the web,
  writes the profile sections in house style, finds connections to the existing
  network, and suggests tags/status/cadence and follow-ups — all on a review
  screen you edit and confirm before anything is saved.
- **✎ Log (AI)** — turn a meeting or email into interaction-log entries on the
  right contacts. Paste content, or have Claude fetch it itself from **Zoom**
  (recording transcripts), **Gmail** (threads), or **Google Drive** (Google
  Meet transcripts) via read-only connectors. It drafts entries, proposes
  next-action updates, closes stale open items (e.g. "outcome never logged"),
  and suggests follow-ups — review before save.
- **🗓 Prep (AI)** — a 3-minute meeting brief for any contact (or auto-detected
  from the next 7 days of your calendar): where things stand, what's changed
  since last touch (checked against Gmail, Calendar, and the web, with source
  attribution), objectives, talking points, questions, watch-outs. Briefs can be
  downloaded as a Word doc, and a "Log this meeting" section closes the loop
  afterwards.
- **◎ Coach (AI)** — a weekly coaching session over the whole CRM: the model
  reads the pipeline, overdue items, and recent activity, gives advice, and you
  chat it through. Commitments you make and items you report as done show up
  as proposed CRM changes under each reply — tick the ones to record, the rest
  are rejected and never re-proposed. Ad-hoc check-ins between weekly sessions too.
- **Pipeline** — kanban board of opportunities (engagements, partnerships,
  ventures, referrals) across consultant-shaped stages: Identified → In
  conversation → Scoping/proposal → Negotiating → Engaged. Move stages inline;
  ★ marks high priority.
- **Keep Warm** — every contact scored against a per-person follow-up cadence
  (defaults were set by status: Active 30d, Exploring 45d, New 21d, Dormant 180d).
  Logging an interaction resets the clock.
- **Map** — live force-directed relationship graph: people (colored by status),
  companies, made intros (violet), owed intros (dashed). Hover isolates a
  node's network; click opens the profile.
- **Search** — one box (sidebar or /search) across people, companies, notes,
  interactions, action items, and pipeline.
- **Actions** — the full outstanding-items list in urgency buckets (overdue,
  this week, awaiting the other party, high potential, keep warm, venture, data
  gaps). Items carry a real due date (typed, or parsed from a label like
  "Fri 7/25"); anything past its date is shown as overdue whatever bucket it was
  filed in. Check items off; reopen from "Recently completed."
- **People / Companies** — rich profiles with narrative sections
  (Relationship Intelligence, Business Context, Engagement Strategy, Notes), with
  status pipeline (🌱 New → 🔍 Exploring → 🔥 Active → 🤝 Client …), relationship
  strength, snapshot fields, and per-profile interaction logs. Every section is
  editable in place (markdown supported); cross-links between profiles work.
  People, companies, individual interactions and action items can be deleted
  from the profile pages (a "Danger zone" at the bottom, or the × on a log
  entry / open item) — deletion is permanent, with only the daily backups to
  fall back on; the MCP server deliberately has no delete tools.
- **Outreach** — imported drafts/sent messages linked to their contacts.

Logging an interaction automatically bumps the contact's "last touch" date
(always an ISO date; any free-text qualifier lives in a separate note).

## How the AI features work

### What leaves your machine

- **Nothing**, for a run that stays on the local model — the database, the
  prompts and the results never leave the box.
- **To Anthropic (via your Claude login):** the pasted text when Intake's
  "research on the web" box is ticked; your request plus the retrieved
  transcript/thread for Log's Zoom/Meet/Gmail sources; the counterparty's
  name, company, role, last-touch date and next action for Prep's Calendar/Gmail
  step, and their public name/role/company for its web step (never the dossier
  or interaction log); and — only if Ollama is unavailable and the
  Claude fallback is enabled in Settings — the entire prompt of a write step,
  which includes your contact roster. Turn the fallback off in Settings if
  that isn't acceptable.
- **To wherever you point backups:** a daily copy of the whole database goes
  to the backup folder (default `data/backups`; a synced cloud folder only if
  you set one).

The AI features run on a **local open-weight model** by default — Ollama on
this Mac, `gemma4:26b` unless configured otherwise — with the **locally
installed Claude Code CLI** used only where a step needs data the local model
can't reach (Gmail, Calendar, Zoom, Drive, the web) and as an automatic
fallback when Ollama isn't running. Nothing needs an API key; the Claude steps
use the same subscription as Claude Desktop.

Every feature is split into a *fetch* step (Claude, read-only connector
tools) and a *write* step (local model, no tools). `lib/llm.ts` is the Ollama
client, `runModel` in `lib/ai.ts` does the local-first / Claude-fallback
routing, and `runWithProgress` in `lib/progress.ts` routes each step by whether
it carries a tool grant:

| Feature | Fetch step (Claude, read-only tools) | Write step (local model) |
|---------|--------------------------------------|--------------------------|
| Intake  | optional web-research digest (checkbox on the form; skipped gracefully if Claude fails) | extract the profile, connections, actions, log entry |
| Log     | paste: none · Zoom / Gmail / Meet-via-Drive: retrieve the transcript or thread | write the interaction-log entries |
| Prep    | two separate runs: (1) Calendar + Gmail, no web — what's changed since last touch (and which meeting is next, in auto mode); (2) web only, given just the person's public name/role/company — recent public news. Kept apart so a session that reads your email never holds a tool that can send data out | write the brief |
| Coach   | none | advice, chat replies, closing summary |

If a fetch step fails (expired Claude login, connector hiccup), Intake and Prep
continue from local data and say so in the result; Log needs the content, so
it asks you to paste it instead. JSON repair also runs locally first.

The **Settings** page (`/settings`) picks the model from whatever Ollama has
pulled, and sets the context window (default 32768 — raise it if a long
transcript or the coach snapshot hits the "ran out of room" error),
temperature, the Ollama URL (point it at another machine to run models there),
the provider (local vs. Claude for everything), and whether to fall back to
Claude. Settings are stored in the database and apply to the next run; the
defaults come from `.env.local` (see `.env.example`). The model must be pulled
(`ollama pull gemma4:26b`) and Ollama running (`ollama serve`, or the menu-bar
app).

Claude steps run with an explicit, **read-only** tool grant (see `TOOLS` in
`lib/ai.ts`) and are blocked from spawning subagents and from any local
shell/file tools. Zoom/Gmail/Calendar/Drive access comes from the claude.ai
connectors already authorized for the CLI (`claude mcp list`). Nothing the AI
produces touches the database until it has passed a human review step (the
Intake and Log review screens, the Coach's tick-to-record proposals), and no
granted tool can send, write, or delete anything external.

Intake refuses to create a second profile for a name that already exists
unless you explicitly opt in on the review screen; if a duplicate slips
through anyway, `npm run merge-people -- <dup-slug> <keep-slug> [--dry-run]`
folds it into the profile you want to keep.

## Make it yours

Copy `config/owner.example.json` to `config/owner.json` (gitignored) and fill
in your name, practice, a one-line description, the research triggers that
matter in your field, and optionally a coach persona and a folder of your own
notes for the coach to read. Every AI prompt, the app name, and the MCP server
name come from this file; with no file the wording is generic. Restart the app
after changing it.

Statuses, action buckets, pipeline stages, opportunity kinds, relationship
strengths and default keep-warm cadences are configurable the same way: copy
`config/vocab.example.json` to `config/vocab.json` (gitignored) and keep only
the parts you want to change. An entry whose key matches a built-in one
replaces just the fields you give (so `"new": {"label": "Prospect"}` renames a
status without touching its emoji or colour), a new key adds an entry, and a
`"remove": ["venture"]` list drops built-in ones. Colours are palette names
(`emerald`, `sky`, `rose`, …; the example file lists them all). The app, the
MCP server's tool descriptions and every AI prompt are generated from the
merged result, so nothing can drift. Restart the app and the MCP server after
changing the file.

Two cautions. The *keys* (`new`, `this_week`, `identified`, …) are what the
database stores, so renaming a key of a status, stage or bucket that rows
already use would orphan those rows — change the label instead. And removing a
key that rows still use does not delete anything, but those rows fall into the
closed/unknown group in the UI (statuses sort last, stages leave the board,
actions disappear from the bucket view) until you edit them. Keep the keys
the app falls back to (`new`, `this_week`, `identified`, `engagement`).

## One database, three ways in

**The SQLite database (`data/crm.db`) is the single source of truth.**
Everything reads and writes the one database:

- the **web app** (this repo, port 3000),
- **Claude Desktop**, via the `siryous-crm` MCP server (`scripts/mcp-server.mjs`)
  — 16 tools for conversational CRM work: search, full profiles, agenda
  ("what's overdue?"), pipeline, logging interactions, building/updating
  profiles with arbitrary markdown, action items, and deals. Register it in
  Claude Desktop's config (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`;
  Windows: `%APPDATA%\Claude\claude_desktop_config.json`) with the absolute
  path to this folder:

  ```json
  { "mcpServers": { "siryous-crm": { "command": "node", "args": ["/absolute/path/to/siryous-crm/scripts/mcp-server.mjs"] } } }
  ```

  The server creates the database and schema itself if the web app hasn't run yet,
- **Claude Code** sessions in this folder, directly.

Because there is only one copy of the data, there is no sync and no staleness:
a checkbox clicked in the app is instantly visible to Claude, and vice versa.

## Backups & export

- **Automatic backups:** the web app and the MCP server each ensure a daily
  snapshot of the database exists in the backup folder (default
  `data/backups/`; change it on the Settings page or with `CRM_BACKUP_DIR`;
  `off` disables). Via SQLite's online-backup API; newest 30 kept. A backup
  happens on any day the data can change — because only those two processes
  change it. `scripts/backup.sh` does the same manually.
- **Readable archive on demand:** `npm run export` regenerates a full markdown
  folder (profiles, index, pipeline) into `exports/` — gitignored, write-only,
  snapshot-in-time.
- **Duplicates:** `npm run merge-people -- <dup-slug> <keep-slug> [--dry-run]`
  folds one person profile into another.

## Getting data in

- **CSV import (bulk).** The **Import** page (`/import`) takes a CSV, shows a
  preview (how each column was matched, the first ten rows as they would be
  saved, and the counts) and then imports on a second click. A LinkedIn
  **Connections.csv** export works as-is (Settings → Data privacy → Get a copy
  of your data → Connections): First/Last Name become the name, URL the
  LinkedIn link, Position the role, Company is linked or created, and
  "Connected On" becomes the last-touch date. Any spreadsheet with a header row
  works too — columns are matched case- and punctuation-insensitively with
  synonyms: name (or first name + last name), email, linkedin/url, role/title/
  position, company, location, phone, tags (comma-separated), notes, status (a
  `STATUS` key or label; default `new`), cadence (days; default by status),
  last touch / connected on (ISO, `12 Jul 2026`, `Jul 12, 2026`, `7/12/2026`;
  anything else is kept as a last-touch note). Unrecognised columns are
  ignored. The same import runs from the terminal:

  ```bash
  npm run import-csv -- path/to/file.csv [--update] [--dry-run]
  ```

  Semantics: the whole import is one transaction. Companies are matched by
  slug and created (as 🌱 New, no profile text) when missing. **People whose
  slug already exists are skipped and listed — never overwritten.** With
  `--update` (or the "update existing" box) an existing person's *blank*
  email / LinkedIn / role / company / location / phone are filled from the
  file; filled fields and the narrative sections are never touched. Rows
  without a name, or with an unknown status or a non-numeric cadence, are
  reported and skipped while the rest go in. `--dry-run` runs everything and
  rolls it back. The web page is best for files under about 1 MB (a
  server-action body limit); use the CLI for anything bigger.
- **One at a time.** The **Intake** page: paste a LinkedIn profile, an email
  thread, or your notes about someone, review what the model extracted, and
  confirm — this is the route that also writes the profile narrative. The
  **People** and **Companies** pages have plain forms too, and Claude Desktop
  can create and update profiles through the MCP server ("add Sam Lee at Acme
  as a new contact — here's what I know…").

All scripts in `scripts/` change to the repo root before touching anything,
so they can be run from any directory; `CRM_DB_PATH` still overrides the
database location, and the export and merge scripts refuse to run when the
database file doesn't exist rather than creating an empty one.

## Stack

Next.js (App Router) · React Server Components + server actions · better-sqlite3 ·
Tailwind CSS v4 · Ollama (local open-weight model) for AI reasoning/writing ·
headless Claude Code CLI for external-data steps (read-only claude.ai connector
grants) and fallback. No client-side state libraries; forms are plain
HTML `<details>` disclosures posting to server actions.

## Tests

```bash
npm test          # node --test via tsx; no extra framework
npm run typecheck # tsc --noEmit
```

The suite lives in `tests/` and uses Node's built-in test runner. It covers
date parsing (`lib/dates.mjs`), slugs, the model-output schemas, the Ollama
URL guard and settings storage, the schema bootstrap and its date-normalisation
migration, the effective-bucket / keep-warm queries, markdown sanitisation, and
the access-token proxy. Every suite that touches disk points `CRM_DB_PATH` at a
temp directory first (`tests/helpers/tempdb.ts`), so `data/crm.db` and
`data/auth-token` are never opened; each test file runs in its own process and
cleans up after itself. The GitHub Actions workflow in `.github/workflows/ci.yml`
runs the type-check, `node --check scripts/mcp-server.mjs`, the tests, and a
production build with `CRM_AUTH=off` on every push and pull request.

## Documentation

- `docs/siryous-crm-architecture.docx` — system architecture: components, data
  flows, and the interaction paths (browser, Claude Desktop, built-in AI).
- `docs/siryous-crm-mcp-server-spec.docx` — tool-level specification of the
  `siryous-crm` MCP server.

## License

MIT — see `LICENSE`.
