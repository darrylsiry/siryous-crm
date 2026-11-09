import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Markdown, { renderMarkdown } from "../components/Markdown";

const render = (md: string) => renderMarkdown(md);

describe("Markdown sanitisation", () => {
  test("the module exports a component and its renderer", () => {
    assert.equal(typeof Markdown, "function");
  });

  // The address a link opens, read back out of the page it goes to first.
  const opens = (html: string) => {
    const m = html.match(/href="\/open-link\?to=([^"]*)"/);
    return m ? decodeURIComponent(m[1].replace(/&amp;/g, "&")) : null;
  };

  test("a link to another site stops at the CRM's own page, so no address leaves on one click (SEC-029)", () => {
    for (const to of ["https://evil.example/c?r=sam-lee,active#x", "https://evil.example/sam-lee/active/", "https://sam-lee-active.evil.example/"]) {
      const html = render(`Met at the summit [(per calendar)](${to}).`);
      assert.equal(opens(html), to, "the whole address reaches the page, to be shown there");
      assert.doesNotMatch(html, /href="https?:/, "and nothing in the page links to it directly");
      assert.match(html, /↗ .*evil\.example/);
    }
  });

  test("the site beside a link can't be hidden by text that merely contains it (SEC-029)", () => {
    assert.match(render("[reuters.com](https://rs.com/)"), /↗ rs\.com/);
    assert.match(render("[see reuters.com today](https://rs.com/)"), /↗ rs\.com/);
    assert.match(render("[reuters.com@rs.com](https://rs.com/)"), /↗ rs\.com/);
    assert.match(render("[rеuters.com](https://xn--ruters-3ve.com/)"), /↗ xn--/, "letters that only look like another site's");
    // Text that really is the site's own address doesn't repeat it.
    assert.doesNotMatch(render("[reuters.com/x](https://www.reuters.com/x)"), /↗/);
    assert.doesNotMatch(render("https://www.reuters.com/x"), /↗/);
  });

  test("a link's title can't claim to be somewhere else", () => {
    const html = render(`[x](https://evil.example/ "Official Reuters page")`);
    assert.doesNotMatch(html, /Reuters/);
    assert.match(html, /title="evil\.example"/);
  });

  test("raw HTML blocks are escaped, never emitted", () => {
    const html = render("<script>alert(1)</script>\n\nhello");
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /<p>hello<\/p>/);
  });

  test("inline HTML with event handlers is escaped", () => {
    const html = render('Look: <img src=x onerror="alert(1)"> here');
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  test("javascript: and data: links are dropped, keeping the link text", () => {
    const js = render("[click](javascript:alert(1))");
    assert.doesNotMatch(js, /<a /);
    assert.doesNotMatch(js, /javascript:/);
    assert.match(js, /<p>click<\/p>/);

    const data = render("[click](data:text/html;base64,PHNjcmlwdD4=)");
    assert.doesNotMatch(data, /<a /);
    assert.match(data, /click/);

    // Mixed case and leading whitespace do not sneak through.
    assert.doesNotMatch(render("[x]( JavaScript:alert(1))"), /<a /);
  });

  test("https links open in a new tab with rel=noopener", () => {
    const html = render("[Site](https://example.com/path?q=1)");
    assert.match(html, /<a href="\/open-link\?to=https%3A%2F%2Fexample\.com%2Fpath%3Fq%3D1" title="example\.com" target="_blank" rel="noopener noreferrer">Site<\/a>/);
  });

  test("attribute values inside a kept link are escaped", () => {
    const html = render('[x](https://example.com/?a=1&b="2")');
    assert.equal(opens(html), 'https://example.com/?a=1&b="2"');
    assert.doesNotMatch(html, /href="[^"]*"[^>]*"2"/);
  });

  test("an address with no usable site isn't a link", () => {
    assert.doesNotMatch(render("[x](https://)"), /<a /);
  });

  test("a protocol-relative link is another site, so it is refused", () => {
    assert.doesNotMatch(render("[x](//evil.example/a)"), /<a /);
    assert.doesNotMatch(render("[x](/\\evil.example/a)"), /<a /);
  });

  test("mailto:, tel:, site-relative and anchor links are kept without target=_blank", () => {
    assert.match(render("[m](mailto:someone@example.com)"), /<a href="mailto:someone@example.com">m<\/a>/);
    assert.match(render("[t](tel:+15550100)"), /<a href="tel:\+15550100">t<\/a>/);
    assert.match(render("[p](/people/sam-lee)"), /<a href="\/people\/sam-lee">p<\/a>/);
    assert.match(render("[a](#notes)"), /<a href="#notes">a<\/a>/);
    assert.doesNotMatch(render("[p](/people/sam-lee)"), /target=/);
  });

  test("images are never loaded: an http(s) image becomes a link, anything else its alt text", () => {
    const img = render("![logo](https://example.com/p.png?d=secret)");
    assert.doesNotMatch(img, /<img/);
    assert.equal(opens(img), "https://example.com/p.png?d=secret");
    assert.match(img, />🖼 logo<\/a>/);
    const bad = render("![alt text](javascript:alert(1))");
    assert.doesNotMatch(bad, /<img/);
    assert.match(bad, /alt text/);
    const data = render("![alt](data:image/svg+xml;base64,AAAA)");
    assert.doesNotMatch(data, /<img/);
  });

  test("ordinary markdown still renders", () => {
    const html = render("# Title\n\n- one\n- two\n\n**bold** and `code`");
    assert.match(html, /<h1[^>]*>Title<\/h1>/);
    assert.match(html, /<li>one<\/li>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
  });
});
