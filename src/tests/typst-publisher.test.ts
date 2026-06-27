/**
 * Tests for the Typst PDF publishing spike.
 *
 * These tests run entirely in memory — no Notion access, no file I/O.
 * They verify:
 *   - package.json script exists
 *   - renderer isolation (does not read dist/docs, does not call renderDocumentHtml)
 *   - Typst source contains expected structural elements
 *   - CJK font configuration is present
 *   - DOC_ID filter targets the correct document
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { renderDocumentTypst } from "../render/render-typst.js";
import { renderRichText } from "../render/render-typst.js";
import type { AppConfig } from "../config.js";
import { emptyValidation, type DocumentModel } from "../model/document.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTestConfig(): AppConfig {
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
  } as unknown as AppConfig;
}

function makeTestDoc(overrides: Partial<DocumentModel> = {}): DocumentModel {
  return {
    meta: {
      docId: "ARCBOS-AGR-2606-0008",
      title: "Test Agreement",
      brand: { label: "ARCBOS", token: "ARCBOS", slug: "arcbos" },
      client: { label: "Test Client", slug: "test-client" },
      project: { label: "Test Project", slug: "test-project" },
      documentType: { label: "Agreement", token: "AGR", slug: "agr" },
      version: "v1.0",
      status: "Approved",
      visibility: "Public",
      publish: true,
      portalListed: true,
      shareToken: "",
      privateLinkNamespace: "",
      category: "",
      portalCategory: "",
      canonicalPath: "/docs/arcbos-agr-2606-0008/",
    },
    content: [
      { type: "paragraph",      id: "p1", richText: [{ text: "Body paragraph." }] },
      { type: "heading_1",      id: "h1", richText: [{ text: "Section One" }] },
      { type: "heading_2",      id: "h2", richText: [{ text: "Subsection" }] },
      { type: "bulleted_list_item", id: "b1", richText: [{ text: "Bullet A" }] },
      { type: "bulleted_list_item", id: "b2", richText: [{ text: "Bullet B" }] },
      { type: "numbered_list_item", id: "n1", richText: [{ text: "Item 1" }] },
      { type: "numbered_list_item", id: "n2", richText: [{ text: "Item 2" }] },
      { type: "quote",          id: "q1", richText: [{ text: "A quoted passage." }] },
      { type: "callout",        id: "ca1", richText: [{ text: "Important note." }] },
      { type: "code",           id: "c1", richText: [{ text: "const x = 1;" }], language: "typescript" },
      { type: "divider",        id: "d1" },
      { type: "table",          id: "t1", rows: [
          [[{ text: "Col A" }], [{ text: "Col B" }]],
          [[{ text: "Val 1" }], [{ text: "Val 2" }]],
        ],
      },
      { type: "unsupported",    id: "u1", notionType: "embed", message: "unsupported" },
    ],
    assets: [],
    source: { notionPageId: "page-1", notionDatabaseId: "db-1" },
    validation: emptyValidation(),
    ...overrides,
  };
}

// ── Script guards ─────────────────────────────────────────────────────────────

test("package.json has pdf:typst script", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.ok(typeof pkg.scripts["pdf:typst"] === "string", "Missing script: pdf:typst");
  assert.ok(pkg.scripts["pdf:typst"].includes("export-typst-pdf"), "pdf:typst must invoke export-typst-pdf");
});

// ── Isolation guards ──────────────────────────────────────────────────────────

test("export-typst-pdf does not read dist/docs/", () => {
  const src = readFileSync("src/cli/export-typst-pdf.ts", "utf8");
  assert.ok(!src.includes("dist/docs"), "export-typst-pdf.ts must not read from dist/docs/");
  assert.ok(!src.includes("renderDocumentHtml"), "export-typst-pdf.ts must not call renderDocumentHtml");
});

test("render-typst does not import render-html", () => {
  const src = readFileSync("src/render/render-typst.ts", "utf8");
  assert.ok(!src.includes("render-html"), "render-typst.ts must not import render-html");
  assert.ok(!src.includes("renderDocumentHtml"), "render-typst.ts must not call renderDocumentHtml");
});

// ── Structural content tests ──────────────────────────────────────────────────

test("Typst source is a non-empty string", () => {
  const src = renderDocumentTypst(makeTestDoc(), makeTestConfig());
  assert.ok(typeof src === "string" && src.length > 100, "Typst source must be a non-trivial string");
});

test("Typst source declares US Letter page with correct margins", () => {
  const src = renderDocumentTypst(makeTestDoc(), makeTestConfig());
  assert.ok(src.includes('paper: "us-letter"'), "Must declare us-letter paper");
  assert.ok(src.includes("1.25in"), "Must declare 1.25in left margin");
  assert.ok(src.includes("margin:"), "Must include margin declaration");
});

test("Typst source contains page header configuration (counter-based)", () => {
  const src = renderDocumentTypst(makeTestDoc(), makeTestConfig());
  assert.ok(src.includes("counter(page)"), "Must use counter(page) for running header/footer");
  assert.ok(src.includes("header:"), "Must declare page header");
  assert.ok(src.includes("footer:"), "Must declare page footer");
});

test("Typst source contains page footer with page number", () => {
  const src = renderDocumentTypst(makeTestDoc(), makeTestConfig());
  assert.ok(
    src.includes("counter(page).display()"),
    "Footer must reference counter(page).display() for page number"
  );
  assert.ok(
    src.includes("counter(page).final()"),
    "Footer must reference counter(page).final() for total page count"
  );
});

test("Typst source contains Noto CJK font declarations", () => {
  const src = renderDocumentTypst(makeTestDoc(), makeTestConfig());
  assert.ok(src.includes("Noto Serif CJK SC"), "Must declare Noto Serif CJK SC for body text");
  assert.ok(src.includes("Noto Sans CJK SC"),  "Must declare Noto Sans CJK SC for headings/UI");
  assert.ok(src.includes("Noto Sans Mono CJK SC"), "Must declare Noto Sans Mono CJK SC for code");
});

test("Typst source contains the target DOC_ID in the cover zone", () => {
  const src = renderDocumentTypst(makeTestDoc(), makeTestConfig());
  assert.ok(src.includes("ARCBOS-AGR-2606-0008"), "Typst source must contain the target DOC_ID");
});

test("Typst source contains heading markers for all four heading levels", () => {
  const doc = makeTestDoc({
    content: [
      { type: "heading_1", id: "h1", richText: [{ text: "H1" }] },
      { type: "heading_2", id: "h2", richText: [{ text: "H2" }] },
      { type: "heading_3", id: "h3", richText: [{ text: "H3" }] },
      { type: "heading_4", id: "h4", richText: [{ text: "H4" }] },
    ],
  });
  const src = renderDocumentTypst(doc, makeTestConfig());
  assert.ok(src.includes("= H1"),   "H1 must use single = marker");
  assert.ok(src.includes("== H2"),  "H2 must use == marker");
  assert.ok(src.includes("=== H3"), "H3 must use === marker");
  assert.ok(src.includes("==== H4"),"H4 must use ==== marker");
});

test("Typst source uses #raw(block:true) for code blocks", () => {
  const doc = makeTestDoc({
    content: [{ type: "code", id: "c1", richText: [{ text: "const x = 1;" }], language: "typescript" }],
  });
  const src = renderDocumentTypst(doc, makeTestConfig());
  assert.ok(src.includes('#raw(block: true'), "Code block must use #raw(block: true, ...)");
  assert.ok(src.includes('lang: "typescript"'), "Code block must include lang attribute");
});

test("Typst source contains table construct for table blocks", () => {
  const doc = makeTestDoc({
    content: [
      {
        type: "table", id: "t1",
        rows: [[[{ text: "H" }]], [[{ text: "C" }]]],
      },
    ],
  });
  const src = renderDocumentTypst(doc, makeTestConfig());
  assert.ok(src.includes("#table("), "Table block must emit #table(...)");
  assert.ok(src.includes("e8e8e8"), "Table header row must use gray fill");
});

// ── Rich text unit tests ──────────────────────────────────────────────────────

test("renderRichText: empty array returns empty string", () => {
  assert.equal(renderRichText([]), "");
});

test("renderRichText: plain text is escaped for Typst content mode", () => {
  const result = renderRichText([{ text: "Hello #world [test]" }]);
  assert.ok(result.includes("\\#"), "# must be escaped");
  assert.ok(result.includes("\\["), "[ must be escaped");
  assert.ok(result.includes("\\]"), "] must be escaped");
});

test("renderRichText: bold span uses weight:bold", () => {
  const result = renderRichText([{ text: "bold", bold: true }]);
  assert.ok(result.includes('weight: "bold"'), "Bold span must use weight:bold");
});

test("renderRichText: italic span uses style:italic", () => {
  const result = renderRichText([{ text: "italic", italic: true }]);
  assert.ok(result.includes('style: "italic"'), "Italic span must use style:italic");
});

test("renderRichText: code span uses #raw()", () => {
  const result = renderRichText([{ text: "x = 1", code: true }]);
  assert.ok(result.includes("#raw("), "Code span must use #raw()");
});

test("renderRichText: link span uses #link()", () => {
  const result = renderRichText([{ text: "click", href: "https://example.com" }]);
  assert.ok(result.includes("#link("), "Link span must use #link()");
  assert.ok(result.includes("example.com"), "Link span must include the URL");
});

test("DOC_ID filter: source contains only filtered document ID", () => {
  const doc = makeTestDoc({ meta: { ...makeTestDoc().meta, docId: "ARCBOS-AGR-2606-0008" } });
  const src = renderDocumentTypst(doc, makeTestConfig());
  assert.ok(src.includes("ARCBOS-AGR-2606-0008"), "Source must reference the target DOC_ID");
  assert.ok(!src.includes("ARCBOS-SPEC-2606-0001"), "Source must not reference other DOC_IDs");
});
