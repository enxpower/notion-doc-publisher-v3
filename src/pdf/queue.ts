import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { NotionClient } from "../notion/client.js";
import type { NotionPage } from "../notion/client.js";
import { pageToDocument } from "../notion/properties.js";
import { fetchPageBlocks } from "../cli/shared.js";
import { exportDocumentTypst, PDF_OUTPUT_DIR } from "./export-pdf.js";
import { validatePdfSchema, writePdfResult } from "./notion-writeback.js";
import type { PdfDocResult, QueueOptions, QueueReport } from "./types.js";

// ── Helpers for reading raw Notion page properties ────────────────────────────

function readCheckboxProp(page: NotionPage, name: string): boolean {
  const prop = page.properties[name] as { checkbox?: boolean } | undefined;
  return prop?.checkbox === true;
}

function readSelectProp(page: NotionPage, name: string): string | null {
  const prop = page.properties[name] as { select?: { name?: string } | null } | undefined;
  return prop?.select?.name ?? null;
}

function readRichTextProp(page: NotionPage, name: string): string | null {
  const prop = page.properties[name] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return prop?.rich_text?.[0]?.plain_text ?? null;
}

function readTitleProp(page: NotionPage): string | null {
  const prop = page.properties["Title"] as { title?: Array<{ plain_text?: string }> } | undefined;
  return prop?.title?.[0]?.plain_text ?? null;
}

// ── Exported types ─────────────────────────────────────────────────────────────

export type QueueEntry = {
  pageId: string;
  docId: string | null;
  title: string | null;
  pdfStatus: string | null;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Builds the GitHub Actions run URL from environment variables.
 * Returns null when any variable is absent (local / non-CI context).
 */
export function buildRunUrl(
  serverUrl: string | undefined,
  repository: string | undefined,
  runId: string | undefined,
): string | null {
  if (!serverUrl || !repository || !runId) return null;
  return `${serverUrl}/${repository}/actions/runs/${runId}`;
}

// ── Queue scanning ────────────────────────────────────────────────────────────

/**
 * Returns pages that are ready to process: Generate PDF = true AND PDF Status != Generated.
 * Pages already marked Generated are skipped so a re-run of ALL never reprocesses them.
 * Does NOT fetch blocks — only reads page-level properties.
 */
export async function queryPdfQueue(config: AppConfig): Promise<QueueEntry[]> {
  const client = new NotionClient(config);
  const pages = await client.queryDatabase();
  return pages
    .filter((p) => readCheckboxProp(p, "Generate PDF") && readSelectProp(p, "PDF Status") !== "Generated")
    .map((p) => ({
      pageId: p.id,
      docId: readRichTextProp(p, "DOC_ID"),
      title: readTitleProp(p),
      pdfStatus: readSelectProp(p, "PDF Status"),
    }));
}

// ── Core queue runner ─────────────────────────────────────────────────────────

export async function runPdfQueue(
  mode: "single" | "all",
  docIdInput: string | undefined,
  config: AppConfig,
  options: QueueOptions,
): Promise<QueueReport> {
  const { writeback, outDir, runUrl } = options;

  // 1. Validate PDF schema upfront
  await validatePdfSchema(config);

  // 2. Fetch all pages once — reused for both modes
  const client = new NotionClient(config);
  const allPages = await client.queryDatabase();
  const pageById = new Map<string, NotionPage>(allPages.map((p) => [p.id, p]));

  // 3. Determine which pages to process
  let entries: QueueEntry[];
  if (mode === "single") {
    const targetId = (docIdInput ?? "").trim().toUpperCase();
    const match = allPages.find(
      (p) => (readRichTextProp(p, "DOC_ID") ?? "").trim().toUpperCase() === targetId,
    );
    if (!match) {
      const sample = allPages
        .map((p) => readRichTextProp(p, "DOC_ID"))
        .filter(Boolean)
        .sort()
        .slice(0, 10)
        .join(", ");
      throw new Error(
        `No document found with DOC_ID "${docIdInput}".` +
        (sample ? `\n  Available DOC_IDs (sample): ${sample}` : ""),
      );
    }
    entries = [
      {
        pageId: match.id,
        docId: readRichTextProp(match, "DOC_ID"),
        title: readTitleProp(match),
        pdfStatus: readSelectProp(match, "PDF Status"),
      },
    ];
  } else {
    entries = allPages
      .filter((p) => readCheckboxProp(p, "Generate PDF") && readSelectProp(p, "PDF Status") !== "Generated")
      .map((p) => ({
        pageId: p.id,
        docId: readRichTextProp(p, "DOC_ID"),
        title: readTitleProp(p),
        pdfStatus: readSelectProp(p, "PDF Status"),
      }));

    if (entries.length === 0) {
      console.log("[PDF Queue] No pages are queued (Generate PDF=true and PDF Status!=Generated). Nothing to do.");
      const report: QueueReport = { mode, writeback, results: [] };
      await writeReport(report, outDir);
      return report;
    }
  }

  console.log(`[PDF Queue] ${mode === "single" ? "Single" : "All"} mode — ${entries.length} document(s) to process`);
  console.log(`[PDF Queue] writeback=${writeback}, runUrl=${runUrl ?? "(none)"}`);

  const results: PdfDocResult[] = [];

  for (const entry of entries) {
    const label = entry.docId ?? entry.pageId;
    console.log(`\n[PDF Queue] Processing: ${label}`);

    // 4a. Mark "Generating"
    if (writeback) {
      await writePdfResult(entry.pageId, { pdfStatus: "Generating" }, config);
    } else {
      console.log(`[PDF Queue] [dry-run] Would set PDF Status = "Generating" for ${label}`);
    }

    let result: PdfDocResult;
    try {
      // 4b. Load blocks and build DocumentModel
      const page = pageById.get(entry.pageId);
      if (!page) throw new Error(`Page ${entry.pageId} disappeared from query results`);

      const blocks = await fetchPageBlocks(client, entry.pageId);
      const doc = pageToDocument(page, blocks, config);

      // 4c. Export
      const { typPath, pdfPath } = await exportDocumentTypst(doc, config, outDir);

      // Typst binary absent → .typ written but no PDF compiled; treat as failure so
      // Generate PDF stays checked and the operator can install Typst and retry.
      if (pdfPath === null) {
        throw new Error(
          "Typst is not installed — .typ source written but PDF was not compiled.\n" +
          `  Source: ${typPath}\n` +
          "  Install Typst and rerun, or use the manual pdf:export command locally.",
        );
      }

      const generatedAt = new Date().toISOString();

      // 4d. Success writeback
      if (writeback) {
        await writePdfResult(
          entry.pageId,
          {
            generatePdf: false,
            pdfStatus: "Generated",
            pdfUrl: runUrl,
            pdfGeneratedAt: generatedAt,
            pdfError: null,
          },
          config,
        );
      } else {
        console.log(
          `[PDF Queue] [dry-run] Would write for ${label}:\n` +
          `  Generate PDF = false\n` +
          `  PDF Status = "Generated"\n` +
          `  PDF URL = ${runUrl ?? "(none)"}\n` +
          `  PDF Generated At = ${generatedAt}\n` +
          `  PDF Error = (cleared)`,
        );
      }

      result = {
        docId: entry.docId ?? "",
        pageId: entry.pageId,
        status: "generated",
        typPath,
        pdfPath,
        url: runUrl,
        error: null,
      };
      console.log(`[PDF Queue] Done: ${label} → ${pdfPath}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[PDF Queue] FAILED: ${label}\n  ${errorMsg}`);

      // 4e. Failure writeback
      if (writeback) {
        await writePdfResult(
          entry.pageId,
          { pdfStatus: "Failed", pdfError: errorMsg },
          config,
        );
      } else {
        console.log(
          `[PDF Queue] [dry-run] Would write for ${label}:\n` +
          `  PDF Status = "Failed"\n` +
          `  PDF Error = ${errorMsg.slice(0, 200)}`,
        );
      }

      result = {
        docId: entry.docId ?? "",
        pageId: entry.pageId,
        status: "failed",
        typPath: null,
        pdfPath: null,
        url: null,
        error: errorMsg,
      };
    }

    results.push(result);
  }

  const report: QueueReport = { mode, writeback, results };
  await writeReport(report, outDir);

  const generated = results.filter((r) => r.status === "generated").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`\n[PDF Queue] Complete: ${generated} generated, ${failed} failed`);

  return report;
}

async function writeReport(report: QueueReport, outDir: string): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, "report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[PDF Queue] Report written to ${reportPath}`);
}
