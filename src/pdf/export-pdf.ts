/**
 * Core Typst PDF export logic — sidecar, read-only against Notion.
 *
 * Does NOT write back to Notion.
 * Does NOT write to the HTML build output directory.
 * Output directory: pdf-output/ (or caller-supplied outDir).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import type { AppConfig } from "../config.js";
import { UserFacingError } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { loadDocuments } from "../cli/shared.js";
import { copyDocumentAssets } from "../assets/copy-assets.js";
import { renderDocumentTypst } from "./render-typst.js";
import type { BrandInfo } from "./types.js";

export const PDF_OUTPUT_DIR = "pdf-output";

export type ExportResult = {
  docId: string;
  title: string;
  typPath: string;
  /** null when Typst is not installed. */
  pdfPath: string | null;
  lineCount: number;
};

/** Finds a document by DOC_ID (case-insensitive). Throws UserFacingError when not found. */
export function findDocument(docs: DocumentModel[], docId: string): DocumentModel {
  const upper = docId.trim().toUpperCase();
  const doc = docs.find((d) => d.meta.docId?.toUpperCase() === upper);
  if (!doc) {
    const ids = docs
      .map((d) => d.meta.docId)
      .filter(Boolean)
      .sort()
      .slice(0, 12)
      .join(", ");
    throw new UserFacingError(
      `No document found with DOC_ID "${docId}".` +
      (ids
        ? `\n  Available DOC_IDs (sample): ${ids}`
        : "\n  No DOC_IDs found — check NOTION_DATABASE_ID.")
    );
  }
  return doc;
}

/** Returns true when the `typst` binary is available on PATH. */
export function checkTypst(): boolean {
  try {
    execSync("typst --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders and compiles one already-loaded DocumentModel → .typ → .pdf.
 * Writes .typ before checking for Typst so the source is always available.
 */
export async function exportDocumentTypst(
  doc: DocumentModel,
  config: AppConfig,
  outDir: string = PDF_OUTPUT_DIR,
): Promise<{ typPath: string; pdfPath: string | null; lineCount: number }> {
  if (doc.assets.length > 0) {
    try {
      await copyDocumentAssets(doc, outDir);
    } catch (err) {
      console.warn(`[PDF] Asset download failed (continuing without images): ${String(err)}`);
    }
  }

  const brandProfile = doc.meta.brand.token ? config.brandProfiles?.[doc.meta.brand.token] : undefined;
  const brand: BrandInfo = brandProfile ?? {
    displayName: doc.meta.brand.label ?? "",
    tagline: "",
  };

  const typSrc = renderDocumentTypst(doc, brand);
  await fs.mkdir(outDir, { recursive: true });
  const typPath = path.join(outDir, `${doc.meta.docId}.typ`);
  await fs.writeFile(typPath, typSrc, "utf8");
  const lineCount = typSrc.split("\n").length;

  const pdfPath = path.join(outDir, `${doc.meta.docId}.pdf`);

  if (!checkTypst()) {
    return { typPath, pdfPath: null, lineCount };
  }

  try {
    const output = execSync(`typst compile "${typPath}" "${pdfPath}" 2>&1`, { encoding: "utf8" });
    if (output.trim()) console.log(output.trim());
  } catch (e) {
    const msg = e instanceof Error ? ((e as { stdout?: string }).stdout ?? e.message) : String(e);
    throw new UserFacingError(
      `Typst compile failed:\n${msg.trim()}\n\nFix the source and rerun:\n  typst compile "${typPath}" "${pdfPath}"`
    );
  }

  return { typPath, pdfPath, lineCount };
}

/**
 * Convenience wrapper: Notion → find doc → export.
 * For queue processing, prefer exportDocumentTypst() with a pre-loaded doc.
 */
export async function exportTypstPdf(
  docId: string,
  config: AppConfig,
  outDir: string = PDF_OUTPUT_DIR,
): Promise<ExportResult> {
  const allDocs = await loadDocuments(config);
  const doc = findDocument(allDocs, docId);

  if (doc.validation.errors.length > 0) {
    console.warn(`[PDF] Document has ${doc.validation.errors.length} validation error(s) — exporting anyway.`);
  }

  const { typPath, pdfPath, lineCount } = await exportDocumentTypst(doc, config, outDir);
  return { docId: doc.meta.docId, title: doc.meta.title, typPath, pdfPath, lineCount };
}
