/**
 * Typst PDF renderer for the prototype review pipeline.
 *
 * Visual language is derived directly from the production HTML publisher:
 *   styles/screen.css  — screen palette and component rules
 *   styles/print.css   — print-specific sizing that we translate here
 *   templates/enterprise.html — structure order (masthead → title → meta → body)
 *   src/render/render-blocks.ts — table/code/quote patterns we mirror in Typst
 *
 * Key decisions inherited from the HTML publisher:
 *   - Colors: CSS custom-property values, not invented hues
 *   - Code blocks: thin all-around border + light bg; NO left bar (screen.css pre)
 *   - Tables: 2pt accent top rule (.table-wrap border-top); th transparent bg, uppercase,
 *             muted (th { background: transparent; text-transform: uppercase }); rows border-bottom only
 *   - H1 (Notion heading_1): top border BEFORE the heading, matching print.css h2 { border-top }
 *   - Masthead: compact 9pt/6.8pt to match print.css masthead-brand/slogan, 1pt rule
 *   - Line height: 0.85em ≈ 1.85× — more generous than print.css 1.5× for CJK contracts
 *   - Quote: thin 1pt muted left border (print.css: border-left: 0.4mm solid #555555)
 *   - Callout: --soft (#f7f8fa) fill, 3px accent left border (screen.css .callout)
 *   - Signature page: auto-detect "签署页" → #pagebreak() + extra space
 */

import type {
  DocumentModel,
  DocumentBlock,
  RichTextSpan,
} from "../../src/model/document.js";

export type BrandInfo = { displayName: string; tagline: string };

// ── Palette — aligned to CSS custom properties ────────────────────────────────
// screen.css: --text #1a1c20, --muted #6a717b, --faint #9aa1aa, --line #e1e4e9
//             --strong-line #c2c7ce, --accent #1d3f5f, --soft #f7f8fa
// screen.css: pre { background: #f6f7f8; color: #1d232b }
const C = {
  text:       "1a1c20",  // --text (body prose)
  muted:      "6a717b",  // --muted (labels, secondary)
  faint:      "9aa1aa",  // --faint (header/footer, tertiary)
  line:       "e1e4e9",  // --line (light rules, cell borders)
  strongLine: "c2c7ce",  // --strong-line (header-row separator)
  accent:     "1d3f5f",  // --accent / --brand-accent
  soft:       "f7f8fa",  // --soft (callout background)
  codeBg:     "f6f7f8",  // pre { background }
  codeText:   "1d232b",  // pre { color }
};

// ── Font stacks ───────────────────────────────────────────────────────────────
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

    // Heading markers — styled via #show rules in preamble.
    // Notion heading_1 → H1 level in .typ; maps to h2 in HTML renderer (document title is h1).
    case "heading_1": return `= ${renderRichText(block.richText)}`;
    case "heading_2": return `== ${renderRichText(block.richText)}`;
    case "heading_3": return `=== ${renderRichText(block.richText)}`;
    case "heading_4": return `==== ${renderRichText(block.richText)}`;

    // Handled in the main loop via list grouping; fallback just in case
    case "bulleted_list_item":
      return `- ${renderRichText(block.richText)}`;
    case "numbered_list_item":
      return `+ ${renderRichText(block.richText)}`;

    case "quote":
      // print.css blockquote: border-left: 0.4mm solid #555555; padding-left: 4mm; font-style: italic
      // Thin 1pt muted border — NOT the heavy 3pt navy used in the old prototype
      return (
        `#block(\n` +
        `  width: 100%,\n` +
        `  stroke: (left: 1pt + ${rgb(C.muted)}),\n` +
        `  inset: (left: 11pt, top: 4pt, bottom: 4pt, right: 0pt),\n` +
        `)[#text(style: "italic", fill: ${rgb(C.muted)})[${renderRichText(block.richText)}]]`
      );

    case "callout":
      // screen.css .callout: border: 1px solid line; border-left: 3px solid accent;
      //                       border-radius: 3px; background: var(--soft) = #f7f8fa
      return (
        `#block(\n` +
        `  width: 100%,\n` +
        `  fill: ${rgb(C.soft)},\n` +
        `  stroke: (left: 3pt + ${rgb(C.accent)}, rest: 0.5pt + ${rgb(C.line)}),\n` +
        `  radius: (right: 2pt),\n` +
        `  inset: (left: 13pt, top: 9pt, bottom: 9pt, right: 12pt),\n` +
        `)[${renderRichText(block.richText)}]`
      );

    case "code": {
      // screen.css pre: border: 1px solid line; border-radius: 4px; bg: #f6f7f8; color: #1d232b
      // NO left bar. Thin all-around border. Styling via #show raw.where(block:true) in preamble.
      const code = block.richText.map((s) => s.text).join("");
      const lang = block.language && block.language !== "plain text" ? block.language : "";
      return `#raw(block: true, lang: "${escStr(lang)}", ${JSON.stringify(code)})`;
    }

    case "divider":
      // screen.css hr: border-top: 1px solid line; margin: 32px 0
      return `#v(6pt)\n#line(length: 100%, stroke: 0.5pt + ${rgb(C.line)})\n#v(6pt)`;

    case "table": {
      if (!block.rows.length) return "";
      const colCount = Math.max(...block.rows.map((r) => r.length));
      if (colCount === 0) return "";
      const cols = Array(colCount).fill("1fr").join(", ");

      // screen.css .table-wrap: border-top: 2px solid var(--brand-accent)
      // screen.css th: background: transparent; color: var(--muted); font-size: 10px;
      //               font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase
      // print.css th:  color: #555555; font-size: 6.8pt; letter-spacing: 0.08em; text-transform: uppercase
      // screen/print td/th: border-bottom: 1px solid line — NO other borders
      //
      // Strategy: stroke: none on table, use table.hline() for explicit rules.
      const parts: string[] = [];

      // 2pt accent line at top of table (= .table-wrap border-top)
      parts.push(`  table.hline(stroke: 2pt + ${rgb(C.accent)}),`);

      for (let ri = 0; ri < block.rows.length; ri++) {
        const row = block.rows[ri];
        for (const cell of row) {
          const content = renderRichText(cell);
          if (ri === 0) {
            // th: transparent bg (no fill), muted uppercase small text
            parts.push(
              `  [#text(font: (${F.sans}), size: 7.5pt, weight: "bold", ` +
              `fill: ${rgb(C.muted)}, tracking: 0.06em)[#upper[${content}]]],`
            );
          } else {
            parts.push(`  [${content}],`);
          }
        }
        // After header row: 1pt stronger separator (matches visual th/td break)
        if (ri === 0) {
          parts.push(`  table.hline(stroke: 1pt + ${rgb(C.strongLine)}),`);
        } else if (ri < block.rows.length - 1) {
          // Between body rows: light 0.5pt separator
          parts.push(`  table.hline(stroke: 0.5pt + ${rgb(C.line)}),`);
        }
      }
      // Bottom rule on last row
      parts.push(`  table.hline(stroke: 0.5pt + ${rgb(C.line)}),`);

      return (
        `#table(\n` +
        `  columns: (${cols}),\n` +
        `  inset: (x: 8pt, y: 6pt),\n` +
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
      // outputPath is "../../assets/docs/{docId}/{filename}" — extract filename
      const filename = asset.outputPath.split("/").pop() ?? "";
      // .typ is at prototype/output/{docId}.typ; assets at prototype/output/assets/docs/{docId}/
      const imgSrc = `assets/docs/${docId}/${escStr(filename)}`;
      const captionText =
        asset.caption?.map((s) => s.text).join("") || asset.alt || "";
      return captionText
        ? `#figure(image("${imgSrc}", width: 90%), caption: [${escContent(captionText)}])`
        : `#figure(image("${imgSrc}", width: 90%))`;
    }

    case "file": {
      const asset = block.asset;
      const label =
        asset.caption?.map((s) => s.text).join("") || asset.alt || "File";
      return asset.sourceUrl
        ? `#text(fill: ${rgb(C.accent)})[#link(${JSON.stringify(asset.sourceUrl)})[${escContent(label)}]]`
        : `#text(fill: ${rgb(C.faint)}, style: "italic")[\\[File: ${escContent(label)}\\]]`;
    }

    case "unsupported":
      return (
        `#text(fill: ${rgb(C.faint)}, size: 9pt, style: "italic")` +
        `[\\[${escContent(block.notionType)}: not rendered\\]]`
      );

    default:
      return "";
  }
}

// ── Preamble ──────────────────────────────────────────────────────────────────

function renderPreamble(
  meta: DocumentModel["meta"],
  brand: BrandInfo,
): string {
  const brandName = escContent(brand.displayName.toUpperCase());
  const docId     = escContent(meta.docId ?? "");
  const title     = escContent(truncate(meta.title ?? "", 80));

  return `\
// ────────────────────────────────────────────────────────────────────────────
// PDF Review Prototype — visual language from styles/screen.css + print.css
// ────────────────────────────────────────────────────────────────────────────

// ── Page layout ───────────────────────────────────────────────────────────────
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
        [${title}],
        [Page #counter(page).display() of #counter(page).final().first()],
      )
    ]
  ],
)

// ── Base typography ───────────────────────────────────────────────────────────
// print.css: 10.5pt/1.5 — we use 11pt with leading 0.85em ≈ 1.85× for CJK contracts
#set text(font: (${F.serif}), size: 11pt, fill: ${rgb(C.text)}, lang: "en")
#set par(leading: 0.85em, spacing: 12pt, justify: true, first-line-indent: 0pt)

// ── Heading show rules ────────────────────────────────────────────────────────
// print.css h2: margin-top: 9mm; padding-top: 4mm; border-top: 0.2mm solid #ddd; font-size: 15pt
// Border is placed ABOVE the heading (top), matching HTML print style.
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
// NO left bar. Thin all-around border. Light neutral background.
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
)[#text(font: (${F.mono}), size: 9pt, fill: ${rgb(C.codeText)})[#it]]`;
}

// ── Cover zone ────────────────────────────────────────────────────────────────
// Structure from enterprise.html + print.css sizing:
//   masthead → rule → title-block (kicker + h1) → identity → metadata grid → body separator

function renderCover(
  meta: DocumentModel["meta"],
  brand: BrandInfo,
): string {
  const brandName = escContent(brand.displayName.toUpperCase());
  const tagline   = escContent((brand.tagline ?? "").toUpperCase());
  const docType   = escContent((meta.documentType?.label ?? "Document").toUpperCase());
  const title     = escContent(meta.title ?? "(Untitled)");
  const docId     = escContent(meta.docId ?? "");
  const version   = meta.version ? escContent(`Version ${meta.version}`) : "";
  const client    = escContent(meta.client?.label ?? "");
  const project   = escContent(meta.project?.label ?? "");
  const status    = escContent(meta.status ?? "");

  // print.css: masthead-brand { font-size: 9pt; font-weight: 700; letter-spacing: 0.08em }
  // print.css: masthead-slogan { font-size: 6.8pt; font-weight: 700; letter-spacing: 0.08em }
  const mastheadBrand = `#text(font: (${F.sans}), size: 9pt, weight: "bold", fill: ${rgb(C.text)}, tracking: 0.08em)[${brandName}]`;
  const mastheadTagline = tagline
    ? `#text(font: (${F.sans}), size: 6.8pt, weight: "bold", fill: ${rgb(C.muted)}, tracking: 0.08em)[${tagline}]`
    : "";

  const masthead = mastheadTagline
    ? (
        `#grid(\n` +
        `  columns: (1fr, auto),\n` +
        `  align: (bottom + left, bottom + right),\n` +
        `  [${mastheadBrand}],\n` +
        `  [${mastheadTagline}],\n` +
        `)`
      )
    : mastheadBrand;

  // print.css: document-masthead { padding-bottom: 4mm; border-bottom: 0.4mm solid #333 }
  // ~1pt border, not 2pt. Near-black, not brand navy.
  const mastheadBorder = [
    `#v(8pt)`,
    `#line(length: 100%, stroke: 1pt + ${rgb(C.text)})`,
  ];

  // print.css: document-title-block { padding: 8mm 0 0 } — 8mm ≈ 23pt; we use 18pt
  // print.css: document-kicker { font-size: 7pt; letter-spacing: 0.08em; margin-bottom: 3mm }
  const kicker = `#text(font: (${F.sans}), size: 7pt, weight: "bold", fill: ${rgb(C.muted)}, tracking: 0.08em)[${docType}]`;

  // print.css h1: font-size: 22pt; font-weight: 600 (semibold); line-height: 1.15
  const titleEl = `#text(font: (${F.sans}), size: 22pt, weight: "semibold", fill: ${rgb(C.text)}, hyphenate: false)[${title}]`;

  // print.css: document-identity { margin-top: 4mm; padding-top: 3mm; border-top: 0.2mm solid }
  // docId · type · version on one line, muted
  const identityParts: string[] = [];
  if (docId)   identityParts.push(`#text(weight: "bold")[${docId}]`);
  if (docType) identityParts.push(docType);
  if (version) identityParts.push(version);
  const identityContent = identityParts.join(` #text(fill: ${rgb(C.faint)})[ · ]`);
  const identityEl = identityContent
    ? `#text(font: (${F.sans}), size: 8pt, fill: ${rgb(C.muted)})[${identityContent}]`
    : "";

  // print.css: dt { font-size: 6.8pt; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase }
  //            dd { font-size: 9pt; font-family: sans }
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
    ...mastheadBorder,
    `#v(18pt)`,
    kicker,
    `#v(7pt)`,
    titleEl,
  ];

  if (identityEl) {
    // print.css: identity border-top: 0.2mm, margin-top: 4mm ≈ 11pt, padding-top: 3mm ≈ 8pt
    parts.push(`#v(10pt)`);
    parts.push(`#line(length: 100%, stroke: 0.5pt + ${rgb(C.line)})`);
    parts.push(`#v(7pt)`);
    parts.push(identityEl);
  }

  if (metaGrid) {
    // print.css: document-summary { padding: 5mm 0 7mm }
    parts.push(`#v(10pt)`);
    parts.push(metaGrid);
  }

  // print.css: summary border-bottom before body starts
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

  while (i < blocks.length) {
    const block = blocks[i];

    // Signature page: break to new page before the heading
    if (isSignaturePage(block)) {
      bodyParts.push(`#pagebreak()\n#v(36pt)`);
    }

    // Group consecutive bullet items into a single Typst list
    if (block.type === "bulleted_list_item") {
      const items: string[] = [];
      while (i < blocks.length) {
        const b = blocks[i];
        if (b.type !== "bulleted_list_item") break;
        items.push(`- ${renderRichText(b.richText)}`);
        i++;
      }
      bodyParts.push(items.join("\n"));
      continue;
    }

    // Group consecutive numbered items
    if (block.type === "numbered_list_item") {
      const items: string[] = [];
      while (i < blocks.length) {
        const b = blocks[i];
        if (b.type !== "numbered_list_item") break;
        items.push(`+ ${renderRichText(b.richText)}`);
        i++;
      }
      bodyParts.push(items.join("\n"));
      continue;
    }

    const rendered = renderBlock(block, docId);
    if (rendered) bodyParts.push(rendered);
    i++;
  }

  return `${preamble}\n\n${cover}\n\n${bodyParts.join("\n\n")}`;
}
