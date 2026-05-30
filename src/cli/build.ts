import fs from "node:fs/promises";
import path from "node:path";
import { copyDocumentAssets, copyStyles } from "../assets/copy-assets.js";
import { loadConfigOrThrow, runCli } from "../config.js";
import { renderDocumentHtml, renderIndexHtml } from "../render/render-html.js";
import { createReport, hasErrors, loadDocuments, publishableDocuments, validateLoadedDocuments, writeJson } from "./shared.js";
import { isPublishableCandidate } from "../validate/validate.js";

await runCli(async () => {
  const config = loadConfigOrThrow();
  await fs.mkdir("dist", { recursive: true });
  await copyStyles("dist");

  const documents = await loadDocuments(config);
  const candidates = documents.filter((document) => isPublishableCandidate(document, config));
  for (const document of candidates) {
    await copyDocumentAssets(document, "dist");
  }
  validateLoadedDocuments(documents, config);
  const report = createReport(documents);
  await writeJson("dist/reports/validation-report.json", report);

  if (hasErrors(documents)) {
    await writeJson("dist/reports/build-report.json", report);
    console.error(`Build stopped because validation found ${report.errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }

  const published = publishableDocuments(documents, config);
  for (const document of published) {
    const outputDir = path.join("dist", "docs", document.meta.docId);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "index.html"), await renderDocumentHtml(document, config), "utf8");
  }
  await fs.writeFile(path.join("dist", "index.html"), renderIndexHtml(published), "utf8");
  const buildReport = createReport(published);
  await writeJson("dist/reports/build-report.json", buildReport);
  console.log(`Built ${published.length} document(s) into dist/.`);
});
