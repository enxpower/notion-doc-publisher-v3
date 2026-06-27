/**
 * Tests for site PDF generation (feature/site-pdf-auto-publish).
 *
 * These tests protect:
 *   - pdf:site script wiring in package.json
 *   - Output isolation (dist/pdf/ only, never pdf-output/)
 *   - No dependency on "Generate PDF" Notion checkbox
 *   - publishableDocuments() is the source of truth for eligible docs
 *   - Download PDF button present alongside unchanged Print button
 *   - Relative PDF link with no hardcoded domain
 *   - Workflow installs Typst and fonts
 *   - PDF_REQUIRED failure policy
 *   - Existing HTML content renderer is untouched
 *
 * All tests run in memory — no Notion access, no file output.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { renderActions } from "../render/render-html.js";

// ── 1. pdf:site script exists ─────────────────────────────────────────────────

test("pdf:site script exists in package.json", async () => {
  const raw = await fs.readFile(path.resolve("package.json"), "utf8");
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  assert.ok("pdf:site" in pkg.scripts, "package.json must have a pdf:site script");
  assert.ok(
    pkg.scripts["pdf:site"]!.includes("export-site-pdf"),
    "pdf:site must invoke export-site-pdf CLI"
  );
});

// ── 2. Site PDF CLI writes only to dist/pdf/ ─────────────────────────────────

test("export-site-pdf.ts writes to dist/pdf/, not pdf-output/", async () => {
  const src = await fs.readFile(path.resolve("src/cli/export-site-pdf.ts"), "utf8");
  assert.ok(src.includes("dist/pdf"), "export-site-pdf must reference dist/pdf");
  assert.ok(!src.includes("pdf-output"), "export-site-pdf must not reference pdf-output");
});

// ── 3. Site PDF does not require Generate PDF checkbox ────────────────────────

test("export-site-pdf.ts does not filter on Generate PDF checkbox", async () => {
  const src = await fs.readFile(path.resolve("src/cli/export-site-pdf.ts"), "utf8");
  assert.ok(
    !src.includes("Generate PDF"),
    "export-site-pdf must not reference the Generate PDF checkbox"
  );
});

// ── 4. Site PDF uses publishableDocuments (not a custom filter) ───────────────

test("export-site-pdf.ts uses publishableDocuments to determine eligible docs", async () => {
  const src = await fs.readFile(path.resolve("src/cli/export-site-pdf.ts"), "utf8");
  assert.ok(
    src.includes("publishableDocuments"),
    "export-site-pdf must call publishableDocuments()"
  );
});

// ── 5. Download PDF button is present in renderActions output ─────────────────

test("renderActions includes Download PDF button when docId is provided", () => {
  const html = renderActions("ARCBOS-AGR-2606-0008");
  assert.ok(
    html.includes("Download PDF"),
    "renderActions must include 'Download PDF' text when docId is given"
  );
  assert.ok(
    html.includes("action-btn"),
    "Download PDF element must use action-btn class"
  );
});

// ── 6. Print button is still present (unchanged) ──────────────────────────────

test("renderActions still includes Print button", () => {
  const html = renderActions("ARCBOS-AGR-2606-0008");
  assert.ok(
    html.includes("window.print()"),
    "renderActions must retain the window.print() Print button"
  );
  assert.ok(html.includes(">Print<"), "Print button label must remain 'Print'");
});

// ── 7. PDF link uses relative path /pdf/{DOC_ID}.pdf ─────────────────────────

test("PDF download link uses relative /pdf/{DOC_ID}.pdf path", () => {
  const docId = "ARCBOS-AGR-2606-0008";
  const html = renderActions(docId);
  assert.ok(
    html.includes(`href="/pdf/${docId}.pdf"`),
    `PDF link must be href="/pdf/${docId}.pdf"`
  );
});

// ── 8. No hardcoded domain in PDF link ───────────────────────────────────────

test("PDF download link does not contain a hardcoded domain", () => {
  const html = renderActions("ARCBOS-AGR-2606-0008");
  assert.ok(!html.includes("http://"), "PDF link must not contain http://");
  assert.ok(!html.includes("https://"), "PDF link must not contain https://");
  assert.ok(!html.includes(".com"), "PDF link must not contain a hardcoded domain");
});

// ── 9. renderActions returns only Print when no docId ────────────────────────

test("renderActions returns only Print button when docId is absent", () => {
  const html = renderActions();
  assert.ok(html.includes("window.print()"), "Print button must always be present");
  assert.ok(!html.includes("Download PDF"), "Download PDF must be absent when no docId");
});

// ── 10. preview-publish.yml installs Typst ───────────────────────────────────

test("preview-publish.yml installs Typst via typst-community/setup-typst", async () => {
  const src = await fs.readFile(
    path.resolve(".github/workflows/preview-publish.yml"),
    "utf8"
  );
  assert.ok(
    src.includes("typst-community/setup-typst"),
    "preview-publish.yml must install Typst via typst-community/setup-typst"
  );
});

// ── 11. preview-publish.yml installs CJK fonts ───────────────────────────────

test("preview-publish.yml installs CJK fonts for PDF rendering", async () => {
  const src = await fs.readFile(
    path.resolve(".github/workflows/preview-publish.yml"),
    "utf8"
  );
  assert.ok(
    src.includes("fonts-noto-cjk"),
    "preview-publish.yml must install fonts-noto-cjk for CJK PDF support"
  );
});

// ── 12. PDF_REQUIRED=false does not block HTML publish ────────────────────────

test("preview-publish.yml pdf:site step uses continue-on-error for PDF_REQUIRED=false", async () => {
  const src = await fs.readFile(
    path.resolve(".github/workflows/preview-publish.yml"),
    "utf8"
  );
  assert.ok(
    src.includes("pdf:site"),
    "preview-publish.yml must include a pdf:site step"
  );
  assert.ok(
    src.includes("continue-on-error:"),
    "pdf:site step must use continue-on-error so PDF failure does not block HTML publish by default"
  );
});

// ── 13. PDF_REQUIRED=true blocks workflow on PDF failure ─────────────────────

test("preview-publish.yml pdf:site step references PDF_REQUIRED env var", async () => {
  const src = await fs.readFile(
    path.resolve(".github/workflows/preview-publish.yml"),
    "utf8"
  );
  assert.ok(
    src.includes("PDF_REQUIRED"),
    "preview-publish.yml must reference PDF_REQUIRED so PDF_REQUIRED=true blocks on failure"
  );
  // continue-on-error must be conditioned on PDF_REQUIRED so setting it to true inverts the behaviour
  const pdfSiteIdx = src.indexOf("pdf:site");
  const continueIdx = src.lastIndexOf("continue-on-error:", pdfSiteIdx);
  const pdfReqInExpr = src.slice(continueIdx, continueIdx + 120);
  assert.ok(
    pdfReqInExpr.includes("PDF_REQUIRED"),
    "continue-on-error for pdf:site must be conditioned on PDF_REQUIRED"
  );
});

// ── 14. Existing HTML renderer content is unchanged ──────────────────────────

test("render-blocks.ts is not modified (content rendering unchanged)", async () => {
  const src = await fs.readFile(path.resolve("src/render/render-blocks.ts"), "utf8");
  // Confirm render-blocks.ts has no PDF-related additions
  assert.ok(
    !src.includes("pdf") && !src.includes("PDF"),
    "render-blocks.ts must not contain any PDF references — content rendering is unchanged"
  );
});

// ── 15. renderActions output is used in template via {{actions}} slot ─────────

test("render-html.ts passes renderActions output through the actions template slot", async () => {
  const src = await fs.readFile(path.resolve("src/render/render-html.ts"), "utf8");
  assert.ok(
    src.includes("actions: renderActions("),
    "renderDocumentHtml must pass renderActions() result to the actions template slot"
  );
});

// ── 16. .document-actions must not use float ──────────────────────────────────

test(".document-actions CSS must not use float (float would cause body text to wrap beside buttons)", async () => {
  const src = await fs.readFile(path.resolve("styles/screen.css"), "utf8");
  // Extract just the .document-actions rule block
  const ruleStart = src.indexOf(".document-actions {");
  const ruleEnd = src.indexOf("}", ruleStart);
  assert.ok(ruleStart >= 0, ".document-actions rule must exist in screen.css");
  const rule = src.slice(ruleStart, ruleEnd + 1);
  assert.ok(
    !rule.includes("float:") && !rule.includes("float :"),
    ".document-actions must not use float — float causes body paragraphs to wrap beside the button row"
  );
});

// ── 17. .document-actions must be an explicit full-width block ────────────────

test(".document-actions CSS must include width: 100% and clear: both to guarantee full-width block layout", async () => {
  const src = await fs.readFile(path.resolve("styles/screen.css"), "utf8");
  const ruleStart = src.indexOf(".document-actions {");
  const ruleEnd = src.indexOf("}", ruleStart);
  const rule = src.slice(ruleStart, ruleEnd + 1);
  assert.ok(
    rule.includes("width: 100%"),
    ".document-actions must declare width: 100% to prevent shrink-wrap beside document body"
  );
  assert.ok(
    rule.includes("clear: both"),
    ".document-actions must declare clear: both to clear any upstream floats"
  );
});
