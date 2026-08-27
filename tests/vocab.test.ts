import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
// Must come first: the prompt builders below pull in lib/db.ts, which opens CRM_DB_PATH on first use.
import { tmp } from "./helpers/tempdb";

// Then this: it writes an override file and points VOCAB_CONFIG at it before lib/db.ts loads.
import { overrideFile } from "./helpers/vocab-override";

import { DEFAULT_VOCAB, PALETTES, cadenceSentence, loadVocab, mergeVocab, palette } from "../lib/vocab.mjs";
import { BUCKETS, DEFAULT_CADENCE, KINDS, STAGES, STATUS, STRENGTHS } from "../lib/db";
import { buildIntakePrompt, buildLogPrompt } from "../lib/ai";
import { buildCoachReplyPrompt } from "../lib/coachai";
import { getDb } from "../lib/db";

after(() => {
  try {
    getDb().close();
  } catch {
    /* never opened */
  }
  tmp.cleanup();
});

describe("defaults", () => {
  const v = mergeVocab({});

  test("built-in keys and shapes match what the app relies on", () => {
    assert.deepEqual(Object.keys(v.status), ["new", "exploring", "active", "on_hold", "client", "won", "lost", "dormant"]);
    assert.deepEqual(Object.keys(v.buckets), ["overdue", "log_gap", "this_week", "awaiting", "high_potential", "keep_warm", "venture", "data_gap"]);
    assert.deepEqual(Object.keys(v.stages), ["identified", "discussing", "scoping", "negotiating", "engaged", "won", "lost", "on_hold"]);
    assert.deepEqual(Object.keys(v.kinds), ["engagement", "partnership", "venture", "referral"]);
    assert.deepEqual([...v.strengths], ["Cold", "Acquaintance", "Warm", "Trusted"]);
    assert.deepEqual(v.status.new, { emoji: "🌱", label: "New", color: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" });
    assert.deepEqual(v.buckets.this_week, { label: "Dated — this week & upcoming", icon: "🟡", order: 2 });
    assert.deepEqual(v.stages.scoping, { label: "Scoping / proposal", icon: "📐", color: "border-t-amber-400", order: 2, open: true });
    assert.equal(v.stages.won.open, false);
    assert.deepEqual(v.kinds.referral, { label: "Referral", badge: "bg-teal-50 text-teal-700 ring-teal-600/20" });
  });

  test("every status has a cadence entry; lost is null", () => {
    assert.deepEqual(Object.keys(v.cadence).sort(), Object.keys(v.status).sort());
    assert.equal(v.cadence.new, 21);
    assert.equal(v.cadence.lost, null);
  });

  test("every palette resolves; unknown names fall back to stone", () => {
    for (const name of Object.keys(PALETTES)) {
      assert.match(palette(name).badge, new RegExp(`\\b${name}-`));
      assert.match(palette(name).stage, /^border-t-/);
    }
    assert.equal(palette("neon"), PALETTES.stone);
    assert.equal(palette(undefined), PALETTES.stone);
    assert.equal(palette(42), PALETTES.stone);
  });

  test("the cadence sentence lists every status with a number and names the ones without", () => {
    const s = cadenceSentence(v);
    assert.match(s, /^cadence_days by status: /);
    assert.match(s, /\bnew 21\b/);
    assert.match(s, /\bdormant 180\b/);
    assert.match(s, /; lost none$/);
  });

  test("DEFAULT_VOCAB is not mutated by merging", () => {
    mergeVocab({ status: { new: { label: "X" } }, buckets: { remove: ["overdue"] } });
    assert.equal(DEFAULT_VOCAB.status.new.label, "New");
    assert.ok(DEFAULT_VOCAB.buckets.overdue);
  });
});

describe("override file", () => {
  const v = mergeVocab({
    status: { new: { label: "Prospect" }, advisor: { emoji: "🧭", label: "Advisor", color: "blue" }, remove: ["dormant"] },
    buckets: { content: { label: "Content", icon: "✍️", order: 1.5 }, keep_warm: { icon: "🟣" } },
    stages: { discussing: { color: "neon" } },
    kinds: { remove: ["venture"], speaking: { label: "Speaking", color: "rose" } },
    strengths: ["Cold", "Warm", "Hot"],
    cadence: { advisor: 60, new: 7, remove: ["won"] },
  });

  test("renaming a label keeps the rest of the entry", () => {
    assert.deepEqual(v.status.new, { emoji: "🌱", label: "Prospect", color: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" });
    assert.equal(v.buckets.keep_warm.icon, "🟣");
    assert.equal(v.buckets.keep_warm.label, "Keep-warm / longer horizon");
  });

  test("new entries are added, ordered by `order`, and removed keys disappear", () => {
    assert.deepEqual(v.status.advisor, { emoji: "🧭", label: "Advisor", color: "bg-blue-50 text-blue-700 ring-blue-600/20" });
    assert.equal(Object.keys(v.status).at(-1), "advisor");
    assert.equal("dormant" in v.status, false);
    assert.deepEqual(Object.keys(v.buckets).slice(0, 3), ["overdue", "log_gap", "content"]);
    assert.equal("venture" in v.kinds, false);
    assert.deepEqual(v.kinds.speaking, { label: "Speaking", badge: "bg-rose-50 text-rose-700 ring-rose-600/20" });
  });

  test("unknown palette renders as stone", () => {
    assert.equal(v.stages.discussing.color, "border-t-stone-400");
    assert.equal(v.stages.discussing.label, "In conversation");
  });

  test("strengths replace wholesale; cadence follows the status list", () => {
    assert.deepEqual([...v.strengths], ["Cold", "Warm", "Hot"]);
    assert.equal(v.cadence.new, 7);
    assert.equal(v.cadence.advisor, 60);
    assert.equal(v.cadence.won, null);
    assert.equal("dormant" in v.cadence, false);
  });

  test("garbage in the file is ignored rather than crashing", () => {
    const g = mergeVocab({ status: "nope", buckets: { overdue: 5 }, cadence: { new: "soon" }, strengths: [] });
    assert.equal(g.status.new.label, "New");
    assert.equal(g.buckets.overdue.label, "Overdue — your move");
    assert.equal(g.cadence.new, null);
    assert.equal(g.strengths.length, 4);
  });

  test("loadVocab reads VOCAB_CONFIG and caches per file", () => {
    const a = loadVocab();
    assert.equal(a.configPath, overrideFile);
    assert.equal(a.configured, true);
    assert.ok(a.buckets.board_prep);
    assert.equal(loadVocab(), a);
    const missing = path.join(tmp.dir, "nope");
    const prev = process.env.VOCAB_CONFIG;
    delete process.env.VOCAB_CONFIG;
    try {
      const b = loadVocab(missing);
      assert.equal(b.configured, false);
      assert.equal("board_prep" in b.buckets, false);
    } finally {
      process.env.VOCAB_CONFIG = prev;
    }
  });
});

describe("lib/db exports and prompts follow the config", () => {
  test("lib/db re-exports the merged vocabulary with the original shapes", () => {
    assert.deepEqual(Object.keys(BUCKETS).slice(0, 4), ["overdue", "log_gap", "this_week", "board_prep"]);
    assert.equal("venture" in KINDS, false);
    assert.ok(STATUS.new.color.startsWith("bg-"));
    assert.ok(STAGES.identified.color.startsWith("border-t-"));
    assert.equal(STRENGTHS.length, 4);
    assert.deepEqual(Object.keys(DEFAULT_CADENCE).sort(), Object.keys(STATUS).sort());
    assert.equal(DEFAULT_CADENCE.lost, null);
  });

  test("intake, log and coach prompts list the added bucket and never a removed kind", () => {
    const intake = buildIntakePrompt("Some pasted profile text");
    const log = buildLogPrompt("Some transcript", "paste");
    const coach = buildCoachReplyPrompt("2026-08-24", "advice", [], "hello");
    for (const p of [intake, log, coach]) {
      assert.match(p, /overdue, log_gap, this_week, board_prep, awaiting, high_potential, keep_warm, venture, data_gap/);
    }
    assert.match(intake, /status_suggestion one of: new, exploring, active, on_hold, client, won, lost, dormant/);
    assert.match(intake, /cadence_days by status: new 21, exploring 45, active 30, on_hold 60, client 14, won 90, dormant 180; lost none/);
  });
});
