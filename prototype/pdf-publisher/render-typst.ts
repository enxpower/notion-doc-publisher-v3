import type {
  DocumentModel,
  DocumentBlock,
  RichTextSpan,
} from "../../src/model/document.js";

export type BrandInfo = { displayName: string; tagline: string };

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  title:  "0a0c10",  // near-black — masthead, major titles
  body:   "1e2028",  // very dark gray — prose
  muted:  "52596a",  // medium gray — secondary copy, version line
  faint:  "8b93a3",  // light gray — labels, header/footer text
  rule:   "ced3dd",  // very light — decorative rules
  accent: "002d62",  // deep navy — code bar, quote border, callout
  thBg:   "edf0f5",  // table header background
  codeBg: "f3f5f8",  // code block background
  callBg: "f0f3fb",  // callout background (faint navy tint)
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
        // #raw() handles its own escaping; do not escContent
        return `#raw(${JSON.stringify(span.text)})`;
      }
      let out = escContent(span.text);
      // Apply inner-to-outer: bold/italic first, then decorations, then link
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
      // Empty paragraphs produce a paragraph break
      return t || "#parbreak()";
    }

    // Heading markers — styled by #show rules in preamble
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
      return (
        `#block(\n` +
        `  width: 100%,\n` +
        `  stroke: (left: 3pt + ${rgb(C.accent)}),\n` +
        `  inset: (left: 14pt, top: 6pt, bottom: 6pt, right: 4pt),\n` +
        `)[#text(style: "italic", fill: ${rgb(C.muted)})[${renderRichText(block.richText)}]]`
      );

    case "callout":
      return (
        `#block(\n` +
        `  width: 100%,\n` +
        `  fill: ${rgb(C.callBg)},\n` +
        `  stroke: (left: 3pt + ${rgb(C.accent)}, rest: 0.5pt + ${rgb(C.rule)}),\n` +
        `  inset: (left: 14pt, top: 8pt, bottom: 8pt, right: 10pt),\n` +
        `)[${renderRichText(block.richText)}]`
      );

    case "code": {
      const code = block.richText.map((s) => s.text).join("");
      const lang = block.language && block.language !== "plain text" ? block.language : "";
      // Styling handled by #show raw.where(block: true) in preamble
      return `#raw(block: true, lang: "${escStr(lang)}", ${JSON.stringify(code)})`;
    }

    case "divider":
      return `#v(4pt)\n#line(length: 100%, stroke: 0.5pt + ${rgb(C.rule)})\n#v(4pt)`;

    case "table": {
      if (!block.rows.length) return "";
      const colCount = Math.max(...block.rows.map((r) => r.length));
      if (colCount === 0) return "";
      const cols = Array(colCount).fill("1fr").join(", ");

      const cellLines: string[] = [];
      for (let ri = 0; ri < block.rows.length; ri++) {
        const row = block.rows[ri];
        for (const cell of row) {
          const content = renderRichText(cell);
          cellLines.push(
            ri === 0
              ? `  table.cell(fill: ${rgb(C.thBg)})[#text(font: (${F.sans}), weight: "bold", size: 9pt)[${content}]]`
              : `  [${content}]`
          );
        }
      }

      return (
        `#table(\n` +
        `  columns: (${cols}),\n` +
        `  inset: (x: 8pt, y: 6pt),\n` +
        `  stroke: (_, y) => if y == 0 { (bottom: 1pt + ${rgb(C.muted)}) } else { (bottom: 0.5pt + ${rgb(C.rule)}) },\n` +
        cellLines.join(",\n") + ",\n" +
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
        ? `#text(fill: ${rgb(C.accent)})[→ #link(${JSON.stringify(asset.sourceUrl)})[${escContent(label)}]]`
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
// PDF Review Prototype — generated by prototype/pdf-publisher/render-typst.ts
// ────────────────────────────────────────────────────────────────────────────

// ── Page layout ───────────────────────────────────────────────────────────────
#set page(
  paper: "us-letter",
  margin: (left: 1.25in, right: 1in, top: 1in, bottom: 1in),
  header: context {
    if counter(page).get().first() > 1 {
      block(
        width: 100%,
        stroke: (bottom: 0.5pt + ${rgb(C.rule)}),
        inset: (bottom: 5pt),
      )[
        #set text(font: (${F.sans}), size: 7.5pt)
        #grid(
          columns: (1fr, auto),
          align: (left + bottom, right + bottom),
          [#text(weight: "bold", fill: ${rgb(C.title)})[${brandName}]],
          [#text(fill: ${rgb(C.faint)})[${docId}]],
        )
      ]
    }
  },
  footer: context [
    #block(
      width: 100%,
      stroke: (top: 0.5pt + ${rgb(C.rule)}),
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
#set text(font: (${F.serif}), size: 11pt, fill: ${rgb(C.body)}, lang: "en")
#set par(leading: 0.7em, spacing: 10pt, justify: true, first-line-indent: 0pt)

// ── Heading show rules ────────────────────────────────────────────────────────
#show heading.where(level: 1): it => {
  v(22pt, weak: true)
  block(
    width: 100%,
    stroke: (bottom: 0.5pt + ${rgb(C.rule)}),
    inset: (bottom: 6pt),
  )[
    #set text(font: (${F.sans}), size: 14pt, weight: "bold", fill: ${rgb(C.title)})
    #it.body
  ]
  v(8pt, weak: true)
}
#show heading.where(level: 2): it => {
  v(16pt, weak: true)
  text(font: (${F.sans}), size: 13pt, weight: "bold", fill: ${rgb(C.title)})[#it.body]
  v(6pt, weak: true)
}
#show heading.where(level: 3): it => {
  v(12pt, weak: true)
  text(font: (${F.sans}), size: 11.5pt, weight: "bold", fill: ${rgb(C.body)})[#it.body]
  v(4pt, weak: true)
}
#show heading.where(level: 4): it => {
  v(10pt, weak: true)
  text(font: (${F.sans}), size: 10.5pt, weight: "bold", style: "italic", fill: ${rgb(C.body)})[#it.body]
  v(2pt, weak: true)
}

// ── Code show rules ───────────────────────────────────────────────────────────
#show raw.where(block: false): it => box(
  fill: ${rgb(C.codeBg)},
  inset: (x: 2.5pt, y: 1.5pt),
  radius: 2pt,
)[#text(font: (${F.mono}), size: 9.5pt, fill: ${rgb(C.body)})[#it]]

#show raw.where(block: true): it => block(
  width: 100%,
  fill: ${rgb(C.codeBg)},
  stroke: (left: 2pt + ${rgb(C.accent)}),
  inset: (left: 12pt, top: 9pt, bottom: 9pt, right: 10pt),
  radius: (right: 2pt),
)[#text(font: (${F.mono}), size: 9pt, fill: ${rgb(C.body)})[#it]]`;
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
  const version   = escContent(meta.version ?? "");
  const docId     = escContent(meta.docId ?? "");
  const client    = escContent(meta.client?.label ?? "");
  const project   = escContent(meta.project?.label ?? "");
  const status    = escContent(meta.status ?? "");

  // Derive a human date from DOC_ID year/month (YYMM suffix)
  const ymMatch = (meta.docId ?? "").match(/(\d{2})(\d{2})-\d+$/);
  let dateStr = "";
  if (ymMatch) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun",
                    "Jul","Aug","Sep","Oct","Nov","Dec"];
    const mo = parseInt(ymMatch[2], 10);
    const yr = `20${ymMatch[1]}`;
    dateStr = escContent(`${months[mo - 1] ?? ""} ${yr}`.trim());
  }

  // ── Masthead row (brand + tagline) ─────────────────────────────────────────
  const masthead = brand.tagline?.trim()
    ? (
        `#grid(\n` +
        `  columns: (1fr, auto),\n` +
        `  align: (bottom + left, bottom + right),\n` +
        `  [#text(font: (${F.sans}), size: 12pt, weight: "bold", fill: ${rgb(C.title)}, tracking: 0.6pt)[${brandName}]],\n` +
        `  [#text(font: (${F.sans}), size: 7.5pt, weight: "bold", fill: ${rgb(C.faint)}, tracking: 0.4pt)[${tagline}]],\n` +
        `)`
      )
    : `#text(font: (${F.sans}), size: 12pt, weight: "bold", fill: ${rgb(C.title)}, tracking: 0.6pt)[${brandName}]`;

  // ── Metadata grid ──────────────────────────────────────────────────────────
  const labelStyle = `font: (${F.sans}), size: 7.5pt, weight: "bold", fill: ${rgb(C.faint)}, tracking: 0.3pt`;
  const valueStyle = `font: (${F.sans}), size: 9.5pt, fill: ${rgb(C.body)}`;
  const metaRows: string[] = [];
  if (client)  metaRows.push(`  [#text(${labelStyle})[CLIENT]],  [#text(${valueStyle})[${client}]]`);
  if (project) metaRows.push(`  [#text(${labelStyle})[PROJECT]], [#text(${valueStyle})[${project}]]`);
  if (docId)   metaRows.push(`  [#text(${labelStyle})[DOC ID]],  [#text(${valueStyle})[${docId}]]`);
  if (status)  metaRows.push(`  [#text(${labelStyle})[STATUS]],  [#text(${valueStyle})[${status}]]`);

  const metaGrid = metaRows.length > 0
    ? `#grid(\n  columns: (1.5in, 1fr),\n  row-gutter: 7pt,\n${metaRows.join(",\n")},\n)`
    : "";

  // ── Version + date line ────────────────────────────────────────────────────
  const versionLine = [version, dateStr].filter(Boolean).join("  ·  ");

  const parts: string[] = [
    masthead,
    `#v(-2pt)`,
    `#line(length: 100%, stroke: 2pt + ${rgb(C.title)})`,
    `#v(32pt)`,
    `// Document type kicker`,
    `#text(font: (${F.sans}), size: 8pt, weight: "bold", fill: ${rgb(C.faint)}, tracking: 1.2pt)[${docType}]`,
    `#v(10pt)`,
    `// Title`,
    `#text(font: (${F.sans}), size: 22pt, weight: "bold", fill: ${rgb(C.title)}, hyphenate: false)[${title}]`,
  ];

  if (versionLine) {
    parts.push(`#v(8pt)`);
    parts.push(`#text(font: (${F.sans}), size: 9pt, fill: ${rgb(C.muted)})[${versionLine}]`);
  }

  parts.push(`#v(24pt)`);
  if (metaGrid) parts.push(metaGrid);
  parts.push(`#v(20pt)`);
  parts.push(`#line(length: 100%, stroke: 0.5pt + ${rgb(C.rule)})`);
  parts.push(`#v(18pt)`);

  return parts.join("\n");
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
