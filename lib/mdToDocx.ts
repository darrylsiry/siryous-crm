import { marked, type Token, type Tokens } from "marked";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

/**
 * Convert a Markdown prep brief into an editable Word document. Covers what
 * briefs actually contain — headings, bullet/numbered lists, bold/italic/code,
 * links, blockquotes, horizontal rules — with sane Word styles throughout.
 */

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

type Inline = TextRun | ExternalHyperlink;

function inlineRuns(
  tokens: Token[] | undefined,
  style: { bold?: boolean; italics?: boolean } = {}
): Inline[] {
  const out: Inline[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...inlineRuns((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineRuns((t as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "codespan":
        out.push(new TextRun({ text: (t as Tokens.Codespan).text, font: "Courier New", ...style }));
        break;
      case "link": {
        const link = t as Tokens.Link;
        out.push(
          new ExternalHyperlink({
            link: link.href,
            children: [new TextRun({ text: link.text || link.href, style: "Hyperlink", ...style })],
          })
        );
        break;
      }
      case "br":
        out.push(new TextRun({ break: 1 }));
        break;
      case "del":
        out.push(...inlineRuns((t as Tokens.Del).tokens, style));
        break;
      default: {
        const text = "text" in t ? (t as Tokens.Text).text : ("raw" in t ? t.raw : "");
        if ("tokens" in t && t.tokens?.length) out.push(...inlineRuns(t.tokens, style));
        else if (text) out.push(new TextRun({ text: decode(text), ...style }));
      }
    }
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

function blockToParagraphs(token: Token, listLevel = 0): Paragraph[] {
  switch (token.type) {
    case "heading": {
      const h = token as Tokens.Heading;
      return [
        new Paragraph({
          heading: HEADINGS[Math.min(h.depth, 6) - 1],
          children: inlineRuns(h.tokens),
        }),
      ];
    }
    case "paragraph":
      return [
        new Paragraph({
          children: inlineRuns((token as Tokens.Paragraph).tokens),
          spacing: { after: 120 },
        }),
      ];
    case "list": {
      const list = token as Tokens.List;
      const out: Paragraph[] = [];
      list.items.forEach((item, i) => {
        let first = true;
        for (const child of item.tokens) {
          if (child.type === "list") {
            out.push(...blockToParagraphs(child, listLevel + 1));
          } else if (child.type === "text" || child.type === "paragraph") {
            const runs = inlineRuns((child as Tokens.Text).tokens ?? [child]);
            if (list.ordered && first) {
              runs.unshift(new TextRun({ text: `${(list.start || 1) + i}. `, bold: true }));
            }
            out.push(
              new Paragraph({
                children: runs,
                bullet: list.ordered ? undefined : { level: Math.min(listLevel, 8) },
                indent: list.ordered
                  ? { left: 360 + listLevel * 360 }
                  : undefined,
                spacing: { after: 60 },
              })
            );
            first = false;
          }
        }
      });
      return out;
    }
    case "blockquote": {
      const bq = token as Tokens.Blockquote;
      return bq.tokens.flatMap((inner) =>
        inner.type === "paragraph"
          ? [
              new Paragraph({
                children: inlineRuns((inner as Tokens.Paragraph).tokens, { italics: true }),
                indent: { left: 480 },
                border: { left: { style: BorderStyle.SINGLE, size: 12, color: "AAAAAA" } },
                spacing: { after: 120 },
              }),
            ]
          : blockToParagraphs(inner)
      );
    }
    case "code":
      return (token as Tokens.Code).text.split("\n").map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line, font: "Courier New", size: 18 })],
            spacing: { after: 0 },
          })
      );
    case "hr":
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
          spacing: { after: 200 },
        }),
      ];
    case "space":
      return [];
    default:
      return "raw" in token && token.raw.trim()
        ? [new Paragraph({ children: [new TextRun(decode(token.raw.trim()))] })]
        : [];
  }
}

export async function markdownToDocx(md: string, footerNote?: string): Promise<Buffer> {
  const tokens = marked.lexer(md);
  const children = tokens.flatMap((t) => blockToParagraphs(t));
  if (footerNote) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: footerNote, italics: true, size: 16, color: "888888" })],
        spacing: { before: 300 },
        alignment: AlignmentType.LEFT,
      })
    );
  }
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
        heading1: { run: { size: 32, bold: true, color: "1F1F1F" }, paragraph: { spacing: { before: 240, after: 160 } } },
        heading2: { run: { size: 26, bold: true, color: "333333" }, paragraph: { spacing: { before: 220, after: 120 } } },
        heading3: { run: { size: 23, bold: true, color: "444444" }, paragraph: { spacing: { before: 180, after: 100 } } },
      },
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
