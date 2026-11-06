import { marked } from "marked";
import { isExternal, safeHref } from "@/lib/safeHref";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Content rendered here comes from models, fetched emails/transcripts, and
// pasted text — never trust raw HTML from it. Escape HTML blocks/inlines and
// refuse javascript:/data:/protocol-relative URLs (lib/safeHref.ts), and never
// load a remote image by itself: an image URL written by a steered model could
// carry CRM data off the machine the moment the page renders, so an image is
// shown as a link the owner can choose to open. (The CSP in next.config.ts
// blocks remote images as well.)
marked.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const safe = safeHref(href);
      const inner = this.parser.parseInline(tokens);
      if (!safe) return inner;
      const external = isExternal(safe);
      return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inner}</a>`;
    },
    image({ href, title, text }) {
      const safe = safeHref(href);
      if (!safe || !isExternal(safe)) return escapeHtml(text);
      const label = escapeHtml(text || "image");
      return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noopener noreferrer">🖼 ${label}</a>`;
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
