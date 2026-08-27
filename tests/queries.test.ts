import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
// Must come first: points CRM_DB_PATH at a temp file before lib/db is loaded.
import { tmp } from "./helpers/tempdb";
import { getDb } from "../lib/db";
import { openActionItems, doneActionItems, followUps, dueForTouch } from "../lib/queries";
import { todayLocal } from "../lib/dates.mjs";

function isoDaysFromToday(delta: number): string {
  const d = new Date(todayLocal() + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return todayLocal(d);
}

const ids: Record<string, number> = {};

before(() => {
  const db = getDb();
  db.prepare(`INSERT INTO companies (slug, name) VALUES ('acme', 'Acme')`).run();
  const acme = (db.prepare(`SELECT id FROM companies WHERE slug='acme'`).get() as { id: number }).id;

  const person = db.prepare(`INSERT INTO people (slug, name, status_key, company_id, cadence_days, last_touch) VALUES (?, ?, ?, ?, ?, ?)`);
  const p = (slug: string, status: string, cadence: number | null, lastTouch: string | null, company: number | null = null) => {
    const r = person.run(slug, slug, status, company, cadence, lastTouch);
    ids[slug] = Number(r.lastInsertRowid);
  };
  p("overdue-touch", "active", 30, isoDaysFromToday(-40), acme); // 10 days over
  p("fresh-touch", "active", 30, isoDaysFromToday(-5)); // 25 days to go
  p("never-touched", "new", 21, null); // has a cadence, no touch → 9999
  p("no-cadence", "exploring", null, isoDaysFromToday(-400)); // no cadence → null
  p("lost-contact", "lost", 7, isoDaysFromToday(-100)); // excluded entirely

  const item = db.prepare(`INSERT INTO action_items (title, bucket, due_date, status, person_id, company_id) VALUES (?, ?, ?, ?, ?, ?)`);
  const a = (title: string, bucket: string, due: string | null, status = "open", personId: number | null = null, companyId: number | null = null) => {
    const r = item.run(title, bucket, due, status, personId, companyId);
    ids[title] = Number(r.lastInsertRowid);
  };
  a("past-this-week", "this_week", isoDaysFromToday(-3), "open", ids["overdue-touch"], acme);
  a("past-keep-warm", "keep_warm", isoDaysFromToday(-1));
  a("today", "this_week", isoDaysFromToday(0));
  a("future", "this_week", isoDaysFromToday(10));
  a("undated-awaiting", "awaiting", null);
  a("filed-overdue", "overdue", null);
  a("done-past", "this_week", isoDaysFromToday(-30), "done");
});

after(() => {
  getDb().close();
  tmp.cleanup();
});

describe("openActionItems", () => {
  test("effective bucket: a passed due date is overdue whatever it was filed under", () => {
    const rows = openActionItems();
    const by = Object.fromEntries(rows.map((r) => [r.title, r]));

    assert.equal(by["past-this-week"].bucket, "overdue");
    assert.equal(by["past-this-week"].bucket_raw, "this_week");
    assert.equal(by["past-keep-warm"].bucket, "overdue");
    assert.equal(by["past-keep-warm"].bucket_raw, "keep_warm");

    // Due today is not yet overdue; future and undated items keep their bucket.
    assert.equal(by["today"].bucket, "this_week");
    assert.equal(by["future"].bucket, "this_week");
    assert.equal(by["undated-awaiting"].bucket, "awaiting");
    assert.equal(by["filed-overdue"].bucket, "overdue");
    assert.equal(by["filed-overdue"].bucket_raw, "overdue");
  });

  test("only open items, dated first (ascending), undated last", () => {
    const rows = openActionItems();
    assert.ok(!rows.some((r) => r.title === "done-past"));
    assert.deepEqual(
      rows.map((r) => r.title),
      ["past-this-week", "past-keep-warm", "today", "future", "undated-awaiting", "filed-overdue"]
    );
  });

  test("joins person and company names", () => {
    const row = openActionItems().find((r) => r.title === "past-this-week")!;
    assert.equal(row.person_slug, "overdue-touch");
    assert.equal(row.person_name, "overdue-touch");
    assert.equal(row.company_slug, "acme");
    assert.equal(row.company_name, "Acme");
    const bare = openActionItems().find((r) => r.title === "today")!;
    assert.equal(bare.person_slug, null);
    assert.equal(bare.company_name, null);
  });

  test("doneActionItems lists the completed ones", () => {
    assert.deepEqual(
      doneActionItems().map((r) => r.title),
      ["done-past"]
    );
  });
});

describe("followUps", () => {
  test("scores days over cadence and excludes lost contacts", () => {
    const rows = followUps();
    const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
    assert.equal("lost-contact" in by, false);

    assert.equal(by["overdue-touch"].days_since, 40);
    assert.equal(by["overdue-touch"].days_over, 10);
    assert.equal(by["overdue-touch"].company_name, "Acme");

    assert.equal(by["fresh-touch"].days_over, -25);
    assert.equal(by["never-touched"].days_since, null);
    assert.equal(by["never-touched"].days_over, 9999);
    assert.equal(by["no-cadence"].days_since, 400);
    assert.equal(by["no-cadence"].days_over, null);
  });

  test("sorted most-overdue first, people without a cadence last", () => {
    assert.deepEqual(
      followUps().map((r) => r.slug),
      ["never-touched", "overdue-touch", "fresh-touch", "no-cadence"]
    );
  });

  test("dueForTouch keeps only positive days_over, capped by limit", () => {
    assert.deepEqual(
      dueForTouch().map((r) => r.slug),
      ["never-touched", "overdue-touch"]
    );
    assert.deepEqual(
      dueForTouch(1).map((r) => r.slug),
      ["never-touched"]
    );
  });
});
