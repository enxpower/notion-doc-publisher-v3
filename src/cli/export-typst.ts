/**
 * CLI entry point for the sidecar Typst PDF publisher.
 *
 * Usage:
 *   npm run pdf:export -- <DOC_ID>
 *
 * Example:
 *   npm run pdf:export -- ARCBOS-AGR-2606-0008
 *
 * Outputs to pdf-output/ only. Never writes to dist/ or Notion.
 */
import fs from "node:fs/promises";
import { loadConfigOrThrow, UserFacingError, runCli } from "../config.js";
import { exportTypstPdf, PDF_OUTPUT_DIR } from "../pdf/export-pdf.js";

await runCli(async () => {
  const rawArg = process.argv[2]?.trim();
  if (!rawArg) {
    throw new UserFacingError(
      "Usage:   npm run pdf:export -- <DOC_ID>\n" +
      "Example: npm run pdf:export -- ARCBOS-AGR-2606-0008"
    );
  }

  const docId = rawArg.toUpperCase();
  console.log(`\n[PDF] Loading documents from Notion...`);

  const config = loadConfigOrThrow();
  const result = await exportTypstPdf(docId, config, PDF_OUTPUT_DIR);

  console.log(`\n[TYP] ${result.typPath}  (${result.lineCount} lines)`);

  if (!result.pdfPath) {
    const pdfTarget = result.typPath.replace(/\.typ$/, ".pdf");
    console.warn("\n[WARN] Typst is not installed — PDF not compiled.");
    console.warn("  Install and rerun:");
    console.warn("    macOS:   brew install typst");
    console.warn("    Ubuntu:  curl -sL https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz | tar -xJ && sudo mv typst-*/typst /usr/local/bin/");
    console.warn("    Windows: winget install --id Typst.Typst");
    console.warn(`\n  Then compile: typst compile "${result.typPath}" "${pdfTarget}"`);
    return;
  }

  const stat = await fs.stat(result.pdfPath);
  const kb = Math.round(stat.size / 1024);
  console.log(`[PDF] ${result.pdfPath}  (${kb} KB)`);
  console.log(`\nExport complete: ${result.pdfPath}`);
});
