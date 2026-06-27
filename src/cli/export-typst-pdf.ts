import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { copyDocumentAssets } from "../assets/copy-assets.js";
import { UserFacingError, loadConfigOrThrow, runCli } from "../config.js";
import {
  loadDocuments,
  publishableDocuments,
  skippedDueToErrors,
  validateLoadedDocuments,
} from "./shared.js";
import { renderDocumentTypst } from "../render/render-typst.js";

await runCli(async () => {
  const config = loadConfigOrThrow();
  const documents = await loadDocuments(config);
  validateLoadedDocuments(documents, config);

  const skipped = skippedDueToErrors(documents, config);
  if (skipped.length > 0) {
    console.warn(`[WARN] ${skipped.length} document(s) skipped due to validation errors:`);
    for (const doc of skipped) {
      const reasons = doc.validation.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
      console.warn(`  - ${doc.meta.title || "(untitled)"} [${doc.meta.docId || "(no DOC_ID)"}]: ${reasons}`);
    }
  }

  // Optional DOC_ID filter: npm run pdf:typst -- ARCBOS-AGR-2606-0008
  const filter = process.argv[2]?.trim().toUpperCase() || null;

  const published = publishableDocuments(documents, config)
    .filter((d) => !filter || d.meta.docId?.toUpperCase() === filter);

  if (filter && published.length === 0) {
    throw new UserFacingError(`No publishable document found with DOC_ID "${filter}".`);
  }

  await fs.mkdir("dist/typst", { recursive: true });
  await fs.mkdir("dist/pdf",   { recursive: true });

  const typstAvailable = checkTypst();
  if (!typstAvailable) {
    console.warn("[WARN] Typst is not installed — .typ source files will be generated but PDF compilation will be skipped.");
    console.warn("  Install Typst:");
    console.warn("    macOS:   brew install typst");
    console.warn("    Ubuntu:  curl -sL https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz | tar xJ && sudo mv typst-*/typst /usr/local/bin/");
    console.warn("    Windows: winget install --id Typst.Typst");
    console.warn("  Then re-run:  npm run pdf:typst -- <DOC_ID>");
  }

  let typCount = 0;
  let pdfCount = 0;

  for (const document of published) {
    await copyDocumentAssets(document, "dist");

    const typSrc = renderDocumentTypst(document, config);
    const typPath = path.join("dist", "typst", `${document.meta.docId}.typ`);
    await fs.writeFile(typPath, typSrc, "utf8");
    console.log(`[TYP] ${document.meta.docId}: ${typPath}`);
    typCount++;

    if (typstAvailable) {
      const pdfPath = path.join("dist", "pdf", `${document.meta.docId}.pdf`);
      try {
        execSync(`typst compile "${typPath}" "${pdfPath}"`, { stdio: "pipe" });
        console.log(`[PDF] ${document.meta.docId}: ${pdfPath}`);
        pdfCount++;
      } catch (e) {
        const msg = e instanceof Error ? (e as NodeJS.ErrnoException).message : String(e);
        console.error(`[ERROR] Typst compile failed for ${document.meta.docId}: ${msg}`);
      }
    }
  }

  console.log(`Generated ${typCount} .typ source file(s) in dist/typst/.`);
  if (typstAvailable) {
    console.log(`Compiled ${pdfCount} PDF(s) in dist/pdf/.`);
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
