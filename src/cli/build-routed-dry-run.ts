import path from "node:path";
import { runCli } from "../config.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { buildRoutedSites } from "../routing/routed-build.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";

await runCli(async () => {
  const outputBaseRoot = path.resolve(process.env.ROUTED_DRY_RUN_OUTPUT_ROOT ?? path.join("dist", "routes"));
  const routes = routesWithOutputBase(await loadBrandRoutes(), outputBaseRoot);
  const config = await loadRoutedDryRunConfig();
  const documents = routedDryRunDocuments();

  const result = await buildRoutedSites({
    documents,
    routes,
    config,
    outputBaseRoot
  });

  console.log(`Routed dry-run build wrote ${result.manifests.length} brand route(s) to ${outputBaseRoot}.`);
  for (const manifest of result.manifests) {
    const deploy = manifest.deploymentPlan.ok ? "deploy-plan-ok" : `deploy-plan-blocked: ${manifest.deploymentPlan.errors.join("; ")}`;
    console.log(
      `${manifest.brand}: ${manifest.successfullyBuiltDocumentCount}/${manifest.sourceDocumentCount} document(s), ` +
      `${manifest.files.length} file(s), build=${manifest.buildStatus}, ${deploy}`
    );
  }
  console.log(`Summary: ${path.join(outputBaseRoot, "routed-build-summary.json")}`);
});
