/**
 * Typst PDF renderer for the prototype review pipeline.
 *
 * Visual benchmark: production HTML publisher (render-html.ts + render-blocks.ts).
 * Colors, spacing, and component rules are derived directly from:
 *   styles/screen.css   — palette, component rules (pre, table, callout, quote)
 *   styles/print.css    — print-specific sizes (masthead, heading, body text, table)
 *   templates/enterprise.html — document structure order
 *
 * Key inherited decisions:
 *   Colors      — CSS custom-property values (--text, --muted, --accent, --line, --soft)
 *   Code blocks — thin all-around border, #f6f7f8 bg; NO left bar  (screen.css pre)
 *   Tables      — 2pt accent top rule; transparent th bg; uppercase muted th text; rows border-bottom only
 *   H1 border   — placed ABOVE the heading to match print.css h2 { border-top }
 *   Masthead    — compact 9pt/6.8pt, 1pt near-black rule  (print.css masthead-brand/slogan)
 *   Line height — 0.85em leading ≈ 1.85× for CJK contract prose
 *   Quote       — 1pt muted left border  (print.css border-left: 0.4mm solid #555)
 *   Callout     — --soft bg + 3pt accent left border  (screen.css .callout)
 *   lang: "zh"  — enables CJK line-break:strict equivalent
 *
 * PDF-specific additions (no HTML equivalent):
 *   Running page header + footer  (DOC_ID · page X of Y)
 *   Table of Contents via #outline()
 *   Signature page: #pagebreak() before heading + structured party/field blocks
 *   Closing document footer (brand + DOC_ID reference)
 *   Divider spacing made weak so heading space always wins
 *   Smart table column widths: auto for all but last col, 1fr for last
 */

import type {
  DocumentModel,
  DocumentBlock,
  RichTextSpan,
} from "../../src/model/document.js";

export type BrandInfo = { displayName: string; tagline: string };

// ── Palette — aligned 1:1 to CSS custom properties ───────────────────────────
// screen.css: --text #1a1c20, --muted #6a717b, --faint #9aa1aa, --line #e1e4e9
//             --strong-line #c2c7ce, --accent #1d3f5f, --soft #f7f8fa
// screen.css: pre { background: #f6f7f8; color: #1d232b }
const C = {
  text:       "1a1c20",   // --text (body prose)
  muted:      "6a717b",   // --muted (labels, secondary)
  faint:      "9aa1aa",   // --faint (header/footer, tertiary)
  line:       "e1e4e9",   // --line (light rules, cell borders)
  strongLine: "c2c7ce",   // --strong-line (header-row separator, sig lines)
  accent:     "1d3f5f",   // --accent / --brand-accent
  soft:       "f7f8fa",   // --soft (callout background)
  codeBg:     "f6f7f8",   // pre { background }
  codeText:   "1d232b",   // pre { color }
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

/** Escape for Typst string literals "..." */
function escStr(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

/** Escape for Typst content mode [...] */
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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ── Table column width heuristic ──────────────────────────────────────────────
// HTML: table { width: 100% } with auto-sized columns.
// PDF strategy: auto for all but the last column (content-sized), 1fr for last
// (takes remaining width).  For narrow tables this keeps short codes compact
// and gives long-text columns (description, conditions) the space they need.
function tableColumns(colCount: number): string {
  if (colCount <= 1) return "1fr";
  if (colCount === 2) return "auto, 1fr";
  return [...Array(colCount - 1).fill("auto"), "1fr"].join(", ");
}

// ── Rich text ─────────────────────────────────────────────────────────────────

export function renderRichText(spans: RichTextSpan[]): string {
  return spans
    .map((span) => {
      if (span.code) {
        // #raw() handles its own escaping
        return `#raw(${JSON.stringify(span.text)})`;
      }
      let out = escContent(span.text);
      if (span.bold)      out = `#text(weight: "bold")[${out}]`;
      if (span.italic)    out = `#text(style: "italic")[${out}]`;
      if (span.underline) out = `#underline[${out}]`;
      if (span.strike)    out = `#strike[${out}]`;
      // Links: href styling applied via #show link in preamble
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

    // Heading markers — visual styling via #show rules in preamble.
    // Notion heading_1 → Typst = (level 1)  → HTML h2 (print.css h2: 15pt, border-top)
    // Notion heading_2 → Typst == (level 2) → HTML h3 (print.css h3: 13pt)
    // Notion heading_3 → Typst === (level 3) → HTML h4 (print.css h4: 11pt)
    // Notion heading_4 → Typst ==== (level 4) → HTML h5 (print.css h5: 10pt)
    case "heading_1": return `= ${renderRichText(block.richText)}`;
    case "heading_2": return `== ${renderRichText(block.richText)}`;
    case "heading_3": return `=== ${renderRichText(block.richText)}`;
    case "heading_4": return `==== ${renderRichText(block.richText)}`;

    // List items — grouping happens in the main loop; these are fallback
    case "bulleted_list_item":
      return `- ${renderRichText(block.richText)}`;
    case "numbered_list_item":
      return `+ ${renderRichText(block.richText)}`;

    case "quote":
      // print.css blockquote: padding-left: 4mm; border-left: 0.4mm solid #555555; font-style: italic
      // Thin 1pt muted border — intentionally restrained for contract documents
      return (
        `#block(\n` +
        `  width: 100%,\n` +
        `  stroke: (left: 1pt + ${rgb(C.muted)}),\n` +
        `  inset: (left: 12pt, top: 5pt, bottom: 5pt, right: 0pt),\n` +
        `)[#text(style: "italic", fill: ${rgb(C.muted)})[${renderRichText(block.richText)}]]`
      );

    case "callout":
      // screen.css .callout: border: 1px solid line; border-left: 3px solid accent;
      //                       border-radius: 3px; background: var(--soft) = #f7f8fa
      // print.css .callout:  padding: 2mm 3mm; border: 0.2mm solid #999999
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
      // screen.css pre: border: 1px solid line; border-radius: 4px; bg: #f6f7f8; color: #1d232b
      // print.css pre:  border: 0.2mm solid #999; bg: #ffffff; white-space: pre-wrap
      // Decision: use screen.css style (light bg, thin border, NO left bar)
      // Styling via #show raw.where(block: true) in preamble
      const code = block.richText.map((s) => s.text).join("");
      const lang = block.language && block.language !== "plain text" ? block.language : "";
      return `#raw(block: true, lang: "${escStr(lang)}", ${JSON.stringify(code)})`;
    }

    case "divider":
      // screen.css hr: border-top: 1px solid line; margin: 32px 0
      // print.css: hr inherits margin in print — appears as a light separator
      // IMPORTANT: both v() calls are weak so heading's larger v() wins when
      // a divider immediately precedes a heading (avoiding collapsed section spacing)
      return (
        `#v(10pt, weak: true)\n` +
        `#line(length: 100%, stroke: 0.3pt + ${rgb(C.line)})\n` +
        `#v(10pt, weak: true)`
      );

    case "table": {
      if (!block.rows.length) return "";
      const colCount = Math.max(...block.rows.map((r) => r.length));
      if (colCount === 0) return "";

      // Smart column widths: auto-size all but last column, give last col remaining space.
      // This keeps short cells (codes, percentages, amounts) compact while long-text
      // columns (description, conditions) expand to fill available width.
      const cols = tableColumns(colCount);

      // table.hline() strategy (no default cell strokes):
      //   top of table  → 2pt accent  (= .table-wrap { border-top: 2px solid brand-accent })
      //   after header  → 1pt strong  (= visual th/body separation)
      //   between rows  → 0.5pt light (= td { border-bottom: 1px solid line })
      //   after last row → 0.5pt light
      const parts: string[] = [];
      parts.push(`  table.hline(stroke: 2pt + ${rgb(C.accent)}),`);

      for (let ri = 0; ri < block.rows.length; ri++) {
        const row = block.rows[ri];
        for (const cell of row) {
          const content = renderRichText(cell);
          if (ri === 0) {
            // th: NO fill. Muted uppercase small text.
            // screen.css th: background: transparent; color: muted; font-size: 10px; text-transform: uppercase
            // print.css th:  color: #555555; font-size: 6.8pt; letter-spacing: 0.08em; text-transform: uppercase
            parts.push(
              `  [#text(font: (${F.sans}), size: 7.5pt, weight: "bold", ` +
              `fill: ${rgb(C.muted)}, tracking: 0.06em)[#upper[${content}]]],`
            );
          } else {
            parts.push(`  [${content}],`);
          }
        }
        if (ri === 0) {
          parts.push(`  table.hline(stroke: 1pt + ${rgb(C.strongLine)}),`);
        } else if (ri < block.rows.length - 1) {
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
// Renders one party's block (甲方/乙方 + fields) as a formal signing area.

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
      // Stamp/seal area — empty rect
      gridRows.push(
        `${labelEl}, ` +
        `[#rect(width: 1.8in, height: 0.9in, stroke: 0.5pt + ${rgb(C.strongLine)})]`
      );
    } else if (rawValue) {
      // Field with pre-filled value (e.g. 签署日期：2026年__月__日)
      gridRows.push(`${labelEl}, [#text(size: 9pt)[${escContent(rawValue)}]]`);
    } else {
      // Blank signature line
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
// Emits all #set and #show rules that govern the entire document.

function renderPreamble(
  meta: DocumentModel["meta"],
  brand: BrandInfo,
): string {
  const brandName  = escContent(brand.displayName.toUpperCase());
  const docId      = escContent(meta.docId ?? "");
  // Footer: compact DOC_ID · version (not the long document title)
  const footerRef  = [meta.docId, meta.version].filter(Boolean).map(escContent).join(" · ");

  return `\
// ────────────────────────────────────────────────────────────────────────────
// PDF Review Prototype — visual language from styles/screen.css + print.css
// ────────────────────────────────────────────────────────────────────────────

// ── Page layout ───────────────────────────────────────────────────────────────
// print.css: @page { size: letter; margin: 18mm }
// We use slightly wider margins (1.25in left) for contract prose readability.
#set page(
  paper: "us-letter",
  margin: (left: 1.25in, right: 1in, top: 1in, bottom: 1in),
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
// print.css body: 10.5pt/1.5 Georgia + Noto Serif CJK SC serif
// We use 11pt with 0.85em leading ≈ 1.85× — slightly more open for dense CJK contracts.
// lang: "zh" enables CJK line-break:strict equivalent (no mid-word breaks in Chinese).
#set text(font: (${F.serif}), size: 11pt, fill: ${rgb(C.text)}, lang: "zh")
#set par(leading: 0.85em, spacing: 12pt, justify: true, first-line-indent: 0pt)

// ── List settings ─────────────────────────────────────────────────────────────
// screen.css: ul,ol { padding-left: 1.45em }  li + li { margin-top: 6px }
#set list(indent: 0.8em, body-indent: 0.5em)
#set enum(indent: 0.8em, body-indent: 0.5em)

// ── Link show rule ────────────────────────────────────────────────────────────
// screen.css: a { color: var(--brand-accent); text-underline-offset: 2px }
// print.css:  a { color: #000000; text-decoration: underline }
// PDF decision: keep brand accent color for visual distinction; add underline.
#show link: it => text(fill: ${rgb(C.accent)})[#underline(
  stroke: 0.5pt + ${rgb(C.accent)},
  offset: 2pt,
  it
)]

// ── Outline (TOC) entry styling ───────────────────────────────────────────────
// Applied in #outline() block in the cover zone.
#show outline.entry: set text(font: (${F.sans}), size: 9.5pt)

// ── Heading show rules ────────────────────────────────────────────────────────
// Notion heading_1 → = (Typst level 1) → HTML h2
// print.css h2: margin-top: 9mm; padding-top: 4mm; border-top: 0.2mm solid #ddd; font-size: 15pt
// Border is placed ABOVE the heading text (top stroke), matching HTML's border-top.
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
  v(12pt, weak: true)
}
// print.css h3: margin-top: 7mm; font-size: 13pt
#show heading.where(level: 2): it => {
  v(20pt, weak: true)
  text(font: (${F.sans}), size: 13pt, weight: "semibold", fill: ${rgb(C.text)})[#it.body]
  v(9pt, weak: true)
}
// print.css h4: margin-top: 6mm; font-size: 11pt
#show heading.where(level: 3): it => {
  v(16pt, weak: true)
  text(font: (${F.sans}), size: 11pt, weight: "semibold", fill: ${rgb(C.text)})[#it.body]
  v(6pt, weak: true)
}
// print.css h5: margin-top: 5mm; font-size: 10pt
#show heading.where(level: 4): it => {
  v(12pt, weak: true)
  text(font: (${F.sans}), size: 10pt, weight: "semibold", fill: ${rgb(C.text)})[#it.body]
  v(4pt, weak: true)
}

// ── Code show rules ───────────────────────────────────────────────────────────
// screen.css pre: border: 1px solid line; border-radius: 4px; bg: #f6f7f8; color: #1d232b
// Inline and block code both: NO left bar, thin all-around border, light neutral bg.
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
// Structure mirrors enterprise.html template order:
//   masthead → rule → kicker → title → identity → metadata → (TOC) → body separator

function renderCover(
  meta: DocumentModel["meta"],
  brand: BrandInfo,
): string {
  const brandName  = escContent(brand.displayName.toUpperCase());
  const tagline    = escContent((brand.tagline ?? "").toUpperCase());
  const docType    = escContent((meta.documentType?.label ?? "Document").toUpperCase());
  const title      = escContent(meta.title ?? "(Untitled)");
  const docId      = escContent(meta.docId ?? "");
  // Show version only if not already embedded in the title string
  const rawTitle   = meta.title ?? "";
  const rawVer     = meta.version ?? "";
  const versionInTitle = rawVer && rawTitle.includes(rawVer);
  const version    = rawVer && !versionInTitle ? escContent(rawVer) : "";
  const client     = escContent(meta.client?.label ?? "");
  const project    = escContent(meta.project?.label ?? "");
  const status     = escContent(meta.status ?? "");

  // ── Masthead ──
  // print.css: masthead-brand { 9pt; 700; letter-spacing: 0.08em; uppercase }
  // print.css: masthead-slogan { 6.8pt; 700; letter-spacing: 0.08em; right }
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

  // print.css: document-masthead { padding-bottom: 4mm; border-bottom: 0.4mm solid #333 }
  const mastheadRule = [
    `#v(8pt)`,
    `#line(length: 100%, stroke: 1pt + ${rgb(C.text)})`,
  ];

  // print.css: document-title-block { padding: 8mm 0 0 } → use 18pt
  // print.css: document-kicker { 7pt; 700; tracking 0.08em; uppercase; margin-bottom: 3mm }
  const kicker = `#text(font: (${F.sans}), size: 7pt, weight: "bold", fill: ${rgb(C.muted)}, tracking: 0.08em)[${docType}]`;

  // print.css: h1 { 22pt; weight: 600; line-height: 1.15 }
  const titleEl = `#text(font: (${F.sans}), size: 22pt, weight: "semibold", fill: ${rgb(C.text)}, hyphenate: false, lang: "zh")[${title}]`;

  // Identity line: DOC_ID · type · version (if not in title)
  // print.css: identity-facts { 8pt; color: #555 }; identity-id { 700 }
  const idParts: string[] = [];
  if (docId)   idParts.push(`#text(weight: "bold")[${docId}]`);
  if (docType) idParts.push(docType);
  if (version) idParts.push(version);
  const identityContent = idParts.join(` #text(fill: ${rgb(C.faint)})[ · ]`);
  const identityEl = identityContent
    ? `#text(font: (${F.sans}), size: 8pt, fill: ${rgb(C.muted)})[${identityContent}]`
    : "";

  // Metadata grid (client / project / status)
  // print.css: dt { 6.8pt; 700; tracking 0.08em; uppercase }  dd { 9pt; sans }
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
    `#v(18pt)`,
    kicker,
    `#v(7pt)`,
    titleEl,
  ];

  if (identityEl) {
    // print.css: identity { margin-top: 4mm; padding-top: 3mm; border-top: 0.2mm solid #b8b8b8 }
    parts.push(`#v(10pt)`);
    parts.push(`#line(length: 100%, stroke: 0.5pt + ${rgb(C.line)})`);
    parts.push(`#v(7pt)`);
    parts.push(identityEl);
  }

  if (metaGrid) {
    // print.css: document-summary { padding: 5mm 0 7mm; border-bottom: 0.2mm solid #b8b8b8 }
    parts.push(`#v(10pt)`);
    parts.push(metaGrid);
  }

  // Cover separator + TOC + body separator
  // The #outline() call auto-collects all headings from the document body.
  parts.push(`#v(12pt)`);
  parts.push(`#line(length: 100%, stroke: 0.5pt + ${rgb(C.line)})`);
  // TOC header label
  parts.push(
    `#v(12pt)\n` +
    `#text(font: (${F.sans}), size: 7pt, weight: "bold", fill: ${rgb(C.faint)}, tracking: 0.1em)[目录  CONTENTS]\n` +
    `#v(5pt)\n` +
    `#outline(title: none, depth: 2, indent: 1.5em)`
  );
  parts.push(`#v(14pt)`);
  parts.push(`#line(length: 100%, stroke: 0.5pt + ${rgb(C.line)})`);
  parts.push(`#v(20pt)`);

  return parts.join("\n");
}

// ── Closing document footer ───────────────────────────────────────────────────
// Mirrors HTML's <footer class="document-footer">:
//   print.css: border-top: 0.4mm solid #333; BRAND  ·  DOC_ID · Version  at 7pt uppercase

function renderClosingFooter(
  meta: DocumentModel["meta"],
  brand: BrandInfo,
): string {
  const brandName = escContent(brand.displayName.toUpperCase());
  const ref = [meta.docId, meta.version ? `v${meta.version.replace(/^v/i, "")}` : ""]
    .filter(Boolean)
    .map(escContent)
    .join(" · ");

  return (
    `#v(28pt)\n` +
    `#line(length: 100%, stroke: 1pt + ${rgb(C.accent)})\n` +
    `#v(7pt)\n` +
    `#grid(\n` +
    `  columns: (1fr, auto),\n` +
    `  align: (left + top, right + top),\n` +
    `  [#text(font: (${F.sans}), size: 7pt, weight: "bold", fill: ${rgb(C.faint)}, tracking: 0.1em)[${brandName}]],\n` +
    `  [#text(font: (${F.sans}), size: 7pt, fill: ${rgb(C.faint)})[${ref}]],\n` +
    `)`
  );
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
  const preamble      = renderPreamble(doc.meta, brand);
  const cover         = renderCover(doc.meta, brand);
  const closingFooter = renderClosingFooter(doc.meta, brand);
  const docId         = doc.meta.docId ?? "";

  const bodyParts: string[] = [];
  const blocks = doc.content;
  let i = 0;

  // Signature-page state
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

    // ── Signature page ────────────────────────────────────────────────────────
    if (isSignaturePage(block)) {
      flushSigParty(); // flush any collected signature fields
      inSignaturePage = true;
      bodyParts.push(`#pagebreak()\n#v(30pt)`);
      // Fall through — render the heading itself normally
    }

    // ── Signature page paragraph handling ────────────────────────────────────
    if (inSignaturePage && block.type === "paragraph") {
      const text  = block.richText.map((s) => s.text).join("");
      const clean = text.replace(/\s+$/, "").trim();
      if (clean.startsWith("甲方：") || clean.startsWith("乙方：") ||
          /^Party [AB][:：]/i.test(clean)) {
        // New party → flush previous
        flushSigParty();
        sigPartyHeader = clean;
      } else if (clean) {
        sigFields.push(clean);
      }
      // Empty paragraphs in signature section are skipped
      i++;
      continue;
    }

    // ── Skip dividers inside signature section ────────────────────────────────
    if (inSignaturePage && block.type === "divider") {
      i++;
      continue;
    }

    // ── List grouping ─────────────────────────────────────────────────────────
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

    // ── General block ─────────────────────────────────────────────────────────
    const rendered = renderBlock(block, docId);
    if (rendered) bodyParts.push(rendered);
    i++;
  }

  // Flush any remaining signature party block
  flushSigParty();

  return (
    `${preamble}\n\n` +
    `${cover}\n\n` +
    `${bodyParts.join("\n\n")}\n\n` +
    `${closingFooter}`
  );
}
