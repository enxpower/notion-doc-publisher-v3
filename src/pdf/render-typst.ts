/**
 * Typst PDF renderer — sidecar PDF publisher.
 *
 * Visual benchmark: production HTML publisher (render-html.ts + render-blocks.ts).
 * Colors, spacing, and component rules are derived directly from:
 *   styles/screen.css   — palette, component rules (pre, table, callout, quote)
 *   styles/print.css    — print-specific sizes (masthead, heading, body text, table)
 *   templates/enterprise.html — document structure order
 *
 * Key visual decisions:
 *   Colors      — CSS custom-property values (--text, --muted, --accent, --line, --soft)
 *   Code blocks — thin all-around border, #f6f7f8 bg; NO left bar  (screen.css pre)
 *   Tables      — neutral top rule; transparent th bg; uppercase muted th text; rows border-bottom only
 *   H1 border   — placed ABOVE the heading to match print.css h2 { border-top }
 *   Masthead    — compact 9pt/6.8pt, 1pt near-black rule  (print.css masthead-brand/slogan)
 *   Line height — 0.85em leading ≈ 1.85× for CJK contract prose
 *   Quote       — 1pt muted left border  (print.css border-left: 0.4mm solid #555)
 *   Callout     — --soft bg + 3pt accent left border  (screen.css .callout)
 *   lang: "zh"  — enables CJK line-break:strict equivalent
 *
 * PDF-specific (no HTML equivalent):
 *   Running page header + footer  (BRAND / DOC_ID · page X of Y)
 *   Signature page: #pagebreak() before 签署页 heading + structured party/field blocks
 *   Divider spacing made weak so heading space always wins
 *   Table column widths: proportional fr units by column count — prevents CJK one-char-per-line
 *     wrapping that occurs with 'auto' columns that compress below readable width.
 *     2-col: 28/72  |  3-col: 20/30/50  |  4-col: 15/20/33/32
 *     5-col: 8/8/18/34/32 (payment/milestone tables)  |  6+ col: equal 1fr
 *   Table header: table.header() repeats the header row on every page the table spans.
 */

import type {
  DocumentModel,
  DocumentBlock,
  RichTextSpan,
} from "../model/document.js";
import type { BrandInfo } from "./types.js";

// ── Palette — aligned 1:1 to CSS custom properties ───────────────────────────
const C = {
  text:       "1a1c20",
  muted:      "6a717b",
  faint:      "9aa1aa",
  line:       "e1e4e9",
  strongLine: "c2c7ce",
  accent:     "1d3f5f",
  soft:       "f7f8fa",
  codeBg:     "f6f7f8",
  codeText:   "1d232b",
};

// ── Font stacks — Latin first, then system CJK fallbacks ─────────────────────
const F = {
  serif: `"Times New Roman", "Noto Serif CJK SC"`,
  sans:  `"Arial", "Noto Sans CJK SC"`,
  mono:  `"Courier New", "Noto Sans Mono CJK SC"`,
};

// ── Low-level helpers ─────────────────────────────────────────────────────────

function rgb(c: string): string {
  return `rgb("${c}")`;
}

function escStr(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

function escContent(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/#/g, "\\#")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/@/g, "\\@")
    .replace(/\$/g, "\\$")
    .replace(/</g, "\\<")
    .replace(/~/g, "\\~");
}

// ── Table column width strategy ────────────────────────────────────────────────
// Use proportional fr units for all columns so the table spans the full content
// width and no column is compressed below a readable line width.
//
// 'auto' columns shrink to content and cause Chinese text to wrap one character
// per line when a table has many columns. fr units distribute the full width
// in fixed ratios, keeping every column readable.
//
// Ratios chosen for common Chinese contract table structures:
//   2-col  28/72  — label + content
//   3-col  20/30/50 — mixed label / description
//   4-col  15/20/33/32 — four-way content
//   5-col  8/8/18/34/32 — payment milestone (节点/比例/节点名称/最低验收目标/付款触发依据)
//   6+ col equal 1fr each
function tableColumns(colCount: number): string {
  if (colCount <= 1) return "1fr";
  if (colCount === 2) return "28fr, 72fr";
  if (colCount === 3) return "20fr, 30fr, 50fr";
  if (colCount === 4) return "15fr, 20fr, 33fr, 32fr";
  if (colCount === 5) return "8fr, 8fr, 18fr, 34fr, 32fr";
  return Array(colCount).fill("1fr").join(", ");
}

// ── Rich text ─────────────────────────────────────────────────────────────────

export function renderRichText(spans: RichTextSpan[]): string {
  return spans
    .map((span) => {
      if (span.code) {
        return `#raw(${JSON.stringify(span.text)})`;
      }
      let out = escContent(span.text);
      if (span.bold)      out = `#text(weight: "bold")[${out}]`;
      if (span.italic)    out = `#text(style: "italic")[${out}]`;
      if (span.underline) out = `#underline[${out}]`;
      if (span.strike)    out = `#strike[${out}]`;
      if (span.href)      out = `#link(${JSON.stringify(span.href)})[${out}]`;
      return out;
    })
    .join("");
}

// ── Block rendering ───────────────────────────────────────────────────────────

function renderBlock(block: DocumentBlock, docId: string): string {
  switch (block.type) {
    case "paragraph": {
      const t = renderRichText(block.richText);
      return t || "#parbreak()";
    }

    case "heading_1": return `= ${renderRichText(block.richText)}`;
    case "heading_2": return `== ${renderRichText(block.richText)}`;
    case "heading_3": return `=== ${renderRichText(block.richText)}`;
    case "heading_4": return `==== ${renderRichText(block.richText)}`;

    case "bulleted_list_item":
      return `- ${renderRichText(block.richText)}`;
    case "numbered_list_item":
      return `+ ${renderRichText(block.richText)}`;

    case "quote":
      return (
        `#block(\n` +
        `  width: 100%,\n` +
        `  stroke: (left: 1pt + ${rgb(C.muted)}),\n` +
        `  inset: (left: 12pt, top: 5pt, bottom: 5pt, right: 0pt),\n` +
        `)[#text(style: "italic", fill: ${rgb(C.muted)})[${renderRichText(block.richText)}]]`
      );

    case "callout":
      return (
        `#block(\n` +
        `  width: 100%,\n` +
        `  fill: ${rgb(C.soft)},\n` +
        `  stroke: (left: 3pt + ${rgb(C.accent)}, rest: 0.5pt + ${rgb(C.line)}),\n` +
        `  radius: (right: 2pt),\n` +
        `  inset: (left: 13pt, top: 9pt, bottom: 9pt, right: 13pt),\n` +
        `)[${renderRichText(block.richText)}]`
      );

    case "code": {
      const code = block.richText.map((s) => s.text).join("");
      const lang = block.language && block.language !== "plain text" ? block.language : "";
      return `#raw(block: true, lang: "${escStr(lang)}", ${JSON.stringify(code)})`;
    }

    case "divider":
      // Both v() calls are weak so a following heading's larger v() always wins,
      // preventing dividers from collapsing section-heading top spacing.
      return (
        `#v(10pt, weak: true)\n` +
        `#line(length: 100%, stroke: 0.3pt + ${rgb(C.line)})\n` +
        `#v(10pt, weak: true)`
      );

    case "table": {
      if (!block.rows.length) return "";
      const colCount = Math.max(...block.rows.map((r) => r.length));
      if (colCount === 0) return "";

      const cols = tableColumns(colCount);

      // Rules: neutral dark top, light after-header (repeating), faint between rows.
      // Header row is wrapped in table.header() so it repeats on every page the
      // table spans. Header cells use #text() styling only — no fill property.
      const parts: string[] = [];
      parts.push(`  table.hline(stroke: 0.8pt + ${rgb(C.text)}),`);

      // Header inside table.header() for page-break repetition
      const headerRow = block.rows[0];
      const headerCells = headerRow.map((cell) => {
        const content = renderRichText(cell);
        return (
          `    [#text(font: (${F.sans}), size: 7.5pt, weight: "bold", ` +
          `fill: ${rgb(C.muted)}, tracking: 0.06em)[#upper[${content}]]],`
        );
      });
      parts.push(
        `  table.header(\n` +
        headerCells.join("\n") + "\n" +
        `    table.hline(stroke: 0.7pt + ${rgb(C.strongLine)}),\n` +
        `  ),`
      );

      // Body rows
      for (let ri = 1; ri < block.rows.length; ri++) {
        const row = block.rows[ri];
        for (const cell of row) {
          parts.push(`  [${renderRichText(cell)}],`);
        }
        if (ri < block.rows.length - 1) {
          parts.push(`  table.hline(stroke: 0.5pt + ${rgb(C.line)}),`);
        }
      }
      parts.push(`  table.hline(stroke: 0.5pt + ${rgb(C.line)}),`);

      return (
        `#table(\n` +
        `  columns: (${cols}),\n` +
        `  inset: (x: 8pt, y: 5.5pt),\n` +
        `  align: top + left,\n` +
        `  stroke: none,\n` +
        parts.join("\n") + "\n" +
        `)`
      );
    }

    case "image": {
      const asset = block.asset;
      if (!asset.local) {
        const alt = asset.alt ?? asset.caption?.map((s) => s.text).join("") ?? "Image";
        return (
          `#block[#text(fill: ${rgb(C.faint)}, size: 9pt, style: "italic")` +
          `[\\[Image: ${escContent(alt)}\\]]]`
        );
      }
      const filename = asset.outputPath.split("/").pop() ?? "";
      const imgSrc = `assets/docs/${docId}/${escStr(filename)}`;
      const captionText = asset.caption?.map((s) => s.text).join("") || asset.alt || "";
      return captionText
        ? `#figure(image("${imgSrc}", width: 90%), caption: [${escContent(captionText)}])`
        : `#figure(image("${imgSrc}", width: 90%))`;
    }

    case "file": {
      const asset = block.asset;
      const label = asset.caption?.map((s) => s.text).join("") || asset.alt || "File";
      return asset.sourceUrl
        ? `#text(fill: ${rgb(C.accent)})[#link(${JSON.stringify(asset.sourceUrl)})[${escContent(label)}]]`
        : `#text(fill: ${rgb(C.faint)}, style: "italic")[\\[File: ${escContent(label)}\\]]`;
    }

    case "unsupported":
      return (
        `#block(fill: ${rgb(C.soft)}, stroke: 0.5pt + ${rgb("c9a449")}, ` +
        `inset: (x: 10pt, y: 6pt), radius: 2pt)` +
        `[#text(fill: ${rgb("8a6d00")}, size: 9pt, style: "italic")` +
        `[\\[Unsupported block: ${escContent(block.notionType)}\\]]]`
      );

    default:
      return "";
  }
}

// ── Signature party block ─────────────────────────────────────────────────────

function renderSigPartyBlock(header: string, fields: string[]): string {
  const h       = escContent(header.replace(/\s+$/, ""));
  const partyEl = `#text(font: (${F.sans}), size: 10.5pt, weight: "bold", fill: ${rgb(C.text)})[${h}]`;
  const rulePt  = `#line(length: 3.5in, stroke: 0.5pt + ${rgb(C.strongLine)})`;

  if (fields.length === 0) {
    return `#v(20pt)\n${partyEl}\n#v(3pt)\n${rulePt}`;
  }

  const gridRows: string[] = [];
  for (const field of fields) {
    const clean = field.replace(/\s+$/, "").trim();
    if (!clean) continue;

    const colonIdx = clean.indexOf("：");
    const label    = colonIdx >= 0 ? clean.slice(0, colonIdx + 1) : clean + "：";
    const rawValue = colonIdx >= 0 ? clean.slice(colonIdx + 1).trim() : "";
    const labelEl  = `[#text(font: (${F.sans}), size: 9pt, fill: ${rgb(C.muted)})[${escContent(label)}]]`;

    if (label.includes("盖章") || label.includes("Seal") || label.includes("Stamp")) {
      gridRows.push(
        `${labelEl}, ` +
        `[#rect(width: 1.8in, height: 0.9in, stroke: 0.5pt + ${rgb(C.strongLine)})]`
      );
    } else if (rawValue) {
      gridRows.push(`${labelEl}, [#text(size: 9pt)[${escContent(rawValue)}]]`);
    } else {
      gridRows.push(
        `${labelEl}, [#v(4pt)#line(length: 100%, stroke: 0.5pt + ${rgb(C.strongLine)})]`
      );
    }
  }

  if (gridRows.length === 0) {
    return `#v(20pt)\n${partyEl}\n#v(3pt)\n${rulePt}`;
  }

  return (
    `#v(20pt)\n` +
    `${partyEl}\n` +
    `#v(3pt)\n` +
    `${rulePt}\n` +
    `#v(10pt)\n` +
    `#grid(\n` +
    `  columns: (1.9in, 2.6in),\n` +
    `  row-gutter: 14pt,\n` +
    `  align: (top + left, bottom + left),\n` +
    `  ${gridRows.join(",\n  ")},\n` +
    `)`
  );
}

// ── Preamble ──────────────────────────────────────────────────────────────────

function renderPreamble(
  meta: DocumentModel["meta"],
  brand: BrandInfo,
): string {
  const brandName = escContent(brand.displayName.toUpperCase());
  const docId     = escContent(meta.docId ?? "");
  const footerRef = [meta.docId, meta.version].filter(Boolean).map(escContent).join(" · ");

  return `\
// ── ARCBOS Sidecar PDF Publisher ─────────────────────────────────────────────
// Visual language from styles/screen.css + print.css

// ── Page layout ───────────────────────────────────────────────────────────────
#set page(
  paper: "us-letter",
  margin: (left: 0.8in, right: 0.8in, top: 0.8in, bottom: 0.8in),
  header: context {
    if counter(page).get().first() > 1 {
      block(
        width: 100%,
        stroke: (bottom: 0.5pt + ${rgb(C.line)}),
        inset: (bottom: 5pt),
      )[
        #set text(font: (${F.sans}), size: 7.5pt)
        #grid(
          columns: (1fr, auto),
          align: (left + bottom, right + bottom),
          [#text(weight: "bold", fill: ${rgb(C.text)})[${brandName}]],
          [#text(fill: ${rgb(C.faint)})[${docId}]],
        )
      ]
    }
  },
  footer: context [
    #block(
      width: 100%,
      stroke: (top: 0.5pt + ${rgb(C.line)}),
      inset: (top: 5pt),
    )[
      #set text(font: (${F.sans}), size: 7pt, fill: ${rgb(C.faint)})
      #grid(
        columns: (1fr, auto),
        align: (left + top, right + top),
        [${footerRef}],
        [Page #counter(page).display() of #counter(page).final().first()],
      )
    ]
  ],
)

// ── Base typography ───────────────────────────────────────────────────────────
// lang: "zh" enables CJK line-break:strict — no mid-word breaks in Chinese.
#set text(font: (${F.serif}), size: 11pt, fill: ${rgb(C.text)}, lang: "zh")
#set par(leading: 0.85em, spacing: 14pt, justify: true, first-line-indent: 0pt)

// ── List settings ─────────────────────────────────────────────────────────────
#set list(indent: 0.8em, body-indent: 0.5em)
#set enum(indent: 0.8em, body-indent: 0.5em)

// ── Link show rule ────────────────────────────────────────────────────────────
#show link: it => text(fill: ${rgb(C.accent)})[#underline(
  stroke: 0.5pt + ${rgb(C.accent)},
  offset: 2pt,
  it
)]

// ── Heading show rules ────────────────────────────────────────────────────────
// bookmarked: true adds PDF navigation bookmarks for each heading.
#set heading(bookmarked: true)
#show heading.where(level: 1): it => {
  v(26pt, weak: true)
  block(
    width: 100%,
    stroke: (top: 0.5pt + ${rgb(C.line)}),
    inset: (top: 10pt, bottom: 0pt),
  )[
    #set text(font: (${F.sans}), size: 15pt, weight: "semibold", fill: ${rgb(C.text)})
    #it.body
  ]
  v(16pt, weak: true)
}
#show heading.where(level: 2): it => {
  v(20pt, weak: true)
  text(font: (${F.sans}), size: 13pt, weight: "semibold", fill: ${rgb(C.text)})[#it.body]
  v(12pt, weak: true)
}
#show heading.where(level: 3): it => {
  v(16pt, weak: true)
  text(font: (${F.sans}), size: 11pt, weight: "semibold", fill: ${rgb(C.text)})[#it.body]
  v(9pt, weak: true)
}
#show heading.where(level: 4): it => {
  v(12pt, weak: true)
  text(font: (${F.sans}), size: 10pt, weight: "semibold", fill: ${rgb(C.text)})[#it.body]
  v(7pt, weak: true)
}

// ── Code show rules ───────────────────────────────────────────────────────────
// Inline and block code: uniform border, light neutral bg, NO left bar.
#show raw.where(block: false): it => box(
  fill: ${rgb(C.codeBg)},
  stroke: 0.5pt + ${rgb(C.line)},
  inset: (x: 3pt, y: 1.5pt),
  radius: 3pt,
)[#text(font: (${F.mono}), size: 9.5pt, fill: ${rgb(C.codeText)})[#it]]

#show raw.where(block: true): it => block(
  width: 100%,
  fill: ${rgb(C.codeBg)},
  stroke: 0.5pt + ${rgb(C.line)},
  radius: 3pt,
  inset: (left: 14pt, top: 11pt, bottom: 11pt, right: 12pt),
)[#set text(lang: "en")
#text(font: (${F.mono}), size: 9pt, fill: ${rgb(C.codeText)})[#it]]`;
}

// ── Cover zone ────────────────────────────────────────────────────────────────

function renderCover(
  meta: DocumentModel["meta"],
  brand: BrandInfo,
): string {
  const brandName = escContent(brand.displayName.toUpperCase());
  const tagline   = escContent((brand.tagline ?? "").toUpperCase());
  const docType   = escContent((meta.documentType?.label ?? "Document").toUpperCase());
  const title     = escContent(meta.title ?? "(Untitled)");
  const docId     = escContent(meta.docId ?? "");

  const rawTitle       = meta.title ?? "";
  const rawVer         = meta.version ?? "";
  const versionInTitle = rawVer && rawTitle.includes(rawVer);
  const version        = rawVer && !versionInTitle ? escContent(rawVer) : "";
  const client         = escContent(meta.client?.label ?? "");
  const project        = escContent(meta.project?.label ?? "");
  const status         = escContent(meta.status ?? "");

  const mastheadBrand = `#text(font: (${F.sans}), size: 9pt, weight: "bold", fill: ${rgb(C.text)}, tracking: 0.08em)[${brandName}]`;
  const mastheadTag   = tagline
    ? `#text(font: (${F.sans}), size: 6.8pt, weight: "bold", fill: ${rgb(C.muted)}, tracking: 0.08em)[${tagline}]`
    : "";
  const masthead = mastheadTag
    ? (
        `#grid(\n` +
        `  columns: (1fr, auto),\n` +
        `  align: (bottom + left, bottom + right),\n` +
        `  [${mastheadBrand}],\n` +
        `  [${mastheadTag}],\n` +
        `)`
      )
    : mastheadBrand;

  const mastheadRule = [
    `#v(8pt)`,
    `#line(length: 100%, stroke: 1pt + ${rgb(C.text)})`,
  ];

  const kicker  = `#text(font: (${F.sans}), size: 7pt, weight: "bold", fill: ${rgb(C.muted)}, tracking: 0.08em)[${docType}]`;
  const titleEl = `#text(font: (${F.sans}), size: 22pt, weight: "semibold", fill: ${rgb(C.text)}, hyphenate: false, lang: "zh")[${title}]`;

  const idParts: string[] = [];
  if (docId)   idParts.push(`#text(weight: "bold")[${docId}]`);
  if (docType) idParts.push(docType);
  if (version) idParts.push(version);
  const identityContent = idParts.join(` #text(fill: ${rgb(C.faint)})[ · ]`);
  const identityEl = identityContent
    ? `#text(font: (${F.sans}), size: 8pt, fill: ${rgb(C.muted)})[${identityContent}]`
    : "";

  const dtStyle = `font: (${F.sans}), size: 6.8pt, weight: "bold", fill: ${rgb(C.faint)}, tracking: 0.08em`;
  const ddStyle = `font: (${F.sans}), size: 9pt, fill: ${rgb(C.text)}`;
  const metaRows: string[] = [];
  if (client)  metaRows.push(`  [#text(${dtStyle})[CLIENT]],  [#text(${ddStyle})[${client}]]`);
  if (project) metaRows.push(`  [#text(${dtStyle})[PROJECT]], [#text(${ddStyle})[${project}]]`);
  if (status)  metaRows.push(`  [#text(${dtStyle})[STATUS]],  [#text(${ddStyle})[${status}]]`);
  const metaGrid = metaRows.length > 0
    ? `#grid(\n  columns: (1.3in, 1fr),\n  row-gutter: 6pt,\n${metaRows.join(",\n")},\n)`
    : "";

  const parts: string[] = [
    masthead,
    ...mastheadRule,
    `#v(8pt)`,
    kicker,
    `#v(6pt)`,
    titleEl,
  ];

  if (identityEl) {
    parts.push(`#v(10pt)`);
    parts.push(`#line(length: 100%, stroke: 0.5pt + ${rgb(C.line)})`);
    parts.push(`#v(7pt)`);
    parts.push(identityEl);
  }

  if (metaGrid) {
    parts.push(`#v(10pt)`);
    parts.push(metaGrid);
  }

  // No TOC in contract PDFs
  parts.push(`#v(12pt)`);
  parts.push(`#line(length: 100%, stroke: 0.5pt + ${rgb(C.line)})`);
  parts.push(`#v(18pt)`);

  return parts.join("\n");
}

// ── Signature page detection ──────────────────────────────────────────────────

function isSignaturePage(block: DocumentBlock): boolean {
  if (
    block.type !== "heading_1" &&
    block.type !== "heading_2" &&
    block.type !== "heading_3"
  ) {
    return false;
  }
  const text = block.richText.map((s) => s.text).join("").trim();
  return (
    text.includes("签署页") ||
    text.includes("签字页") ||
    text.toLowerCase().includes("signature page") ||
    text.toLowerCase().includes("signatures")
  );
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function renderDocumentTypst(
  doc: DocumentModel,
  brand: BrandInfo,
): string {
  const preamble = renderPreamble(doc.meta, brand);
  const cover    = renderCover(doc.meta, brand);
  const docId    = doc.meta.docId ?? "";

  const bodyParts: string[] = [];
  const blocks = doc.content;
  let i = 0;

  let inSignaturePage = false;
  let sigPartyHeader  = "";
  const sigFields: string[] = [];

  function flushSigParty(): void {
    if (!sigPartyHeader) return;
    bodyParts.push(renderSigPartyBlock(sigPartyHeader, [...sigFields]));
    sigPartyHeader = "";
    sigFields.length = 0;
  }

  while (i < blocks.length) {
    const block = blocks[i];

    if (isSignaturePage(block)) {
      flushSigParty();
      inSignaturePage = true;
      bodyParts.push(`#pagebreak()\n#v(30pt)`);
    }

    if (inSignaturePage && block.type === "paragraph") {
      const text  = block.richText.map((s) => s.text).join("");
      const clean = text.replace(/\s+$/, "").trim();
      if (clean.startsWith("甲方：") || clean.startsWith("乙方：") ||
          /^Party [AB][:：]/i.test(clean)) {
        flushSigParty();
        sigPartyHeader = clean;
      } else if (clean) {
        sigFields.push(clean);
      }
      i++;
      continue;
    }

    if (inSignaturePage && block.type === "divider") {
      i++;
      continue;
    }

    if (block.type === "bulleted_list_item") {
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === "bulleted_list_item") {
        items.push(`- ${renderRichText((blocks[i] as { richText: RichTextSpan[] }).richText)}`);
        i++;
      }
      bodyParts.push(items.join("\n"));
      continue;
    }

    if (block.type === "numbered_list_item") {
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === "numbered_list_item") {
        items.push(`+ ${renderRichText((blocks[i] as { richText: RichTextSpan[] }).richText)}`);
        i++;
      }
      bodyParts.push(items.join("\n"));
      continue;
    }

    const rendered = renderBlock(block, docId);
    if (rendered) bodyParts.push(rendered);
    i++;
  }

  flushSigParty();

  return (
    `${preamble}\n\n` +
    `${cover}\n\n` +
    `${bodyParts.join("\n\n")}`
  );
}
