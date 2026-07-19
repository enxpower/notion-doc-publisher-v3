import fs from "node:fs/promises";
import path from "node:path";
import { runCli } from "../config.js";
import { loadDocuments } from "./shared.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { buildRoutedReadonly, loadRoutedReadonlyConfigFromEnvironment } from "../routing/routed-readonly.js";
import { createFixtureRoutedPdfRenderer } from "../routing/routed-pdf.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";

await runCli(async () => {
  const testMode = process.env.ROUTED_READONLY_TEST_MODE === "fixture";
  const outputBaseRoot = path.resolve(path.join("dist", testMode ? "routes-readonly-fixture" : "routes-readonly"));
  const baseRoutes = await loadBrandRoutes();
  const routes = routesWithOutputBase(baseRoutes, outputBaseRoot);
  const config = testMode ? await loadRoutedDryRunConfig() : await loadRoutedReadonlyConfigFromEnvironment(baseRoutes);

  await resetReadonlyOutputRoot(outputBaseRoot);

  const result = await buildRoutedReadonly({
    config,
    routes,
    outputBaseRoot,
    loadDocuments: testMode ? async () => routedDryRunDocuments() : loadDocuments,
    pdfRenderer: testMode ? createFixtureRoutedPdfRenderer() : undefined
  });

  console.log(`Routed readonly build wrote ${result.manifests.length} brand route(s) to ${outputBaseRoot}.`);
  for (const manifest of result.manifests) {
    const deploy = manifest.deploymentPlan.ok ? "deploy-plan-ok" : `deploy-plan-blocked: ${manifest.deploymentPlan.errors.join("; ")}`;
    const pdfBytes = manifest.pdfResults.reduce((sum, pdf) => sum + (pdf.byteSize ?? 0), 0);
    console.log(
      `${manifest.brand}: ${manifest.successfullyBuiltDocumentCount}/${manifest.sourceDocumentCount} document(s), ` +
      `${manifest.files.length} file(s), pdf=${manifest.successfulPdfCount}/${manifest.plannedPdfCount}, ` +
      `pdfFailed=${manifest.failedPdfCount}, pdfBytes=${pdfBytes}, ` +
      `build=${manifest.buildStatus}, ${deploy}`
    );
  }
  console.log(`Summary: ${path.join(outputBaseRoot, "routed-build-summary.json")}`);
  console.log(`Private audit report: ${result.auditReportPath}`);
});

async function resetReadonlyOutputRoot(outputBaseRoot: string): Promise<void> {
  const distRoot = path.resolve("dist");
  const relative = path.relative(distRoot, outputBaseRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Readonly routed output root must be inside dist.");
  }
  await fs.rm(outputBaseRoot, { recursive: true, force: true });
}
