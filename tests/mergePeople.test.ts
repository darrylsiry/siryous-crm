import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
// Must come first: points CRM_DB_PATH at a temp file before anything loads lib/db.
import { tmp } from "./helpers/tempdb";
import { openDatabase } from "../lib/schema.mjs";
import { MergeError, mergePeople } from "../lib/mergePeople";

after(() => tmp.cleanup());

/** A fresh database per test, so fixtures never leak between cases. */
let n = 0;
function freshDb(): Database.Database {
  return openDatabase(Database, path.join(tmp.dir, `merge-${++n}.db`)) as Database.Database;
}

function addPerson(db: Database.Database, slug: string, fields: Record<string, string | number | null> = {}): number {
  const cols = ["slug", "name", ...Object.keys(fields)];
  const r = db
    .prepare(`INSERT INTO people (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`)
    .run({ slug, name: slug, ...fields });
  return Number(r.lastInsertRowid);
}

const count = (db: Database.Database, sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

describe("mergePeople: profile and attached records", () => {
  test("moves interactions and action items, unions tags, newer status wins, appends narrative, deletes the duplicate", () => {
    const db = freshDb();
    try {
      const keep = addPerson(db, "alex-rivera", {
        status_key: "active",
        status_note: "old note",
        last_touch: "2026-03-01",
        tags: "investor, board",
        email: "",
        relationship_intel: "Met at a trade show.",
      });
      const dup = addPerson(db, "alex-rivera-2", {
        status_key: "warm",
        status_note: "new note",
        last_touch: "2026-06-15",
        tags: "board,advisor",
        email: "alex@example.com",
        phone: "555-0100",
        relationship_intel: "Introduced by a mutual friend.",
        notes: "Prefers mornings.",
      });
      db.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, '2026-06-15', 'coffee')`).run(dup);
      db.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, '2026-03-01', 'intro call')`).run(keep);
      db.prepare(`INSERT INTO action_items (title, person_id) VALUES ('send deck', ?)`).run(dup);
      db.prepare(`INSERT INTO section_history (entity, entity_id, section, value) VALUES ('person', ?, 'notes', 'old text')`).run(dup);

      const res = mergePeople(db, "alex-rivera-2", "alex-rivera");
      assert.equal(res.dryRun, false);
      assert.ok(res.receipt.includes("interactions.person_id: moved 1"));
      assert.ok(res.receipt.includes("action_items.person_id: moved 1"));
      // Section history has no foreign key, so it is moved by hand (CR-052).
      assert.ok(res.receipt.includes("section_history: moved 1"));
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM section_history WHERE entity='person' AND entity_id=?`, keep), 1);

      assert.equal(count(db, `SELECT COUNT(*) AS n FROM people WHERE id=?`, dup), 0);
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM interactions WHERE person_id=?`, keep), 2);
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM action_items WHERE person_id=?`, keep), 1);

      const p = db.prepare(`SELECT * FROM people WHERE id=?`).get(keep) as Record<string, string | null>;
      assert.equal(p.tags, "investor,board,advisor");
      assert.equal(p.status_key, "warm");
      assert.equal(p.status_note, "new note");
      assert.equal(p.last_touch, "2026-06-15");
      assert.equal(p.email, "alex@example.com"); // empty on the kept profile, so filled
      assert.equal(p.phone, "555-0100");
      assert.match(p.relationship_intel!, /^Met at a trade show\.\n\n---\n_Merged from duplicate profile `alex-rivera-2` \(created .+\):_\n\nIntroduced by a mutual friend\.$/);
      assert.equal(p.notes, "Prefers mornings."); // nothing to append to
    } finally {
      db.close();
    }
  });

  test("the kept profile's status stays when it was touched more recently; its scalars win", () => {
    const db = freshDb();
    try {
      const keep = addPerson(db, "jordan-blake", { status_key: "active", last_touch: "2026-07-01", email: "jordan@example.com" });
      addPerson(db, "jordan-blake-2", { status_key: "lost", last_touch: "2026-01-01", email: "old@example.com" });
      mergePeople(db, "jordan-blake-2", "jordan-blake");
      const p = db.prepare(`SELECT status_key, last_touch, email FROM people WHERE id=?`).get(keep);
      assert.deepEqual(p, { status_key: "active", last_touch: "2026-07-01", email: "jordan@example.com" });
    } finally {
      db.close();
    }
  });

  test("the later imported connected-on date is kept as the last-touch floor", () => {
    const db = freshDb();
    try {
      const keep = addPerson(db, "kim-ray", { connected_on: "2025-03-01" });
      addPerson(db, "kim-ray-2", { connected_on: "2025-09-01" });
      mergePeople(db, "kim-ray-2", "kim-ray");
      assert.equal((db.prepare(`SELECT connected_on FROM people WHERE id=?`).get(keep) as { connected_on: string }).connected_on, "2025-09-01");
    } finally {
      db.close();
    }
  });
});

describe("mergePeople: connections", () => {
  test("cleans up only the kept person's links: self-links dropped, duplicate pairs collapsed with labels combined", () => {
    const db = freshDb();
    try {
      const keep = addPerson(db, "casey-morgan");
      const dup = addPerson(db, "casey-morgan-2");
      const friend = addPerson(db, "riley-chen");
      const other = addPerson(db, "sam-patel");
      const third = addPerson(db, "taylor-kim");
      const conn = db.prepare(`INSERT INTO connections (from_person_id, to_person_id, label) VALUES (?, ?, ?)`);

      conn.run(keep, friend, "former colleague");
      conn.run(dup, friend, "conference intro");
      conn.run(friend, dup, "mentor"); // other direction: a different pair, just re-pointed
      conn.run(keep, third, "neighbour");
      conn.run(dup, third, "Neighbour"); // same label, different case
      conn.run(dup, keep, "same person"); // becomes keep→keep
      // Unrelated to the merge: must survive untouched, duplicates and all.
      conn.run(friend, other, "classmate");
      conn.run(friend, other, "co-founder");
      conn.run(other, other, "odd self-link");

      const res = mergePeople(db, "casey-morgan-2", "casey-morgan");
      assert.ok(res.receipt.includes("connections: dropped 1 self-link(s)"));
      assert.ok(res.receipt.includes("connections: dropped 2 duplicate pair(s)"));
      assert.ok(res.receipt.includes("connections: combined labels on 1 pair(s)"));

      const rows = db.prepare(`SELECT from_person_id AS f, to_person_id AS t, label FROM connections ORDER BY id`).all();
      assert.deepEqual(rows, [
        { f: keep, t: friend, label: "former colleague; conference intro" },
        { f: friend, t: keep, label: "mentor" },
        { f: keep, t: third, label: "neighbour" },
        { f: friend, t: other, label: "classmate" },
        { f: friend, t: other, label: "co-founder" },
        { f: other, t: other, label: "odd self-link" },
      ]);
    } finally {
      db.close();
    }
  });
});

describe("mergePeople: slug references", () => {
  test("rewrites News Feed refs (de-duplicated) and Coach proposals; leaves others alone", () => {
    const db = freshDb();
    try {
      addPerson(db, "morgan-lee");
      addPerson(db, "morgan-lee-2");
      addPerson(db, "morgan-lee-20"); // a slug that merely starts with the duplicate's
      const news = db.prepare(`INSERT INTO news_items (url, url_key, headline, headline_key, about) VALUES (?, ?, 'h', 'h', ?)`);
      const both = Number(news.run("https://a", "a", JSON.stringify(["p:morgan-lee", "c:acme", "p:morgan-lee-2"])).lastInsertRowid);
      const onlyDup = Number(news.run("https://b", "b", JSON.stringify(["p:morgan-lee-2"])).lastInsertRowid);
      const unrelated = Number(news.run("https://c", "c", JSON.stringify(["p:morgan-lee-20", "c:morgan-lee-2"])).lastInsertRowid);

      const session = Number(db.prepare(`INSERT INTO coach_sessions (week_start) VALUES ('2026-07-13')`).run().lastInsertRowid);
      const prop = db.prepare(`INSERT INTO coach_proposals (session_id, kind, title, person_slug) VALUES (?, 'new_action', 't', ?)`);
      const pending = Number(prop.run(session, "morgan-lee-2").lastInsertRowid);
      const other = Number(prop.run(session, "morgan-lee-20").lastInsertRowid);

      const res = mergePeople(db, "morgan-lee-2", "morgan-lee");
      assert.ok(res.receipt.includes("news_items.about: moved 2"));
      assert.ok(res.receipt.includes("coach_proposals.person_slug: moved 1"));

      const about = (id: number) => JSON.parse((db.prepare(`SELECT about FROM news_items WHERE id=?`).get(id) as { about: string }).about);
      assert.deepEqual(about(both), ["p:morgan-lee", "c:acme"]);
      assert.deepEqual(about(onlyDup), ["p:morgan-lee"]);
      assert.deepEqual(about(unrelated), ["p:morgan-lee-20", "c:morgan-lee-2"]);

      const slug = (id: number) => (db.prepare(`SELECT person_slug FROM coach_proposals WHERE id=?`).get(id) as { person_slug: string }).person_slug;
      assert.equal(slug(pending), "morgan-lee");
      assert.equal(slug(other), "morgan-lee-20");
    } finally {
      db.close();
    }
  });
});

describe("mergePeople: dry run and errors", () => {
  test("a dry run reports the same plan and changes nothing", () => {
    const db = freshDb();
    try {
      const keep = addPerson(db, "jamie-ortiz", { tags: "a" });
      const dup = addPerson(db, "jamie-ortiz-2", { tags: "b" });
      db.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, '2026-05-01', 'call')`).run(dup);
      db.prepare(`INSERT INTO connections (from_person_id, to_person_id) VALUES (?, ?)`).run(dup, keep);

      const snapshot = () => ({
        people: db.prepare(`SELECT * FROM people ORDER BY id`).all(),
        interactions: db.prepare(`SELECT * FROM interactions ORDER BY id`).all(),
        connections: db.prepare(`SELECT * FROM connections ORDER BY id`).all(),
      });
      const before = snapshot();
      const res = mergePeople(db, "jamie-ortiz-2", "jamie-ortiz", { dryRun: true });
      assert.equal(res.dryRun, true);
      assert.ok(res.receipt.includes("interactions.person_id: moved 1"));
      assert.ok(res.receipt.includes("connections: dropped 1 self-link(s)"));
      assert.ok(res.receipt.some((l) => l.startsWith("people[jamie-ortiz-2]")));
      assert.deepEqual(snapshot(), before);
    } finally {
      db.close();
    }
  });

  test("unknown or identical slugs throw a MergeError", () => {
    const db = freshDb();
    try {
      addPerson(db, "drew-silva");
      assert.throws(() => mergePeople(db, "nobody", "drew-silva"), (e) => e instanceof MergeError && /'nobody'/.test(e.message));
      assert.throws(() => mergePeople(db, "drew-silva", "nobody"), MergeError);
      assert.throws(() => mergePeople(db, "drew-silva", "drew-silva"), MergeError);
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM people`), 1);
    } finally {
      db.close();
    }
  });
});
