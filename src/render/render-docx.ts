import fs from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from "docx";
import type { AppConfig, BrandProfile } from "../config.js";
import type { DocumentAsset, DocumentBlock, DocumentModel, RichTextSpan } from "../model/document.js";

// ── Page layout (US Letter) ──────────────────────────────────────────────────
const TWIP = 1440;                            // twips per inch
const PAGE_W = Math.round(TWIP * 8.5);       // 12240 twips
const PAGE_H = TWIP * 11;                    // 15840 twips
const MARGIN_T = TWIP;                       // 1"
const MARGIN_B = TWIP;                       // 1"
const MARGIN_L = Math.round(TWIP * 1.25);   // 1800 twips (1.25")
const MARGIN_R = TWIP;                       // 1"
const HDR_DIST = Math.round(TWIP * 0.4);    // 576 twips (0.4") header distance
const FTR_DIST = Math.round(TWIP * 0.4);    // 576 twips

// Content area width ≈ 9240 twips (6.375"). At 96 DPI: 9240/1440 * 96 ≈ 616 px
const IMG_MAX_PX = Math.round(((PAGE_W - MARGIN_L - MARGIN_R) / TWIP) * 96);

// ── Fonts ────────────────────────────────────────────────────────────────────
const FONT_SERIF = { ascii: "Georgia",     hAnsi: "Georgia",     cs: "Times New Roman", eastAsia: "Songti SC" };
const FONT_SANS  = { ascii: "Arial",       hAnsi: "Arial",       cs: "Arial",           eastAsia: "PingFang SC" };
const FONT_MONO  = { ascii: "Courier New", hAnsi: "Courier New", cs: "Courier New",     eastAsia: "Courier New" };

// ── Colours (hex, no #) ──────────────────────────────────────────────────────
const C_TEXT     = "1a1c20";
const C_MUTED    = "555555";
const C_FAINT    = "999999";
const C_LINE     = "c8c8c8";
const C_CODE_BG  = "f0f0f0";
const C_RULE     = "333333";

// ── Unit helpers ─────────────────────────────────────────────────────────────
// Paragraph spacing/indent: twentieths of a point.  pt(6) = 120 = 6pt
const pt = (n: number): number => n * 20;
// TextRun size: half-points.  hpt(11) = 22 = 11pt
const hpt = (n: number): number => n * 2;

// ── Types ────────────────────────────────────────────────────────────────────
type ParagraphChild = Paragraph | Table;

type ListState = {
  numberGroupIdx: number;
  inNumberedList: boolean;
};

// ── Public API ───────────────────────────────────────────────────────────────

export async function renderDocumentDocx(document: DocumentModel, config: AppConfig): Promise<Buffer> {
  const meta = document.meta;
  const brand = resolveBrand(meta.brand.label, config);
  const numGroups = countNumberedListGroups(document.content);

  const coverZone = buildCoverZone(meta, brand);
  const bodyBlocks = await buildBodyBlocks(document.content, document.assets, meta.docId, numGroups);

  const doc = new Document({
    numbering: buildNumberingConfig(numGroups),
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: {
              top: MARGIN_T,
              bottom: MARGIN_B,
              left: MARGIN_L,
              right: MARGIN_R,
              header: HDR_DIST,
              footer: FTR_DIST,
            },
          },
        },
        headers: { default: buildPageHeader(meta, brand) },
        footers: { default: buildPageFooter() },
        children: [...coverZone, ...bodyBlocks],
      },
    ],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}

// ── Numbering ────────────────────────────────────────────────────────────────

function buildNumberingConfig(numGroups: number) {
  return {
    config: [
      {
        reference: "bullet-list",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: pt(24), hanging: pt(12) }, spacing: { after: pt(3) } },
              run: { font: FONT_SANS, size: hpt(11) },
            },
          },
        ],
      },
      ...Array.from({ length: Math.max(numGroups, 1) }, (_, i) => ({
        reference: `number-list-${i}`,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: pt(24), hanging: pt(12) }, spacing: { after: pt(3) } },
              run: { font: FONT_SANS, size: hpt(11) },
            },
          },
        ],
      })),
    ],
  };
}

function countNumberedListGroups(blocks: DocumentBlock[]): number {
  let count = 0;
  let inList = false;
  for (const block of blocks) {
    if (block.type === "numbered_list_item") {
      if (!inList) { count++; inList = true; }
    } else {
      inList = false;
    }
  }
  return count;
}

// ── Header & footer ──────────────────────────────────────────────────────────

function buildPageHeader(meta: DocumentModel["meta"], brand: { displayName: string }): Header {
  const ref = [meta.docId, meta.version ?? ""].filter(Boolean).join(" · ");
  const borderNone = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

  return new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top:              borderNone,
          bottom:           { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
          left:             borderNone,
          right:            borderNone,
          insideHorizontal: borderNone,
          insideVertical:   borderNone,
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 60, type: WidthType.PERCENTAGE },
                borders: noBorders(),
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    spacing: { before: 0, after: pt(3) },
                    children: [
                      new TextRun({
                        text: brand.displayName,
                        font: FONT_SANS,
                        size: hpt(7.5),
                        bold: true,
                        allCaps: true,
                        color: C_TEXT,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 40, type: WidthType.PERCENTAGE },
                borders: noBorders(),
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: { before: 0, after: pt(3) },
                    children: [
                      new TextRun({ text: ref, font: FONT_SANS, size: hpt(7), color: C_MUTED }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildPageFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: pt(4), after: 0 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: C_LINE } },
        children: [
          new TextRun({ text: "Page ", font: FONT_SANS, size: hpt(7.5), color: C_MUTED }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT_SANS, size: hpt(7.5), color: C_MUTED }),
          new TextRun({ text: " of ", font: FONT_SANS, size: hpt(7.5), color: C_MUTED }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT_SANS, size: hpt(7.5), color: C_MUTED }),
        ],
      }),
    ],
  });
}

// ── Cover zone ───────────────────────────────────────────────────────────────

function buildCoverZone(meta: DocumentModel["meta"], brand: { displayName: string; tagline: string }): ParagraphChild[] {
  const result: ParagraphChild[] = [];

  // 1. Masthead table: brand name (left) + tagline (right), thick bottom rule
  result.push(buildMasthead(brand));

  // 2. Type kicker
  if (meta.documentType.label) {
    result.push(
      new Paragraph({
        spacing: { before: pt(10), after: pt(3) },
        children: [
          new TextRun({
            text: meta.documentType.label.toUpperCase(),
            font: FONT_SANS,
            size: hpt(7.5),
            bold: true,
            color: C_MUTED,
          }),
        ],
      })
    );
  }

  // 3. Document title
  result.push(
    new Paragraph({
      spacing: { before: pt(4), after: pt(4) },
      children: [
        new TextRun({
          text: meta.title,
          font: FONT_SANS,
          size: hpt(22),
          bold: true,
          color: C_TEXT,
        }),
      ],
    })
  );

  // 4. Identity line: DOC_ID · Type · Version · Status (with top rule)
  result.push(buildIdentityLine(meta));

  // 5. Metadata strip table (client, project)
  const metaTable = buildMetaStrip(meta);
  if (metaTable) {
    result.push(metaTable);
  }

  // 6. Rule before body
  result.push(
    new Paragraph({
      spacing: { before: pt(8), after: pt(8) },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C_LINE } },
      children: [],
    })
  );

  return result;
}

function buildMasthead(brand: { displayName: string; tagline: string }): Table {
  const borderNone = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              borderNone,
      bottom:           { style: BorderStyle.SINGLE, size: 16, color: C_RULE },
      left:             borderNone,
      right:            borderNone,
      insideHorizontal: borderNone,
      insideVertical:   borderNone,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 65, type: WidthType.PERCENTAGE },
            borders: noBorders(),
            verticalAlign: VerticalAlign.BOTTOM,
            children: [
              new Paragraph({
                spacing: { before: 0, after: pt(5) },
                children: [
                  new TextRun({
                    text: brand.displayName,
                    font: FONT_SANS,
                    size: hpt(11),
                    bold: true,
                    allCaps: true,
                    color: C_TEXT,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 35, type: WidthType.PERCENTAGE },
            borders: noBorders(),
            verticalAlign: VerticalAlign.BOTTOM,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 0, after: pt(5) },
                children: brand.tagline
                  ? [
                      new TextRun({
                        text: brand.tagline,
                        font: FONT_SANS,
                        size: hpt(7),
                        bold: true,
                        allCaps: true,
                        color: C_MUTED,
                      }),
                    ]
                  : [],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildIdentityLine(meta: DocumentModel["meta"]): Paragraph {
  const runs: (TextRun | ExternalHyperlink)[] = [];

  const sep = () =>
    new TextRun({ text: "  ·  ", font: FONT_SANS, size: hpt(9), color: C_FAINT });

  if (meta.docId) {
    runs.push(new TextRun({ text: meta.docId, font: FONT_SANS, size: hpt(9), bold: true, color: C_TEXT }));
  }
  if (meta.documentType.label) {
    if (runs.length > 0) runs.push(sep());
    runs.push(new TextRun({ text: meta.documentType.label, font: FONT_SANS, size: hpt(9), color: C_MUTED }));
  }
  if (meta.version) {
    if (runs.length > 0) runs.push(sep());
    runs.push(new TextRun({ text: `Version ${meta.version}`, font: FONT_SANS, size: hpt(9), color: C_MUTED }));
  }
  if (meta.status) {
    if (runs.length > 0) runs.push(sep());
    runs.push(new TextRun({ text: meta.status, font: FONT_SANS, size: hpt(9), color: C_MUTED }));
  }

  return new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: C_LINE } },
    spacing: { before: pt(6), after: pt(6) },
    children: runs,
  });
}

function buildMetaStrip(meta: DocumentModel["meta"]): Table | null {
  const fields: Array<[string, string]> = (
    [
      ["Client", meta.client.label],
      ["Project", meta.project.label],
      ["Status", meta.status],
    ] as Array<[string, string]>
  ).filter(([, v]) => Boolean(v));

  if (fields.length === 0) return null;

  const colWidth = Math.floor(100 / fields.length);

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom:           { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left:             { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right:            { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [
      new TableRow({
        children: fields.map(
          ([label, value]) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.PERCENTAGE },
              borders: noBorders(),
              children: [
                new Paragraph({
                  spacing: { before: 0, after: pt(1) },
                  children: [
                    new TextRun({
                      text: label.toUpperCase(),
                      font: FONT_SANS,
                      size: hpt(7),
                      bold: true,
                      color: C_MUTED,
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  children: [
                    new TextRun({ text: value, font: FONT_SANS, size: hpt(10), color: C_TEXT }),
                  ],
                }),
              ],
            })
        ),
      }),
    ],
  });
}

// ── Body blocks ──────────────────────────────────────────────────────────────

async function buildBodyBlocks(
  content: DocumentBlock[],
  assets: DocumentAsset[],
  docId: string,
  numGroups: number
): Promise<ParagraphChild[]> {
  const result: ParagraphChild[] = [];
  const state: ListState = { numberGroupIdx: -1, inNumberedList: false };

  for (const block of content) {
    if (block.type !== "numbered_list_item") {
      state.inNumberedList = false;
    }
    const rendered = await renderBlock(block, assets, docId, state, numGroups);
    result.push(...rendered);
  }

  return result;
}

async function renderBlock(
  block: DocumentBlock,
  assets: DocumentAsset[],
  docId: string,
  state: ListState,
  _numGroups: number
): Promise<ParagraphChild[]> {
  switch (block.type) {
    case "paragraph":
      return [
        new Paragraph({
          spacing: { before: 0, after: pt(6) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SERIF, size: hpt(11), color: C_TEXT },
        }),
      ];

    case "heading_1":
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          keepNext: true,
          spacing: { before: pt(14), after: pt(4) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SANS, size: hpt(16), bold: true, color: C_TEXT },
        }),
      ];

    case "heading_2":
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          keepNext: true,
          spacing: { before: pt(12), after: pt(4) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SANS, size: hpt(13), bold: true, color: C_TEXT },
        }),
      ];

    case "heading_3":
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          keepNext: true,
          spacing: { before: pt(10), after: pt(3) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SANS, size: hpt(11), bold: true, color: C_TEXT },
        }),
      ];

    case "heading_4":
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_4,
          keepNext: true,
          spacing: { before: pt(8), after: pt(2) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SANS, size: hpt(10), bold: true, color: C_MUTED },
        }),
      ];

    case "bulleted_list_item":
      return [
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          spacing: { before: 0, after: pt(3) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SERIF, size: hpt(11), color: C_TEXT },
        }),
      ];

    case "numbered_list_item": {
      if (!state.inNumberedList) {
        state.inNumberedList = true;
        state.numberGroupIdx++;
      }
      const ref = `number-list-${state.numberGroupIdx}`;
      return [
        new Paragraph({
          numbering: { reference: ref, level: 0 },
          spacing: { before: 0, after: pt(3) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SERIF, size: hpt(11), color: C_TEXT },
        }),
      ];
    }

    case "quote":
      return [
        new Paragraph({
          indent: { left: pt(18), right: pt(6) },
          border: { left: { style: BorderStyle.SINGLE, size: 16, color: C_MUTED } },
          spacing: { before: pt(6), after: pt(6) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SERIF, size: hpt(11), color: C_MUTED, italics: true },
        }),
      ];

    case "callout":
      return [
        new Paragraph({
          indent: { left: pt(12), right: pt(12) },
          border: {
            top:    { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
            left:   { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
            right:  { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
          },
          shading: { type: ShadingType.SOLID, fill: "f5f5f5", color: "auto" },
          spacing: { before: pt(6), after: pt(6) },
          children: renderDocxRichText(block.richText),
          run: { font: FONT_SANS, size: hpt(10.5), color: C_TEXT },
        }),
      ];

    case "code": {
      const codeText = block.richText.map((s) => s.text).join("");
      const lines = codeText.split("\n");
      const codeRuns: TextRun[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) {
          codeRuns.push(new TextRun({ break: 1, font: FONT_MONO, size: hpt(9) }));
        }
        codeRuns.push(
          new TextRun({ text: lines[i] ?? "", font: FONT_MONO, size: hpt(9), color: C_TEXT })
        );
      }
      return [
        new Paragraph({
          indent: { left: pt(12), right: pt(12) },
          border: {
            top:    { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
            left:   { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
            right:  { style: BorderStyle.SINGLE, size: 4, color: C_LINE },
          },
          shading: { type: ShadingType.SOLID, fill: C_CODE_BG, color: "auto" },
          spacing: {
            before: pt(6),
            after: pt(6),
            line: 260,
            lineRule: LineRuleType.AUTO,
          },
          children: codeRuns,
        }),
      ];
    }

    case "divider":
      return [
        new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: C_LINE } },
          spacing: { before: pt(8), after: pt(8) },
          children: [],
        }),
      ];

    case "image":
      return [await renderImageBlock(block.asset, docId)];

    case "file":
      return [renderFileBlock(block.asset)];

    case "table":
      return [renderTableBlock(block.rows)];

    case "unsupported":
      return [];

    default:
      return [];
  }
}

// ── Rich text ────────────────────────────────────────────────────────────────

export function renderDocxRichText(spans: RichTextSpan[]): (TextRun | ExternalHyperlink)[] {
  if (spans.length === 0) {
    return [new TextRun({ text: "" })];
  }

  return spans.map((span) => {
    const runOpts = {
      text: span.text,
      ...(span.bold      ? { bold: true }                                                                            : {}),
      ...(span.italic    ? { italics: true }                                                                         : {}),
      ...(span.underline ? { underline: { type: UnderlineType.SINGLE } }                                            : {}),
      ...(span.strike    ? { strike: true }                                                                          : {}),
      ...(span.code      ? { font: FONT_MONO, size: hpt(9.5), shading: { type: ShadingType.SOLID, fill: C_CODE_BG, color: "auto" } } : {}),
    };

    if (span.href) {
      return new ExternalHyperlink({
        link: span.href,
        children: [
          new TextRun({
            ...runOpts,
            style: "Hyperlink",
            color: "0563C1",
            underline: { type: UnderlineType.SINGLE },
          }),
        ],
      });
    }

    return new TextRun(runOpts);
  });
}

// ── Image rendering ──────────────────────────────────────────────────────────

async function renderImageBlock(asset: DocumentAsset, docId: string): Promise<Paragraph> {
  const fallback = () =>
    new Paragraph({
      spacing: { before: pt(6), after: pt(6) },
      children: [new TextRun({ text: `[Image: ${asset.sourceUrl}]`, font: FONT_SERIF, size: hpt(9), color: C_MUTED })],
    });

  if (!asset.local || !asset.outputPath) {
    return fallback();
  }

  const filename = asset.outputPath.split("/").pop();
  if (!filename) return fallback();

  const absPath = path.join("dist", "assets", "docs", docId, filename);
  const ext = path.extname(filename).toLowerCase().slice(1);
  const imgType = resolveImageType(ext);
  if (!imgType) {
    // unsupported format — fall back to alt text or URL
    const label = asset.alt || filename;
    return new Paragraph({
      spacing: { before: pt(6), after: pt(6) },
      children: [new TextRun({ text: `[Image: ${label}]`, font: FONT_SERIF, size: hpt(9), color: C_MUTED })],
    });
  }

  let data: Buffer;
  try {
    data = await fs.readFile(absPath);
  } catch {
    return fallback();
  }

  const { width, height } = readImageDimensions(data, ext);
  const children: (TextRun | ImageRun | ExternalHyperlink)[] = [
    new ImageRun({ data, transformation: { width, height }, type: imgType }),
  ];
  const caption = asset.caption && asset.caption.length > 0 ? asset.caption : null;

  const paras: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: pt(8), after: caption ? pt(2) : pt(8) },
      children,
    }),
  ];

  if (caption) {
    paras.push(
      new Paragraph({
        spacing: { before: 0, after: pt(8) },
        children: [
          new TextRun({
            text: caption.map((s) => s.text).join(""),
            font: FONT_SANS,
            size: hpt(8.5),
            italics: true,
            color: C_MUTED,
          }),
        ],
      })
    );
    // Return only the image paragraph; caption is appended separately via array.
    // Since we return a single Paragraph from renderImageBlock, we can't return both.
    // Instead, we render caption into the image paragraph itself via a break.
    paras[0] = new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: pt(8), after: pt(8) },
      children: [
        new ImageRun({ data, transformation: { width, height }, type: imgType }),
        new TextRun({ break: 1 }),
        new TextRun({
          text: caption.map((s) => s.text).join(""),
          font: FONT_SANS,
          size: hpt(8.5),
          italics: true,
          color: C_MUTED,
        }),
      ],
    });
    return paras[0];
  }

  return paras[0];
}

function renderFileBlock(asset: DocumentAsset): Paragraph {
  const filename = asset.outputPath?.split("/").pop() || asset.sourceUrl;
  return new Paragraph({
    spacing: { before: pt(4), after: pt(4) },
    children: [
      new TextRun({ text: "File: ", font: FONT_SANS, size: hpt(10), bold: true, color: C_TEXT }),
      new ExternalHyperlink({
        link: asset.sourceUrl,
        children: [
          new TextRun({
            text: filename,
            font: FONT_SANS,
            size: hpt(10),
            style: "Hyperlink",
            color: "0563C1",
            underline: { type: UnderlineType.SINGLE },
          }),
        ],
      }),
    ],
  });
}

function resolveImageType(ext: string): "png" | "jpg" | "gif" | "bmp" | null {
  switch (ext) {
    case "png":  return "png";
    case "jpg":
    case "jpeg": return "jpg";
    case "gif":  return "gif";
    case "bmp":  return "bmp";
    default:     return null;
  }
}

function readImageDimensions(buf: Buffer, ext: string): { width: number; height: number } {
  const DEFAULT = { width: 400, height: 300 };

  if (ext === "png") {
    if (
      buf.length >= 24 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    ) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (w > 0 && h > 0) return scaleToMax(w, h);
    }
    return DEFAULT;
  }

  if (ext === "jpg" || ext === "jpeg") {
    let offset = 2;
    while (offset < buf.length - 9) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      if (marker === undefined) break;
      const segLen = buf.readUInt16BE(offset + 2);
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const h = buf.readUInt16BE(offset + 5);
        const w = buf.readUInt16BE(offset + 7);
        if (w > 0 && h > 0) return scaleToMax(w, h);
      }
      offset += 2 + segLen;
    }
    return DEFAULT;
  }

  return DEFAULT;
}

function scaleToMax(width: number, height: number): { width: number; height: number } {
  if (width <= IMG_MAX_PX) return { width, height };
  const scale = IMG_MAX_PX / width;
  return { width: IMG_MAX_PX, height: Math.round(height * scale) };
}

// ── Table rendering ──────────────────────────────────────────────────────────

function renderTableBlock(rows: RichTextSpan[][][]): Table {
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0) || 1;
  const colWidth = Math.floor(100 / colCount);
  const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: C_LINE };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:     thinBorder,
      bottom:  thinBorder,
      left:    thinBorder,
      right:   thinBorder,
      insideHorizontal: thinBorder,
      insideVertical:   thinBorder,
    },
    rows: rows.map((row, rowIdx) =>
      new TableRow({
        tableHeader: rowIdx === 0,
        children: row.map(
          (cell) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.PERCENTAGE },
              borders: {
                top:    thinBorder,
                bottom: thinBorder,
                left:   thinBorder,
                right:  thinBorder,
              },
              shading: rowIdx === 0
                ? { type: ShadingType.SOLID, fill: "e8e8e8", color: "auto" }
                : undefined,
              children: [
                new Paragraph({
                  spacing: { before: pt(3), after: pt(3) },
                  children: renderDocxRichText(cell),
                  run: {
                    font: FONT_SANS,
                    size: hpt(9.5),
                    color: C_TEXT,
                    bold: rowIdx === 0,
                  },
                }),
              ],
            })
        ),
      })
    ),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: none, bottom: none, left: none, right: none };
}

type BrandPresentation = { displayName: string; tagline: string };

function resolveBrand(label: string, config: AppConfig): BrandPresentation {
  const profile: BrandProfile | undefined = config.brandProfiles[label];
  return {
    displayName: profile?.displayName?.trim() || label || "Document",
    tagline: profile?.tagline?.trim() || "",
  };
}
