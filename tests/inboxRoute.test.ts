import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSubject,
  INBOX_ACTIVE_WINDOW_MINUTES,
  INBOX_AWAY_POLL_MINUTES,
  inboxCheckDue,
  intakeInputFor,
  logInputFor,
  participantsOf,
  primaryParticipant,
  routeEmail,
  sentByOwner,
  stripPlusTag,
  subjectTag,
  type InboxEmail,
  type RosterEntry,
} from "../lib/inboxRoute";

const OWNER = ["owner@example.com", "owner+crm@example.com", "owner@firm.example"];
const roster: RosterEntry[] = [
  { slug: "jane-doe", name: "Jane Doe", email: "jane@acme.example" },
  { slug: "sam-lee", name: "Sam Lee", email: null },
  { slug: "cher", name: "Cher", email: null },
];

const email = (over: Partial<InboxEmail>): InboxEmail => ({
  subject: "Fwd: catch-up",
  from: "Owner <owner@example.com>",
  to: ["owner+crm@example.com"],
  cc: [],
  body: "",
  ...over,
});

describe("stripPlusTag", () => {
  test("drops the +tag and lowercases", () => {
    assert.equal(stripPlusTag("Owner+CRM@Example.com"), "owner@example.com");
    assert.equal(stripPlusTag("plain@example.com"), "plain@example.com");
  });
});

describe("participantsOf", () => {
  test("reads header addresses, drops the owner and the CRM address", () => {
    const p = participantsOf(
      email({ from: "Jane Doe <jane@acme.example>", to: ["owner@example.com", "Bob <bob@x.example>"], cc: ["owner+crm@example.com"] }),
      OWNER
    );
    assert.deepEqual(p, [
      { name: "Jane Doe", email: "jane@acme.example" },
      { name: "Bob", email: "bob@x.example" },
    ]);
  });

  test("reads the From/To/Cc lines of a forwarded block, quoted or bold", () => {
    const body = `FYI — good call, log this on Jane.

---------- Forwarded message ---------
From: Jane Doe <jane@acme.example>
Date: Mon, 21 Sep 2026 at 10:02
Subject: catch-up
To: Owner <owner@firm.example>
> **Cc:** Ravi Patel <ravi@acme.example>, noreply@calendar.example
`;
    const p = participantsOf(email({ body }), OWNER);
    assert.deepEqual(p, [
      { name: "Jane Doe", email: "jane@acme.example" },
      { name: "Ravi Patel", email: "ravi@acme.example" },
    ]);
  });

  test("a named occurrence wins over a bare address", () => {
    const p = participantsOf(email({ to: ["bob@x.example"], body: "To: Bob Smith <bob@x.example>" }), OWNER);
    assert.deepEqual(p, [{ name: "Bob Smith", email: "bob@x.example" }]);
  });
});

describe("subjectTag / cleanSubject", () => {
  test("finds #log and #intake, case-insensitively, and cleans them off", () => {
    assert.equal(subjectTag("Fwd: notes #LOG"), "log");
    assert.equal(subjectTag("#intake Fwd: intro"), "intake");
    assert.equal(subjectTag("Re: #logistics"), null);
    assert.equal(cleanSubject("Fwd: Re: #intake intro to Bob"), "intro to Bob");
  });
});

describe("routeEmail", () => {
  test("a known participant by email → log", () => {
    const r = routeEmail(email({ from: "jane@acme.example", to: ["owner@example.com"], cc: ["owner+crm@example.com"] }), roster, OWNER);
    assert.equal(r.mode, "log");
    assert.deepEqual(r.known, [{ slug: "jane-doe", name: "Jane Doe" }]);
    assert.deepEqual(r.unknown, []);
  });

  test("a known person by full name in the text (no email on file) → log", () => {
    const r = routeEmail(email({ body: "Had coffee with Sam Lee yesterday." }), roster, OWNER);
    assert.equal(r.mode, "log");
    assert.deepEqual(r.known, [{ slug: "sam-lee", name: "Sam Lee" }]);
  });

  test("a single-word roster name never matches on its own", () => {
    const r = routeEmail(email({ body: "cher said hello" }), roster, OWNER);
    assert.deepEqual(r.known, []);
  });

  test("only unknown people → intake, listing them", () => {
    const r = routeEmail(email({ body: "From: Bob Smith <bob@x.example>\nTo: owner@firm.example" }), roster, OWNER);
    assert.equal(r.mode, "intake");
    assert.deepEqual(r.unknown, [{ name: "Bob Smith", email: "bob@x.example" }]);
  });

  test("known and unknown together → both", () => {
    const r = routeEmail(email({ body: "From: Bob Smith <bob@x.example>\nCc: Jane Doe <jane@acme.example>" }), roster, OWNER);
    assert.equal(r.mode, "both");
    assert.equal(r.known[0].slug, "jane-doe");
    assert.deepEqual(r.unknown, [{ name: "Bob Smith", email: "bob@x.example" }]);
  });

  test("nobody recognisable → log (the model gets a shot at the text)", () => {
    const r = routeEmail(email({ body: "Quick note: great meeting, follow up next week." }), roster, OWNER);
    assert.equal(r.mode, "log");
    assert.equal(r.forced, null);
  });

  test("#intake forces intake even for a known person; #log forces log", () => {
    const a = routeEmail(email({ subject: "#intake Fwd: hi", from: "jane@acme.example" }), roster, OWNER);
    assert.equal(a.mode, "intake");
    assert.equal(a.forced, "intake");
    const b = routeEmail(email({ subject: "Fwd: hi #log", body: "From: Bob <bob@x.example>" }), roster, OWNER);
    assert.equal(b.mode, "log");
    assert.equal(b.forced, "log");
  });
});

describe("draft inputs", () => {
  test("logInputFor carries the retrieval-step header shape", () => {
    const text = logInputFor(email({ subject: "Fwd: catch-up", body: "hello" }), "2026-09-21");
    assert.match(text, /^TITLE: catch-up\nDATE: 2026-09-21\nPARTICIPANTS: .*\nSOURCE: .*\nCONTENT:\nhello$/);
  });

  test("intakeInputFor names the person and lists the others as context, minus the owner", () => {
    const e = email({ body: "From: Bob Smith <bob@x.example>\nCc: Jane Doe <jane@acme.example>, owner@firm.example\n\nhi" });
    const text = intakeInputFor(e, { name: "Bob Smith", email: "bob@x.example" }, null, OWNER);
    assert.match(text, /^THIS INTAKE IS FOR: Bob Smith <bob@x.example>\n/);
    assert.match(text, /Others on the email .*Jane Doe <jane@acme.example>/);
    assert.doesNotMatch(text, /Others on the email .*owner@firm.example/);
  });
});

describe("primaryParticipant", () => {
  test("prefers the forwarded message's sender", () => {
    const e = email({
      from: "Owner <owner@example.com>",
      body: "FYI\n\n---------- Forwarded message ---------\nFrom: Bob Smith <bob@x.example>\nTo: Ann Lee <ann@y.example>\nCc: Cal <cal@z.example>\n",
    });
    const unknown = participantsOf(e, OWNER);
    assert.equal(primaryParticipant(e, unknown)?.email, "bob@x.example");
  });

  test("falls back to the email's own sender, then the first unknown", () => {
    const direct = email({ from: "Ann Lee <ann@y.example>", to: ["owner+crm@example.com", "cal@z.example"] });
    assert.equal(primaryParticipant(direct, participantsOf(direct, OWNER))?.email, "ann@y.example");
    const none = email({ body: "To: cal@z.example, dee@z.example" });
    assert.equal(primaryParticipant(none, participantsOf(none, OWNER))?.email, "cal@z.example");
    assert.equal(primaryParticipant(none, []), null);
  });
});

describe("sentByOwner", () => {
  test("accepts the owner's addresses, any plus-tag, any case, with or without a display name", () => {
    assert.equal(sentByOwner({ from: "Owner <owner@example.com>" }, OWNER), true);
    assert.equal(sentByOwner({ from: "owner+anything@Example.com" }, OWNER), true);
    assert.equal(sentByOwner({ from: "\"Owner at Firm\" <OWNER@firm.example>" }, OWNER), true);
  });
  test("rejects anyone else, including a stranger writing to the CRM address", () => {
    assert.equal(sentByOwner({ from: "Jane Doe <jane@acme.example>" }, OWNER), false);
    assert.equal(sentByOwner({ from: "owner@example.com.evil.example" }, OWNER), false);
    assert.equal(sentByOwner({ from: "notowner@example.com" }, OWNER), false);
  });
  test("judges only the real sender, not a name or address that merely looks like the owner's", () => {
    assert.equal(sentByOwner({ from: "owner@example.com <jane@acme.example>" }, OWNER), false);
  });
  test("rejects an empty or unparseable From, and accepts nobody when no owner address is known", () => {
    assert.equal(sentByOwner({ from: "" }, OWNER), false);
    assert.equal(sentByOwner({ from: "Owner" }, OWNER), false);
    assert.equal(sentByOwner({ from: "owner@example.com" }, ["", "  "]), false);
  });
});


describe("inboxCheckDue", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const due = (lastAttempt: number | null, lastActive: number | null, pollMinutes = 30) =>
    inboxCheckDue({
      now,
      lastAttemptAt: lastAttempt === null ? null : ago(lastAttempt),
      lastActiveAt: lastActive === null ? null : ago(lastActive),
      pollMinutes,
    });

  test("the first check runs straight away", () => {
    assert.equal(due(null, null), true);
  });

  test("while the owner is using the app, it keeps their chosen pace", () => {
    assert.equal(due(29, 1), false);
    assert.equal(due(30, 1), true);
    assert.equal(due(10, 1, 10), true);
  });

  test("while they're away, it slows to the away pace", () => {
    const away = INBOX_ACTIVE_WINDOW_MINUTES + 1;
    assert.equal(due(30, away), false);
    assert.equal(due(INBOX_AWAY_POLL_MINUTES - 1, away), false);
    assert.equal(due(INBOX_AWAY_POLL_MINUTES, away), true);
  });

  test("with no activity on record, it counts as away", () => {
    assert.equal(due(30, null), false);
    assert.equal(due(INBOX_AWAY_POLL_MINUTES, null), true);
  });

  test("coming back after a while triggers a check right away", () => {
    assert.equal(due(INBOX_AWAY_POLL_MINUTES - 60, 0), true);
  });

  test("a chosen pace slower than the away pace is honoured both ways", () => {
    assert.equal(due(INBOX_AWAY_POLL_MINUTES, 1, 600), false);
    assert.equal(due(INBOX_AWAY_POLL_MINUTES, null, 600), false);
    assert.equal(due(600, null, 600), true);
  });

  test("a follow-up a full check asked for is due from its time, even while away", () => {
    const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
    const base = { now, lastAttemptAt: ago(1), lastActiveAt: null, pollMinutes: 30 };
    assert.equal(inboxCheckDue({ ...base, followUpAt: at(2) }), false);
    assert.equal(inboxCheckDue({ ...base, followUpAt: at(-1) }), true);
    assert.equal(inboxCheckDue({ ...base, followUpAt: "garbage" }), false);
  });

  test("an unreadable timestamp doesn't stop the checks", () => {
    assert.equal(inboxCheckDue({ now, lastAttemptAt: "garbage", lastActiveAt: "garbage", pollMinutes: 30 }), true);
  });
});

describe("routing people the roster knows by name", () => {
  test("someone matched by name isn't also drafted as new, even with a different address", () => {
    const r = routeEmail(email({ body: "From: Sam Lee <sam@new.example>\nTo: owner@firm.example\n\nHello again." }), roster, OWNER);
    assert.equal(r.mode, "log");
    assert.deepEqual(r.known.map((k) => k.slug), ["sam-lee"]);
    assert.deepEqual(r.unknown, []);
  });

  test("a re-route chosen by hand beats a tag in the subject", () => {
    const r = routeEmail(email({ subject: "#intake Fwd: hi", body: "From: Bob <bob@x.example>" }), roster, OWNER, "log");
    assert.equal(r.mode, "log");
    assert.equal(r.forced, "log");
  });
});
