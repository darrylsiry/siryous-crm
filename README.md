# Siryous CRM

A private address book with a memory. Siryous CRM keeps track of the people
and companies in your professional life — who they are, what you last talked
about, what you promised, who is due a call — and nudges you before a
relationship goes cold. It runs entirely on your own computer: there is no
account to create, no monthly fee, and nothing is uploaded anywhere unless you
switch on the optional AI helpers described below. It was built by
[Darryl Siry](https://github.com/darrylsiry) for his own advisory practice and
is shared as-is for other solo advisors, consultants and independent
professionals. Free and open source (MIT licence).

## What you need

- A **Mac with Apple silicon** (M1 or later) and **16 GB of memory**. 32 GB is
  recommended if you want the default AI model; 16 GB works with a smaller one.
- About **20 GB of free disk space** (most of it for the optional AI model).
- **Half an hour** for the setup below. No technical knowledge needed — every
  step is spelled out.
- It also runs on Windows and Linux (there is a `Start CRM.bat` for Windows) —
  see [docs/DEVELOPING.md](docs/DEVELOPING.md).

Three things to know before you start:

1. **The CRM works without any AI.** People, companies, notes, follow-ups, the
   pipeline, search, import — all of it works with nothing but Node installed.
2. **The AI features need Ollama**, a free program that runs an AI model on
   your Mac. With it you get Intake (paste anything, get a profile), Log (turn a
   meeting into notes), Prep (a briefing before a meeting) and Coach (a weekly
   review). Everything stays on your computer.
3. **The email, calendar and web features additionally need Claude** — the
   Claude app or command-line tool from Anthropic, signed in to a paid Claude
   subscription. That is what lets Prep read your calendar and Gmail, Log fetch a
   Zoom transcript, and Intake look someone up on the web. Optional, and the
   only part that sends anything off your computer.

## Set up in 5 steps (Mac)

### 1. Install Node

Node is the engine the CRM runs on.

1. Go to <https://nodejs.org>.
2. Click the big green **LTS** download button.
3. Open the downloaded `.pkg` file and click **Continue** until it says
   **Done**. It will ask for your Mac password.

### 2. Install Ollama (for the AI features — skip if you don't want them yet)

1. Go to <https://ollama.com> and click **Download** → **Download for macOS**.
2. Unzip it and drag **Ollama** into your **Applications** folder.
3. Open it once. A small llama icon appears in the menu bar at the top of the
   screen — that means it is running. It starts itself when you log in from now
   on.

### 3. Download the CRM

1. On this page on GitHub, click the green **Code** button, then
   **Download ZIP**.
2. Double-click the ZIP in your Downloads folder to unzip it. You get a folder
   called something like `siryous-crm-main`.
3. Move that folder somewhere it can live permanently — your **Documents**
   folder is a good choice. (Your data will be stored inside this folder, so
   don't leave it in Downloads.) You can rename it to `Siryous CRM` if you like.

If you know `git`, `git clone` works just as well.

### 4. Double-click **Start CRM.command**

Open the folder and double-click the file called **Start CRM.command**. A
Terminal window opens and tells you what it is doing:

- The first time, it installs the app's components and prepares the app. This
  takes a few minutes and needs an internet connection. Later starts take a few
  seconds.
- When it is ready it opens the CRM in your web browser, already signed in, at
  `http://127.0.0.1:3000`. You can close the Terminal window; the CRM keeps
  running until you double-click **Stop CRM.command** or restart the Mac.

**If macOS says the file "can't be opened because it is from an unidentified
developer"** (or "Apple could not verify…"): right-click (or Control-click)
**Start CRM.command**, choose **Open**, and click **Open** again in the dialog.
macOS asks this once for any program that didn't come from the App Store; after
that a normal double-click works.

**If Terminal says the file "could not be executed because you do not have
appropriate access privileges"**: unzipping sometimes loses the permission that
makes the file double-clickable. Open Terminal (press Command-Space, type
`Terminal`, press Return), type `chmod +x ` (with a space after it), drag
**Start CRM.command** from the Finder into the Terminal window, press Return,
then double-click the file again.

### 5. Download an AI model (if you installed Ollama)

Open **Settings** in the CRM's left-hand menu. The **Ollama status** box tells
you whether Ollama is running and whether the AI model has been downloaded.
Today the download is one command in Terminal (a later version will offer it
inside the app):

1. Open Terminal: press **Command-Space**, type `Terminal`, press **Return**.
2. Type one of these and press Return:
   - **32 GB Mac or more:** `ollama pull gemma4:26b` — the default model, the
     best quality. About a 16 GB download; it runs at a comfortable pace on 32
     GB and is slow and cramped on 16 GB.
   - **16 GB Mac:** `ollama pull gemma4:12b` (about 8 GB) or `ollama pull qwen3:8b`
     (about 5 GB). Smaller and faster, slightly less polished writing.
3. Wait for it to finish (a few minutes to an hour depending on your
   connection), then go back to Settings, choose the model you downloaded in the
   **Model** list, and click **Save settings**.

That's it. Try **Intake**: paste the text of someone's LinkedIn profile or an
email from them and watch a profile appear for you to check and save.

## Using it

The left-hand menu has everything. In rough order of how often you'll use it:

- **Dashboard** — the home page: who is due a touch, what is overdue, deals
  that need attention, follow-ups with dates, things you are waiting on from
  other people, and recent activity.
- **People** and **Companies** — the profiles. Each one has contact details, a
  status (New → Exploring → Active → Client …), how strong the relationship is,
  a narrative in four sections (Relationship, Business context, Strategy,
  Notes) and a log of every interaction. Click any text to edit it in place.
  Profiles link to each other, and you can delete a person, company, log entry
  or open item from the profile page (permanent — only the daily backups can
  bring it back).
- **Keep Warm** — every contact scored against how often you want to be in
  touch with them (by default: Active every 30 days, Exploring 45, New 21,
  Dormant 180 — adjustable per person). Logging an interaction resets the
  clock.
- **Pipeline** — a board of the work you are chasing (engagements,
  partnerships, referrals, ventures) across the stages a consultant actually
  goes through: Identified → In conversation → Scoping/proposal → Negotiating →
  Engaged. Change a deal's stage right on its card; ★ marks the important
  ones.
- **Actions** — everything you have promised or are waiting for, grouped by
  urgency (overdue, this week, awaiting the other party, high potential, keep
  warm, data gaps). Items carry a real due date — type one or write "Fri 7/25"
  and it is understood. Tick things off; "Recently completed" lets you reopen.
- **✨ Intake (AI)** — paste anything about a person (a LinkedIn profile, an
  email thread, your own rough notes) and the AI extracts the person and their
  company, writes up the profile in a consistent style, spots links to people
  you already know, and suggests tags, a status and follow-ups. Nothing is
  saved until you have looked it over and clicked confirm. With Claude, it can
  also look the person up on the web first.
- **✎ Log (AI)** — turn a meeting or an email into log entries on the right
  contacts. Paste the notes or transcript, or (with Claude) have it fetch the
  Zoom recording transcript, the Gmail thread or the Google Meet transcript
  itself. It drafts the entries, proposes what your next step is, closes
  things that are now done, and suggests follow-ups — again, you review before
  anything is saved. A profile's own "Log interaction" form is the no-AI
  route (what you type is what is saved); its "Draft the entry with AI" link
  opens Log with that contact preset.
- **🗓 Prep (AI)** — a three-minute briefing before you meet someone: where
  things stand, what has changed since you last spoke (with Claude: checked
  against your calendar, your email and the web, with sources), what you want
  out of the meeting, talking points, questions and watch-outs. With Claude it
  can also look at your next seven days of meetings and pick who to prep for.
  Briefs can be downloaded as a Word document, and a "Log this meeting" button
  closes the loop afterwards.
- **◎ Coach (AI)** — a weekly review of your whole practice. The AI reads the
  pipeline, the overdue items and the recent activity, tells you what it sees,
  and you talk it through. Anything you commit to in the conversation shows up
  as a proposed change to the CRM underneath the reply — tick the ones you want
  recorded. Quick check-ins between weekly sessions work too.
- **Import** — bring in a spreadsheet of contacts, including your LinkedIn
  connections (see the next section).
- **Map** — a live picture of your network: people coloured by status,
  companies, and who introduced whom. Hover over someone to see just their
  circle; click to open the profile.
- **Search** — one box (in the sidebar, or the Search page) that looks across
  people, companies, notes, interactions, action items and the pipeline.
- **Outreach** — messages you have drafted or sent, attached to their contacts.

Logging an interaction automatically updates the contact's "last touch" date.

## Import your LinkedIn connections

The fastest way to fill the CRM is your LinkedIn connections list.

1. On LinkedIn, click **Me** (your photo, top right) → **Settings & Privacy**
   → **Data privacy** → **Get a copy of your data**.
2. Choose **"Want something in particular?"**, tick **Connections**, and click
   **Request archive**. LinkedIn emails you a download link within about ten
   minutes.
3. Download and unzip it; inside is a file called **Connections.csv**.
4. In the CRM, open **Import**, choose that file, and look at the preview: it
   shows how each column was understood and the first ten people as they will
   be saved. Click **Import** to bring them in.

Names, LinkedIn links, current role and company come across, and the
"Connected On" date becomes the last-touch date. Anyone already in the CRM is
left alone (never overwritten); tick **update existing** if you want blank
fields on existing people filled in from the file. Any spreadsheet with a
header row works the same way — name, email, company, role, phone, location,
tags, notes and a few other columns are recognised automatically.

## If you use Claude (optional)

Claude is Anthropic's AI assistant. If you have a paid Claude subscription
(Pro or Max), the CRM can use it for the parts a local model can't do: read
your Google Calendar and Gmail to prepare a briefing, fetch a Zoom or Google
Meet transcript to log a meeting, and look people up on the web during Intake.
It also serves as a stand-in when Ollama isn't running. No API key or separate
billing — it uses the same subscription as the Claude app.

### Set it up once

1. **Install the Claude Code command-line tool.** Open Terminal (Command-Space,
   type `Terminal`, Return), paste this one line, and press Return:

   ```
   curl -fsSL https://claude.ai/install.sh | bash
   ```

   (This is Anthropic's official installer; it puts a program called `claude`
   in your home folder.) Close Terminal and open it again afterwards.
2. **Sign in.** In Terminal type `claude` and press Return, then type `/login`
   and press Return. Your browser opens; sign in with your Claude account, then
   come back and type `/exit`. You only do this once — it stays signed in for
   weeks.
3. **Turn on the connectors.** Go to <https://claude.ai>, open **Settings** →
   **Connectors**, and connect **Gmail**, **Google Calendar**, **Google Drive**
   and **Zoom** (whichever you use). These are Anthropic's read-only
   integrations; the CRM never sees your passwords.

The **Intake** page tells you if the Claude tool can't be found. If a Claude
step fails mid-run, the CRM carries on with what it has locally and says so in
the result.

### What leaves your computer

This matters, so here it is plainly:

- **Nothing**, for anything that runs on the local model — Intake from pasted
  text, Log from pasted notes, Prep from your own records, Coach. Your
  database, the prompts and the results never leave the Mac.
- **To Anthropic (through your own Claude login), only when you use a Claude
  step:**
  - Intake with the **"research on the web"** box ticked: the text you pasted.
  - Log with the **Zoom / Gmail / Google Meet** source: your request, and the
    transcript or email thread Claude fetched on your behalf.
  - Prep's calendar/email check: the other person's name, company, role, the
    date you last spoke and your noted next step — never your profile notes or
    interaction log. Prep's web check: only their public name, role and
    company. These are two separate, walled-off requests so that a session
    that reads your email never also has a way to send anything out.
  - **If Ollama isn't running** and the "Fall back to Claude automatically"
    box in Settings is ticked (it is by default): the whole request for that
    step, which includes your list of contacts. Untick that box if that isn't
    acceptable to you — runs will then wait for Ollama instead.
- **To wherever you point backups:** a daily copy of the whole database goes
  into the backup folder (see below). That is only a cloud folder if you chose
  one.

Claude runs with a fixed, read-only set of tools: it can search and read, and
it cannot send email, change your calendar, run anything on your Mac, or read
your files. Nothing any AI produces is saved into the CRM until you have
reviewed it.

## Where your data lives, and backups

- **Everything is in one file:** `data/crm.db` inside the CRM folder. That is
  your entire CRM.
- **Daily backups** are made automatically while the CRM is running, into
  `data/backups` inside the CRM folder. The newest 30 are kept. The Settings
  page shows when the last one was made.
- **To keep a copy off the Mac**, open **Settings** → **Backups** and type the
  path of a folder that syncs to the cloud — for example a folder inside your
  iCloud Drive, Dropbox or Google Drive folder. From then on the daily copy
  goes there. Note that it is a plain, unencrypted copy of everything in the
  CRM.
- **Moving to a new Mac:** copy the whole CRM folder across, install Node (and
  Ollama) on the new machine, and double-click **Start CRM.command**. Your
  data, settings and sign-in come with the folder.
- **Restoring a backup:** stop the CRM, replace `data/crm.db` with the backup
  file you want (rename it to `crm.db`), and start it again.

## Signing in

The CRM is locked to the Mac it runs on. When it first starts it creates a
private link (a long random code) and only browsers that have opened that link
once can use it. This is what stops other programs on the Mac — or a web page
you happen to visit — from reading or changing your CRM. There is no password
to remember:

- **Start CRM.command** always opens the CRM already signed in.
- **To sign in a second browser** (or after clearing your browser's cookies),
  open **Settings** in a browser that is signed in and copy the **sign-in link**
  shown there into the other browser. Or paste the contents of the file
  `data/auth-token` into the box on the sign-in page.
- **"That token didn't match" / "That code didn't match":** the code was
  copied incompletely. It is a single line with no spaces — open
  `data/auth-token` with TextEdit, select all, copy, and paste it again. Or just
  double-click **Start CRM.command**, which signs the browser in for you.
- Always use the address the CRM gives you, `http://127.0.0.1:3000`. The
  sign-in is tied to that exact address, so `localhost:3000` looks like a
  different site to your browser and asks you to sign in again.

## Troubleshooting

Look for the message you are seeing:

- **"Ollama isn't running" / "Not reachable at http://127.0.0.1:11434"** —
  the Ollama app isn't open. Open **Ollama** from Applications; the llama icon
  should appear in the menu bar. Then try again. If you never installed it, see
  step 2 of the setup.
- **"…isn't downloaded yet" / "model … is not pulled (run: ollama pull …)"** — Ollama
  is running but the model chosen in Settings hasn't been downloaded. Follow
  step 5 of the setup, then pick the model in Settings and save.
- **"The local model ran out of room…" / "too much text"** — you gave the AI
  more text than the model can hold at once (a long transcript, or a very busy
  Coach week). Either paste less, or open Settings and raise the **Context
  window** number (32768 by default; doubling it is fine if you have the
  memory).
- **"…timed out"** — the model took too long, which usually means the Mac is
  short of memory for the model you chose. Close other heavy apps, or switch to
  a smaller model (step 5), and try again.
- **"Your Claude Code login has expired"** — Claude needs you to sign in
  again. Open Terminal, type `claude`, then `/login`, finish in the browser,
  type `/exit`, and try again in the CRM.
- **"The Claude Code CLI isn't installed"** — you tried a step that needs
  Claude (calendar, email, Zoom, Drive or web) but the Claude tool isn't set up.
  Either follow "If you use Claude" above, or untick the web-research box /
  paste the content instead — everything else works without it.
- **"Interrupted by a server restart — start it again"** — the CRM was stopped
  while the AI was working on something. Nothing is lost; open that item and
  use its "Try again" link (or start the run once more).
- **"Build failed — see above"** in the Start CRM window — the one-time
  preparation didn't finish. The most common causes are no internet connection
  during the first start, or a Node older than version 20 (the window says which
  version it found). Fix that and double-click **Start CRM.command** again. If
  it still fails, copy the text in the window and open an issue on GitHub.
- **Terminal says `command not found: npm` or `command not found: node`** —
  Node isn't installed, or was installed while Terminal was open. Do step 1 of
  the setup, then quit Terminal (Command-Q) and double-click **Start
  CRM.command** again.
- **The browser says it can't connect to 127.0.0.1:3000** — the CRM isn't
  running. Double-click **Start CRM.command**. If that window shows an error,
  the details are also in `data/server.log` inside the CRM folder.
- **You updated the CRM (downloaded a new ZIP) and it looks the same** — Start
  CRM notices changed files and rebuilds automatically; if you replaced the
  folder, make sure you copied your old `data` folder into the new one first.

## For developers

Everything technical — running it in development mode, environment variables,
how the access token works, the AI architecture and exactly what each step
sends where, configuration files for your own vocabulary and owner profile,
the Claude Desktop MCP server, backups, the export and merge scripts, the CSV
importer's command-line form, tests and CI — is in
[docs/DEVELOPING.md](docs/DEVELOPING.md). [CLAUDE.md](CLAUDE.md) has the
ground rules for AI coding sessions in this repository. Contributions welcome.

## License

MIT — see `LICENSE`.
