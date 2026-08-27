import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
// Importing the component registers the sanitising renderer overrides on the
// shared `marked` instance (module side effect). The component itself is never rendered here.
import Markdown from "../components/Markdown";

const render = (md: string) => marked.parse(md, { async: false }) as string;

describe("Markdown sanitisation", () => {
  test("the module exports a component and registers the renderer", () => {
    assert.equal(typeof Markdown, "function");
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

  test("mailto:, tel:, site-relative and anchor links are kept without target=_blank", () => {
    assert.match(render("[m](mailto:someone@example.com)"), /<a href="mailto:someone@example.com">m<\/a>/);
    assert.match(render("[t](tel:+15550100)"), /<a href="tel:\+15550100">t<\/a>/);
    assert.match(render("[p](/people/sam-lee)"), /<a href="\/people\/sam-lee">p<\/a>/);
    assert.match(render("[a](#notes)"), /<a href="#notes">a<\/a>/);
    assert.doesNotMatch(render("[p](/people/sam-lee)"), /target=/);
  });

  test("images: only http(s) sources render; others fall back to the alt text", () => {
    assert.match(render("![logo](https://example.com/logo.png)"), /<img src="https:\/\/example\.com\/logo\.png" alt="logo" loading="lazy">/);
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
