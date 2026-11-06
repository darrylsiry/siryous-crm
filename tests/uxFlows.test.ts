import { tmp } from "./helpers/tempdb";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CADENCE, getDb } from "../lib/db";
import { localPath } from "../lib/params";
import {
  addActionItem,
  clearNextStep,
  createPerson,
  logTouch,
  setOutreachStatus,
  tickActionItem,
  updateActionItem,
  updateSnapshot,
  updateStatus,
} from "../lib/actions";
import { confirmLog } from "../lib/logmeeting";
import { confirmIntake } from "../lib/intake";
import { ignoreInboxMessage } from "../lib/inboxActions";
import { importCsvText } from "../lib/importCsv";
import { search } from "../lib/queries";
import { readReceipt, receiptLine } from "../lib/receipts";
import { ago, localDateOf, localStamp, shortDate, todayLocal } from "../lib/dates.mjs";
import { normalizeToken } from "../lib/auth.mjs";
import { loadOwner, resetOwner } from "../lib/owner.mjs";
import { briefChecks, briefChecksLine } from "../lib/briefChecks";
import { stateWord } from "../lib/stateWords";
import { plainError } from "../components/ErrorExplain";
import { CANCELLED, cancelRun, typicalRunSeconds } from "../lib/progress";
import { recommendedModel } from "../lib/aiStatus";

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
    return await fn();
  } catch {
    return undefined;
  }
};
const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return todayLocal(d);
};

beforeEach(() => {
  db.exec(`DELETE FROM interactions; DELETE FROM action_items; DELETE FROM log_drafts; DELETE FROM intake_drafts;
           DELETE FROM inbox_messages; DELETE FROM opportunities; DELETE FROM outreach; DELETE FROM people; DELETE FROM companies;`);
  db.prepare(`INSERT INTO companies (id, slug, name, status_key) VALUES (1, 'acme', 'Acme Inc', 'new')`).run();
  db.prepare(
    `INSERT INTO people (id, slug, name, status_key, company_id, last_touch, next_action, updated_at) VALUES (1, 'sam-lee', 'Sam Lee', 'active', 1, '2026-01-01', 'Send the proposal', '2026-01-01 00:00:00')`
  ).run();
});

describe("adding a to-do", () => {
  test("the dated group needs a date the box can read, and says why", async () => {
    const r = await addActionItem(null, form({ title: "Call back", bucket: "this_week", due: "sometime" }));
    assert.equal(r?.ok, false);
    assert.match(r!.message, /isn't a date I can read/);
    assert.equal(one<{ n: number }>(`SELECT COUNT(*) n FROM action_items`).n, 0);
  });

  test("one Due box takes a written date, or free text in an undated group", async () => {
    await run(() => addActionItem(null, form({ title: "Send deck", bucket: "this_week", due: "Dec 3, 2027" })));
    await run(() => addActionItem(null, form({ title: "Catch up", bucket: "keep_warm", due: "ASAP" })));
    const rows = db.prepare(`SELECT title, due_date, due_label FROM action_items ORDER BY id`).all();
    assert.deepEqual(rows, [
      { title: "Send deck", due_date: "2027-12-03", due_label: "Dec 3, 2027" },
      { title: "Catch up", due_date: null, due_label: "ASAP" },
    ]);
  });
});

describe("editing and ticking a to-do", () => {
  test("a quick-date button re-dates it, and the person can be changed", async () => {
    db.prepare(`INSERT INTO people (id, slug, name, status_key) VALUES (2, 'priya-rao', 'Priya Rao', 'new')`).run();
    db.prepare(`INSERT INTO action_items (id, title, bucket, due_date, person_id) VALUES (10, 'Intro', 'this_week', '2020-01-01', 1)`).run();
    const tomorrow = plusDays(1);
    await run(() => updateActionItem(form({ id: "10", title: "Intro", bucket: "this_week", due_date: "2020-01-01", quick_due: tomorrow, person_id: "2" })));
    assert.deepEqual(one(`SELECT due_date, person_id FROM action_items WHERE id=10`), { due_date: tomorrow, person_id: 2 });
  });

  test("ticking marks it done; the matching next step is cleared only on request, and only if unchanged", async () => {
    db.prepare(`INSERT INTO action_items (id, title, bucket, person_id) VALUES (11, 'Send the proposal', 'this_week', 1)`).run();
    await run(() => tickActionItem(11));
    assert.equal(one<{ status: string }>(`SELECT status FROM action_items WHERE id=11`).status, "done");
    // The next step changed meanwhile: left alone.
    db.prepare(`UPDATE people SET next_action='Book the workshop' WHERE id=1`).run();
    await run(() => clearNextStep({ entity: "person", id: 1, name: "Sam Lee", text: "Send the proposal" }));
    assert.equal(one<{ next_action: string }>(`SELECT next_action FROM people WHERE id=1`).next_action, "Book the workshop");
    await run(() => clearNextStep({ entity: "person", id: 1, name: "Sam Lee", text: "Book the workshop" }));
    assert.equal(one<{ next_action: string | null }>(`SELECT next_action FROM people WHERE id=1`).next_action, null);
  });
});

describe("Log touch", () => {
  test("records the touch, moves last touch, sets the next step and, with a date, a to-do", async () => {
    const today = todayLocal();
    const due = plusDays(3);
    await run(() =>
      logTouch(null, form({ person_id: "1", company_id: "1", date: today, channel: "Call", note: "", next_step: "Send revised scope", next_due: due }))
    );
    assert.deepEqual(one(`SELECT channel, summary FROM interactions`), { channel: "Call", summary: "Call." });
    assert.equal(one<{ last_touch: string }>(`SELECT last_touch FROM people WHERE id=1`).last_touch, today);
    assert.equal(one<{ next_action: string }>(`SELECT next_action FROM people WHERE id=1`).next_action, "Send revised scope");
    assert.deepEqual(one(`SELECT title, due_date, person_id, source FROM action_items`), {
      title: "Send revised scope",
      due_date: due,
      person_id: 1,
      source: "next step",
    });
  });

  test("refuses a date that hasn't happened yet", async () => {
    const r = await logTouch(null, form({ person_id: "1", date: plusDays(2), channel: "Call" }));
    assert.equal(r?.ok, false);
    assert.equal(one<{ n: number }>(`SELECT COUNT(*) n FROM interactions`).n, 0);
  });
});

describe("profile edits", () => {
  test("status editor: the next step can also become a to-do", async () => {
    await run(() =>
      updateStatus(form({ entity: "person", id: "1", status_key: "active", next_action: "Draft the SOW", also_todo: "on", todo_due: "2027-01-15" }))
    );
    assert.deepEqual(one(`SELECT title, due_date, bucket FROM action_items`), { title: "Draft the SOW", due_date: "2027-01-15", bucket: "this_week" });
  });

  test("a rename keeps the slug; a typed company links to an existing one by name, or is created", async () => {
    await run(() => updateSnapshot(form({ entity: "person", id: "1", name: "Samuel Lee", new_company: "acme inc", company_id: "" })));
    assert.deepEqual(one(`SELECT slug, name, company_id FROM people WHERE id=1`), { slug: "sam-lee", name: "Samuel Lee", company_id: 1 });
    await run(() => updateSnapshot(form({ entity: "person", id: "1", new_company: "Beta Co", company_id: "1" })));
    const beta = one<{ id: number }>(`SELECT id FROM companies WHERE name='Beta Co'`);
    assert.equal(one<{ company_id: number }>(`SELECT company_id FROM people WHERE id=1`).company_id, beta.id);
  });

  test("the edit page saves the status with the rest; a cadence left as it was follows the new status", async () => {
    const was = String(DEFAULT_CADENCE.active ?? "");
    db.prepare(`UPDATE people SET cadence_days=? WHERE id=1`).run(DEFAULT_CADENCE.active ?? null);
    await run(() =>
      updateSnapshot(form({ entity: "person", id: "1", name: "Sam Lee", status_key: "client", cadence_days: was, cadence_was: was, email: "sam@example.com" }))
    );
    assert.deepEqual(one(`SELECT status_key, cadence_days, email FROM people WHERE id=1`), {
      status_key: "client",
      cadence_days: DEFAULT_CADENCE.client ?? null,
      email: "sam@example.com",
    });
  });

  test("a cadence typed in the same form wins over the new status's default", async () => {
    await run(() => updateSnapshot(form({ entity: "person", id: "1", name: "Sam Lee", status_key: "client", cadence_days: "10", cadence_was: "" })));
    assert.deepEqual(one(`SELECT status_key, cadence_days FROM people WHERE id=1`), { status_key: "client", cadence_days: 10 });
  });

  test("an unknown status keeps the current one; a company's status saves with its snapshot", async () => {
    await run(() => updateSnapshot(form({ entity: "person", id: "1", name: "Sam Lee", status_key: "nonsense" })));
    assert.equal(one<{ status_key: string }>(`SELECT status_key FROM people WHERE id=1`).status_key, "active");
    await run(() => updateSnapshot(form({ entity: "company", id: "1", name: "Acme Inc", status_key: "active", industry: "Insurance" })));
    assert.deepEqual(one(`SELECT status_key, industry FROM companies WHERE id=1`), { status_key: "active", industry: "Insurance" });
  });

  test("a stale save from the edit page goes back to it, keeping where to return to", async () => {
    let target = "";
    try {
      await updateSnapshot(form({ entity: "person", id: "1", name: "X", updated_at: "1999-01-01 00:00:00", back: "/people?status=active" }));
    } catch (e) {
      target = String((e as { digest?: string }).digest ?? "");
    }
    assert.match(target, /\/people\/sam-lee\/edit\?stale=1&back=%2Fpeople%3Fstatus%3Dactive/);
    assert.equal(one<{ name: string }>(`SELECT name FROM people WHERE id=1`).name, "Sam Lee");
  });

  test("an edit page only returns to a page of this app", () => {
    assert.equal(localPath("/people?status=active#x"), "/people?status=active#x");
    assert.equal(localPath("/companies/acme"), "/companies/acme");
    for (const bad of ["//evil.example/x", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "people", "", undefined]) {
      assert.equal(localPath(bad), undefined, String(bad));
    }
  });

  test("Add person keeps the phone", async () => {
    await run(() => createPerson(form({ name: "Lena Park", phone: "+1 555 0100", status_key: "new" })));
    assert.equal(one<{ phone: string }>(`SELECT phone FROM people WHERE slug='lena-park'`).phone, "+1 555 0100");
  });
});

describe("saving a Log draft", () => {
  const base = { draft_id: "1", date: "2026-10-30", entry_slug_0: "sam-lee", entry_summary_0: "Talked scope." };
  beforeEach(() => {
    db.prepare(`INSERT INTO log_drafts (id, raw_text, status, result_json) VALUES (1, 'notes', 'ready', '{}')`).run();
  });

  test("with nothing ticked, nothing is saved and the draft stays ready", async () => {
    await run(() => confirmLog(form(base)));
    assert.equal(one<{ status: string }>(`SELECT status FROM log_drafts WHERE id=1`).status, "ready");
    assert.equal(one<{ n: number }>(`SELECT COUNT(*) n FROM interactions`).n, 0);
  });

  test("a save leaves a receipt naming what was saved; edited follow-ups and the next-step to-do are kept as typed", async () => {
    await run(() =>
      confirmLog(
        form({
          ...base,
          entry_0: "on",
          entry_next_0: "Send revised scope",
          entry_todo_0: "on",
          entry_todo_due_0: "2027-02-01",
          action_0: "on",
          action_title_0: "Book the workshop",
          action_bucket_0: "this_week",
          action_due_0: "2027-02-05",
          action_slug_0: "sam-lee",
        })
      )
    );
    const receipt = readReceipt(db, "log", 1)!;
    assert.deepEqual(receipt, { saved: ["Sam Lee"], closed: 0, added: 2, skipped: 0 });
    assert.equal(receiptLine("log", receipt), "Saved 1 entry (Sam Lee) · added 2 follow-ups");
    const todos = db.prepare(`SELECT title, due_date FROM action_items ORDER BY id`).all();
    assert.deepEqual(todos, [
      { title: "Send revised scope", due_date: "2027-02-01" },
      { title: "Book the workshop", due_date: "2027-02-05" },
    ]);
  });

  test("“Keep the current one” leaves the next step as it was", async () => {
    await run(() => confirmLog(form({ ...base, entry_0: "on", entry_next_0: "Something new", entry_keep_next_0: "on" })));
    assert.equal(one<{ next_action: string }>(`SELECT next_action FROM people WHERE id=1`).next_action, "Send the proposal");
  });

  test("a to-do ticked off elsewhere keeps its completion date and isn't counted as closed again (CR-043)", async () => {
    db.prepare(`INSERT INTO action_items (id, title, person_id, status, completed_at) VALUES (7, 'Send deck', 1, 'done', '2026-10-01')`).run();
    db.prepare(`INSERT INTO action_items (id, title, person_id, status) VALUES (8, 'Call back', 1, 'open')`).run();
    await run(() => confirmLog(form({ ...base, entry_0: "on", resolve_7: "on", resolve_8: "on" })));
    assert.equal(one<{ completed_at: string }>(`SELECT completed_at FROM action_items WHERE id=7`).completed_at, "2026-10-01");
    assert.equal(one<{ status: string }>(`SELECT status FROM action_items WHERE id=8`).status, "done");
    assert.equal(readReceipt(db, "log", 1)!.closed, 1);
  });
});

describe("saving an Intake draft", () => {
  const analysis = {
    person: { name: "Lena Park" },
    connections: [],
    suggested_actions: [],
    interaction: { date: null, channel: null, summary_md: "Met at the conference." },
    summary_md: "",
    confidence_flags: [],
  };
  beforeEach(() => {
    db.prepare(`INSERT INTO intake_drafts (id, raw_text, status, result_json) VALUES (5, 'paste', 'ready', ?)`).run(JSON.stringify(analysis));
  });

  test("an interaction without a readable date is refused, and nothing is created", async () => {
    await run(() => confirmIntake(form({ draft_id: "5", name: "Lena Park", interaction_include: "on", interaction_summary: "Met.", interaction_date: "" })));
    assert.equal(one<{ n: number }>(`SELECT COUNT(*) n FROM people WHERE slug='lena-park'`).n, 0);
    assert.equal(one<{ status: string }>(`SELECT status FROM intake_drafts WHERE id=5`).status, "ready");
  });

  test("the phone is saved and the receipt names the new profile", async () => {
    await run(() => confirmIntake(form({ draft_id: "5", name: "Lena Park", phone: "555-0101", company_mode: "none" })));
    assert.equal(one<{ phone: string }>(`SELECT phone FROM people WHERE slug='lena-park'`).phone, "555-0101");
    assert.deepEqual(readReceipt(db, "intake", 5), { saved: [], created: ["Lena Park"], closed: 0, added: 0, skipped: 0 });
  });
});

describe("Inbox: Ignore", () => {
  test("discards the email's unsaved drafts so they stop asking for review", async () => {
    db.prepare(`INSERT INTO log_drafts (id, raw_text, status) VALUES (7, 'x', 'ready')`).run();
    db.prepare(`INSERT INTO inbox_messages (id, gmail_id, body, status, log_draft_id) VALUES (3, 'g3', 'b', 'routed', 7)`).run();
    await run(() => ignoreInboxMessage(form({ id: "3" })));
    assert.equal(one<{ status: string }>(`SELECT status FROM log_drafts WHERE id=7`).status, "discarded");
    assert.equal(one<{ status: string }>(`SELECT status FROM inbox_messages WHERE id=3`).status, "ignored");
  });
});

describe("Outreach", () => {
  test("Mark sent records the date once", async () => {
    db.prepare(`INSERT INTO outreach (id, status) VALUES (1, 'draft')`).run();
    await run(() => setOutreachStatus(1, "sent"));
    assert.deepEqual(one(`SELECT status, date FROM outreach WHERE id=1`), { status: "sent", date: todayLocal() });
  });
});

describe("LinkedIn import and Keep Warm", () => {
  const csv = "First Name,Last Name,Company,Connected On\nOld,Contact,Acme Inc,12 Mar 2019\nNew,Contact,Acme Inc,01 Nov 2026\n";
  test("“Not yet” imports with no cadence; the dry run says how many would be overdue", () => {
    const dry = importCsvText(db, csv, { dryRun: true });
    assert.equal(dry.overdueIfKeptWarm, 1);
    importCsvText(db, csv, { keepWarm: false });
    const rows = db.prepare(`SELECT name, cadence_days, connected_on FROM people WHERE name LIKE '% Contact' ORDER BY name`).all();
    assert.deepEqual(rows, [
      { name: "New Contact", cadence_days: null, connected_on: "2026-11-01" },
      { name: "Old Contact", cadence_days: null, connected_on: "2019-03-12" },
    ]);
  });
});

describe("search", () => {
  test("finds people by their employer and their LinkedIn", () => {
    db.prepare(`UPDATE people SET linkedin='https://linkedin.com/in/samlee99' WHERE id=1`).run();
    assert.deepEqual(search("acme inc").people.map((p) => p.name), ["Sam Lee"]);
    assert.deepEqual(search("samlee99").people.map((p) => p.name), ["Sam Lee"]);
  });
});

describe("dates on screen", () => {
  test("an old date shows its year; stored UTC times show in local time", () => {
    assert.equal(shortDate("2024-03-12", "2026-11-05"), "Mar 12, 2024");
    assert.equal(shortDate("2026-03-12", "2026-11-05"), "Mar 12");
    assert.equal(shortDate("recently"), "");
    const utc = "2026-11-03 22:04:05";
    assert.equal(localDateOf(utc), todayLocal(new Date("2026-11-03T22:04:05Z")));
    assert.match(localStamp(utc, "2026-11-05"), /^Nov \d+, \d{1,2}:\d{2} [AP]M$/);
    assert.equal(ago(new Date(Date.now() - 2 * 3600_000).toISOString()), "2h ago");
  });
});

describe("small rules", () => {
  test("the sign-in box takes the whole link or a code with stray spaces", () => {
    assert.equal(normalizeToken("  abc123 "), "abc123");
    assert.equal(normalizeToken("http://127.0.0.1:3000/?token=a%2Bb "), "a+b");
  });

  test("a brief says what it checked and what it didn't", () => {
    assert.equal(briefChecksLine(briefChecks(JSON.stringify({ connector: null, web: null }))!), "Checked: your CRM, Calendar and Gmail, the web");
    assert.equal(
      briefChecksLine(briefChecks(JSON.stringify({ connector: "the Gmail connector didn't answer (Detail: 401)", web: null }))!),
      "Checked: your CRM, the web · Not checked: Calendar and Gmail (the Gmail connector didn't answer)"
    );
  });

  test("one word per state, and technical errors lead with a plain sentence", () => {
    assert.deepEqual(["analyzing", "ready", "error", "confirmed", "discarded"].map(stateWord), [
      "Drafting",
      "Ready to review",
      "Failed",
      "Saved",
      "Discarded",
    ]);
    assert.match(plainError("No JSON object found in the model's response.").lead, /came back unreadable/);
    assert.deepEqual(plainError("Ollama isn't running (Detail: ECONNREFUSED)"), { lead: "Ollama isn't running", detail: "ECONNREFUSED" });
  });

  test("the model suggested for a Mac follows the README", () => {
    const gb = 1024 ** 3;
    assert.equal(recommendedModel(36 * gb).model, "gemma4:26b");
    assert.equal(recommendedModel(16 * gb).model, "gemma4:12b");
    assert.equal(recommendedModel(8 * gb).model, "qwen3:8b");
  });
});

describe("cancelling a run", () => {
  test("marks the draft failed with a message offering Try again; only a running draft", () => {
    db.prepare(`INSERT INTO log_drafts (id, raw_text, status) VALUES (20, 'x', 'analyzing'), (21, 'y', 'ready')`).run();
    assert.equal(cancelRun("log", 20), true);
    assert.equal(cancelRun("log", 21), false);
    assert.deepEqual(one(`SELECT status, error FROM log_drafts WHERE id=20`), { status: "error", error: CANCELLED });
    assert.equal(one<{ status: string }>(`SELECT status FROM log_drafts WHERE id=21`).status, "ready");
  });

  test("the typical run time is the median of recent finished runs", () => {
    const p = (secs: number) => JSON.stringify([{ t: "info", label: "a", ts: 0 }, { t: "info", label: "b", ts: secs * 1000 }]);
    for (const [i, secs] of [60, 90, 300].entries()) {
      db.prepare(`INSERT INTO log_drafts (id, raw_text, status, progress) VALUES (?, 'x', 'confirmed', ?)`).run(30 + i, p(secs));
    }
    assert.equal(typicalRunSeconds("log"), 90);
  });
});

describe("the owner profile", () => {
  test("ignores fields still holding the example's sample text, and says when the file can't be read", () => {
    const dir = fs.mkdtempSync(path.join(tmp.dir, "owner-"));
    const file = path.join(dir, "owner.json");
    const before = process.env.OWNER_CONFIG;
    process.env.OWNER_CONFIG = file;
    try {
      fs.writeFileSync(file, JSON.stringify({ ownerName: "Sam Lee", practiceName: "Doe Advisory", ownerEmail: "jane@example.com" }));
      resetOwner();
      const o = loadOwner();
      assert.equal(o.ownerName, "Sam Lee");
      assert.equal(o.ownerFirstName, "Sam");
      assert.equal(o.practiceName, "the practice");
      assert.deepEqual(o.ignoredSamples.sort(), ["ownerEmail", "practiceName"]);
      fs.writeFileSync(file, "{ “ownerName”: “Sam” }");
      resetOwner();
      const bad = loadOwner();
      assert.equal(bad.configured, false);
      assert.match(bad.readError ?? "", /curly quotes/);
    } finally {
      process.env.OWNER_CONFIG = before;
      resetOwner();
    }
  });
});
