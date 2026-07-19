import path from "node:path";
import { runCli } from "../config.js";
import { loadDocuments } from "./shared.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { runRoutedReadonlyDiagnostics } from "../routing/routed-diagnostics.js";
import { loadRoutedReadonlyConfigFromEnvironment } from "../routing/routed-readonly.js";
import { loadBrandRoutes } from "../routing/routes.js";

await runCli(async () => {
  const outputRoot = path.join("dist", "diagnostics", "routed-readonly");
  const testMode = process.env.ROUTED_READONLY_DIAGNOSTIC_TEST_MODE === "fixture";
  const routes = await loadBrandRoutes();
  const config = testMode ? await loadRoutedDryRunConfig() : await loadRoutedReadonlyConfigFromEnvironment(routes);
  const result = await runRoutedReadonlyDiagnostics({
    config,
    routes,
    outputRoot,
    loadDocuments: testMode ? async () => routedDryRunDocuments() : loadDocuments
  });
  const report = result.report;

  console.log(`Routed readonly diagnostics wrote sanitized report to ${path.relative(process.cwd(), result.reportPath)}.`);
  console.log(`Private correlation report: ${path.relative(process.cwd(), result.correlationPath)}`);
  console.log(`Loaded records: ${report.loadedDocumentCount}`);
  console.log(`Publishable candidates: ${report.publishableCandidateCount}`);
  console.log(
    `Collision groups: ${report.collisionSummary.totalGroups} ` +
    `(output-path=${report.collisionSummary.outputPathGroups}, ` +
    `doc-id=${report.collisionSummary.docIdGroups}, token=${report.collisionSummary.shareTokenGroups})`
  );
  console.log(`Output-path validation issues: ${report.collisionSummary.outputPathValidationIssueCount}`);
  console.log(`Missing Share Token records: ${report.missingShareTokens.total}`);
  console.log(`Publishable token blockers: ${report.missingShareTokens.publishableImmediateRemediationCount}`);
  console.log(`Draft/nonpublishable token records: ${report.missingShareTokens.nonpublishableDraftOnlyCount}`);
  console.log(`Likely token false positives: ${report.missingShareTokens.falsePositiveCandidateCount}`);
});
