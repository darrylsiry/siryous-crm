import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSubject,
  intakeInputFor,
  logInputFor,
  participantsOf,
  routeEmail,
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
