/**
 * Mail-in routing: given one email that reached the CRM address, decide
 * whether it is an update on people already in the roster (→ Log), a new
 * person to add (→ Intake), or both. Pure functions — no database, no model —
 * so the rules are unit-tested and the poller stays thin.
 *
 * Who took part is read from the message headers AND from any forwarded
 * header block in the body ("From: Jane Doe <jane@acme.com>" lines), because
 * a forwarded email's own headers only say that the owner sent it to the CRM.
 */

export interface InboxEmail {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  body: string;
}

export interface RosterEntry {
  slug: string;
  name: string;
  email: string | null;
}

export interface Participant {
  name: string | null;
  email: string;
}

export interface Route {
  /** 'log' | 'intake' | 'both' */
  mode: "log" | "intake" | "both";
  /** Roster people found among the participants (or named in the text). */
  known: { slug: string; name: string }[];
  /** Participants who are not in the roster (and are not the owner). */
  unknown: Participant[];
  /** A #log / #intake tag in the subject forced the decision. */
  forced: "log" | "intake" | null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** "Name <a@b.c>" or "a@b.c" or "Name (a@b.c)", as mail clients render them. */
const ADDR_RE = /(?:"?([^"<,;()]*?)"?\s*[<(]\s*)?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*[>)]?/g;
/** A header line in a forwarded/quoted block: optional quote marks, optional bold, From/To/Cc. */
const FWD_HEADER_RE = /^[>\s*_]*(?:\*\*)?(from|to|cc|reply-to)(?:\*\*)?\s*:\s*(.+)$/i;

/** Addresses that never count as a participant (auto-senders, the CRM itself). */
const NOISE_RE = /^(no-?reply|noreply|do-?not-?reply|mailer-daemon|notifications?|calendar-notification|bounce)/i;

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

/** "you+crm@example.com" → "you@example.com" so any plus-tag of an owner address counts as the owner. */
export function stripPlusTag(e: string): string {
  const m = normEmail(e).match(/^([^+@]+)(\+[^@]*)?@(.+)$/);
  return m ? `${m[1]}@${m[3]}` : normEmail(e);
}

export function parseAddresses(text: string): Participant[] {
  const out: Participant[] = [];
  for (const m of text.matchAll(ADDR_RE)) {
    const name = m[1]?.replace(/^[\s*_>]+|[\s*_]+$/g, "").replace(/^(fwd?|re)\s*:\s*/i, "").trim() || null;
    out.push({ name: name && name.length < 80 ? name : null, email: normEmail(m[2]) });
  }
  return out;
}

/**
 * Everyone the email involves: header recipients/sender plus the From/To/Cc
 * lines of any forwarded block in the body. Owner addresses, the CRM address
 * and auto-senders are dropped; duplicates are merged (a named occurrence
 * wins over a bare address).
 */
export function participantsOf(email: InboxEmail, ownerEmails: string[]): Participant[] {
  const owners = new Set(ownerEmails.map(stripPlusTag));
  const found = new Map<string, Participant>();
  const add = (p: Participant) => {
    if (owners.has(stripPlusTag(p.email))) return;
    if (NOISE_RE.test(p.email)) return;
    const cur = found.get(p.email);
    if (!cur) found.set(p.email, p);
    else if (!cur.name && p.name) cur.name = p.name;
  };
  for (const p of parseAddresses([email.from, ...email.to, ...email.cc].join(", "))) add(p);
  for (const line of email.body.split(/\r?\n/)) {
    const m = line.match(FWD_HEADER_RE);
    if (!m) continue;
    for (const p of parseAddresses(m[2])) add(p);
  }
  return [...found.values()];
}

/** #intake / #log anywhere in the subject (case-insensitive) forces the route. */
export function subjectTag(subject: string): "log" | "intake" | null {
  if (/(^|\s)#intake\b/i.test(subject)) return "intake";
  if (/(^|\s)#log\b/i.test(subject)) return "log";
  return null;
}

/** Strip the routing tag and Fwd:/Re: prefixes for display. */
export function cleanSubject(subject: string): string {
  return subject
    .replace(/(^|\s)#(intake|log)\b/gi, " ")
    .replace(/^\s*((fwd?|re|fw)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Roster people this email is about: matched by address first, then by full
 * name appearing in the text (two or more words, so a lone first name never
 * matches). Returns them in roster order.
 */
export function matchRoster(email: InboxEmail, participants: Participant[], roster: RosterEntry[]): { slug: string; name: string }[] {
  const byEmail = new Map<string, RosterEntry>();
  for (const r of roster) if (r.email) byEmail.set(normEmail(r.email), r);
  const hits = new Map<string, RosterEntry>();
  for (const p of participants) {
    const r = byEmail.get(p.email);
    if (r) hits.set(r.slug, r);
  }
  const text = `${email.subject}\n${email.from}\n${email.to.join(" ")}\n${email.cc.join(" ")}\n${email.body}`;
  for (const r of roster) {
    if (hits.has(r.slug)) continue;
    const words = r.name.trim().split(/\s+/);
    if (words.length < 2) continue;
    const re = new RegExp(`(^|[^A-Za-z])${escapeRe(r.name.trim()).replace(/\s+/g, "\\s+")}(?![A-Za-z])`, "i");
    if (re.test(text)) hits.set(r.slug, r);
  }
  return roster.filter((r) => hits.has(r.slug)).map((r) => ({ slug: r.slug, name: r.name }));
}

export function routeEmail(email: InboxEmail, roster: RosterEntry[], ownerEmails: string[]): Route {
  const participants = participantsOf(email, ownerEmails);
  const known = matchRoster(email, participants, roster);
  const knownEmails = new Set(roster.filter((r) => known.some((k) => k.slug === r.slug) && r.email).map((r) => normEmail(r.email!)));
  const unknown = participants.filter((p) => !knownEmails.has(p.email));
  const forced = subjectTag(email.subject);

  let mode: Route["mode"];
  if (forced === "intake") mode = "intake";
  else if (forced === "log") mode = "log";
  else if (known.length && unknown.length) mode = "both";
  else if (unknown.length) mode = "intake";
  // Nobody recognisable at all (headers stripped by a phone client, say):
  // let the Log model try — it matches roster names in the content itself,
  // and its "nobody matched" error shows on the queue with a re-route button.
  else mode = "log";
  return { mode, known, unknown, forced };
}

/**
 * The text the Log model gets: metadata header lines (the same shape the
 * Zoom/Meet/Gmail retrieval step produces) followed by the message.
 */
export function logInputFor(email: InboxEmail, date: string | null): string {
  return [
    `TITLE: ${cleanSubject(email.subject) || "(no subject)"}`,
    `DATE: ${date ?? "unknown"}`,
    `PARTICIPANTS: ${[email.from, ...email.to, ...email.cc].filter(Boolean).join("; ")}`,
    `SOURCE: email forwarded to the CRM address`,
    `CONTENT:`,
    email.body.trim(),
  ].join("\n");
}

/**
 * The text an Intake draft gets for one unknown participant: who the draft
 * is for, then the whole email for context (the other people in it are
 * context, not the subject of the intake).
 */
export function intakeInputFor(email: InboxEmail, who: Participant, date: string | null, ownerEmails: string[] = []): string {
  const others = participantsOf(email, [...ownerEmails, who.email]).filter((p) => p.email !== who.email);
  return [
    `THIS INTAKE IS FOR: ${who.name ? `${who.name} <${who.email}>` : who.email}`,
    others.length ? `Others on the email (context only, not the person to add): ${others.map((o) => (o.name ? `${o.name} <${o.email}>` : o.email)).join("; ")}` : "",
    `Email subject: ${cleanSubject(email.subject) || "(no subject)"}${date ? ` · date: ${date}` : ""}`,
    `From: ${email.from}`,
    "",
    email.body.trim(),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Every address that belongs to the owner, plus-tags included. */
export function ownerAddresses(ownerEmail: string | null | undefined, inboxAddress: string, extra: string[] = []): string[] {
  return [ownerEmail ?? "", inboxAddress, ...extra].map((e) => e.trim()).filter(Boolean);
}

export { EMAIL_RE };
