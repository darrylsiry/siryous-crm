import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
// Must come first: lib/settings.ts imports lib/db.ts, which opens CRM_DB_PATH on first use.
import { dbPath, tmp } from "./helpers/tempdb";
import { AI_DEFAULTS, getAiSettings, getSetting, setSetting, validateOllamaUrl } from "../lib/settings";
import { getDb } from "../lib/db";

delete process.env.LOCAL_LLM_ALLOW_REMOTE;

after(() => {
  try {
    getDb().close();
  } catch {
    /* never opened */
  }
  tmp.cleanup();
});

describe("validateOllamaUrl", () => {
  test("loopback, private ranges and .local hosts are accepted", () => {
    for (const url of [
      "http://localhost:11434",
      "http://127.0.0.1:11434",
      "http://127.5.6.7:11434",
      "http://[::1]:11434",
      "http://10.0.0.5:11434",
      "http://192.168.1.20:11434",
      "http://172.16.0.1:11434",
      "http://172.31.255.1:11434",
      "http://studio.local:11434",
      "https://gpu-box.local",
      "http://[fe80::1]:11434",
      "http://[fd12:3456::1]:11434",
    ]) {
      const r = validateOllamaUrl(url);
      assert.equal(r.ok, true, `${url} should be accepted: ${JSON.stringify(r)}`);
    }
  });

  test("public hosts are rejected unless LOCAL_LLM_ALLOW_REMOTE=1", () => {
    const r = validateOllamaUrl("https://api.example.com");
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /api\.example\.com is not a local\/private address/);
    assert.match((r as { reason: string }).reason, /LOCAL_LLM_ALLOW_REMOTE=1/);

    // 172.32.x.x is outside the 172.16/12 private block; 8.8.8.8 is plainly public.
    assert.equal(validateOllamaUrl("http://172.32.0.1:11434").ok, false);
    assert.equal(validateOllamaUrl("http://8.8.8.8:11434").ok, false);

    process.env.LOCAL_LLM_ALLOW_REMOTE = "1";
    try {
      const allowed = validateOllamaUrl("https://api.example.com");
      assert.deepEqual(allowed, { ok: true, url: "https://api.example.com" });
    } finally {
      delete process.env.LOCAL_LLM_ALLOW_REMOTE;
    }
    assert.equal(validateOllamaUrl("https://api.example.com").ok, false);
  });

  test("credentials, query strings and fragments are rejected", () => {
    for (const url of [
      "http://user:pw@localhost:11434",
      "http://user@localhost:11434",
      "http://localhost:11434/?x=1",
      "http://localhost:11434/#frag",
    ]) {
      const r = validateOllamaUrl(url);
      assert.equal(r.ok, false, `${url} should be rejected`);
      assert.match((r as { reason: string }).reason, /no credentials, query or fragment/);
    }
  });

  test("only http(s) schemes; garbage is not a URL", () => {
    const ftp = validateOllamaUrl("ftp://localhost:11434");
    assert.equal(ftp.ok, false);
    assert.match((ftp as { reason: string }).reason, /http:\/\/ or https:\/\//);

    const junk = validateOllamaUrl("not a url");
    assert.equal(junk.ok, false);
    assert.equal((junk as { reason: string }).reason, "not a valid URL");
    assert.equal(validateOllamaUrl("").ok, false);
  });

  test("normalises: trims whitespace, drops a trailing slash, keeps a path", () => {
    assert.deepEqual(validateOllamaUrl("  http://127.0.0.1:11434/  "), { ok: true, url: "http://127.0.0.1:11434" });
    assert.deepEqual(validateOllamaUrl("http://localhost:11434"), { ok: true, url: "http://localhost:11434" });
    assert.deepEqual(validateOllamaUrl("http://LOCALHOST:11434/v1/"), { ok: true, url: "http://localhost:11434/v1" });
  });
});

describe("settings storage (temp database)", () => {
  test("the database is created at CRM_DB_PATH, not under data/", () => {
    getDb();
    assert.ok(fs.existsSync(dbPath));
  });

  test("getSetting is null when unset; setSetting round-trips and null deletes", () => {
    assert.equal(getSetting("ai.model"), null);
    setSetting("ai.model", "tiny:1b");
    assert.equal(getSetting("ai.model"), "tiny:1b");
    setSetting("ai.model", "tiny:2b");
    assert.equal(getSetting("ai.model"), "tiny:2b");
    setSetting("ai.model", null);
    assert.equal(getSetting("ai.model"), null);
    setSetting("ai.model", "x");
    setSetting("ai.model", "");
    assert.equal(getSetting("ai.model"), null);
  });

  test("getAiSettings layers stored values over defaults and normalises them", () => {
    assert.deepEqual(getAiSettings(), AI_DEFAULTS);

    setSetting("ai.ollama_url", "http://10.0.0.9:11434/");
    setSetting("ai.provider", "claude");
    setSetting("ai.fallback", "none");
    setSetting("ai.num_ctx", "8192");
    setSetting("ai.temperature", "0.7");
    const s = getAiSettings();
    assert.equal(s.ollamaUrl, "http://10.0.0.9:11434");
    assert.equal(s.provider, "claude");
    assert.equal(s.fallbackToClaude, false);
    assert.equal(s.numCtx, 8192);
    assert.equal(s.temperature, 0.7);

    // Invalid stored values fall back to the defaults.
    setSetting("ai.provider", "openai");
    setSetting("ai.num_ctx", "-5");
    setSetting("ai.temperature", "warm");
    const fallback = getAiSettings();
    assert.equal(fallback.provider, AI_DEFAULTS.provider);
    assert.equal(fallback.numCtx, AI_DEFAULTS.numCtx);
    assert.equal(fallback.temperature, AI_DEFAULTS.temperature);
  });
});
