import "./helpers/tempdb";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../lib/db";
import { applyLogHintFallback, COMPANY_TARGET, loadLogHint } from "../lib/logHint";
import type { LogAnalysis } from "../lib/ai";

const db = getDb();
const companyId = Number(db.prepare(`INSERT INTO companies (slug, name) VALUES ('acme', 'Acme')`).run().lastInsertRowid);
const personId = Number(
  db.prepare(`INSERT INTO people (slug, name, company_id) VALUES ('jane-doe', 'Jane Doe', ?)`).run(companyId).lastInsertRowid
);

const empty = (): LogAnalysis => ({
  meeting: { date: null, channel: null, title: null },
  entries: [],
  unmatched_participants: [],
  resolves_action_ids: [],
  suggested_actions: [],
  summary_md: "",
  confidence_flags: [],
});

describe("loadLogHint", () => {
  test("resolves a person hint with their company", () => {
    assert.deepEqual(loadLogHint(db, personId, null), {
      kind: "person",
      slug: "jane-doe",
      name: "Jane Doe",
      company: "Acme",
      members: [],
    });
  });

  test("resolves a company hint with the roster people there", () => {
    const hint = loadLogHint(db, null, companyId);
    assert.equal(hint?.kind, "company");
    assert.equal(hint?.slug, "acme");
    assert.deepEqual(hint?.members, [{ slug: "jane-doe", name: "Jane Doe" }]);
  });

  test("person wins over company; unknown ids are ignored", () => {
    assert.equal(loadLogHint(db, personId, companyId)?.kind, "person");
    assert.equal(loadLogHint(db, 9999, null), null);
    assert.equal(loadLogHint(db, 9999, 9999), null);
    assert.equal(loadLogHint(db, null, null), null);
  });
});

describe("applyLogHintFallback", () => {
  test("leaves an analysis with entries alone", () => {
    const a = { ...empty(), entries: [{ person_slug: "someone-else", summary_md: "x", next_action: null }] };
    assert.equal(applyLogHintFallback(a, loadLogHint(db, personId, null), "raw"), a);
  });

  test("no hint and no entries stays empty (caller reports the failure)", () => {
    assert.equal(applyLogHintFallback(empty(), null, "raw").entries.length, 0);
  });

  test("logs on the hinted person, using the summary or the raw content", () => {
    const withSummary = applyLogHintFallback({ ...empty(), summary_md: "Quick catch-up." }, loadLogHint(db, personId, null), "raw notes");
    assert.deepEqual(withSummary.entries, [{ person_slug: "jane-doe", summary_md: "Quick catch-up.", next_action: null }]);
    assert.match(withSummary.confidence_flags.at(-1) ?? "", /logged on Jane Doe/);

    const noSummary = applyLogHintFallback(empty(), loadLogHint(db, personId, null), "  raw notes  ");
    assert.equal(noSummary.entries[0].summary_md, "raw notes");
  });

  test("logs on the company target when the hint is a company", () => {
    const a = applyLogHintFallback(empty(), loadLogHint(db, null, companyId), "called the main line");
    assert.equal(a.entries[0].person_slug, `${COMPANY_TARGET}acme`);
  });
});
