import "./helpers/tempdb";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../lib/db";
import { cleanItems, chunk, headlineKey, sinceFor, urlKey, buildNewsPrompt, type NewsSubject } from "../lib/newsCore";
import { dueSubjects, getNewsSettings, newsFeed, newsSubjects, storeNewsItems } from "../lib/news";
import { setSetting } from "../lib/settings";

const subj = (ref: string, checkedAt: string | null = null): NewsSubject => ({
  ref,
  kind: ref.startsWith("p:") ? "person" : "company",
  id: 1,
  name: ref.slice(2),
  context: "",
  checkedAt,
});

describe("newsCore", () => {
  test("urlKey ignores tracking params, www, trailing slash and hash", () => {
    assert.equal(
      urlKey("https://www.example.com/news/story/?utm_source=x&id=5#top"),
      urlKey("http://example.com/news/story?id=5")
    );
    assert.notEqual(urlKey("https://example.com/a?id=5"), urlKey("https://example.com/a?id=6"));
  });

  test("headlineKey folds case, accents and punctuation", () => {
    assert.equal(headlineKey("Acmé Raises $10M — Series A!"), "acme raises 10m series a");
  });

  test("chunk", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  test("sinceFor: earliest last check less overlap, capped at the first-run lookback", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    assert.equal(sinceFor([subj("p:a", "2026-10-11T12:00:00Z")], now), "2026-10-09");
    assert.equal(sinceFor([subj("p:a", "2026-10-11T12:00:00Z"), subj("c:b")], now), "2026-09-28");
    assert.equal(sinceFor([subj("p:a", "2025-01-01T00:00:00Z")], now), "2026-09-28");
  });

  test("cleanItems keeps only well-formed, in-window items about batch subjects", () => {
    const batch = [subj("p:jane"), subj("c:acme")];
    const raw = {
      items: [
        { headline: "Good", url: "https://news.example/a", source: "News", published: "2026-10-10", summary: "s", about: ["p:jane", "p:stranger"] },
        { headline: "Dup", url: "https://www.news.example/a/", published: "2026-10-10", about: ["c:acme"] },
        { headline: "Too old", url: "https://news.example/b", published: "2026-09-01", about: ["p:jane"] },
        { headline: "Future", url: "https://news.example/c", published: "2026-12-01", about: ["p:jane"] },
        { headline: "No date", url: "https://news.example/d", about: ["p:jane"] },
        { headline: "Bad url", url: "javascript:alert(1)", published: "2026-10-10", about: ["p:jane"] },
        { headline: "Not ours", url: "https://news.example/e", published: "2026-10-10", about: ["p:someone"] },
        { headline: "String about", url: "https://news.example/f", published: "2026-10-11T08:00:00Z", about: "c:acme" },
      ],
    };
    const out = cleanItems(raw, batch, "2026-10-01", "2026-10-12");
    assert.deepEqual(out.map((o) => o.headline), ["Good", "String about"]);
    assert.deepEqual(out[0].about, ["p:jane"]);
    assert.equal(out[1].published, "2026-10-11");
    assert.deepEqual(cleanItems("nonsense", batch, "2026-10-01", "2026-10-12"), []);
  });

  test("prompt lists every subject ref", () => {
    const p = buildNewsPrompt([subj("p:jane"), subj("c:acme")], "2026-10-01", "2026-10-12");
    assert.match(p, /p:jane \| person \| jane/);
    assert.match(p, /c:acme \| company \| acme/);
    assert.match(p, /on or after 2026-10-01/);
  });
});

describe("news store", () => {
  const db = getDb();
  db.prepare(`INSERT INTO companies (slug, name, industry) VALUES ('acme','Acme Insurance','Insurance')`).run();
  db.prepare(`INSERT INTO people (slug, name, role_title, company_id) VALUES ('jane-doe','Jane Doe','CEO',1)`).run();

  test("subjects carry context and become due when never checked", () => {
    const s = newsSubjects(db);
    assert.deepEqual(s.map((x) => x.ref), ["c:acme", "p:jane-doe"]);
    assert.equal(s[1].context, "CEO at Acme Insurance");
    assert.equal(dueSubjects(s).length, 2);
    assert.equal(dueSubjects([{ ...s[0], checkedAt: new Date().toISOString() }]).length, 0);
  });

  test("store dedupes by URL and by headline, merging subjects", () => {
    const base = { source: "Wire", summary: "x", published: "2026-10-10" };
    assert.equal(
      storeNewsItems(db, [{ ...base, headline: "Acme Insurance names Jane Doe chief executive", url: "https://a.example/1", about: ["c:acme"] }]),
      1
    );
    // Same URL with tracking → merged.
    assert.equal(
      storeNewsItems(db, [{ ...base, headline: "Other title", url: "https://a.example/1?utm_source=t", about: ["p:jane-doe"] }]),
      0
    );
    // Same wire headline on another site → merged.
    assert.equal(
      storeNewsItems(db, [{ ...base, headline: "Acme Insurance Names Jane Doe Chief Executive", url: "https://b.example/9", about: ["c:acme"] }]),
      0
    );
    assert.equal(storeNewsItems(db, [{ ...base, headline: "Acme opens Denver office", url: "https://a.example/2", published: "2026-10-11", about: ["c:acme"] }]), 1);
    const feed = newsFeed();
    assert.deepEqual(feed.map((f) => f.url), ["https://a.example/2", "https://a.example/1"]);
    assert.deepEqual(feed[1].about.map((a) => a.name).sort(), ["Acme Insurance", "Jane Doe"]);
  });

  test("dismissed items leave the feed and don't come back", () => {
    db.prepare(`UPDATE news_items SET dismissed_at=datetime('now') WHERE url='https://a.example/2'`).run();
    assert.equal(newsFeed().length, 1);
    assert.equal(newsFeed({ dismissed: true }).length, 1);
    assert.equal(storeNewsItems(db, [{ headline: "Acme opens Denver office", url: "https://a.example/2", source: null, summary: "", published: "2026-10-11", about: ["c:acme"] }]), 0);
    assert.equal(newsFeed().length, 1);
  });
});

describe("news opt-in", () => {
  test("off on a fresh install, on for installs that already ran it, explicit choice wins", () => {
    setSetting("news.enabled", null);
    setSetting("news.last_run_at", null);
    assert.equal(getNewsSettings().enabled, false);
    setSetting("news.last_run_at", "2026-10-12T10:00:00.000Z");
    assert.equal(getNewsSettings().enabled, true);
    setSetting("news.enabled", "off");
    assert.equal(getNewsSettings().enabled, false);
    setSetting("news.last_run_at", null);
    setSetting("news.enabled", "on");
    assert.equal(getNewsSettings().enabled, true);
  });
});
