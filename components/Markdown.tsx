import { Marked } from "marked";
import { isExternal, linkHost, safeHref, textNamesSite, throughCheck } from "@/lib/safeHref";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A link to another site: it opens the CRM's page showing the whole address
 * (lib/safeHref.ts throughCheck), and says beside it which site that is, unless
 * its text is that site's own address. The title is the site too, never one the
 * text supplied. An address with no usable site isn't a link at all.
 */
function leavingLink(href: string, inner: string): string {
  const host = linkHost(href);
  if (!host) return inner;
  const site = escapeHtml(host);
  const note = textNamesSite(inner, host) ? "" : `<span class="text-xs text-stone-500"> ↗ ${site}</span>`;
  return `<a href="${escapeHtml(throughCheck(href))}" title="${site}" target="_blank" rel="noopener noreferrer">${inner}</a>${note}`;
}

// Content rendered here comes from models, fetched emails/transcripts, and
// pasted text, and once saved it can't be told from the owner's own: never
// trust raw HTML from it. Escape HTML blocks/inlines and refuse
// javascript:/data:/protocol-relative URLs (lib/safeHref.ts), and never load a
// remote image by itself: an image URL written by a steered model could carry
// CRM data off the machine the moment the page renders, so an image is shown as
// a link the owner can choose to open. (The CSP in next.config.ts blocks remote
// images as well.) No link here reaches another site directly: see leavingLink.
const MARKED = new Marked({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const safe = safeHref(href);
      const inner = this.parser.parseInline(tokens);
      if (!safe) return inner;
      if (isExternal(safe)) return leavingLink(safe, inner);
      return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${inner}</a>`;
    },
    image({ href, text }) {
      const safe = safeHref(href);
      if (!safe || !isExternal(safe)) return escapeHtml(text);
      return leavingLink(safe, `🖼 ${escapeHtml(text || "image")}`);
    },
  },
});

/** Rewrite relative profile links (../people/x.md, companies/y.md) to app routes. Slugs may be in any script. */
function rewriteLinks(md: string): string {
  const to = (table: "people" | "companies") => (_: string, slug: string) => `(/${table}/${encodeURIComponent(slug)})`;
  return md
    .replace(/\((?:\.\.\/)?people\/([\p{L}\p{N}-]+)\.md\)/gu, to("people"))
    .replace(/\((?:\.\.\/)?companies\/([\p{L}\p{N}-]+)\.md\)/gu, to("companies"))
    .replace(/\(([\p{L}\p{N}-]+)\.md\)/gu, to("people"));
}

/** The HTML for some Markdown, sanitised as above. */
export function renderMarkdown(md: string): string {
  return MARKED.parse(rewriteLinks(md), { async: false }) as string;
}

export default function Markdown({ children }: { children: string }) {
  const html = renderMarkdown(children);
  return (
    <div className="prose-crm" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
