/**
 * Tests for the sidecar Typst PDF publisher.
 *
 * These tests protect:
 *   - CLI wiring (script exists, correct output dir)
 *   - Isolation (no render-html dependency, no dist/ access)
 *   - Typst source correctness (no TOC, running footer, heading/table/code style)
 *   - Signature page detection
 *   - DOC_ID filtering and error handling
 *
 * All tests run in memory — no Notion access, no file output.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { DocumentModel } from "../model/document.js";
import { emptyValidation } from "../model/document.js";
import { renderDocumentTypst } from "../pdf/render-typst.js";
import { findDocument } from "../pdf/export-pdf.js";
import type { BrandInfo } from "../pdf/types.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_BRAND: BrandInfo = { displayName: "ARCBOS", tagline: "Engineering" };

function makeDoc(
  content: DocumentModel["content"] = [],
  metaOverrides: Partial<DocumentModel["meta"]> = {},
): DocumentModel {
  return {
    meta: {
      docId: "ARCBOS-TEST-2606-0001",
      title: "Test Contract",
      brand:  { label: "ARCBOS",     token: "ARCBOS", slug: "arcbos"  },
      client: { label: "Test Client", slug: "test-client" },
      project:{ label: "Test Proj",   slug: "test-proj"   },
      documentType: { label: "Agreement", token: "AGR", slug: "agr" },
      version: "v1.0",
      status:  "Approved",
      visibility: "Public",
      publish: true,
      portalListed: false,
      shareToken: "",
      privateLinkNamespace: "",
      category: "",
      portalCategory: "",
      canonicalPath: "/docs/arcbos-test-2606-0001/",
      ...metaOverrides,
    },
    content,
    assets: [],
    source: { notionPageId: "test-page-id", notionDatabaseId: "test-db-id" },
    validation: emptyValidation(),
  };
}

// ── 1. Script wiring ──────────────────────────────────────────────────────────

test("pdf:export script exists in package.json", async () => {
  const raw = await fs.readFile(path.resolve("package.json"), "utf8");
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  assert.ok(
    "pdf:export" in pkg.scripts,
    "package.json must have a pdf:export script"
  );
  assert.ok(
    pkg.scripts["pdf:export"]!.includes("export-typst"),
    "pdf:export must invoke export-typst CLI"
  );
});

// ── 2. Output isolation — writes only to pdf-output/ ─────────────────────────

test("exporter only writes to pdf-output/, not dist/", async () => {
  const src = await fs.readFile(path.resolve("src/pdf/export-pdf.ts"), "utf8");
  assert.ok(src.includes("pdf-output"), "export-pdf.ts must reference pdf-output");
  assert.ok(!src.includes("dist/"), "export-pdf.ts must not reference dist/");
});

// ── 3. No render-html dependency ──────────────────────────────────────────────

test("exporter does not import render-html", async () => {
  const [cliSrc, coreSrc] = await Promise.all([
    fs.readFile(path.resolve("src/cli/export-typst.ts"), "utf8"),
    fs.readFile(path.resolve("src/pdf/export-pdf.ts"),   "utf8"),
  ]);
  assert.ok(!cliSrc.includes("render-html"), "CLI must not import render-html");
  assert.ok(!coreSrc.includes("render-html"), "export-pdf must not import render-html");
});

// ── 4. No dist/docs access ────────────────────────────────────────────────────

test("exporter does not read from dist/docs", async () => {
  const [cliSrc, coreSrc, rendererSrc] = await Promise.all([
    fs.readFile(path.resolve("src/cli/export-typst.ts"),  "utf8"),
    fs.readFile(path.resolve("src/pdf/export-pdf.ts"),    "utf8"),
    fs.readFile(path.resolve("src/pdf/render-typst.ts"),  "utf8"),
  ]);
  for (const [label, src] of [["CLI", cliSrc], ["core", coreSrc], ["renderer", rendererSrc]]) {
    assert.ok(
      !(src as string).includes("dist/docs"),
      `${label} must not reference dist/docs`
    );
  }
});

// ── 5. No TOC in rendered output ──────────────────────────────────────────────

test("Typst source contains no #outline (TOC removed)", () => {
  const doc = makeDoc([
    { type: "paragraph", id: "p1", richText: [{ text: "Body." }] },
  ]);
  const src = renderDocumentTypst(doc, TEST_BRAND);
  assert.ok(!src.includes("#outline"), "Rendered .typ must not contain #outline");
  assert.ok(!src.includes("目录"), "Rendered .typ must not contain TOC label 目录");
});

// ── 6. Running footer with page counter ───────────────────────────────────────

test("Typst source contains running footer with page counter", () => {
  const doc = makeDoc([]);
  const src = renderDocumentTypst(doc, TEST_BRAND);
  assert.ok(
    src.includes("counter(page)"),
    "Rendered .typ must contain counter(page) for running footer"
  );
  assert.ok(
    src.includes("footer:"),
    "Rendered .typ must have a footer: declaration in page setup"
  );
});

// ── 7. Signature page triggers pagebreak ──────────────────────────────────────

test("签署页 heading triggers #pagebreak() in Typst output", () => {
  const doc = makeDoc([
    { type: "paragraph",  id: "b1", richText: [{ text: "Body paragraph." }] },
    { type: "heading_1",  id: "b2", richText: [{ text: "签署页" }] },
    { type: "paragraph",  id: "b3", richText: [{ text: "甲方：上海测试公司" }] },
  ]);
  const src = renderDocumentTypst(doc, TEST_BRAND);
  assert.ok(
    src.includes("#pagebreak()"),
    "Signature page heading must trigger #pagebreak()"
  );
});

// ── 8. Table header has no fill color ─────────────────────────────────────────

test("table header cells use no fill — transparent background", () => {
  const doc = makeDoc([
    {
      type: "table",
      id: "t1",
      rows: [
        [[{ text: "Header A" }], [{ text: "Header B" }]],
        [[{ text: "Row 1A"   }], [{ text: "Row 1B"   }]],
      ],
    },
  ]);
  const src = renderDocumentTypst(doc, TEST_BRAND);

  // The table section must not set fill: on header-row cells.
  // Check that there is no table.cell(fill: pattern (which would color the cell).
  assert.ok(
    !src.includes("table.cell(fill:"),
    "Table must not use table.cell(fill:) — no header fill allowed"
  );
  // Header cells should be wrapped in #upper[], not given a fill
  assert.ok(
    src.includes("#upper[Header A]"),
    "Header cell content should be wrapped in #upper[]"
  );
});

// ── 9. Code block uses uniform border, no left bar ────────────────────────────

test("code block show rule uses uniform stroke, not left-only bar", () => {
  const doc = makeDoc([]);
  const src = renderDocumentTypst(doc, TEST_BRAND);

  // The block raw show rule should use a uniform stroke (e.g. 0.5pt + rgb(...))
  // not a directional (left: ...) stroke — which would be the "left bar" pattern.
  assert.ok(
    src.includes("stroke: 0.5pt +"),
    "Code block must use uniform stroke (not directional)"
  );
  // Verify the block raw rule does NOT restrict stroke to left side only
  const blockRawIdx = src.indexOf("raw.where(block: true)");
  const blockRawSection = blockRawIdx >= 0 ? src.slice(blockRawIdx, blockRawIdx + 300) : "";
  assert.ok(
    !blockRawSection.includes("stroke: (left:"),
    "Block code show rule must not use left-only stroke (no left bar)"
  );
});

// ── 10. DOC_ID filtering works with case normalization ────────────────────────

test("findDocument matches case-insensitively and returns correct doc", () => {
  const doc = makeDoc([], { docId: "ARCBOS-TEST-2606-0001" });

  const result = findDocument([doc], "ARCBOS-TEST-2606-0001");
  assert.equal(result.meta.docId, "ARCBOS-TEST-2606-0001");

  const resultLower = findDocument([doc], "arcbos-test-2606-0001");
  assert.equal(resultLower.meta.docId, "ARCBOS-TEST-2606-0001");
});

// ── 11. Missing DOC_ID gives clear error ──────────────────────────────────────

test("findDocument throws UserFacingError when DOC_ID not found", () => {
  const doc = makeDoc([], { docId: "ARCBOS-TEST-2606-0001" });

  assert.throws(
    () => findDocument([doc], "ARCBOS-MISSING-0000-9999"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /No document found/);
      assert.match(err.message, /ARCBOS-MISSING-0000-9999/);
      return true;
    }
  );
});

// ── 12. .typ written before typst binary check ────────────────────────────────

test(".typ file is written before Typst binary is checked", async () => {
  const src = await fs.readFile(path.resolve("src/pdf/export-pdf.ts"), "utf8");
  const writeIdx = src.indexOf("writeFile(typPath");
  // Search for the call site !checkTypst(), not the function definition
  const typstIdx = src.indexOf("!checkTypst()");
  assert.ok(writeIdx >= 0, "export-pdf.ts must call writeFile for .typ");
  assert.ok(typstIdx >= 0, "export-pdf.ts must call !checkTypst() guard");
  assert.ok(
    writeIdx < typstIdx,
    ".typ must be written (writeFile) before the !checkTypst() guard"
  );
});

// ── 13. 5-column table uses payment-style proportional fr widths ──────────────

test("5-column table uses 8fr/8fr/18fr/34fr/32fr payment-milestone column widths", () => {
  const doc = makeDoc([
    {
      type: "table",
      id: "t5",
      rows: [
        [
          [{ text: "节点" }],
          [{ text: "比例" }],
          [{ text: "节点名称" }],
          [{ text: "最低验收目标" }],
          [{ text: "付款触发依据" }],
        ],
        [
          [{ text: "M1" }],
          [{ text: "30%" }],
          [{ text: "需求评审" }],
          [{ text: "需求文档完成" }],
          [{ text: "确认函签署" }],
        ],
      ],
    },
  ]);
  const src = renderDocumentTypst(doc, TEST_BRAND);
  assert.ok(
    src.includes("8fr, 8fr, 18fr, 34fr, 32fr"),
    "5-column table must use payment milestone column ratios (8/8/18/34/32)"
  );
});

// ── 14. 2-column table uses 28fr/72fr proportional widths ─────────────────────

test("2-column table uses 28fr/72fr proportional column widths", () => {
  const doc = makeDoc([
    {
      type: "table",
      id: "t2",
      rows: [
        [[{ text: "Term" }], [{ text: "Definition" }]],
        [[{ text: "甲方" }], [{ text: "上海测试公司" }]],
      ],
    },
  ]);
  const src = renderDocumentTypst(doc, TEST_BRAND);
  assert.ok(
    src.includes("28fr, 72fr"),
    "2-column table must use 28/72 fr proportions"
  );
});

// ── 15. 3-column and 4-column tables use fr widths (not auto) ─────────────────

test("3-column and 4-column tables use fr units — no auto columns", () => {
  for (const [colCount, expectedFrag] of [
    [3, "20fr, 30fr, 50fr"],
    [4, "15fr, 20fr, 33fr, 32fr"],
  ] as [number, string][]) {
    const headers = Array.from({ length: colCount }, (_, i) => [{ text: `H${i + 1}` }]);
    const bodyRow = Array.from({ length: colCount }, (_, i) => [{ text: `R${i + 1}` }]);
    const doc = makeDoc([{ type: "table", id: "t", rows: [headers, bodyRow] }]);
    const src = renderDocumentTypst(doc, TEST_BRAND);
    assert.ok(
      src.includes(expectedFrag),
      `${colCount}-column table must use fr proportions: ${expectedFrag}`
    );
    // Table columns declaration must not use 'auto'
    const tableStart = src.indexOf("#table(");
    const columnsLine = src.indexOf("columns:", tableStart);
    const columnsEnd = src.indexOf("\n", columnsLine);
    const columnsDecl = src.slice(columnsLine, columnsEnd);
    assert.ok(
      !columnsDecl.includes("auto"),
      `${colCount}-column table columns: line must not use 'auto' — prevents CJK vertical wrapping`
    );
  }
});

// ── 16. Rendered table uses table.header() for repeating header ───────────────

test("rendered table uses table.header() so header repeats on multi-page tables", () => {
  const doc = makeDoc([
    {
      type: "table",
      id: "t1",
      rows: [
        [[{ text: "Header A" }], [{ text: "Header B" }]],
        [[{ text: "Row 1A" }], [{ text: "Row 1B" }]],
      ],
    },
  ]);
  const src = renderDocumentTypst(doc, TEST_BRAND);
  assert.ok(
    src.includes("table.header("),
    "Rendered table must use table.header() for repeating header on page breaks"
  );
});

// ── 17. render-html.ts has no Typst or PDF renderer references ───────────────

test("render-html.ts contains no Typst or PDF renderer references", async () => {
  const src = await fs.readFile(path.resolve("src/render/render-html.ts"), "utf8");
  assert.ok(
    !src.includes("render-typst"),
    "render-html.ts must not import render-typst"
  );
  assert.ok(
    !src.toLowerCase().includes("typst"),
    "render-html.ts must not contain any Typst references"
  );
});

// ── 18. styles/print.css is unchanged — standard print rules intact ───────────

test("styles/print.css retains standard print layout rules (unchanged)", async () => {
  const src = await fs.readFile(path.resolve("styles/print.css"), "utf8");
  assert.ok(src.includes("@page"), "print.css must still contain @page rule");
  assert.ok(
    src.includes("border-collapse: collapse"),
    "print.css must still declare table border-collapse: collapse"
  );
  assert.ok(
    src.includes("size: letter"),
    "print.css must still specify US Letter page size"
  );
  assert.ok(
    !src.includes("typst") && !src.includes("render-typst"),
    "print.css must not contain any Typst references — HTML and PDF renderers are independent"
  );
});
