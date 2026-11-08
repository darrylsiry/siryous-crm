import { Marked } from "marked";
import { isExternal, linkHost, safeHref, withoutQuery } from "@/lib/safeHref";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The site after an external link, unless its text already shows it. */
const hostNote = (href: string, text: string) => {
  const host = linkHost(href);
  return host && !text.toLowerCase().includes(host.toLowerCase()) ? `<span class="text-xs text-stone-500"> ↗ ${escapeHtml(host)}</span>` : "";
};

// Content rendered here comes from models, fetched emails/transcripts, and
// pasted text — never trust raw HTML from it. Escape HTML blocks/inlines and
// refuse javascript:/data:/protocol-relative URLs (lib/safeHref.ts), and never
// load a remote image by itself: an image URL written by a steered model could
// carry CRM data off the machine the moment the page renders, so an image is
// shown as a link the owner can choose to open. (The CSP in next.config.ts
// blocks remote images as well.) Every external link shows the site it really
// goes to, and in text a model wrote it loses its query string and fragment,
// which is where data would ride out on a click (lib/safeHref.ts withoutQuery).
function renderer(modelWritten: boolean) {
  const external = (href: string) => (modelWritten ? withoutQuery(href) : href);
  return new Marked({
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, title, tokens }) {
        const safe = safeHref(href);
        const inner = this.parser.parseInline(tokens);
        if (!safe) return inner;
        if (!isExternal(safe)) return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${inner}</a>`;
        const to = external(safe);
        return `<a href="${escapeHtml(to)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noopener noreferrer">${inner}</a>${hostNote(to, inner)}`;
      },
      image({ href, title, text }) {
        const safe = safeHref(href);
        if (!safe || !isExternal(safe)) return escapeHtml(text);
        const label = escapeHtml(text || "image");
        const to = external(safe);
        return `<a href="${escapeHtml(to)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noopener noreferrer">🖼 ${label}</a>${hostNote(to, label)}`;
      },
    },
  });
}
const OWN = renderer(false);
const MODEL = renderer(true);

/** Rewrite relative profile links (../people/x.md, companies/y.md) to app routes. Slugs may be in any script. */
function rewriteLinks(md: string): string {
  const to = (table: "people" | "companies") => (_: string, slug: string) => `(/${table}/${encodeURIComponent(slug)})`;
  return md
    .replace(/\((?:\.\.\/)?people\/([\p{L}\p{N}-]+)\.md\)/gu, to("people"))
    .replace(/\((?:\.\.\/)?companies\/([\p{L}\p{N}-]+)\.md\)/gu, to("companies"))
    .replace(/\(([\p{L}\p{N}-]+)\.md\)/gu, to("people"));
}

/** The HTML for some Markdown, sanitised as above. */
export function renderMarkdown(md: string, modelWritten = false): string {
  return (modelWritten ? MODEL : OWN).parse(rewriteLinks(md), { async: false }) as string;
}

/** `modelWritten`: text an AI wrote (a brief, advice, a draft's summary), whose external links lose their query string. */
export default function Markdown({ children, modelWritten = false }: { children: string; modelWritten?: boolean }) {
  const html = renderMarkdown(children, modelWritten);
  return (
    <div className="prose-crm" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
