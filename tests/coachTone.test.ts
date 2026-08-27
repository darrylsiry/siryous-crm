// Must come first: lib/settings.ts and lib/coachai.ts open CRM_DB_PATH on first use.
import { tmp } from "./helpers/tempdb";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { COACH_TONES, coachToneChoices, coachToneSpec, DEFAULT_COACH_TONE, isCoachTone } from "../lib/coachTone";
import { getCoachSettings, setSetting, validateContextDir } from "../lib/settings";
import { buildCoachAdvicePrompt, buildCoachReplyPrompt, buildCoachSummaryPrompt } from "../lib/coachai";
import { getDb } from "../lib/db";

after(() => {
  try {
    getDb().close();
  } catch {
    /* never opened */
  }
  tmp.cleanup();
});

const O = { first: "Jane", possessive: "Jane's" };

describe("coach tone specs", () => {
  test("three levels, each fully specified and distinct", () => {
    assert.deepEqual([...COACH_TONES], ["friendly", "pushy", "hardcore"]);
    const seen = new Set<string>();
    for (const t of COACH_TONES) {
      const s = coachToneSpec(t);
      for (const part of [s.rules(O), s.weekly(O), s.checkin(O), s.reply(O)]) {
        assert.ok(part.length > 40, `${t} has a real ${part.slice(0, 20)}…`);
        assert.ok(!seen.has(part), `${t} text is not shared with another level`);
        seen.add(part);
      }
      assert.match(s.rules(O), new RegExp(`COACHING TONE — ${t.toUpperCase()}`));
      assert.match(s.weekly(O), /\{WEEK\}/);
      assert.match(s.checkin(O), /\{DATE\}/);
      assert.ok(!s.rules(O).includes("undefined"));
    }
  });

  test("owner wording is substituted, never hard-coded", () => {
    for (const t of COACH_TONES) {
      const s = coachToneSpec(t);
      const all = [s.rules(O), s.weekly(O), s.checkin(O), s.reply(O), s.crmRule(O)].join("\n");
      assert.ok(!/darryl|siry/i.test(all), `${t} contains no owner-specific names`);
    }
    assert.match(coachToneSpec("hardcore").rules(O), /Jane/);
    assert.match(coachToneSpec("hardcore").crmRule(O), /Jane gave no day/);
    assert.equal(coachToneSpec("pushy").crmRule(O), "");
  });

  test("isCoachTone and the Settings choices", () => {
    assert.equal(isCoachTone("pushy"), true);
    assert.equal(isCoachTone("brutal"), false);
    assert.equal(isCoachTone(null), false);
    assert.deepEqual(
      coachToneChoices().map((c) => c.key),
      [...COACH_TONES]
    );
    for (const c of coachToneChoices()) {
      assert.ok(c.label && c.blurb && c.sample);
    }
  });
});

describe("coach settings", () => {
  test("defaults: pushy, profile on, no folder", () => {
    const s = getCoachSettings();
    assert.equal(s.tone, DEFAULT_COACH_TONE);
    assert.equal(s.useProfile, true);
    assert.equal(s.contextDir, "");
  });

  test("an unknown stored tone falls back to the default", () => {
    setSetting("coach.tone", "brutal");
    assert.equal(getCoachSettings().tone, DEFAULT_COACH_TONE);
    setSetting("coach.tone", "hardcore");
    assert.equal(getCoachSettings().tone, "hardcore");
    setSetting("coach.tone", null);
  });

  test("the notes folder can be overridden and switched off", () => {
    const dir = path.join(tmp.dir, "notes");
    fs.mkdirSync(dir, { recursive: true });
    setSetting("coach.context_dir", dir);
    assert.equal(getCoachSettings().contextDir, dir);
    setSetting("coach.use_profile", "off");
    assert.equal(getCoachSettings().useProfile, false);
    assert.equal(getCoachSettings().contextDir, "", "off means no folder even when one is set");
    setSetting("coach.use_profile", null);
    setSetting("coach.context_dir", null);
  });

  test("validateContextDir accepts blank and real folders only", () => {
    assert.deepEqual(validateContextDir(""), { ok: true, dir: "" });
    assert.deepEqual(validateContextDir(tmp.dir), { ok: true, dir: tmp.dir });
    assert.equal(validateContextDir("notes").ok, false);
    assert.equal(validateContextDir(path.join(tmp.dir, "missing")).ok, false);
    const file = path.join(tmp.dir, "a-file.txt");
    fs.writeFileSync(file, "x");
    assert.equal(validateContextDir(file).ok, false);
  });
});

describe("coach prompts follow the chosen tone", () => {
  const week = "2026-08-24";

  test("advice, reply and close all carry the tone block and the tone's template", () => {
    for (const t of COACH_TONES) {
      setSetting("coach.tone", t);
      const marker = new RegExp(`COACHING TONE — ${t.toUpperCase()}`);
      const advice = buildCoachAdvicePrompt(week, "weekly");
      const checkin = buildCoachAdvicePrompt(week, "checkin");
      const reply = buildCoachReplyPrompt(week, "# advice", [], "I'll try to call him soon", "weekly");
      const close = buildCoachSummaryPrompt(week, "# advice", [], "weekly");
      for (const p of [advice, checkin, reply, close]) assert.match(p, marker);
      assert.ok(!advice.includes("{WEEK}") && !checkin.includes("{DATE}"), "placeholders are filled");
      assert.match(advice, /Aug|2026/);
    }
    setSetting("coach.tone", null);
  });

  test("the templates differ in the ways that matter", () => {
    setSetting("coach.tone", "friendly");
    const friendly = buildCoachAdvicePrompt(week);
    setSetting("coach.tone", "hardcore");
    const hardcore = buildCoachAdvicePrompt(week);
    const hardReply = buildCoachReplyPrompt(week, "# advice", [], "soon", "weekly");
    setSetting("coach.tone", null);
    const pushy = buildCoachAdvicePrompt(week);

    assert.match(friendly, /## Where you could tighten up/);
    assert.match(pushy, /## Where you're dropping the ball/);
    assert.match(hardcore, /## The biggest miss/);
    assert.match(hardcore, /## Scorecard/);
    assert.doesNotMatch(friendly, /BROKEN/);
    assert.match(hardReply, /a day and a time/);
    assert.match(hardReply, /needs a due_label/);
    assert.doesNotMatch(pushy, /needs a due_label/);
  });

  test("the identity paragraph stays generic without an owner config", () => {
    const p = buildCoachAdvicePrompt(week);
    assert.match(p, /the executive coach for the owner of/);
    assert.ok(!/darryl|siry/i.test(p));
  });
});

describe("coach AI route", () => {
  test("defaults to the app-wide provider and model", () => {
    const s = getCoachSettings();
    assert.equal(s.provider, null);
    assert.equal(s.model, null);
    assert.equal(s.route.provider, "local");
    assert.equal(typeof s.route.model, "string");
  });

  test("a local model override keeps the provider local; Claude override drops the model", () => {
    setSetting("coach.provider", "local");
    setSetting("coach.model", "qwen3:32b");
    assert.deepEqual(getCoachSettings().route, { provider: "local", model: "qwen3:32b" });
    setSetting("coach.provider", "claude");
    setSetting("coach.model", null);
    assert.equal(getCoachSettings().route.provider, "claude");
    setSetting("coach.provider", "gpt");
    assert.equal(getCoachSettings().provider, null, "unknown provider is ignored");
    setSetting("coach.provider", null);
  });
});
