import type Database from "better-sqlite3";
import { z } from "zod";
import { getDb } from "./db";
import { buildInboxFetchPrompt, claudeBin, extractJsonWithRepair, runClaudeStream, TOOLS, type InboxFetchedMessage } from "./ai";
import { insertIntakeDraft, insertLogDraft, processIntakeDraft, processLogDraft } from "./drafts";
import { intakeInputFor, logInputFor, ownerAddresses, routeEmail, type InboxEmail, type Participant, type RosterEntry } from "./inboxRoute";
import { loadOwner } from "./owner.mjs";
import { getSetting, setSetting } from "./settings";

/**
 * Mail-in: a mailbox address the owner forwards or copies emails to. A poll
 * asks Claude (Gmail read tools — the same connector Prep and Log use) for
 * the new messages at that address, then everything else happens locally:
 * the participants are matched against the roster, and each message becomes
 * a Log draft (people already in the CRM), Intake draft(s) (people who
 * aren't), or both. Nothing is written to the roster until the owner
 * confirms the drafts, exactly as with a paste.
 *
 * Settings (key/value, edited on /inbox): inbox.address, inbox.enabled,
 * inbox.poll_minutes, inbox.extra_owner_emails, and the status pair
 * inbox.last_poll_at / inbox.last_error.
 */

export const INBOX_MAX_PER_POLL = 20;
const MIN_POLL_MINUTES = 10;
const DEFAULT_POLL_MINUTES = 30;
/** How far back a poll looks: from the last successful poll, less this margin (Gmail's after: is day-granular). */
const LOOKBACK_DAYS = 2;
const FIRST_LOOKBACK_DAYS = 7;

export interface InboxSettings {
  address: string;
  enabled: boolean;
  pollMinutes: number;
  extraOwnerEmails: string[];
  lastPollAt: string | null;
  lastError: string | null;
}

export function getInboxSettings(): InboxSettings {
  const minutes = Number(getSetting("inbox.poll_minutes"));
  return {
    address: (getSetting("inbox.address") ?? "").trim(),
    enabled: getSetting("inbox.enabled") === "on",
    pollMinutes: minutes >= MIN_POLL_MINUTES ? Math.round(minutes) : DEFAULT_POLL_MINUTES,
    extraOwnerEmails: (getSetting("inbox.extra_owner_emails") ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean),
    lastPollAt: getSetting("inbox.last_poll_at"),
    lastError: getSetting("inbox.last_error"),
  };
}

export function validateInboxAddress(raw: string): { ok: true; address: string } | { ok: false; reason: string } {
  const address = raw.trim().toLowerCase();
  if (!address) return { ok: true, address: "" };
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address)) return { ok: false, reason: "that isn't an email address" };
  return { ok: true, address };
}

/** All addresses that mean "the owner" for routing purposes. */
export function inboxOwnerEmails(s: InboxSettings = getInboxSettings()): string[] {
  return ownerAddresses(loadOwner().ownerEmail, s.address, s.extraOwnerEmails);
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const FetchedSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().min(1),
      thread_id: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      subject: z.string().optional(),
      from: z.string().optional(),
      to: z.array(z.string()).optional(),
      cc: z.array(z.string()).optional(),
      body: z.string().optional(),
    })
  ),
});

let polling: Promise<PollResult> | null = null;

export interface PollResult {
  fetched: number;
  routed: number;
  skipped: number;
  error: string | null;
}

/** One poll; concurrent callers share the in-flight one. */
export function pollInbox(): Promise<PollResult> {
  if (polling) return polling;
  polling = pollInboxInner().finally(() => {
    polling = null;
  });
  return polling;
}

export function inboxPollRunning(): boolean {
  return polling !== null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function gmailDate(d: Date): string {
  return isoDate(d).replace(/-/g, "/");
}

async function pollInboxInner(): Promise<PollResult> {
  const db = getDb();
  const s = getInboxSettings();
  const result: PollResult = { fetched: 0, routed: 0, skipped: 0, error: null };
  if (!s.address) {
    result.error = "No CRM address is set.";
    return result;
  }
  if (!claudeBin()) {
    result.error = "The Claude tool isn't installed, so the mailbox can't be read (see “If you use Claude” in the README).";
    setSetting("inbox.last_error", result.error);
    return result;
  }
  try {
    const since = new Date();
    if (s.lastPollAt) since.setTime(new Date(s.lastPollAt).getTime() - LOOKBACK_DAYS * 86_400_000);
    else since.setTime(since.getTime() - FIRST_LOOKBACK_DAYS * 86_400_000);
    const seen = (db.prepare(`SELECT gmail_id FROM inbox_messages ORDER BY id DESC LIMIT 60`).all() as { gmail_id: string }[]).map(
      (r) => r.gmail_id
    );
    const text = await runClaudeStream(buildInboxFetchPrompt(s.address, gmailDate(since), seen, INBOX_MAX_PER_POLL), {
      allowedTools: TOOLS.gmailRead,
      timeoutMs: 300_000,
    });
    const parsed = FetchedSchema.safeParse(await extractJsonWithRepair(text));
    if (!parsed.success) throw new Error(`Couldn't read the mailbox listing: ${parsed.error.issues[0]?.message ?? "bad JSON"}`);
    const messages: InboxFetchedMessage[] = parsed.data.messages.map((m) => ({
      id: m.id,
      thread_id: m.thread_id ?? null,
      date: m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date) ? m.date.slice(0, 10) : null,
      subject: m.subject ?? "",
      from: m.from ?? "",
      to: m.to ?? [],
      cc: m.cc ?? [],
      body: m.body ?? "",
    }));
    result.fetched = messages.length;
    for (const m of messages) {
      const stored = storeMessage(db, m);
      if (!stored) {
        result.skipped++;
        continue;
      }
      routeMessage(db, stored);
      result.routed++;
    }
    setSetting("inbox.last_poll_at", new Date().toISOString());
    setSetting("inbox.last_error", null);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    setSetting("inbox.last_error", result.error);
  }
  return result;
}

/** Insert the message if it is new; null when it was seen before or is empty. */
function storeMessage(db: Database.Database, m: InboxFetchedMessage): number | null {
  if (!m.body.trim() && !m.subject.trim()) return null;
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO inbox_messages (gmail_id, thread_id, subject, sender, recipients, date, body, status)
       VALUES (?,?,?,?,?,?,?,'new')`
    )
    .run(m.id, m.thread_id, m.subject, m.from, JSON.stringify({ to: m.to, cc: m.cc }), m.date, m.body);
  return r.changes ? Number(r.lastInsertRowid) : null;
}

// ---------------------------------------------------------------------------
// Routing a stored message into drafts
// ---------------------------------------------------------------------------

export interface InboxRow {
  id: number;
  gmail_id: string;
  thread_id: string | null;
  subject: string | null;
  sender: string | null;
  recipients: string | null;
  date: string | null;
  body: string;
  status: string;
  route: string | null;
  log_draft_id: number | null;
  intake_draft_ids: string | null;
  note: string | null;
  error: string | null;
  created_at: string;
}

export function loadInboxRow(db: Database.Database, id: number): InboxRow | undefined {
  return db.prepare(`SELECT * FROM inbox_messages WHERE id=?`).get(id) as InboxRow | undefined;
}

export function emailOf(row: InboxRow): InboxEmail {
  let to: string[] = [];
  let cc: string[] = [];
  try {
    const r = JSON.parse(row.recipients ?? "{}");
    to = Array.isArray(r.to) ? r.to : [];
    cc = Array.isArray(r.cc) ? r.cc : [];
  } catch {}
  return { subject: row.subject ?? "", from: row.sender ?? "", to, cc, body: row.body };
}

function roster(db: Database.Database): RosterEntry[] {
  return db.prepare(`SELECT slug, name, email FROM people ORDER BY name`).all() as RosterEntry[];
}

/**
 * Decide where a message goes and start the draft(s). `force` re-routes a
 * message by hand from the queue ("Send to Intake" / "Send to Log").
 */
export function routeMessage(db: Database.Database, id: number, force: "log" | "intake" | null = null): void {
  const row = loadInboxRow(db, id);
  if (!row) return;
  const email = emailOf(row);
  const owners = inboxOwnerEmails();
  const route = routeEmail(force ? { ...email, subject: `#${force} ${email.subject}` } : email, roster(db), owners);
  const notes: string[] = [];
  let logDraftId: number | null = null;
  const intakeIds: number[] = [];

  try {
    if (route.mode === "log" || route.mode === "both") {
      const hint = route.known.length === 1 ? (db.prepare(`SELECT id FROM people WHERE slug=?`).get(route.known[0].slug) as { id: number } | undefined) : undefined;
      logDraftId = insertLogDraft(db, {
        raw: `Email to the CRM address: ${email.subject || "(no subject)"}${route.known.length ? ` — about ${route.known.map((k) => k.name).join(", ")}` : ""}`,
        source: "email",
        content: logInputFor(email, row.date),
        hintPersonId: hint?.id ?? null,
      });
      void processLogDraft(logDraftId);
      notes.push(route.known.length ? `Log: ${route.known.map((k) => k.name).join(", ")}` : "Log: nobody matched by address — the model will look for roster names in the text");
    }
    if (route.mode === "intake" || route.mode === "both") {
      // One Intake per unknown participant (Intake adds one person at a time);
      // with nobody identifiable, one draft from the whole email.
      const targets: Participant[] = route.unknown.length ? route.unknown.slice(0, 3) : [{ name: null, email: "" }];
      for (const who of targets) {
        const raw = who.email ? intakeInputFor(email, who, row.date, owners) : `Email subject: ${email.subject}\nFrom: ${email.from}\n\n${email.body}`;
        const draftId = insertIntakeDraft(db, raw);
        intakeIds.push(draftId);
        void processIntakeDraft(draftId, false);
      }
      if (route.unknown.length > 3) notes.push(`${route.unknown.length - 3} more people on the email were not sent to Intake (limit 3 per email)`);
      notes.push(`Intake: ${route.unknown.length ? route.unknown.map((u) => u.name ?? u.email).join(", ") : "from the email text"}`);
    }
    db.prepare(
      `UPDATE inbox_messages SET status='routed', route=?, log_draft_id=?, intake_draft_ids=?, note=?, error=NULL WHERE id=?`
    ).run(route.forced ? `${route.mode} (tagged)` : route.mode, logDraftId, intakeIds.length ? JSON.stringify(intakeIds) : null, notes.join(" · "), id);
  } catch (err) {
    db.prepare(`UPDATE inbox_messages SET status='error', error=? WHERE id=?`).run(err instanceof Error ? err.message : String(err), id);
  }
}

// ---------------------------------------------------------------------------
// Background loop (started from instrumentation.ts)
// ---------------------------------------------------------------------------

let loopTimer: NodeJS.Timeout | null = null;

/**
 * Check the mailbox on a schedule while mail-in is on. The interval is read
 * from settings on every tick, so changes on /inbox apply without a restart.
 */
export function startInboxLoop(): void {
  if (loopTimer) return;
  const tick = async () => {
    try {
      const s = getInboxSettings();
      if (s.enabled && s.address && claudeBin()) {
        const last = s.lastPollAt ? new Date(s.lastPollAt).getTime() : 0;
        if (Date.now() - last >= s.pollMinutes * 60_000 - 5_000) {
          const r = await pollInbox();
          if (r.fetched || r.error) console.log(`[inbox] fetched ${r.fetched}, routed ${r.routed}${r.error ? ` — ${r.error}` : ""}`);
        }
      }
    } catch (err) {
      console.error("[inbox] poll failed:", err);
    }
  };
  loopTimer = setInterval(tick, 60_000);
  loopTimer.unref();
  // First check shortly after boot rather than a full interval later.
  setTimeout(tick, 15_000).unref();
}
