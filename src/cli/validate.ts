import { loadConfigOrThrow, runCli } from "../config.js";
import { createReport, hasErrors, loadDocuments, validateLoadedDocuments, writeJson } from "./shared.js";

await runCli(async () => {
  const config = loadConfigOrThrow();
  const documents = validateLoadedDocuments(await loadDocuments(config), config);
  const report = createReport(documents);
  await writeJson("dist/reports/validation-report.json", report);
  console.log(`Validation checked ${documents.length} document(s).`);
  console.log(`Report: dist/reports/validation-report.json`);
  if (report.warnings.length > 0) {
    console.log(`Warnings: ${report.warnings.length}`);
  }
  if (hasErrors(documents)) {
    console.error(`Errors: ${report.errors.length}`);
    process.exitCode = 1;
  }
});
