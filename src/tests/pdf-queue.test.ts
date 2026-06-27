/**
 * Tests for PDF Publisher 2.0 queue, writeback, and workflow wiring.
 *
 * These tests protect:
 *   - CLI wiring (scripts exist in package.json)
 *   - Workflow safety (dispatch-only, no deploy, writeback default off)
 *   - Queue logic (single/ALL modes, error handling)
 *   - Writeback isolation (only 5 PDF fields, not preview writeback)
 *   - Pure helpers (buildPdfProperties, buildRunUrl)
 *
 * All tests run in memory — no Notion access, no file output.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { buildPdfProperties } from "../pdf/notion-writeback.js";
import { buildRunUrl } from "../pdf/queue.js";
import type { QueueReport, PdfWritebackPayload } from "../pdf/types.js";

// ── 1. pdf:queue script exists ────────────────────────────────────────────────

test("pdf:queue script exists in package.json", async () => {
  const raw = await fs.readFile(path.resolve("package.json"), "utf8");
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  assert.ok("pdf:queue" in pkg.scripts, "package.json must have a pdf:queue script");
  assert.ok(
    pkg.scripts["pdf:queue"]!.includes("pdf-queue"),
    "pdf:queue must invoke pdf-queue CLI"
  );
});

// ── 2. Workflow: dispatch-only, no push/schedule ──────────────────────────────

test("pdf-publisher.yml is workflow_dispatch only — no push or schedule", async () => {
  const src = await fs.readFile(
    path.resolve(".github/workflows/pdf-publisher.yml"),
    "utf8"
  );
  assert.ok(src.includes("workflow_dispatch"), "workflow must have workflow_dispatch trigger");
  assert.ok(!src.includes("push:"), "workflow must NOT have push trigger");
  assert.ok(!src.includes("schedule:"), "workflow must NOT have schedule trigger");
});

// ── 3. Workflow: writeback default false ──────────────────────────────────────

test("pdf-publisher.yml writeback input defaults to false", async () => {
  const src = await fs.readFile(
    path.resolve(".github/workflows/pdf-publisher.yml"),
    "utf8"
  );
  // The writeback input should exist with default: false
  assert.ok(src.includes("writeback"), "workflow must have a writeback input");
  assert.ok(src.includes("default: false"), "writeback input must default to false");
});

// ── 4. Workflow: does not deploy GitHub Pages ─────────────────────────────────

test("pdf-publisher.yml does not deploy to GitHub Pages", async () => {
  const src = await fs.readFile(
    path.resolve(".github/workflows/pdf-publisher.yml"),
    "utf8"
  );
  assert.ok(!src.includes("pages"), "workflow must not reference pages deployment");
  assert.ok(!src.includes("deploy"), "workflow must not contain deploy steps");
});

// ── 5. Queue CLI requires explicit DOC_ID or ALL ──────────────────────────────

test("queue CLI requires DOC_ID or ALL — no-arg case handled in CLI source", async () => {
  const src = await fs.readFile(path.resolve("src/cli/pdf-queue.ts"), "utf8");
  assert.ok(
    src.includes("throw new UserFacingError"),
    "pdf-queue.ts must throw UserFacingError when no arg provided"
  );
  assert.ok(
    src.includes("ALL"),
    "pdf-queue.ts must handle the ALL keyword"
  );
});

// ── 6. buildPdfProperties writes only 5 PDF fields ───────────────────────────

test("buildPdfProperties writes only allowed PDF fields", () => {
  const payload: PdfWritebackPayload = {
    generatePdf: false,
    pdfStatus: "Generated",
    pdfUrl: "https://example.com",
    pdfGeneratedAt: "2026-06-27T00:00:00.000Z",
    pdfError: null,
  };
  const props = buildPdfProperties(payload);
  const keys = Object.keys(props);

  assert.ok(keys.includes("Generate PDF"), "must include 'Generate PDF'");
  assert.ok(keys.includes("PDF Status"), "must include 'PDF Status'");
  assert.ok(keys.includes("PDF URL"), "must include 'PDF URL'");
  assert.ok(keys.includes("PDF Generated At"), "must include 'PDF Generated At'");
  assert.ok(keys.includes("PDF Error"), "must include 'PDF Error'");
  assert.equal(keys.length, 5, "must write exactly 5 properties");
});

// ── 7. buildPdfProperties partial payload omits missing keys ──────────────────

test("buildPdfProperties only includes keys present in payload", () => {
  const props = buildPdfProperties({ pdfStatus: "Generating" });
  const keys = Object.keys(props);
  assert.equal(keys.length, 1, "should only include pdfStatus key");
  assert.ok(keys.includes("PDF Status"));
});

// ── 8. buildPdfProperties clears PDF Error on success ────────────────────────

test("buildPdfProperties clears PDF Error when pdfError is null", () => {
  const props = buildPdfProperties({ pdfError: null }) as Record<string, { rich_text: unknown[] }>;
  assert.ok("PDF Error" in props, "PDF Error key must be present");
  assert.deepEqual(props["PDF Error"]!.rich_text, [], "null pdfError must produce empty rich_text");
});

// ── 9. QueueReport has correct schema shape ───────────────────────────────────

test("QueueReport type has mode, writeback, and results fields", () => {
  const report: QueueReport = {
    mode: "single",
    writeback: false,
    results: [
      {
        docId: "ARCBOS-AGR-2606-0008",
        pageId: "abc123",
        status: "generated",
        typPath: "pdf-output/ARCBOS-AGR-2606-0008.typ",
        pdfPath: "pdf-output/ARCBOS-AGR-2606-0008.pdf",
        url: null,
        error: null,
      },
    ],
  };
  assert.equal(report.mode, "single");
  assert.equal(report.writeback, false);
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0]!.status, "generated");
});

// ── 10. buildRunUrl generates correct URL ─────────────────────────────────────

test("buildRunUrl generates correct GitHub Actions run URL", () => {
  const url = buildRunUrl(
    "https://github.com",
    "enxpower/notion-doc-publisher-v3",
    "12345678",
  );
  assert.equal(
    url,
    "https://github.com/enxpower/notion-doc-publisher-v3/actions/runs/12345678",
  );
});

// ── 11. buildRunUrl returns null when env vars missing ────────────────────────

test("buildRunUrl returns null when any env var is undefined", () => {
  assert.equal(buildRunUrl(undefined, "repo", "123"), null);
  assert.equal(buildRunUrl("https://github.com", undefined, "123"), null);
  assert.equal(buildRunUrl("https://github.com", "repo", undefined), null);
  assert.equal(buildRunUrl(undefined, undefined, undefined), null);
});

// ── 12. No render-html imports in queue pipeline ──────────────────────────────

test("queue pipeline does not import render-html", async () => {
  const [queueSrc, writebackSrc, cliSrc] = await Promise.all([
    fs.readFile(path.resolve("src/pdf/queue.ts"), "utf8"),
    fs.readFile(path.resolve("src/pdf/notion-writeback.ts"), "utf8"),
    fs.readFile(path.resolve("src/cli/pdf-queue.ts"), "utf8"),
  ]);
  for (const [label, src] of [
    ["queue.ts", queueSrc],
    ["notion-writeback.ts", writebackSrc],
    ["pdf-queue.ts (CLI)", cliSrc],
  ]) {
    assert.ok(
      !(src as string).includes("render-html"),
      `${label} must not import render-html`
    );
  }
});

// ── 13. No dist/docs access in queue pipeline ────────────────────────────────

test("queue pipeline does not reference dist/docs", async () => {
  const [queueSrc, writebackSrc, cliSrc] = await Promise.all([
    fs.readFile(path.resolve("src/pdf/queue.ts"), "utf8"),
    fs.readFile(path.resolve("src/pdf/notion-writeback.ts"), "utf8"),
    fs.readFile(path.resolve("src/cli/pdf-queue.ts"), "utf8"),
  ]);
  for (const [label, src] of [
    ["queue.ts", queueSrc],
    ["notion-writeback.ts", writebackSrc],
    ["pdf-queue.ts (CLI)", cliSrc],
  ]) {
    assert.ok(
      !(src as string).includes("dist/docs"),
      `${label} must not reference dist/docs`
    );
  }
});

// ── 14. Dry-run logging exists in queue.ts ────────────────────────────────────

test("queue.ts has dry-run log path when writeback is false", async () => {
  const src = await fs.readFile(path.resolve("src/pdf/queue.ts"), "utf8");
  assert.ok(
    src.includes("dry-run"),
    "queue.ts must log dry-run messages when writeback=false"
  );
});

// ── 15. Queue uses notion-writeback, not preview writeback ───────────────────

test("queue.ts imports from notion-writeback, not from writeback.ts preview module", async () => {
  const src = await fs.readFile(path.resolve("src/pdf/queue.ts"), "utf8");
  assert.ok(
    src.includes("notion-writeback"),
    "queue.ts must import from notion-writeback.ts"
  );
  assert.ok(
    !src.includes("writeback.ts") && !src.includes("NotionWriteback"),
    "queue.ts must not use the preview NotionWriteback class"
  );
});
