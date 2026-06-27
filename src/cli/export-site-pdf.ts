/**
 * Site PDF generation — generates PDFs for all publishable documents and writes
 * them into the HTML dist output at dist/pdf/{DOC_ID}.pdf.
 *
 * Triggered automatically after `npm run build` in the publish workflow.
 * Does NOT require any Notion checkbox — all publishable documents are included.
 * Does NOT affect the HTML build output outside of dist/pdf/.
 *
 * Failure policy:
 *   PDF_REQUIRED=false (default) — failures are warnings; HTML publish continues.
 *   PDF_REQUIRED=true            — any failure exits non-zero and blocks the workflow.
 */
import fs from "node:fs/promises";
import { loadConfigOrThrow, UserFacingError, runCli } from "../config.js";
import { loadDocuments, publishableDocuments } from "./shared.js";
import { exportDocumentTypst } from "../pdf/export-pdf.js";

export const SITE_PDF_OUTPUT_DIR = "dist/pdf";

await runCli(async () => {
  const pdfRequired = process.env["PDF_REQUIRED"] === "true";
  const config = loadConfigOrThrow();

  console.log("[PDF Site] Loading publishable documents from Notion...");
  const documents = await loadDocuments(config);
  const publishable = publishableDocuments(documents, config);
  const eligible = publishable.filter((doc) => doc.meta.docId);

  if (eligible.length === 0) {
    console.log("[PDF Site] No publishable documents with DOC_IDs found. Nothing to generate.");
    return;
  }

  console.log(`[PDF Site] Generating PDFs for ${eligible.length} document(s)...`);
  const errors: Array<{ docId: string; message: string }> = [];

  for (const doc of eligible) {
    try {
      const { typPath, pdfPath } = await exportDocumentTypst(doc, config, SITE_PDF_OUTPUT_DIR);

      if (pdfPath === null) {
        throw new UserFacingError(
          "Typst is not installed — .typ written but PDF not compiled.\n" +
          `  Source: ${typPath}\n` +
          "  Install Typst (typst-community/setup-typst) before running pdf:site."
        );
      }

      const stat = await fs.stat(pdfPath);
      const kb = Math.round(stat.size / 1024);
      console.log(`[PDF Site] ${doc.meta.docId}: ${pdfPath} (${kb} KB)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PDF Site] FAILED: ${doc.meta.docId}\n  ${msg}`);
      errors.push({ docId: doc.meta.docId!, message: msg });
    }
  }

  if (errors.length === 0) {
    console.log(`\n[PDF Site] Complete — ${eligible.length} PDF(s) written to ${SITE_PDF_OUTPUT_DIR}/`);
    return;
  }

  console.warn(`\n[PDF Site] ${errors.length} PDF(s) failed to generate:`);
  for (const e of errors) {
    console.warn(`  • ${e.docId}: ${e.message.split("\n")[0]}`);
  }

  if (pdfRequired) {
    throw new UserFacingError(
      `PDF generation failed for ${errors.length} document(s) and PDF_REQUIRED=true.\n` +
      "Set PDF_REQUIRED=false (or unset) to allow HTML publish to continue without site PDFs."
    );
  } else {
    console.warn("[PDF Site] PDF_REQUIRED=false — HTML publish continues. Download PDF buttons may 404 for failed docs.");
  }
});
