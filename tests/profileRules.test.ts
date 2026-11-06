import { tmp } from "./helpers/tempdb";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { getDb } from "../lib/db";
import {
  createCompany,
  createPerson,
  deleteInteraction,
  deletePerson,
  setStatus,
  updateActionItem,
  updateSection,
  updateStatus,
} from "../lib/actions";
import { openActionItems, search } from "../lib/queries";
import { COMPANY_SEARCH_COLUMNS, PEOPLE_SEARCH_COLUMNS, likeAnySql, likeNeedle } from "../lib/rules.mjs";
import { importCsvText } from "../lib/importCsv";
import { slugFor, slugify } from "../lib/rules.mjs";
import { slugParam } from "../lib/slug";
import { openDatabase } from "../lib/schema.mjs";
import Markdown from "../components/Markdown";

after(() => tmp.cleanup());

const db = getDb();
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
/** Outside a request, Next's redirect/revalidate throw once the work is done: only the database matters here. */
const run = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch {
    /* redirect or revalidate after the write */
  }
};
const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;

describe("slugs for any name", () => {
  test("Latin names keep the slug they always had", () => {
    assert.equal(slugify("José Núñez"), "jose-nunez");
    assert.equal(slugify("Søren Kierkegaard"), "s-ren-kierkegaard");
  });

  test("a name with no Latin letters keeps its own script", () => {
    assert.equal(slugify("王小明"), "王小明");
    assert.equal(slugify("Алексей Петров"), "алексеи-петров");
    assert.equal(slugify("محمد علي"), "محمد-علي");
  });

  test("a name with no letters at all still gets a slug to store", () => {
    assert.equal(slugify("!!!"), "");
    assert.match(slugFor("!!!", "person"), /^person-[0-9a-f]{6}$/);
  });

  test("a percent-encoded route segment is decoded, a plain one left alone", () => {
    assert.equal(slugParam(encodeURIComponent("王小明")), "王小明");
    assert.equal(slugParam("sam-lee"), "sam-lee");
    assert.equal(slugParam("%E0%A4%A"), "%E0%A4%A");
  });

  test("two people with different non-Latin names get two working profiles", async () => {
    db.exec(`DELETE FROM people; DELETE FROM companies;`);
    await run(() => createPerson(form({ name: "王小明" })));
    await run(() => createPerson(form({ name: "李华" })));
    await run(() => createPerson(form({ name: "!!!" })));
    await run(() => createCompany(form({ name: "株式会社" })));
    const slugs = (db.prepare(`SELECT slug FROM people ORDER BY id`).all() as { slug: string }[]).map((r) => r.slug);
    assert.deepEqual(slugs.slice(0, 2), ["王小明", "李华"]);
    assert.match(slugs[2], /^person-/);
    assert.equal(one<{ slug: string }>(`SELECT slug FROM companies`).slug, "株式会社");
  });

  test("the CSV importer takes them too", () => {
    db.exec(`DELETE FROM people;`);
    const report = importCsvText(db, "Name,Company\n王小明,北京公司\nАлексей Петров,\n???,\n");
    assert.equal(report.created, 2);
    assert.match(report.errors[0].message, /no letters or digits/);
  });

  test("a stored empty slug is repaired when the database opens", () => {
    const file = path.join(tmp.dir, "empty-slug.db");
    const a = openDatabase(Database, file) as Database.Database;
    a.prepare(`INSERT INTO people (slug, name) VALUES ('', '王小明')`).run();
    a.close();
    const b = openDatabase(Database, file) as Database.Database;
    try {
      assert.match((b.prepare(`SELECT slug FROM people`).get() as { slug: string }).slug, /^person-1-[0-9a-f]{6}$/);
    } finally {
      b.close();
    }
  });

  test("profile links in notes work for any script", () => {
    const el = Markdown({ children: "See [Wang](../people/王小明.md) and [Acme](companies/acme.md)." }) as {
      props: { dangerouslySetInnerHTML: { __html: string } };
    };
    const html = el.props.dangerouslySetInnerHTML.__html;
    assert.match(html, new RegExp(`href="/people/${encodeURIComponent("王小明")}"`));
    assert.match(html, /href="\/companies\/acme"/);
  });
});

describe("cadence follows a status change", () => {
  let id = 0;
  beforeEach(() => {
    db.exec(`DELETE FROM people;`);
    id = Number(db.prepare(`INSERT INTO people (slug, name, status_key, cadence_days) VALUES ('sam', 'Sam', 'new', 21)`).run().lastInsertRowid);
  });
  const cadence = () => one<{ cadence_days: number | null }>(`SELECT cadence_days FROM people WHERE id=?`, id).cadence_days;

  test("the full status editor moves a default cadence to the new default", async () => {
    await run(() => updateStatus(form({ id: String(id), status_key: "dormant" })));
    assert.equal(cadence(), 180);
  });

  test("so does the status badge", async () => {
    await run(() => setStatus("person", id, "dormant", null));
    assert.equal(cadence(), 180);
  });

  test("a cadence set by hand stays", async () => {
    db.prepare(`UPDATE people SET cadence_days=10 WHERE id=?`).run(id);
    await run(() => setStatus("person", id, "dormant", null));
    assert.equal(cadence(), 10);
  });

  test("an unset cadence picks up the new default", async () => {
    db.prepare(`UPDATE people SET cadence_days=NULL WHERE id=?`).run(id);
    await run(() => updateStatus(form({ id: String(id), status_key: "client" })));
    assert.equal(cadence(), 14);
  });
});

describe("last touch after deletions", () => {
  beforeEach(() => db.exec(`DELETE FROM interactions; DELETE FROM people; DELETE FROM companies;`));

  test("an imported date comes back when a newer interaction is deleted", async () => {
    importCsvText(db, "Name,Connected On\nSam Lee,2026-03-01\n");
    const p = one<{ id: number; connected_on: string }>(`SELECT id, connected_on FROM people WHERE slug='sam-lee'`);
    assert.equal(p.connected_on, "2026-03-01");
    const i = Number(db.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, '2026-05-01', 'call')`).run(p.id).lastInsertRowid);
    db.prepare(`UPDATE people SET last_touch='2026-05-01' WHERE id=?`).run(p.id);
    await run(() => deleteInteraction(i));
    assert.equal(one<{ last_touch: string }>(`SELECT last_touch FROM people WHERE id=?`, p.id).last_touch, "2026-03-01");
  });

  test("deleting a person recomputes their company's last touch", async () => {
    const c = Number(db.prepare(`INSERT INTO companies (slug, name, last_touch) VALUES ('acme', 'Acme', '2026-06-01')`).run().lastInsertRowid);
    const a = Number(db.prepare(`INSERT INTO people (slug, name, company_id) VALUES ('a', 'A', ?)`).run(c).lastInsertRowid);
    const b = Number(db.prepare(`INSERT INTO people (slug, name, company_id) VALUES ('b', 'B', ?)`).run(c).lastInsertRowid);
    db.prepare(`INSERT INTO interactions (person_id, company_id, date, summary) VALUES (?, ?, '2026-06-01', 'newest')`).run(a, c);
    db.prepare(`INSERT INTO interactions (person_id, company_id, date, summary) VALUES (?, ?, '2026-04-01', 'older')`).run(b, c);
    await run(() => deletePerson(a));
    assert.equal(one<{ last_touch: string }>(`SELECT last_touch FROM companies WHERE id=?`, c).last_touch, "2026-04-01");
  });

  test("an existing last touch no interaction backs becomes the floor when the column is added", () => {
    const file = path.join(tmp.dir, "connected-on.db");
    const a = openDatabase(Database, file) as Database.Database;
    a.exec(`ALTER TABLE people DROP COLUMN connected_on`);
    a.prepare(`INSERT INTO people (slug, name, last_touch) VALUES ('imported', 'Imported', '2026-02-01')`).run();
    const logged = Number(a.prepare(`INSERT INTO people (slug, name, last_touch) VALUES ('logged', 'Logged', '2026-02-01')`).run().lastInsertRowid);
    a.prepare(`INSERT INTO interactions (person_id, date, summary) VALUES (?, '2026-02-01', 'call')`).run(logged);
    a.close();
    const b = openDatabase(Database, file) as Database.Database;
    try {
      const rows = b.prepare(`SELECT slug, connected_on FROM people ORDER BY slug`).all();
      assert.deepEqual(rows, [
        { slug: "imported", connected_on: "2026-02-01" },
        { slug: "logged", connected_on: null },
      ]);
    } finally {
      b.close();
    }
  });
});

describe("saving a profile section", () => {
  let id = 0;
  beforeEach(() => {
    db.exec(`DELETE FROM people;`);
    id = Number(
      db.prepare(`INSERT INTO people (slug, name, notes, updated_at) VALUES ('sam', 'Sam', 'Old notes', '2026-01-01 00:00:00')`).run().lastInsertRowid
    );
  });
  const save = (value: string, original = "Old notes") =>
    run(() =>
      updateSection(form({ entity: "person", id: String(id), column: "notes", value, original, updated_at: "2026-01-01 00:00:00" }))
    );
  const notes = () => one<{ notes: string | null }>(`SELECT notes FROM people WHERE id=?`, id).notes;

  test("a change elsewhere on the row (a last-touch bump) doesn't block it", async () => {
    db.prepare(`UPDATE people SET last_touch='2026-11-01', updated_at=datetime('now') WHERE id=?`).run(id);
    await save("New notes\r\nline two");
    assert.equal(notes(), "New notes\r\nline two");
  });

  test("a newer version of the same section is kept, with the typed text below it", async () => {
    db.prepare(`UPDATE people SET notes='Claude added this', updated_at=datetime('now') WHERE id=?`).run(id);
    await save("My long note");
    const kept = notes() ?? "";
    assert.ok(kept.startsWith("Claude added this"));
    assert.match(kept, /Your edit, kept below/);
    assert.ok(kept.endsWith("My long note"));
  });

  test("clearing a section that changed meanwhile is refused", async () => {
    db.prepare(`UPDATE people SET notes='Claude added this' WHERE id=?`).run(id);
    await save("");
    assert.equal(notes(), "Claude added this");
  });
});

describe("editing a to-do", () => {
  test("re-dating a late item takes it out of Overdue and keeps a free-text label until the date changes", async () => {
    db.exec(`DELETE FROM action_items;`);
    const id = Number(
      db.prepare(`INSERT INTO action_items (title, bucket, due_date, due_label) VALUES ('Send deck', 'this_week', '2020-01-01', 'early Jan')`).run()
        .lastInsertRowid
    );
    assert.equal(openActionItems()[0].bucket, "overdue");
    await run(() => updateActionItem(form({ id: String(id), title: "Send the deck", bucket: "this_week", due_date: "2020-01-01" })));
    assert.equal(one<{ due_label: string }>(`SELECT due_label FROM action_items WHERE id=?`, id).due_label, "early Jan");
    await run(() => updateActionItem(form({ id: String(id), title: "Send the deck", bucket: "awaiting", due_date: "2999-01-01" })));
    const item = openActionItems()[0];
    assert.equal(item.bucket, "awaiting");
    assert.equal(item.title, "Send the deck");
    assert.equal(item.due_label, "2999-01-01");
  });

  test("a bucket that doesn't exist and a blank title are ignored; a blank date clears it", async () => {
    db.exec(`DELETE FROM action_items;`);
    const id = Number(db.prepare(`INSERT INTO action_items (title, bucket, due_date) VALUES ('Call', 'this_week', '2026-01-01')`).run().lastInsertRowid);
    await run(() => updateActionItem(form({ id: String(id), title: " ", bucket: "nope", due_date: "" })));
    assert.deepEqual(db.prepare(`SELECT title, bucket, due_date FROM action_items WHERE id=?`).get(id), {
      title: "Call",
      bucket: "this_week",
      due_date: null,
    });
  });
});

describe("search", () => {
  test("finds a word in every column the owner types into", () => {
    db.exec(`DELETE FROM people; DELETE FROM companies;`);
    for (const col of PEOPLE_SEARCH_COLUMNS) {
      db.prepare(`INSERT INTO people (slug, name, ${col === "name" ? "role_title" : col}) VALUES (?, ?, ?)`).run(
        `p-${col}`,
        col === "name" ? `zq${col}zq` : `Person ${col}`,
        `zq${col}zq`
      );
    }
    for (const col of COMPANY_SEARCH_COLUMNS) {
      db.prepare(`INSERT INTO companies (slug, name, ${col === "name" ? "industry" : col}) VALUES (?, ?, ?)`).run(
        `c-${col}`,
        col === "name" ? `zq${col}zq` : `Company ${col}`,
        `zq${col}zq`
      );
    }
    for (const col of PEOPLE_SEARCH_COLUMNS) assert.ok(search(`zq${col}zq`).people.some((p) => p.slug === `p-${col}`), `people.${col}`);
    for (const col of COMPANY_SEARCH_COLUMNS) assert.ok(search(`zq${col}zq`).companies.some((c) => c.slug === `c-${col}`), `companies.${col}`);
  });

  test("%, _ and \\ match themselves, with the same rule the MCP server's search uses", () => {
    db.exec(`DELETE FROM people;`);
    db.prepare(`INSERT INTO people (slug, name, notes) VALUES ('a', 'A', 'grew 100% last year'), ('b', 'B', 'grew 1000 units'), ('c', 'C', 'file_name')`).run();
    assert.deepEqual(search("100%").people.map((p) => p.slug), ["a"]);
    assert.deepEqual(search("e_n").people.map((p) => p.slug), ["c"]);
    const mcpStyle = db.prepare(`SELECT slug FROM people WHERE ${likeAnySql(["notes"])} ORDER BY slug`).all(likeNeedle("100%"));
    assert.deepEqual(mcpStyle, [{ slug: "a" }]);
  });
});

describe("importing a CSV", () => {
  test("a dry run reports what would happen and writes nothing", () => {
    db.exec(`DELETE FROM people; DELETE FROM companies;`);
    const report = importCsvText(db, "Name,Company,Email\nSam Lee,Acme,sam@example.com\n", { dryRun: true });
    assert.equal(report.created, 1);
    assert.equal(report.createdCompanies, 1);
    assert.equal(one<{ n: number }>(`SELECT COUNT(*) n FROM people`).n, 0);
    assert.equal(one<{ n: number }>(`SELECT COUNT(*) n FROM companies`).n, 0);
  });

  test("update fills blank contact fields and never overwrites one already set", () => {
    db.exec(`DELETE FROM people; DELETE FROM companies;`);
    db.prepare(`INSERT INTO people (slug, name, email) VALUES ('sam-lee', 'Sam Lee', 'kept@example.com')`).run();
    const csv = "Name,Email,Position\nSam Lee,new@example.com,Partner\n";
    assert.equal(importCsvText(db, csv).skippedExisting.length, 1, "without update, an existing person is skipped");
    assert.equal(importCsvText(db, csv, { update: true }).updated, 1);
    assert.deepEqual(db.prepare(`SELECT email, role_title FROM people WHERE slug='sam-lee'`).get(), {
      email: "kept@example.com",
      role_title: "Partner",
    });
  });
});

