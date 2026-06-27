/**
 * Standalone PDF review prototype.
 *
 * Usage:
 *   npx tsx prototype/pdf-publisher/export-review-pdf.ts <DOC_ID>
 *
 * Example:
 *   npx tsx prototype/pdf-publisher/export-review-pdf.ts ARCBOS-AGR-2606-0008
 *
 * Outputs to prototype/output/ only. Does not write to dist/.
 * Does not modify Notion. Does not run the production build.
 *
 * Requires .env with at minimum:
 *   NOTION_TOKEN, NOTION_DATABASE_ID, PUBLISHABLE_STATUSES,
 *   BRAND_TOKENS_JSON, DOCUMENT_TYPE_TOKENS_JSON
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadConfigOrThrow, UserFacingError, runCli } from "../../src/config.js";
import { loadDocuments } from "../../src/cli/shared.js";
import { copyDocumentAssets } from "../../src/assets/copy-assets.js";
import { renderDocumentTypst } from "./render-typst.js";

const OUTPUT_DIR = "prototype/output";

await runCli(async () => {
  const filter = process.argv[2]?.trim().toUpperCase();
  if (!filter) {
    throw new UserFacingError(
      "Usage:   npx tsx prototype/pdf-publisher/export-review-pdf.ts <DOC_ID>\n" +
      "Example: npx tsx prototype/pdf-publisher/export-review-pdf.ts ARCBOS-AGR-2606-0008"
    );
  }

  console.log(`\n[Review] Loading documents from Notion...`);
  const config = loadConfigOrThrow();

  // Load all documents — no publishability filter, so drafts/WIP are included
  const allDocs = await loadDocuments(config);

  const doc = allDocs.find((d) => d.meta.docId?.toUpperCase() === filter);

  if (!doc) {
    const ids = allDocs
      .map((d) => d.meta.docId)
      .filter(Boolean)
      .sort()
      .slice(0, 12)
      .join(", ");
    throw new UserFacingError(
      `No document found with DOC_ID "${filter}".` +
      (ids ? `\n  Loaded DOC_IDs: ${ids}` : "\n  No DOC_IDs found — check NOTION_DATABASE_ID.")
    );
  }

  console.log(`[Review] Found: ${doc.meta.title} [${doc.meta.docId}]`);
  if (doc.validation.errors.length > 0) {
    console.warn(`[Review] Document has ${doc.validation.errors.length} validation error(s) — rendering anyway for review.`);
  }

  // Download image assets to prototype/output/assets/docs/{docId}/
  if (doc.assets.length > 0) {
    console.log(`[Review] Downloading ${doc.assets.length} asset(s) to ${OUTPUT_DIR}/assets/...`);
    try {
      await copyDocumentAssets(doc, OUTPUT_DIR);
      const localCount = doc.assets.filter((a) => a.local).length;
      console.log(`[Review] ${localCount}/${doc.assets.length} asset(s) ready.`);
    } catch (err) {
      console.warn(`[Review] Asset download failed (continuing without images): ${String(err)}`);
    }
  }

  // Resolve brand profile
  const brand = config.brandProfiles?.[doc.meta.brand.token] ?? {
    displayName: doc.meta.brand.label,
    tagline: "",
  };

  // Render Typst source
  const typSrc = renderDocumentTypst(doc, brand);

  // Write .typ
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const typPath = path.join(OUTPUT_DIR, `${doc.meta.docId}.typ`);
  await fs.writeFile(typPath, typSrc, "utf8");
  const lineCount = typSrc.split("\n").length;
  console.log(`\n[TYP] ${typPath}  (${lineCount} lines)`);

  // Compile to PDF
  const pdfPath = path.join(OUTPUT_DIR, `${doc.meta.docId}.pdf`);

  if (!checkTypst()) {
    console.warn("\n[WARN] Typst is not installed — PDF not compiled.");
    console.warn("  Install and rerun:");
    console.warn("    macOS:   brew install typst");
    console.warn("    Ubuntu:  curl -sL https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz | tar -xJ && sudo mv typst-*/typst /usr/local/bin/");
    console.warn("    Windows: winget install --id Typst.Typst");
    console.warn(`\n  Then compile: typst compile "${typPath}" "${pdfPath}"`);
    return;
  }

  console.log(`[Review] Compiling PDF with Typst...`);
  try {
    const result = execSync(`typst compile "${typPath}" "${pdfPath}" 2>&1`, { encoding: "utf8" });
    if (result.trim()) console.log(result.trim());
    const stat = await fs.stat(pdfPath);
    const kb = Math.round(stat.size / 1024);
    console.log(`[PDF] ${pdfPath}  (${kb} KB)`);
    console.log(`\nReview PDF ready: ${pdfPath}`);
  } catch (e) {
    const output = e instanceof Error ? (e as NodeJS.ErrnoError & { stdout?: string }).stdout ?? e.message : String(e);
    console.error(`\n[ERROR] Typst compile failed:`);
    console.error(output.trim());
    console.error(`\nFix the source and rerun: typst compile "${typPath}" "${pdfPath}"`);
    process.exitCode = 1;
  }
});

function checkTypst(): boolean {
  try {
    execSync("typst --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
