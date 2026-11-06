import { marked } from "marked";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only http(s), mailto, tel, and site-relative links are rendered as links. */
const safeHref = (href: string | null | undefined) => {
  const h = String(href ?? "").trim();
  if (/^(https?:|mailto:|tel:)/i.test(h) || h.startsWith("/") || h.startsWith("#")) return h;
  return null;
};

// Content rendered here comes from models, fetched emails/transcripts, and
// pasted text — never trust raw HTML from it. Escape HTML blocks/inlines and
// refuse javascript:/data: URLs, everything else renders as normal markdown.
marked.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const safe = safeHref(href);
      const inner = this.parser.parseInline(tokens);
      if (!safe) return inner;
      const external = /^https?:/i.test(safe);
      return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inner}</a>`;
    },
    image({ href, title, text }) {
      const safe = safeHref(href);
      if (!safe || !/^https?:/i.test(safe)) return escapeHtml(text);
      return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy">`;
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

export default function Markdown({ children }: { children: string }) {
  const html = marked.parse(rewriteLinks(children), { async: false }) as string;
  return (
    <div className="prose-crm" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
