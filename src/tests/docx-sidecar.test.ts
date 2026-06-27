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
import { readFileSync } from "node:fs";

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
