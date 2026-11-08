/**
 * The one link allowlist for rendered model, email and pasted text (the web
 * Markdown renderer and the Word export): http(s), mailto and tel links, and
 * paths on this site. A protocol-relative "//host" or "/\host" is another
 * site, so it is refused like javascript:, data: and file: are.
 */
export function safeHref(href: string | null | undefined): string | null {
  const h = String(href ?? "").trim();
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  if (/^\/(?![/\\])/.test(h) || h.startsWith("#")) return h;
  return null;
}

/** An address on another site (opened in a new tab, never fetched by itself). */
export function isExternal(href: string): boolean {
  return /^https?:/i.test(href);
}

/** The site an external link really goes to ("www." dropped), shown next to the link so its text can't disguise it. */
export function linkHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * An external link without its query string or fragment. Text a model wrote
 * can come from a steered run, and a link is how it would carry data out:
 * one click sends whatever is in the address. So model-written links keep
 * only the page itself.
 */
export function withoutQuery(href: string): string {
  try {
    const u = new URL(href);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return href;
  }
}
