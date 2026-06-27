/**
 * Isolation tests for the DOCX sidecar pipeline.
 *
 * These tests run entirely in memory: no Notion access, no file I/O
 * beyond package.json inspection. They verify:
 *   - package.json scripts exist
 *   - renderDocxRichText produces correct TextRun/ExternalHyperlink output
 *   - The DOCX renderer does not import render-html.ts
 *   - Block rendering isolation (empty content, unknown types)
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// package.json script guards
// ---------------------------------------------------------------------------

test("package.json has docx:doc script", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.ok(typeof pkg.scripts["docx:doc"] === "string", "Missing script: docx:doc");
  assert.ok(pkg.scripts["docx:doc"].includes("export-doc-docx"), "docx:doc must invoke export-doc-docx");
});

test("package.json has pdf:from-docx script", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.ok(typeof pkg.scripts["pdf:from-docx"] === "string", "Missing script: pdf:from-docx");
  assert.ok(pkg.scripts["pdf:from-docx"].includes("convert-docx-to-pdf"), "pdf:from-docx must invoke convert-docx-to-pdf");
});

// ---------------------------------------------------------------------------
// renderDocxRichText — inline rich text rendering
// ---------------------------------------------------------------------------

import { renderDocxRichText } from "../render/render-docx.js";
import { ExternalHyperlink, TextRun } from "docx";

test("renderDocxRichText: empty spans returns one empty TextRun", () => {
  const result = renderDocxRichText([]);
  assert.equal(result.length, 1);
  assert.ok(result[0] instanceof TextRun);
});

test("renderDocxRichText: plain text span returns TextRun", () => {
  const result = renderDocxRichText([{ text: "Hello world" }]);
  assert.equal(result.length, 1);
  assert.ok(result[0] instanceof TextRun);
});

test("renderDocxRichText: span with href returns ExternalHyperlink", () => {
  const result = renderDocxRichText([{ text: "Click here", href: "https://example.com" }]);
  assert.equal(result.length, 1);
  assert.ok(result[0] instanceof ExternalHyperlink, "Expected ExternalHyperlink for span with href");
});

test("renderDocxRichText: bold span returns TextRun", () => {
  const result = renderDocxRichText([{ text: "Bold", bold: true }]);
  assert.equal(result.length, 1);
  assert.ok(result[0] instanceof TextRun);
});

test("renderDocxRichText: mixed spans produce correct output count", () => {
  const spans = [
    { text: "Normal" },
    { text: "Bold", bold: true },
    { text: "Link", href: "https://example.com" },
    { text: "Code", code: true },
  ];
  const result = renderDocxRichText(spans);
  assert.equal(result.length, 4);
  assert.ok(result[0] instanceof TextRun);
  assert.ok(result[1] instanceof TextRun);
  assert.ok(result[2] instanceof ExternalHyperlink);
  assert.ok(result[3] instanceof TextRun);
});

test("renderDocxRichText: strike span returns TextRun", () => {
  const result = renderDocxRichText([{ text: "Strikethrough", strike: true }]);
  assert.equal(result.length, 1);
  assert.ok(result[0] instanceof TextRun);
});

// ---------------------------------------------------------------------------
// renderDocumentDocx — document-level smoke test (in-memory, no Notion)
// ---------------------------------------------------------------------------

import { renderDocumentDocx } from "../render/render-docx.js";
import type { AppConfig } from "../config.js";
import { emptyValidation, type DocumentModel } from "../model/document.js";

function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    publishableStatuses: new Set(["Approved"]),
    allowedVisibility: new Set(["Public"]),
    docIdYearMonth: "2606",
    autoGenerateShareToken: false,
    allowMissingShareToken: true,
    autoFillPrivateNamespace: false,
    autoFillPortalCategory: false,
    registerPublic: false,
    robotsDisallowDocs: false,
    legacyUnlistedDocsPath: false,
    legacyPrivateDocIdUrls: false,
    brandProfiles: {
      ARCBOS: { displayName: "ARCBOS", tagline: "ENGINEERED FOR EXTREME CONDITIONS" },
    },
    brandTokens: {},
    documentTypeTokens: {},
    notionToken: "test",
    notionDatabaseId: "test",
    ...overrides,
  } as unknown as AppConfig;
}

function makeTestDoc(overrides: Partial<DocumentModel> = {}): DocumentModel {
  return {
    meta: {
      docId: "ARCBOS-CON-2606-0001",
      title: "Test Contract",
      brand: { label: "ARCBOS", token: "ARCBOS", slug: "arcbos" },
      client: { label: "Test Client", slug: "test-client" },
      project: { label: "Test Project", slug: "test-project" },
      documentType: { label: "Contract", token: "CON", slug: "con" },
      version: "v1.0",
      status: "Approved",
      visibility: "Public",
      publish: true,
      portalListed: true,
      shareToken: "",
      privateLinkNamespace: "",
      category: "",
      portalCategory: "",
      canonicalPath: "/docs/arcbos-con-2606-0001/",
    },
    content: [
      { type: "paragraph", id: "b1", richText: [{ text: "This is body text." }] },
      { type: "heading_1", id: "b2", richText: [{ text: "Section 1" }] },
      { type: "bulleted_list_item", id: "b3", richText: [{ text: "Bullet point" }] },
      { type: "numbered_list_item", id: "b4", richText: [{ text: "Item 1" }] },
      { type: "numbered_list_item", id: "b5", richText: [{ text: "Item 2" }] },
      { type: "quote", id: "b6", richText: [{ text: "A quoted passage." }] },
      { type: "callout", id: "b7", richText: [{ text: "An important note." }] },
      { type: "code", id: "b8", richText: [{ text: "const x = 1;\nconst y = 2;" }], language: "typescript" },
      { type: "divider", id: "b9" },
      { type: "heading_2", id: "b10", richText: [{ text: "Subsection" }] },
      { type: "paragraph", id: "b11", richText: [{ text: "End." }] },
      { type: "unsupported", id: "b12", notionType: "embed", message: "Unsupported block type: embed" },
    ],
    assets: [],
    source: { notionPageId: "page-1", notionDatabaseId: "db-1" },
    validation: emptyValidation(),
    ...overrides,
  };
}

test("renderDocumentDocx: produces a non-empty Buffer", async () => {
  const doc = makeTestDoc();
  const config = makeTestConfig();
  const buf = await renderDocumentDocx(doc, config);
  assert.ok(buf instanceof Buffer, "Result must be a Buffer");
  assert.ok(buf.length > 1000, `Buffer too small: ${buf.length} bytes`);
});

test("renderDocumentDocx: DOCX buffer starts with PK zip magic bytes", async () => {
  const doc = makeTestDoc();
  const config = makeTestConfig();
  const buf = await renderDocumentDocx(doc, config);
  // DOCX is a ZIP file — magic bytes are PK (0x50, 0x4B)
  assert.equal(buf[0], 0x50, "Expected 0x50 (P)");
  assert.equal(buf[1], 0x4b, "Expected 0x4B (K)");
});

test("renderDocumentDocx: handles document with no content blocks", async () => {
  const doc = makeTestDoc({ content: [] });
  const config = makeTestConfig();
  const buf = await renderDocumentDocx(doc, config);
  assert.ok(buf.length > 0, "Should produce output even for empty content");
});

test("renderDocumentDocx: handles document with table block", async () => {
  const doc = makeTestDoc({
    content: [
      {
        type: "table",
        id: "t1",
        rows: [
          [[{ text: "Header A" }], [{ text: "Header B" }]],
          [[{ text: "Cell 1" }], [{ text: "Cell 2" }]],
        ],
      },
    ],
  });
  const config = makeTestConfig();
  const buf = await renderDocumentDocx(doc, config);
  assert.ok(buf.length > 0);
});

test("renderDocumentDocx: handles brand without profile (neutral brand)", async () => {
  const doc = makeTestDoc({
    meta: {
      ...makeTestDoc().meta,
      brand: { label: "UNKNOWN_BRAND", slug: "unknown-brand" },
    },
  });
  const config = makeTestConfig();
  const buf = await renderDocumentDocx(doc, config);
  assert.ok(buf.length > 0, "Should fall back to raw brand label");
});

test("renderDocumentDocx: does not call renderDocumentHtml", async () => {
  // Static import graph check: render-docx.ts must not import render-html.ts.
  // We verify this by reading the source file.
  const src = readFileSync("src/render/render-docx.ts", "utf8");
  assert.ok(!src.includes("render-html"), "render-docx.ts must not import render-html");
  assert.ok(!src.includes("renderDocumentHtml"), "render-docx.ts must not call renderDocumentHtml");
});

test("export-doc-docx does not read dist/docs/", () => {
  const src = readFileSync("src/cli/export-doc-docx.ts", "utf8");
  assert.ok(!src.includes("dist/docs"), "export-doc-docx.ts must not read from dist/docs/");
  assert.ok(!src.includes("renderDocumentHtml"), "export-doc-docx.ts must not call renderDocumentHtml");
});

// ---------------------------------------------------------------------------
// P0/P1 fix verification — XML-level assertions
// ---------------------------------------------------------------------------

async function extractDocxXml(buf: Buffer, xmlPath: string): Promise<string> {
  const tmpFile = join(tmpdir(), `docx-test-${Date.now()}.docx`);
  try {
    writeFileSync(tmpFile, buf);
    return execSync(`unzip -p "${tmpFile}" "${xmlPath}"`).toString("utf8");
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

test("P0-1: heading runs do not suppress bold with w:val=false", async () => {
  const doc = makeTestDoc({
    content: [
      { type: "heading_1", id: "h1", richText: [{ text: "Section One" }] },
      { type: "heading_2", id: "h2", richText: [{ text: "Subsection" }] },
      { type: "heading_3", id: "h3", richText: [{ text: "Sub-subsection" }] },
    ],
  });
  const buf = await renderDocumentDocx(doc, makeTestConfig());
  const xml = await extractDocxXml(buf, "word/document.xml");
  assert.ok(!xml.includes('<w:b w:val="false"/>'), 'Must not suppress bold with w:val="false"');
  assert.ok(!xml.includes('<w:b w:val="0"/>'), 'Must not suppress bold with w:val="0"');
});

test("P0-2: header version does not produce double-v prefix", async () => {
  const doc = makeTestDoc();
  const buf = await renderDocumentDocx(doc, makeTestConfig());
  const xml = await extractDocxXml(buf, "word/header1.xml");
  assert.ok(!xml.includes("vv"), 'Header XML must not contain "vv" — meta.version already includes the v prefix');
  assert.ok(xml.includes("v1.0"), 'Header XML must contain the version string "v1.0"');
});

test("P1-1: DOCX document XML contains eastAsia font attributes (Noto CJK)", async () => {
  const doc = makeTestDoc();
  const buf = await renderDocumentDocx(doc, makeTestConfig());
  const xml = await extractDocxXml(buf, "word/document.xml");
  assert.ok(xml.includes("w:eastAsia="), "document.xml must contain w:eastAsia font attributes");
  assert.ok(
    xml.includes("Noto Serif CJK SC") || xml.includes("Noto Sans CJK SC"),
    "document.xml must reference a Noto CJK font — cross-platform replacement for macOS-only Songti/PingFang"
  );
});

test("P1-2: quote block runs do not suppress italics", async () => {
  const doc = makeTestDoc({
    content: [
      { type: "quote", id: "q1", richText: [{ text: "A quoted passage without explicit italic flag." }] },
    ],
  });
  const buf = await renderDocumentDocx(doc, makeTestConfig());
  const xml = await extractDocxXml(buf, "word/document.xml");
  assert.ok(!xml.includes('<w:i w:val="false"/>'), 'Must not suppress italics with w:val="false"');
  assert.ok(!xml.includes('<w:i w:val="0"/>'), 'Must not suppress italics with w:val="0"');
});

// ---------------------------------------------------------------------------
// Phase A + B — layout, font, and style system regression tests
// ---------------------------------------------------------------------------

test("Phase-A: QA workflow installs fonts-liberation and fonts-noto-cjk", () => {
  const src = readFileSync(".github/workflows/docx-pdf-export-qa.yml", "utf8");
  assert.ok(src.includes("fonts-liberation"), "QA workflow must install fonts-liberation");
  assert.ok(src.includes("fonts-noto-cjk"), "QA workflow must install fonts-noto-cjk");
});

test("Phase-B: page header uses paragraph-based layout with right tab stop (no table)", async () => {
  const buf = await renderDocumentDocx(makeTestDoc(), makeTestConfig());
  const xml = await extractDocxXml(buf, "word/header1.xml");
  assert.ok(!xml.includes("<w:tbl>") && !xml.includes("<w:tbl "), "Page header must not contain a <w:tbl> element");
  assert.ok(xml.includes('w:val="right"'), "Page header must declare a right-aligned tab stop");
});

test("Phase-B: masthead and metadata strip source does not instantiate Table", () => {
  const src = readFileSync("src/render/render-docx.ts", "utf8");

  const mastheadStart = src.indexOf("function buildMasthead");
  assert.ok(mastheadStart >= 0, "buildMasthead function must exist");
  const mastheadBody = src.slice(mastheadStart, src.indexOf("\nfunction ", mastheadStart + 1));
  assert.ok(!mastheadBody.includes("new Table("), "buildMasthead must not instantiate a Table");

  const metaStart = src.indexOf("function buildMetaStrip");
  assert.ok(metaStart >= 0, "buildMetaStrip function must exist");
  const metaBody = src.slice(metaStart, src.indexOf("\nfunction ", metaStart + 1));
  assert.ok(!metaBody.includes("new Table("), "buildMetaStrip must not instantiate a Table");
});

test("Phase-B: body tables use DXA (fixed twip) column widths, not percentage", async () => {
  const doc = makeTestDoc({
    content: [
      {
        type: "table",
        id: "t1",
        rows: [
          [[{ text: "Col A" }], [{ text: "Col B" }]],
          [[{ text: "Val 1" }], [{ text: "Val 2" }]],
        ],
      },
    ],
  });
  const buf = await renderDocumentDocx(doc, makeTestConfig());
  const xml = await extractDocxXml(buf, "word/document.xml");
  assert.ok(xml.includes('w:type="dxa"'), "Table cell widths must use DXA type");
  assert.ok(!xml.includes('w:type="pct"'), "Table must not use percentage (pct) widths");
});

test("Phase-B: code block uses left-border accent style without paragraph shading", async () => {
  const doc = makeTestDoc({
    content: [{ type: "code", id: "c1", richText: [{ text: "const x = 1;" }], language: "typescript" }],
  });
  const buf = await renderDocumentDocx(doc, makeTestConfig());
  const xml = await extractDocxXml(buf, "word/document.xml");
  assert.ok(!xml.includes('w:fill="f0f0f0"'), "Code block must not use f0f0f0 paragraph shading fill");
  assert.ok(!xml.includes('w:fill="000000"'), "Code block must not use black paragraph shading fill");
  assert.ok(xml.includes("<w:left ") || xml.includes("<w:left>"), "Code block must have a left border");
});

test("Phase-B: callout block has no paragraph shading (ShadingType.SOLID)", async () => {
  const doc = makeTestDoc({
    content: [{ type: "callout", id: "ca1", richText: [{ text: "Important note." }] }],
  });
  const buf = await renderDocumentDocx(doc, makeTestConfig());
  const xml = await extractDocxXml(buf, "word/document.xml");
  assert.ok(!xml.includes('w:fill="f5f5f5"'), "Callout must not use f5f5f5 paragraph shading — incompatible with Apple Pages");
});

test("Phase-B: H1 heading has a bottom border in document XML", async () => {
  const doc = makeTestDoc({
    content: [{ type: "heading_1", id: "h1", richText: [{ text: "Chapter One" }] }],
  });
  const buf = await renderDocumentDocx(doc, makeTestConfig());
  const xml = await extractDocxXml(buf, "word/document.xml");
  assert.ok(xml.includes("<w:bottom ") || xml.includes("<w:bottom>"), "H1 paragraph must declare a bottom border");
});
