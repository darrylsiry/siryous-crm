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
 * An external link without its query string or fragment: the page itself. A
 * model's text can come from a steered run, and an address is how it would
 * carry data out, so this is the default wherever only the page is needed.
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

/**
 * Where a link in rendered text goes first: the CRM's own page
 * (app/(app)/open-link) that shows the whole address and opens it only when
 * the owner says so. Rendered text can't be told apart from what a model
 * wrote, and one click on a direct link would send whatever is in its query,
 * path or subdomain.
 */
export function throughCheck(href: string): string {
  return `/open-link?to=${encodeURIComponent(href)}`;
}

/**
 * Whether a link's text is itself this site's address or domain ("reuters.com/x"),
 * so a note naming the site would only repeat it. Parsed, not searched: the text
 * "reuters.com" contains the host "rs.com" but doesn't name it. Text with
 * non-ASCII letters or a user@ part never counts, because it can look like another site.
 */
export function textNamesSite(text: string, host: string): boolean {
  const t = text.replace(/<[^>]*>/g, "").trim();
  if (!t || !/^[\x21-\x7e]+$/.test(t)) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return !u.username && !u.password && u.hostname.replace(/^www\./, "").toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
