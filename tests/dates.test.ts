import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isIsoDate, parseDueDate, splitLastTouch, todayLocal } from "../lib/dates.mjs";

const BASE = "2026-07-17"; // a Friday in mid-July; every relative case below is anchored here

describe("parseDueDate", () => {
  test("ISO dates are taken verbatim, even inside a phrase", () => {
    assert.equal(parseDueDate("2026-06-27", BASE), "2026-06-27");
    assert.equal(parseDueDate("by 2026-06-27", BASE), "2026-06-27");
    assert.equal(parseDueDate("  2026-12-01 latest ", BASE), "2026-12-01");
  });

  test("weekday + numeric month/day: 'Fri 7/25'", () => {
    assert.equal(parseDueDate("Fri 7/25", BASE), "2026-07-25");
  });

  test("approximate numeric label: '~07-22'", () => {
    assert.equal(parseDueDate("~07-22", BASE), "2026-07-22");
  });

  test("month-name labels in either order", () => {
    assert.equal(parseDueDate("Aug 31", BASE), "2026-08-31");
    assert.equal(parseDueDate("31 Aug", BASE), "2026-08-31");
    assert.equal(parseDueDate("by August 3", BASE), "2026-08-03");
    assert.equal(parseDueDate("3 sept.", BASE), "2026-09-03");
  });

  test("month/day more than 45 days in the past rolls into next year", () => {
    assert.equal(parseDueDate("01-15", BASE), "2027-01-15"); // ~183 days back → next year
    assert.equal(parseDueDate("May 1", BASE), "2027-05-01"); // 77 days back → next year
  });

  test("month/day within the last 45 days keeps the base year", () => {
    assert.equal(parseDueDate("07-01", BASE), "2026-07-01"); // 16 days back
    assert.equal(parseDueDate("Jun 10", BASE), "2026-06-10"); // 37 days back
  });

  test("impossible calendar dates are rejected", () => {
    assert.equal(parseDueDate("02-30", BASE), null);
    assert.equal(parseDueDate("2026-02-30", BASE), null);
    assert.equal(parseDueDate("13/05", BASE), null);
  });

  test("vague labels and empty input give null", () => {
    assert.equal(parseDueDate("ASAP", BASE), null);
    assert.equal(parseDueDate("late summer", BASE), null);
    assert.equal(parseDueDate("", BASE), null);
    assert.equal(parseDueDate(null, BASE), null);
    assert.equal(parseDueDate(undefined, BASE), null);
  });

  test("falls back to today when the base is not an ISO date", () => {
    const year = new Date().getFullYear();
    const out = parseDueDate("Dec 31", "not-a-date");
    assert.ok(out === `${year}-12-31` || out === `${year + 1}-12-31`);
  });
});

describe("splitLastTouch", () => {
  test("date followed by a parenthesised qualifier", () => {
    assert.deepEqual(splitLastTouch("2026-06-23 (phone catch-up)"), { date: "2026-06-23", note: "phone catch-up" });
  });

  test("date with dash / colon separators", () => {
    assert.deepEqual(splitLastTouch("2026-06-23 — coffee"), { date: "2026-06-23", note: "coffee" });
    assert.deepEqual(splitLastTouch("2026-06-23: intro call"), { date: "2026-06-23", note: "intro call" });
  });

  test("bare ISO date has no note", () => {
    assert.deepEqual(splitLastTouch("2026-07-15"), { date: "2026-07-15", note: null });
  });

  test("free text becomes a note with no date", () => {
    assert.deepEqual(splitLastTouch("recent call"), { date: null, note: "recent call" });
  });

  test("empty / null values", () => {
    assert.deepEqual(splitLastTouch(null), { date: null, note: null });
    assert.deepEqual(splitLastTouch(undefined), { date: null, note: null });
    assert.deepEqual(splitLastTouch("   "), { date: null, note: null });
  });
});

describe("todayLocal / isIsoDate", () => {
  test("todayLocal is YYYY-MM-DD in local time", () => {
    assert.match(todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(todayLocal(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
    assert.equal(todayLocal(new Date(2026, 11, 31, 0, 1)), "2026-12-31");
  });

  test("isIsoDate", () => {
    assert.equal(isIsoDate("2026-07-17"), true);
    assert.equal(isIsoDate("2026-7-17"), false);
    assert.equal(isIsoDate("2026-13-01"), false);
    assert.equal(isIsoDate(null), false);
    assert.equal(isIsoDate(20260717), false);
  });
});
