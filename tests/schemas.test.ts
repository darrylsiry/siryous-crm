import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CoachCloseSchema,
  CoachTurnSchema,
  IntakeAnalysisSchema,
  LogAnalysisSchema,
  PrepResearchSchema,
  validateModelJson,
} from "../lib/schemas";

describe("IntakeAnalysisSchema", () => {
  test("a bare person name is enough; every list and string gets a safe default", () => {
    const out = IntakeAnalysisSchema.parse({ person: { name: "Sam Lee" } });
    assert.equal(out.person.name, "Sam Lee");
    assert.equal(out.person.role_title, null);
    assert.equal(out.person.new_company, null);
    assert.equal(out.person.status_suggestion, "new");
    assert.equal(out.person.tags, null);
    assert.equal(out.person.cadence_days, null);
    assert.deepEqual(out.connections, []);
    assert.deepEqual(out.suggested_actions, []);
    assert.equal(out.interaction, null);
    assert.equal(out.summary_md, "");
    assert.deepEqual(out.confidence_flags, []);
  });

  test("coercions: lone string → [string], numeric strings, tag arrays, whitespace-trimmed name", () => {
    const out = IntakeAnalysisSchema.parse({
      person: {
        name: "  Sam Lee  ",
        cadence_days: "30 days",
        tags: ["insurer", "ai", ""],
        status_suggestion: " Active ",
        role_title: 42,
        location: { city: "x" }, // not a string → null
      },
      confidence_flags: "no email found",
    });
    assert.equal(out.person.name, "Sam Lee");
    assert.equal(out.person.cadence_days, 30);
    assert.equal(out.person.tags, "insurer, ai");
    assert.equal(out.person.status_suggestion, "active");
    assert.equal(out.person.role_title, "42");
    assert.equal(out.person.location, null);
    assert.deepEqual(out.confidence_flags, ["no email found"]);
  });

  test("malformed list items are dropped rather than failing the whole response", () => {
    const out = IntakeAnalysisSchema.parse({
      person: { name: "Sam Lee" },
      connections: [
        { person_slug: "a-b", label: "colleague" },
        { label: "missing slug" },
        "just a string",
        null,
      ],
      suggested_actions: [{ title: "Send deck" }, { bucket: "this_week" }],
    });
    assert.deepEqual(out.connections, [{ person_slug: "a-b", label: "colleague", reason: "" }]);
    assert.deepEqual(out.suggested_actions, [{ title: "Send deck", bucket: "this_week", due: null }]);
  });

  test("unknown keys are stripped", () => {
    const out = IntakeAnalysisSchema.parse({
      person: { name: "Sam Lee", favourite_colour: "blue" },
      hallucinated: true,
    }) as Record<string, unknown>;
    assert.equal("hallucinated" in out, false);
    assert.equal("favourite_colour" in (out.person as object), false);
  });

  test("nested company and interaction objects; non-objects become null", () => {
    const withCompany = IntakeAnalysisSchema.parse({
      person: { name: "Sam Lee", new_company: { name: "Acme", industry: "Insurance" } },
      interaction: { summary_md: "Intro call", date: "2026-07-01" },
    });
    assert.equal(withCompany.person.new_company?.name, "Acme");
    assert.equal(withCompany.person.new_company?.website, null);
    assert.equal(withCompany.interaction?.summary_md, "Intro call");
    assert.equal(withCompany.interaction?.channel, null);

    const junk = IntakeAnalysisSchema.parse({
      person: { name: "Sam Lee", new_company: "Acme" },
      interaction: ["nope"],
    });
    assert.equal(junk.person.new_company, null);
    assert.equal(junk.interaction, null);
  });

  test("fails without a person name, and the message names the field", () => {
    assert.equal(IntakeAnalysisSchema.safeParse({ person: {} }).success, false);
    assert.equal(IntakeAnalysisSchema.safeParse({ person: { name: "   " } }).success, false);
    assert.throws(
      () => validateModelJson(IntakeAnalysisSchema, { person: { role_title: "CEO" } }, '{"person":{"role_title":"CEO"}}'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /person\.name/);
        assert.match(err.message, /Raw start: \{"person"/);
        return true;
      }
    );
  });
});

describe("LogAnalysisSchema", () => {
  test("missing meeting and lists default; ids tolerate '#12' strings", () => {
    const out = LogAnalysisSchema.parse({ resolves_action_ids: ["#12", 7, "x", 0, -3, "4.5"] });
    assert.deepEqual(out.meeting, { date: null, channel: null, title: null });
    assert.deepEqual(out.entries, []);
    assert.deepEqual(out.unmatched_participants, []);
    assert.deepEqual(out.resolves_action_ids, [12, 7, 45]);
    assert.equal(out.summary_md, "");
  });

  test("meeting that is not an object is replaced with an empty one", () => {
    const out = LogAnalysisSchema.parse({ meeting: "Tuesday" });
    assert.deepEqual(out.meeting, { date: null, channel: null, title: null });
  });

  test("entries need a person_slug and a summary; the rest are dropped", () => {
    const out = LogAnalysisSchema.parse({
      entries: [
        { person_slug: "sam-lee", summary_md: "Talked pricing" },
        { person_slug: "sam-lee" },
        { summary_md: "no slug" },
      ],
      unmatched_participants: "Unknown caller",
      resolves_action_ids: "3",
    });
    assert.deepEqual(out.entries, [{ person_slug: "sam-lee", summary_md: "Talked pricing", next_action: null }]);
    assert.deepEqual(out.unmatched_participants, ["Unknown caller"]);
    assert.deepEqual(out.resolves_action_ids, [3]);
  });
});

describe("PrepResearchSchema", () => {
  test("defaults and attendee coercion", () => {
    const empty = PrepResearchSchema.parse({});
    assert.deepEqual(empty, { person_slug: null, meeting: null, whats_changed_md: "", confidence_flags: [] });

    const out = PrepResearchSchema.parse({ meeting: { title: "Catch-up", attendees: "Sam Lee" }, whats_changed_md: 7 });
    assert.deepEqual(out.meeting, { date: null, time: null, title: "Catch-up", attendees: ["Sam Lee"] });
    assert.equal(out.whats_changed_md, "7");
  });
});

describe("Coach schemas", () => {
  test("turn: reply with defaults; new_actions drop malformed items", () => {
    const out = CoachTurnSchema.parse({
      reply_md: "Do the thing",
      completed_action_ids: null,
      new_actions: [{ title: "Call Sam", due_label: "Fri" }, { bucket: "keep_warm" }],
    });
    assert.equal(out.reply_md, "Do the thing");
    assert.deepEqual(out.completed_action_ids, []);
    assert.deepEqual(out.new_actions, [{ title: "Call Sam", bucket: "this_week", due_label: "Fri", person_slug: null }]);
  });

  test("turn: empty reply fails and the message names reply_md", () => {
    assert.equal(CoachTurnSchema.safeParse({ reply_md: "" }).success, false);
    assert.equal(CoachTurnSchema.safeParse({}).success, false);
    assert.throws(
      () => validateModelJson(CoachTurnSchema, { reply_md: "" }, '{"reply_md":""}'),
      (err: unknown) => err instanceof Error && /(^|[^.\w])reply_md:/.test(err.message)
    );
  });

  test("close: summary required", () => {
    assert.equal(CoachCloseSchema.parse({ summary_md: "Done" }).summary_md, "Done");
    assert.throws(
      () => validateModelJson(CoachCloseSchema, { summary_md: null }, "null"),
      (err: unknown) => err instanceof Error && /summary_md/.test(err.message)
    );
  });
});

describe("validateModelJson", () => {
  test("returns the coerced value on success", () => {
    const out = validateModelJson(CoachTurnSchema, { reply_md: "ok", completed_action_ids: ["#2"] }, "…");
    assert.deepEqual(out, { reply_md: "ok", completed_action_ids: [2], new_actions: [] });
  });

  test("collapses whitespace in the quoted raw text and caps it at 300 chars", () => {
    const raw = "{\n  \"reply_md\": \"\"" + " ".repeat(400) + "}";
    assert.throws(
      () => validateModelJson(CoachTurnSchema, { reply_md: "" }, raw),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const quoted = err.message.split("Raw start: ")[1];
        assert.ok(quoted.length <= 300);
        assert.doesNotMatch(quoted, /\n/);
        return true;
      }
    );
  });
});
