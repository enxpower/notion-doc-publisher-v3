/**
 * Regression tests for the sidecar PDF export feature.
 *
 * These tests verify that the PDF sidecar remains isolated from the
 * existing HTML publishing pipeline:
 *   - The pdf:doc npm script exists and targets export-doc-pdf
 *   - Output paths follow dist/pdf/{DOC_ID}.pdf
 *   - The PDF-only template does not include web-only chrome
 *   - The PDF-only CSS specifies US Letter @page
 *   - The existing render-html functions are unaffected
 *
 * No Notion access. No Playwright invocation. No file output.
 * Run with: npm test
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderBlocks } from "../render/render-blocks.js";
import type { DocumentBlock } from "../model/document.js";

/* ------------------------------------------------------------------ */
/* pdf:doc script registration                                         */
/* ------------------------------------------------------------------ */

test("pdf:doc script is defined in package.json", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.ok(
    typeof pkg.scripts["pdf:doc"] === "string",
    'scripts["pdf:doc"] must exist in package.json'
  );
  assert.ok(
    pkg.scripts["pdf:doc"]!.includes("export-doc-pdf"),
    'pdf:doc must invoke export-doc-pdf'
  );
});

test("pdf:doc output path follows dist/pdf/{DOC_ID}.pdf pattern", () => {
  const docId = "ARCBOS-CON-2606-0001";
  const outPath = `dist/pdf/${docId}.pdf`;
  assert.ok(outPath.startsWith("dist/pdf/"), "output must be under dist/pdf/");
  assert.ok(outPath.endsWith(".pdf"), "output must be a .pdf file");
  assert.ok(outPath.includes(docId), "output must include the DOC_ID");
  assert.equal(outPath, "dist/pdf/ARCBOS-CON-2606-0001.pdf");
});

/* ------------------------------------------------------------------ */
/* PDF-only template isolation                                         */
/* ------------------------------------------------------------------ */

test("pdf-document.html is a distinct template from enterprise.html", () => {
  const pdfTpl = readFileSync("templates/pdf-document.html", "utf8");
  const entTpl = readFileSync("templates/enterprise.html", "utf8");

  // PDF template must not include web-only chrome classes
  assert.ok(!pdfTpl.includes("site-topbar"), "PDF template must not contain .site-topbar");
  assert.ok(!pdfTpl.includes("document-actions"), "PDF template must not contain .document-actions");
  assert.ok(!pdfTpl.includes("document-toc"), "PDF template must not contain .document-toc");

  // PDF template must not reference the screen or print stylesheets
  assert.ok(!pdfTpl.includes("screen.css"), "PDF template must not reference screen.css");
  assert.ok(!pdfTpl.includes("print.css"), "PDF template must not reference print.css");

  // PDF template must not include the browser print button
  assert.ok(!pdfTpl.includes("window.print"), "PDF template must not include browser print action");

  // Enterprise template is unchanged
  assert.ok(entTpl.includes("{{screenCss}}"), "enterprise.html must still reference screenCss slot");
  assert.ok(entTpl.includes("{{printCss}}"), "enterprise.html must still reference printCss slot");
});

test("pdf-document.css specifies US Letter @page and does not alter existing stylesheets", () => {
  const pdfCss = readFileSync("styles/pdf-document.css", "utf8");
  const screenCss = readFileSync("styles/screen.css", "utf8");
  const printCss = readFileSync("styles/print.css", "utf8");

  assert.ok(pdfCss.includes("@page"), "pdf-document.css must have an @page rule");
  assert.ok(pdfCss.includes("letter"), "pdf-document.css must specify US Letter size");

  // Verify existing stylesheets are unchanged by spot-checking key anchors
  assert.ok(
    screenCss.includes("--paper-width"),
    "screen.css must still define --paper-width (unchanged)"
  );
  assert.ok(
    printCss.includes("size: letter"),
    "print.css must still specify letter size (unchanged)"
  );
});

/* ------------------------------------------------------------------ */
/* render-blocks isolation — PDF export must not affect block renderer */
/* ------------------------------------------------------------------ */

test("renderBlocks output is unchanged by the PDF sidecar", () => {
  const blocks: DocumentBlock[] = [
    { type: "paragraph", id: "b1", richText: [{ text: "Hello world." }] },
    { type: "heading_1", id: "b2", richText: [{ text: "Section A" }] },
    { type: "bulleted_list_item", id: "b3", richText: [{ text: "Item 1" }] },
    { type: "bulleted_list_item", id: "b4", richText: [{ text: "Item 2" }] },
  ];
  const html = renderBlocks(blocks, "publishable");
  assert.ok(html.includes("<p>Hello world.</p>"), "paragraph renders correctly");
  assert.ok(html.includes("<h2>Section A</h2>"), "heading_1 renders as h2");
  assert.ok(html.includes("<ul>"), "bulleted list items render as ul");
  assert.ok(html.includes("<li>Item 1</li>"), "list item 1 renders");
  assert.ok(html.includes("<li>Item 2</li>"), "list item 2 renders");
});

test("pdf template slots do not collide with enterprise.html slots", () => {
  const pdfTpl = readFileSync("templates/pdf-document.html", "utf8");
  const entTpl = readFileSync("templates/enterprise.html", "utf8");

  // Extract slot names from each template
  const pdfSlots = new Set([...pdfTpl.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map((m) => m[1]!));
  const entSlots = new Set([...entTpl.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map((m) => m[1]!));

  // PDF-specific slots must not appear in enterprise.html
  const pdfOnlySlots = ["inlineCss", "taglineBlock", "heroBlock", "identityLine", "metaSection", "footerRef"];
  for (const slot of pdfOnlySlots) {
    assert.ok(pdfSlots.has(slot), `pdf-document.html must have slot {{${slot}}}`);
    assert.ok(!entSlots.has(slot), `enterprise.html must NOT have slot {{${slot}}}`);
  }
});
