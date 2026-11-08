import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Markdown, { renderMarkdown } from "../components/Markdown";

const render = (md: string) => renderMarkdown(md);

describe("Markdown sanitisation", () => {
  test("the module exports a component and its renderer", () => {
    assert.equal(typeof Markdown, "function");
  });

  test("an external link shows the site it really goes to; in model-written text it loses its query (SEC-029)", () => {
    const md = "Met at the summit [(per calendar)](https://evil.example/c?r=sam-lee,active#x).";
    const own = render(md);
    assert.match(own, /href="https:\/\/evil\.example\/c\?r=sam-lee,active#x"/, "your own notes keep their links");
    assert.match(own, /↗ evil\.example/);
    const model = renderMarkdown(md, true);
    assert.match(model, /href="https:\/\/evil\.example\/c"/);
    assert.doesNotMatch(model, /sam-lee/);
    assert.match(model, /↗ evil\.example/);
    // A link whose text already names the site doesn't repeat it.
    assert.doesNotMatch(render("[reuters.com/x](https://www.reuters.com/x)"), /↗/);
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

  test("https links are kept and open in a new tab with rel=noopener", () => {
    const html = render("[Site](https://example.com/path?q=1 \"Title\")");
    assert.match(html, /<a href="https:\/\/example\.com\/path\?q=1" title="Title" target="_blank" rel="noopener noreferrer">Site<\/a>/);
  });

  test("attribute values inside a kept link are escaped", () => {
    const html = render('[x](https://example.com/?a=1&b="2")');
    assert.match(html, /href="https:\/\/example\.com\/\?a=1&amp;b=&quot;2&quot;"/);
    assert.doesNotMatch(html, /href="[^"]*"[^>]*"2"/);
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
    assert.match(img, /<a href="https:\/\/example\.com\/p\.png\?d=secret" target="_blank" rel="noopener noreferrer">🖼 logo<\/a>/);
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
