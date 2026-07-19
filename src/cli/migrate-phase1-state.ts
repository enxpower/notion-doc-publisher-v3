import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli, UserFacingError, type AppConfig } from "../config.js";
import { routedDryRunDocuments, loadRoutedDryRunConfig } from "../fixtures/routed-dry-run.js";
import { enableNotionReadOnlyMode } from "../notion/read-only-guard.js";
import { loadDocuments } from "./shared.js";
import { computeRouteBaseUrl, normalizeBrand, type BrandRoute } from "../routing/brand-routing.js";
import {
  migrateLegacyPhase1State,
  sanitizeLegacyMigrationSummary,
  type LegacyRepositoryInput
} from "../routing/legacy-state-migration.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";
import { loadRoutedReadonlyConfigFromEnvironment } from "../routing/routed-readonly.js";

await runCli(async () => {
  const testMode = process.env.PHASE2_MIGRATION_TEST_MODE === "fixture";
  const routes = await loadBrandRoutes();
  const config = testMode
    ? await loadRoutedDryRunConfig()
    : await loadRoutedReadonlyConfigFromEnvironment(routes);
  const statePath = path.resolve(process.env.PHASE2_STATE_PATH ?? "dist/phase2-state/private/incremental-state.json");
  const summaryPath = path.resolve(process.env.PHASE2_MIGRATION_SUMMARY_PATH ?? "dist/phase2-state/private/migration-summary.json");
  const reportPath = path.resolve(process.env.PHASE2_MIGRATION_REPORT_PATH ?? "dist/phase2-state/private/migration-report.json");

  const restoreReadOnly = enableNotionReadOnlyMode("migrate:phase1-state");
  try {
    const documents = testMode ? routedDryRunDocuments() : await loadDocuments(config);
    const repositories = testMode
      ? await createFixtureRepositoryInputs({ documents, routes, config })
      : readRepositoryInputsFromEnvironment();
    const result = await migrateLegacyPhase1State({
      documents,
      routes,
      config,
      repositories
    });
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(result.state, null, 2)}\n`, "utf8");
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, `${JSON.stringify(sanitizeLegacyMigrationSummary(result), null, 2)}\n`, "utf8");
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(
      `Phase 1 state migration dry-run: migrated=${result.migratedRecordCount}, ` +
      `repair=${result.repairCandidates.length}, unmanaged=${result.unmanagedLegacyFileCount}, ` +
      `errors=${result.errors.length}, warnings=${result.warnings.length}.`
    );
    console.log(
      `Post-migration idempotency: CREATE=${result.idempotencyPlan.counts.CREATE}, ` +
      `UPDATE=${result.idempotencyPlan.counts.UPDATE}, MOVE=${result.idempotencyPlan.counts.MOVE}, ` +
      `REMOVE=${result.idempotencyPlan.counts.REMOVE}, NOOP=${result.idempotencyPlan.counts.NOOP}, ` +
      `INVALID=${result.idempotencyPlan.counts.INVALID}, FILTERED=${result.idempotencyPlan.counts.FILTERED}.`
    );
    console.log(`Private state: ${path.relative(process.cwd(), statePath)}`);
    console.log(`Private summary: ${path.relative(process.cwd(), summaryPath)}`);
    console.log(`Private report: ${path.relative(process.cwd(), reportPath)}`);
    if (result.errors.length > 0) {
      throw new UserFacingError("Phase 1 state migration found blocking errors. No production apply should run.");
    }
  } finally {
    restoreReadOnly();
  }
});

function readRepositoryInputsFromEnvironment(): LegacyRepositoryInput[] {
  const raw = process.env.PHASE2_DEPLOYED_REPO_ROOTS_JSON;
  if (!raw?.trim()) {
    throw new UserFacingError("PHASE2_DEPLOYED_REPO_ROOTS_JSON is required for Phase 1 state migration.");
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UserFacingError("PHASE2_DEPLOYED_REPO_ROOTS_JSON must be a JSON object keyed by brand.");
  }
  return Object.entries(parsed as Record<string, unknown>).map(([brand, repositoryRoot]) => {
    if (typeof repositoryRoot !== "string" || !repositoryRoot.trim()) {
      throw new UserFacingError(`Repository root for ${brand} must be a non-empty string.`);
    }
    return { brand, repositoryRoot };
  });
}

async function createFixtureRepositoryInputs(input: {
  documents: ReturnType<typeof routedDryRunDocuments>;
  routes: BrandRoute[];
  config: AppConfig;
}): Promise<LegacyRepositoryInput[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "phase2-migration-fixture-"));
  const repositories: LegacyRepositoryInput[] = [];
  for (const route of input.routes) {
    const brand = normalizeBrand(route.brand);
    const repositoryRoot = path.join(root, brand);
    await fs.mkdir(repositoryRoot, { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, "CNAME"), `${new URL(route.targetDomain).hostname}\n`, "utf8");
    await fs.mkdir(path.join(repositoryRoot, "assets", "css"), { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, "assets", "css", "screen.css"), "body{}\n", "utf8");
    await fs.writeFile(path.join(repositoryRoot, "assets", "css", "print.css"), "@media print{}\n", "utf8");

    const docs = input.documents.filter((document) => normalizeBrand(document.meta.brand.label) === brand);
    const pages: Record<string, string> = {};
    for (const document of docs) {
      const deploymentRoot = route.deploymentRoot?.replace(/^\/+|\/+$/g, "") ?? "";
      const prefix = deploymentRoot ? `${deploymentRoot}/` : "";
      const canonicalRelative = document.meta.canonicalPath.replace(/^\/+|\/+$/g, "");
      const htmlPath = path.join(repositoryRoot, prefix, canonicalRelative, "index.html");
      const pdfPath = path.join(repositoryRoot, prefix, route.pdfPath ?? "pdf", `${document.meta.docId}.pdf`);
      await fs.mkdir(path.dirname(htmlPath), { recursive: true });
      await fs.mkdir(path.dirname(pdfPath), { recursive: true });
      await fs.writeFile(
        htmlPath,
        `<html><head><link rel="canonical" href="${computeRouteBaseUrl(route)}${document.meta.canonicalPath}"></head>` +
        `<body><button onclick="window.print()">Print</button><a href="../../${route.pdfPath ?? "pdf"}/${document.meta.docId}.pdf">PDF</a>` +
        `<span>${document.meta.docId}</span></body></html>\n`,
        "utf8"
      );
      await fs.writeFile(pdfPath, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512, "0"), Buffer.from("\n%%EOF\n")]));
      pages[document.source.notionPageId] = document.meta.docId;
    }
    await fs.writeFile(path.join(repositoryRoot, ".publisher_state.json"), `${JSON.stringify({ pages }, null, 2)}\n`, "utf8");
    repositories.push({ brand, repositoryRoot });
  }
  return repositories;
}
