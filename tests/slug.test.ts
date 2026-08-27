import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../lib/slug";

describe("slugify", () => {
  test("lowercases and joins words with single dashes", () => {
    assert.equal(slugify("Sam Lee"), "sam-lee");
    assert.equal(slugify("Acme   Holdings"), "acme-holdings");
  });

  test("strips accents", () => {
    assert.equal(slugify("Zoë Müller-Brown"), "zoe-muller-brown");
    assert.equal(slugify("Café Ölé"), "cafe-ole");
    assert.equal(slugify("François Ñandú"), "francois-nandu");
  });

  test("collapses punctuation into a single dash", () => {
    assert.equal(slugify("Acme, Inc."), "acme-inc");
    assert.equal(slugify("O'Brien & Sons (UK) Ltd"), "o-brien-sons-uk-ltd");
    assert.equal(slugify("a.b_c/d"), "a-b-c-d");
  });

  test("trims leading and trailing separators", () => {
    assert.equal(slugify("  --Hello World!!  "), "hello-world");
    assert.equal(slugify("***"), "");
    assert.equal(slugify(""), "");
  });

  test("keeps digits", () => {
    assert.equal(slugify("Studio 54"), "studio-54");
  });
});
