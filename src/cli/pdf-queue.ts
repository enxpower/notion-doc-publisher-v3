/**
 * CLI entry point for PDF Publisher 2.0 queue.
 *
 * Usage:
 *   npm run pdf:queue -- <DOC_ID>    # single doc
 *   npm run pdf:queue -- ALL         # all docs with "Generate PDF" checked
 *
 * Environment:
 *   PDF_WRITEBACK=true               # enable Notion writeback (default: false = dry-run)
 *   PDF_OUTPUT_DIR=pdf-output        # output directory (default: pdf-output)
 *   GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID  # set by GitHub Actions
 */
import { loadConfigOrThrow, UserFacingError, runCli } from "../config.js";
import { PDF_OUTPUT_DIR } from "../pdf/export-pdf.js";
import { runPdfQueue, buildRunUrl } from "../pdf/queue.js";

await runCli(async () => {
  const rawArg = process.argv[2]?.trim();

  if (!rawArg) {
    throw new UserFacingError(
      "Usage:\n" +
      "  npm run pdf:queue -- <DOC_ID>   # process one document\n" +
      "  npm run pdf:queue -- ALL        # process all queued documents\n" +
      "\nExample:\n" +
      "  npm run pdf:queue -- ARCBOS-AGR-2606-0008\n" +
      "  PDF_WRITEBACK=true npm run pdf:queue -- ALL"
    );
  }

  const mode = rawArg.toUpperCase() === "ALL" ? "all" : "single";
  const docIdInput = mode === "single" ? rawArg.toUpperCase() : undefined;

  const writeback = process.env["PDF_WRITEBACK"] === "true";
  const outDir = process.env["PDF_OUTPUT_DIR"]?.trim() || PDF_OUTPUT_DIR;
  const runUrl = buildRunUrl(
    process.env["GITHUB_SERVER_URL"],
    process.env["GITHUB_REPOSITORY"],
    process.env["GITHUB_RUN_ID"],
  );

  console.log(`[PDF Queue] Starting — mode=${mode}, writeback=${writeback}`);
  if (!writeback) {
    console.log("[PDF Queue] DRY-RUN mode: no Notion writes will occur. Set PDF_WRITEBACK=true to enable.");
  }

  const config = loadConfigOrThrow();
  const report = await runPdfQueue(mode, docIdInput, config, { writeback, outDir, runUrl });

  const failed = report.results.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    console.error(`\n[PDF Queue] ${failed.length} document(s) failed:`);
    for (const r of failed) {
      console.error(`  • ${r.docId || r.pageId}: ${r.error}`);
    }
    process.exit(1);
  }
});
