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

- A **Mac with Apple silicon** (M1 or later). For the AI features, **16 GB of
  memory** at least; 32 GB is recommended for the default AI model. Without AI
  any recent Mac will do.
- About **20 GB of free disk space** (most of it for the optional AI model).
- **Half an hour** for the setup below. No technical knowledge needed — every
  step is spelled out.
- It also runs on Windows and Linux (there is a `Start CRM.bat` for Windows,
  less tested than the Mac launchers) — see
  [docs/DEVELOPING.md](docs/DEVELOPING.md).

Three things to know before you start:

1. **The CRM works without any AI.** People, companies, notes, follow-ups, the
   pipeline, search, import — all of it works with nothing but Node installed.
2. **The AI features need Ollama**, a free program that runs an AI model on
   your Mac. With it you get Intake (paste anything, get a profile), Log (turn a
   meeting into notes), Prep (a briefing before a meeting) and Coach (a weekly
   review). Everything stays on your computer.
3. **The email, calendar and web features additionally need Claude** —
   Anthropic's Claude Code command-line tool (see "If you use Claude" below),
   signed in to a paid Claude subscription. That is what lets Prep read your calendar and Gmail, Log fetch a
   Zoom transcript, Intake look someone up on the web, and the News Feed find
   news about your contacts. Optional, and the only part that sends anything off
   your computer.

## Set up in 6 steps (Mac)

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
3. Move that folder somewhere it can live permanently — your **home folder**
   (the one with the house icon and your name) is a good choice. Your data is
   stored inside this folder, so don't leave it in Downloads, and avoid
   **Documents** or **Desktop** if those sync to iCloud: syncing a live
   database can damage it. You can rename the folder to `Siryous CRM` if you
   like.

If you know `git`, `git clone` works just as well.

### 4. Double-click **Start CRM.command**

Open the folder and double-click the file called **Start CRM.command**. A
Terminal window opens and tells you what it is doing:

- The first time, it installs the app's components and prepares the app. This
  takes a few minutes and needs an internet connection. Later starts take a few
  seconds.
- When it is ready it opens the CRM in your web browser, already signed in, at
  `http://127.0.0.1:3000`. You can close the Terminal window; the CRM keeps
  running until you double-click **Stop CRM.command** or restart the Mac. It
  doesn't start by itself after a restart — double-click **Start CRM.command**
  again (it is quick after the first time). **Restart CRM.command** stops and
  starts it in one go, which is what to use after changing a configuration
  file.

**If macOS says "Apple could not verify 'Start CRM.command'…"** (or that it
"can't be opened because it is from an unidentified developer"): click **Done**,
open **System Settings** → **Privacy & Security**, scroll down to the message
about **Start CRM.command**, click **Open Anyway** and confirm with your
password. (On macOS 14 Sonoma or earlier you can instead right-click the file,
choose **Open**, and click **Open** again.) macOS asks this once for any
program that didn't come from the App Store; do the same for **Stop CRM.command**
and **Restart CRM.command** the first time you use them.

**If Terminal says the file "could not be executed because you do not have
appropriate access privileges"**: unzipping sometimes loses the permission that
makes the file double-clickable. Open Terminal (press Command-Space, type
`Terminal`, press Return), type `chmod +x ` (with a space after it), drag
**Start CRM.command** from the Finder into the Terminal window, press Return,
then double-click the file again.

### 5. Download an AI model (if you installed Ollama)

Open **Settings** in the CRM's left-hand menu. The **AI on this Mac** box tells
you whether Ollama is running and whether the AI model has been downloaded, and
the notice on the AI pages says which model suits your Mac's memory, with a
**Copy** button for the command and a **Check again** button. The download is
one command in Terminal:

1. Open Terminal: press **Command-Space**, type `Terminal`, press **Return**.
2. Type one of these and press Return:
   - **32 GB Mac or more:** `ollama pull gemma4:26b` — the default model, the
     best quality. About a 16 GB download; it runs at a comfortable pace on 32
     GB and is slow and cramped on 16 GB.
   - **16 GB Mac:** `ollama pull gemma4:12b` (about 8 GB) or `ollama pull qwen3:8b`
     (about 5 GB). Smaller and faster, slightly less polished writing.
3. Wait for it to finish (a few minutes to an hour depending on your
   connection), then press **Check again**. If the model you downloaded isn't
   the one Settings names, the notice offers **Use …** to switch to it in one
   click (or choose it in Settings → **AI model** and click **Save settings**).

That's it. Try **Intake**: paste the text of someone's LinkedIn profile or an
email from them and watch a profile appear for you to check and save.

### 6. Tell the AI who you are (optional, recommended)

The AI writes for you — your name, your practice, what you sell. Open
**Settings → About you**, fill in your name, practice, what you do and your
email, and click **Save**. Without it the AI calls you "the owner". It is kept
in `config/owner.json` on your Mac and is never part of an update. (Other
fields there, such as the coach's persona, can be edited by hand: copy
`config/owner.example.json`, whose fields start blank with an example beside
each, and restart. A field left at an example's text is ignored, and Settings
says if the file can't be read.)

## Using it

The left-hand menu has everything, grouped into **New Business** (Intake,
Log, Inbox), **Pipeline** (Actions, Pipeline, Keep Warm, Outreach, Prep,
News Feed, Coach) and **Data** (People, Companies, Map, Import), with the Dashboard at
the top and Settings at the bottom. In rough order of how often you'll use it:

- **Dashboard** — the home page, built around what needs you right now. It
  opens with a greeting and a quote of the day, then:
  - The line under the greeting counts what is there (this week, long
    overdue, with no date, due a touch, emails to review, deals needing
    attention); each count jumps to its place.
  - **Your move** — to-dos that are late (up to two weeks) or due in the next
    seven days, each with the person, their company, the open deal it belongs
    to and when you last spoke. Tick one off right there (a note at the bottom
    offers **Undo** for a few seconds), or click its date (✎) to re-date it in
    one click (Tomorrow, Next Mon, +1 week), reword it or change its person.
    Anything more than two weeks late, and anything in the dated group with no
    date, folds into its own list to do, re-date or drop.
  - **Due a touch** — the people most overdue on Keep Warm, each with **Log
    touch**.
  - **Deals in motion** — open opportunities, with the ones that **need
    attention** first (quiet for a month, or no next step: set one right
    there, or log a touch); the rest grouped by stage, furthest along first,
    with the days since you last logged contact (amber after two weeks, red
    after a month). Job opportunities sit at the bottom of each stage on a
    tinted row.
  - Down the side: emails in the **Inbox** waiting for review, **In the news**
    (stories about your contacts, deal-related ones first, dismissable), what
    you are **waiting on** from other people (oldest first, with **Got it**
    when they reply; late ones say "chase"), and **recent activity**.
  - A new CRM starts with a **Getting started** list (add a person, tell the
    AI who you are, set up the AI, add a deal, set your CRM email address)
    that stays until each is done, or until you hide it.
- **People** and **Companies** — the profiles. Each one has contact details, a
  status (New → Exploring → Active → Client …), how strong the relationship is,
  a narrative in four sections (Relationship, Business context, Strategy,
  Notes) and a log of every interaction. Under the name is a bar for what you
  came to do: **Log touch**, **Prep**, **Add to-do**, **Add deal**, **Call**
  or **Email** when the snapshot has a number or address, and **✎ Edit**. What
  you have open with them is listed right below it. **✎ Edit** in that bar
  (or beside each name in the People and Companies lists, which you return to
  after saving) opens one form for the name (links keep working), company
  (pick one, or type a new one), status, contact details, strength, tags and
  keep-warm cadence; a company's has its name, status and snapshot.
  **✎ Edit** on each section edits that section. Click the status badge — on
  a profile or in the People/Companies lists — to change the status on the
  spot. If Claude (or another window) changed the same section while you were
  typing, nothing is lost: your text is saved below the newer version, marked
  ⚠, for you to merge. You can delete a person, company, log entry or to-do
  from the profile page (permanent — the Danger zone says where your backups
  are, or that they are off).
- **Keep Warm** — every contact scored against how often you want to be in
  touch with them (by default: Active every 30 days, Exploring 45, New 21,
  Dormant 180 — adjustable per person; changing someone's status moves a
  default cadence to the new status's, and leaves one you set by hand).
  **Log touch** on each row records a call, email or meeting in a few seconds
  without leaving the page, and logging any interaction resets the clock.
  People with no cadence are folded away below the list.
- **Pipeline** — a board of the work you are chasing (engagements,
  partnerships, referrals, ventures — and job opportunities) across the stages
  a consultant actually goes through: Identified → In conversation →
  Scoping/proposal → Negotiating → Engaged. Choosing a stage on a card saves it;
  each card shows the days since contact, and **✎ Edit** changes the rest or
  deletes a deal made by mistake. ★ marks the important ones. Job opportunities are listed after
  everything else in each column, on a tinted card, so a job search stays
  apart from business development at a glance.
- **Actions** — everything you have promised or are waiting for, grouped by
  urgency (overdue, this week, awaiting the other party, high potential, keep
  warm, missing details). Items carry a real due date — the one **Due** box
  takes a date or "Fri 7/25" and shows what it understood. Tick things off;
  **✎ Edit** changes an item's wording, date, person or group; "Recently
  completed" (the last 30 days, with **Show older**) lets you reopen.
- **✨ Intake (AI)** — paste anything about a person (a LinkedIn profile, an
  email thread, your own rough notes) and the AI extracts the person and their
  company, writes up the profile in a consistent style, spots links to people
  you already know, and suggests tags, a status and follow-ups. Nothing is
  saved until you have looked it over and clicked confirm. With Claude, it can
  also look the person up on the web first. If the person is already in the
  CRM it says so and offers **Log this on …** (the same text, as a Log draft)
  instead of a duplicate. A run that fails keeps what you pasted: **Try
  again** or **Discard** it from the draft's page; a run in progress has
  **Cancel**.
- **✎ Log (AI)** — turn a meeting or an email into log entries on the right
  contacts. Paste the notes or transcript, or (with Claude) have it fetch the
  Zoom recording transcript, the Gmail thread or the Google Meet transcript
  itself. It drafts the entries, proposes what your next step is, closes
  things that are now done, and suggests follow-ups — again, you review before
  anything is saved, next to the source text, and every suggestion (wording,
  date, person) can be changed first. Saving says what was saved ("Saved 2
  entries · closed 1 to-do · added 1 follow-up") and offers the next draft
  waiting. If nobody in the notes is in your CRM yet, it offers **Create a
  profile from these notes**. **Log touch** and a profile's own "Log
  interaction" form are the no-AI routes (what you type is what is saved).
- **📥 Inbox (AI, needs Claude)** — a CRM email address. Forward an email
  there, or copy the address on one you send, and it becomes a Log draft for
  the people already in your CRM, an Intake draft for anyone who isn't, or
  both — the same review screens as a paste, nothing saved until you confirm,
  and saving brings you back to the queue. This is also how to log something
  from your phone: email the address, and it waits here for review.
  Gmail's plus-addressing means `you+crm@gmail.com` works with no setup, as
  long as that is the mailbox your Claude Gmail connector is signed in to;
  mail you get at other addresses can be forwarded to it. People are matched
  by email address, then by full name; the new person the email is about (the
  forwarded message's sender, usually) gets the Intake, and anyone else new is
  listed with an "add" button, because every draft is a full run of the local
  model. `#log` or `#intake` in the subject decides for you; a note you type
  above a forwarded message is passed to the AI as your instruction ("log this
  on Sam — next step is the proposal"). The CRM checks the mailbox on a
  schedule, or on demand, with one Claude run each time: at the pace you set
  while you're using the app, and every four hours while you're away (mail
  that arrives meanwhile isn't lost). The page shows where each
  draft is in the model's queue and updates by itself, and an email's
  **More** menu re-routes anything it guessed wrong (replacing that email's
  unsaved drafts rather than adding more; a saved Log entry stays, and isn't
  offered again) or ignores it (discarding its unsaved drafts). Only
  email sent from your own addresses (the one in `config/owner.json`, plus any
  you list under **Your other email addresses**) is read or acted on: anyone
  can write to a plus-address. Each check first lists the new messages by
  sender, recipients and date only (no subject or text), then reads just your
  own, by message id; a guard on the Gmail connector blocks every other kind of
  call. So anyone else's message, a reply-all in a thread you copied the CRM
  on included, isn't read by any AI: it is listed as ignored, headers only.
  A note you write at the top of an email is followed as your instruction
  ("log this on Sam") only when Gmail filed the email as sent from your own
  account; from your other addresses it is read as context. To set it
  up, open **Inbox**, enter the address under **Your CRM address**, tick
  **Check automatically** and click **Save** — nothing is checked until you do.
- **📰 News Feed (AI, needs Claude)** — once a day, Claude searches the web
  for news about every person and company in the CRM, about ten at a time,
  and keeps only stories clearly about them (for a big organisation, only
  stories that name one of your contacts there or touch the business you know
  them for). Each item has the headline linked to the source, a short summary
  and the contacts it concerns; the feed stays in date order until you dismiss
  an item, and a dismissed story never comes back. It is **off until you turn
  it on** with **Turn daily search on** on the News Feed page, because each
  daily run sends your contacts' names, roles and employers to Anthropic (see
  "What leaves your computer"); with a large contact list it is also many
  Claude runs a day. "Check now" searches everyone once without turning on
  the daily run; "Pause daily search" turns it off again, and **Stop after
  this batch** ends a search that is running.
- **🗓 Prep (AI)** — a three-minute briefing before you meet someone: where
  things stand, what has changed since you last spoke (with Claude: checked
  against your calendar, your email and the web, with sources), what you want
  out of the meeting, talking points, questions and watch-outs. With Claude it
  can also look at your next seven days of meetings and pick who to prep for.
  The top of each brief says what was checked and what wasn't (and why).
  Briefs can be downloaded as a Word document, and a "Log this meeting" box
  closes the loop afterwards (with the AI, or saved as typed).
- **◎ Coach (AI)** — a weekly review of your whole practice. The AI reads the
  pipeline, the overdue items and the recent activity, tells you what it sees,
  and you talk it through. Anything you commit to in the conversation shows up
  as a proposed change to the CRM underneath the reply — correct the wording,
  date or person if needed and tick the ones you want recorded; the Coach page
  marks the sessions with proposals waiting, and **End session** asks first.
  Quick check-ins between weekly sessions work too. Settings → Coach sets how
  hard it pushes (Friendly, Pushy or Hardcore), whether it reads a
  folder of your own notes about your strengths, pitfalls and goals, and which
  AI it uses — it can run on a bigger local model, or on Claude, than the rest
  of the app.
- **Import** — bring in a spreadsheet of contacts, including your LinkedIn
  connections (see the next section).
- **Map** — a live picture of your network: people coloured by status,
  companies, and who introduced whom. Hover over someone (or tap them) to see
  just their circle; click (or tap again) to open the profile. Chips filter by
  status, and a big network starts on the most engaged ones; **Find** jumps to
  a name.
- **Search** — one box (in the sidebar, or the Search page) that looks across
  people (including email, phone and employer), companies, notes,
  interactions, to-dos and the pipeline. A to-do result opens that to-do.
- **Outreach** — imported messages, drafted or sent, attached to their
  contacts; **Copy text** and **Mark sent**. It appears in the menu once there
  is something in it.

The AI pages say before you start where the text will go: on this Mac, or —
if the AI on this Mac isn't running and the Claude fallback is on — to
Anthropic through Claude. Every review page and brief says which one wrote it.

Logging an interaction automatically updates the contact's "last touch" date.

## Import your LinkedIn connections

The fastest way to fill the CRM is your LinkedIn connections list.

1. On LinkedIn, click **Me** (your photo, top right) → **Settings & Privacy**
   → **Data privacy** → **Get a copy of your data**.
2. Choose **"Want something in particular?"**, tick **Connections**, and click
   **Request archive**. LinkedIn emails you a download link within about ten
   minutes.
3. Download and unzip it; inside is a file called **Connections.csv**.
4. In the CRM, open **Import**, choose that file and click **Preview**: it
   shows how each column was understood and the first people as they will be
   saved — nothing is written yet. Click **Import** to bring them in. Files up
   to 8 MB work here (a LinkedIn export is far smaller).

Names, LinkedIn links, current role and company come across, and the
"Connected On" date is kept as when you connected. Before importing, the
preview asks whether to add everyone to **Keep Warm**: the default, **Not yet**,
leaves them on the People page with no keep-warm cadence, so years-old
connections don't all show as overdue (the preview says how many would);
give someone a cadence when they matter. Anyone already in the CRM is left
alone (never overwritten); tick **update existing** if you want blank fields
on existing people filled in from the file. Any spreadsheet with a
header row works the same way — name, email, company, role, phone, location,
tags, notes and a few other columns are recognised automatically.

## If you use Claude (optional)

Claude is Anthropic's AI assistant. If you have a paid Claude subscription
(any paid plan), the CRM can use it for the parts a local model can't do: read
your Google Calendar and Gmail to prepare a briefing, fetch a Zoom or Google
Meet transcript to log a meeting, look people up on the web during Intake, and
search the web for news about your contacts.
It also serves as a stand-in when Ollama isn't running. No API key or separate
billing — it uses the same subscription as the Claude app. The CRM talks to the
**Claude Code command-line tool** below; having only the Claude app installed
isn't enough.

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
   and **Zoom** (whichever you use). The connectors themselves can do more than
   read, but the CRM only ever lets Claude use their search and read tools, and
   it never sees your passwords.

Once Claude is installed, Intake's **Look them up on the web first** box is
ticked by default. It sends only the person's name, role, employer and
location (read on this Mac first), never what you pasted (see below).
The News Feed stays off until you turn it on. The **Intake** page tells you if
the Claude tool can't be found. If a Claude
step fails mid-run, the CRM carries on with what it has locally and says so in
the result.

### What leaves your computer

This matters, so here it is plainly:

- **Nothing**, for anything that runs on the local model — Intake from pasted
  text, Log from pasted notes, Prep from your own records, Coach. Your
  database, the prompts and the results never leave the Mac.
- **To Anthropic (through your own Claude login), only when you use a Claude
  step:**
  - Intake with the **Look them up on the web first** box ticked (it is ticked
    by default once Claude is installed): the person's name, role, employer and
    location, which the AI on this Mac picks out of your paste first. Never the
    paste itself.
  - Log with the **Zoom / Gmail / Google Meet** source: your request, and the
    transcript or email thread Claude fetched on your behalf (for Google Meet,
    Claude first looks the meeting up on your Google Calendar, then finds its
    "Notes by Gemini" doc in Google Drive — so Gemini note-taking has to have
    been on for that meeting).
  - Inbox: each mailbox check is two Claude runs. The first lists the mail
    delivered to your CRM address by sender, recipients, date and Gmail label,
    never a subject or any text. The second reads only the messages that are
    from your own addresses. The routing and the drafting then happen on this
    Mac.
  - News Feed (only once you turn it on, then daily, or when you click "Check
    now"): for each person, their name, role, employer and location;
    for each company, its name, industry, headquarters, website and the names
    of up to three of your contacts there, plus your first name. Never your
    notes, interaction log or deals. This run can only search the web: it
    can't open pages, so nothing it reads can make it send that list anywhere.
  - Prep's calendar/email check: the other person's name, company, role, the
    date you last spoke, your noted next step and any focus you typed — never
    your profile notes or interaction log. If you let Prep pick the meeting
    from your calendar (no person chosen), it also gets your contact list —
    names, roles, companies, statuses and tags — so it can match calendar
    events to people. Prep's web check: only their public name, role and
    company. These are two separate, walled-off requests so that a session
    that reads your email never also has a way to send anything out.
  - **If Ollama isn't running** and you ticked "If the AI on this Mac isn't
    available, use Claude instead" in Settings (it is off unless you turn it
    on): the whole request for that step — your contact list, and for Prep the
    person's notes and interaction log. The AI pages warn you before you start.
    It never applies to the Coach or to drafts made from Inbox emails, which
    wait for Ollama instead.
  - **If you choose Claude** under Settings → **Where the AI runs**, or as the
    AI the Coach uses: the whole request for every such step — including your
    contacts' notes and, for the Coach, the files in your notes folder.
  - Requests that describe you (Intake, Inbox, Prep, Coach) also include the
    name and practice description from `config/owner.json`.
- **To wherever you point backups:** a daily copy of the whole database goes
  into the backup folder (see below). That is only a cloud folder if you chose
  one, and the copies are not encrypted.
- **To another computer, if you point Settings → Ollama URL at one:** every
  request the local model would get, over your network, unencrypted.

Claude runs with a fixed, read-only set of tools: it can search and read, and
it cannot send email, change your calendar, run anything on your Mac, or read
your files. The CRM enforces this itself on every run, whatever you may have
allowed Claude Code to do in your own settings. Nothing the CRM's own AI
features produce is saved until you have reviewed it. The exception is the
Claude Desktop connection (MCP, see "For developers"): what you ask Claude
Desktop to change is written straight away, and a replaced profile section is
kept in the database's section history.

Text that came from an email, a transcript or the web is shown as text: links
open only when you click them, and images are never loaded by themselves.

## Where your data lives, and backups

- **Everything is in one file:** `data/crm.db` inside the CRM folder. That is
  your entire CRM.
- **Daily backups** are made automatically while the CRM is running, into
  `data/backups` inside the CRM folder. The newest 30 are kept. The Settings
  page shows when the last one was made, and both Settings and the Dashboard
  warn you in red if a backup failed or the newest is more than two days old.
- **To keep a copy off the Mac**, open **Settings** → **Backups** and type the
  full path of a folder that syncs to the cloud — for example a folder inside
  your iCloud Drive, Dropbox or Google Drive folder (`~/` works). The folder is
  checked when you save, and today's copy is made there straight away; from
  then on the daily copy goes there. Note that it is a plain, unencrypted copy of everything in the
  CRM.
- **Moving to a new Mac:** stop the CRM, copy the whole CRM folder across,
  install Node (and Ollama) on the new machine, delete the `node_modules` and
  `.next` folders inside the copied CRM folder (they are rebuilt for the new
  Mac), and double-click **Start CRM.command**. Your data, settings and
  sign-in come with the folder.
- **Restoring a backup:** stop the CRM, delete `crm.db-wal` and `crm.db-shm`
  from the `data` folder if they are there, replace `data/crm.db` with the
  backup file you want (rename it to `crm.db`), and start it again.

## Updating to a new version

1. Double-click **Stop CRM.command**.
2. Download the new ZIP and unzip it (or `git pull` if you cloned).
3. Copy these from your old CRM folder into the new one: the **`data`** folder
   (your CRM and its backups), and if you created them, **`config/owner.json`**,
   **`config/vocab.json`** and **`.env.local`**.
4. Double-click **Start CRM.command** in the new folder. It notices the new
   version, refreshes its components and rebuilds (a few minutes), then opens
   as usual. Once you're happy, delete the old folder.

## Uninstalling

Stop the CRM and delete its folder — that deletes your data too, so keep a
backup if you might want it back. Ollama and its models (in `.ollama` in your
home folder) and Claude Code are separate programs: remove them only if
nothing else uses them. If you connected Claude Desktop, remove the
`siryous-crm` entry from its configuration (see docs/DEVELOPING.md).

## Signing in

The CRM is locked to the Mac it runs on. When it first starts it creates a
private link (a long random code) and only browsers that have opened that link
once can use it. This is what stops web pages you visit, and programs that
talk to the CRM over the network, from reading or changing it. (Software
running as you on this Mac could still read the files in `data/` directly;
the CRM keeps them readable by your account only.) There is no password to
remember:

- **Start CRM.command** always opens the CRM already signed in.
- **To sign in a second browser on this Mac** (or after clearing your
  browser's cookies), open **Settings → Access** in a browser that is signed
  in, click **Make a sign-in link** and open that link in the other browser
  within two minutes: it works once. Or paste the contents of the file
  `data/auth-token` into the box on the sign-in page.
- **Staying signed in:** each browser stays signed in while you use it, and
  is signed out after 30 days without a visit. **Sign out other browsers** on
  the same page ends every sign-in but the one you are using.
- **"That didn't match":** the code was copied incompletely, or a one-time
  link was used already or is more than two minutes old. Make a new one, or
  just double-click **Start CRM.command**, which signs the browser in for you.
- **On your phone:** the CRM runs on this Mac, so its pages don't open on a
  phone. Email your CRM address instead (see **Inbox**) — for example
  "#log Called Sam. Next step: proposal Friday." — and review the draft when
  you're back at the Mac.
- Always use the address the CRM gives you, `http://127.0.0.1:3000`. The
  sign-in is tied to that exact address, so `localhost:3000` looks like a
  different site to your browser and asks you to sign in again.

## Troubleshooting

Look for the message you are seeing:

- **"AI features are off — Ollama isn't running" / "The AI on this Mac isn't
  running"** —
  the Ollama app isn't open. Open **Ollama** from Applications; the llama icon
  should appear in the menu bar. Then try again. If you never installed it, see
  step 2 of the setup.
- **"The AI model … hasn't been downloaded yet"** — Ollama
  is running but the model chosen in Settings hasn't been downloaded. The
  notice shows the command to copy for the model that suits your Mac; run it,
  press **Check again**, and choose the model if it offers **Use …**.
- **"That's too much text for the AI to read at once"** — you gave the AI
  more text than the model can hold at once (a long transcript, or a very busy
  Coach week). Either paste less, or open Settings and raise **How much text
  the AI can read at once** (32768 by default; doubling it is fine if you have
  the memory).
- **"The AI didn't finish in …" / "Claude timed out after …"** — the model took too long, which usually means the Mac is
  short of memory for the model you chose. Close other heavy apps, or switch to
  a smaller model (step 5), and try again.
- **"Your Claude Code login has expired"** — Claude needs you to sign in
  again. Open Terminal, type `claude`, then `/login`, finish in the browser,
  type `/exit`, and try again in the CRM.
- **"This needs Claude Code, which isn't installed on this Mac"** — you tried
  a step that needs Claude (calendar, email, Zoom, Drive or web) but the Claude
  tool isn't set up. Either follow "If you use Claude" above, or untick
  **Look them up on the web first** / paste the content instead — everything
  else works without it.
- **"Interrupted by a server restart — start it again"** — the CRM was stopped
  while the AI was working on something. Nothing is lost; open that item and
  use its "Try again" link (or start the run once more).
- **"Build failed — see above"** in the Start CRM window — the one-time
  preparation didn't finish. The most common causes are no internet connection
  during the first start, or a Node older than version 22 (the window says which
  version it found). Fix that and double-click **Start CRM.command** again. If
  it still fails, copy the text in the window and open an issue on GitHub.
- **Terminal says `command not found: npm` or `command not found: node`** —
  Node isn't installed, or was installed while Terminal was open. Do step 1 of
  the setup, then quit Terminal (Command-Q) and double-click **Start
  CRM.command** again.
- **The browser says it can't connect to 127.0.0.1:3000** — the CRM isn't
  running. Double-click **Start CRM.command**. If that window shows an error,
  the details are also in `data/server.log` inside the CRM folder.
- **"Another program is using the address the CRM needs (port 3000)"** — some
  other app on this Mac answers on the same address. Start CRM never opens it
  (or hands it your sign-in link), and Stop CRM only ever stops the CRM. Quit
  the other app and double-click **Start CRM.command** again.
- **Installing fails with messages about `gyp`, `xcrun` or "Command Line
  Tools"** — the database component had to be built from source, which needs
  Apple's developer tools. Open Terminal, run `xcode-select --install`, accept
  the dialog, wait for it to finish, then double-click **Start CRM.command**
  again.
- **"was compiled against a different Node.js version" / `NODE_MODULE_VERSION`**
  — Node was updated (or the folder came from another Mac). Stop the CRM,
  delete the `node_modules` and `.next` folders inside the CRM folder, and
  double-click **Start CRM.command**.
- **You updated the CRM (downloaded a new ZIP) and it looks the same** — Start
  CRM notices changed files and rebuilds automatically; if you replaced the
  folder, make sure you copied your old `data` folder (and `config/owner.json`)
  into the new one first — see "Updating to a new version".

## For developers

Everything technical — running it in development mode, environment variables,
how the access token works, the AI architecture and exactly what each step
sends where, configuration files for your own vocabulary and owner profile,
the Claude Desktop MCP server, backups, the export and merge scripts, the CSV
importer's command-line form, tests and CI — is in
[docs/DEVELOPING.md](docs/DEVELOPING.md). [CLAUDE.md](CLAUDE.md) has the
ground rules for AI coding sessions in this repository, and
[docs/REVIEW_AGENTS.md](docs/REVIEW_AGENTS.md) covers the optional code,
security and UX review agents behind the App Tests page. Contributions welcome.

## License

MIT — see `LICENSE`.
