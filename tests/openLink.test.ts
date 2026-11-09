import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import OpenLinkPage from "../app/(app)/open-link/page";
import { throughCheck } from "../lib/safeHref";

const page = async (to: string | string[] | undefined) => renderToStaticMarkup(await OpenLinkPage({ searchParams: Promise.resolve({ to }) }));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("The page before a link leaves the CRM (SEC-029)", () => {
  test("shows the whole address and the real site, with the path and subdomain in plain sight", async () => {
    const html = await page("https://sam-lee.evil.example/active/pat-kim/");
    assert.match(html, /sam-lee\.evil\.example\/active\/pat-kim\//);
    assert.deepEqual(hrefs(html), ["https://sam-lee.evil.example/active/pat-kim/"]);
    assert.match(html, /Open sam-lee\.evil\.example/);
  });

  test("with a query, the first choice is the page only and the whole address is the second", async () => {
    const html = await page("https://evil.example/c?r=sam-lee#x");
    assert.deepEqual(hrefs(html), ["https://evil.example/c", "https://evil.example/c?r=sam-lee#x"]);
    assert.match(html, /Open the page only/);
    assert.match(html, /Open the whole address/);
  });

  test("a look-alike domain shows as what it really is", async () => {
    const html = await page("https://rеuters.com/x");
    assert.match(html, /xn--/);
    assert.doesNotMatch(html, /rеuters/);
  });

  test("the user@ trick shows the real site", async () => {
    const html = await page("https://reuters.com@evil.example/x");
    assert.match(html, /Open evil\.example/);
  });

  test("anything but a web address opens nothing", async () => {
    for (const to of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "//evil.example/a", "/people/sam", "mailto:a@b.co", "https://", "", undefined]) {
      const html = await page(to);
      assert.deepEqual(hrefs(html), [], String(to));
      assert.match(html, /Nothing to open/, String(to));
    }
  });

  test("a repeated parameter uses the first", async () => {
    assert.deepEqual(hrefs(await page(["https://a.example/", "https://b.example/"])), ["https://a.example/"]);
  });

  test("the link into it survives any address", () => {
    const to = 'https://x.example/a b?c=1&d="2"#e';
    assert.equal(decodeURIComponent(throughCheck(to).slice("/open-link?to=".length)), to);
  });
});
