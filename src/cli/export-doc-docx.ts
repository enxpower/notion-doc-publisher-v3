import fs from "node:fs/promises";
import path from "node:path";
import { copyDocumentAssets } from "../assets/copy-assets.js";
import { loadConfigOrThrow, runCli } from "../config.js";
import {
  loadDocuments,
  publishableDocuments,
  skippedDueToErrors,
  validateLoadedDocuments,
} from "./shared.js";
import { renderDocumentDocx } from "../render/render-docx.js";

await runCli(async () => {
  const config = loadConfigOrThrow();
  const documents = await loadDocuments(config);
  validateLoadedDocuments(documents, config);

  const skipped = skippedDueToErrors(documents, config);
  if (skipped.length > 0) {
    console.warn(
      `[WARN] ${skipped.length} document(s) skipped due to validation errors (others will still export):`
    );
    for (const doc of skipped) {
      const reasons = doc.validation.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
      console.warn(`  - ${doc.meta.title || "(untitled)"} [${doc.meta.docId || "(no DOC_ID)"}]: ${reasons}`);
    }
  }

  const published = publishableDocuments(documents, config);
  await fs.mkdir("dist/docx", { recursive: true });

  let count = 0;
  for (const document of published) {
    await copyDocumentAssets(document, "dist");
    const buffer = await renderDocumentDocx(document, config);
    const outPath = path.join("dist", "docx", `${document.meta.docId}.docx`);
    await fs.writeFile(outPath, buffer);
    console.log(`[DOCX] ${document.meta.docId}: ${outPath}`);
    count++;
  }

  console.log(`Exported ${count} document(s) to dist/docx/.`);
});
