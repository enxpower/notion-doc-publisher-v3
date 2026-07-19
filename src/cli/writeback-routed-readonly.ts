import path from "node:path";

import { runCli, UserFacingError } from "../config.js";
import { loadDocuments } from "./shared.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { NotionWriteback } from "../notion/writeback.js";
import { buildRoutedReadonly, loadRoutedReadonlyConfigFromEnvironment } from "../routing/routed-readonly.js";
import { computeRouteFinalUrl, normalizeBrand, type BrandRoute } from "../routing/brand-routing.js";
import { createFixtureRoutedPdfRenderer } from "../routing/routed-pdf.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";
import {
  applyVerifiedUrlsToDocuments,
  createRoutedUrlWritebackPlan,
  executeRoutedUrlWriteback,
  isGitIgnoredOrOutsideRepo,
  verifyRoutedUrlWriteback,
  writeRoutedUrlWritebackArtifacts,
  type RoutedUrlWritebackClient
} from "../routing/routed-url-writeback.js";

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const testMode = process.env.ROUTED_WRITEBACK_TEST_MODE === "fixture";
  const routes = await loadBrandRoutes();
  const outputBaseRoot = path.resolve("dist", "routes-readonly");
  const writebackOutputRoot = path.resolve("dist", "routed-url-writeback");
  const runId = createRunId();
  const now = new Date().toISOString();
  const config = testMode ? await loadRoutedDryRunConfig() : await loadRoutedReadonlyConfigFromEnvironment(routes);
  const routedRoutes = routesWithOutputBase(routes, outputBaseRoot);
  let loadedDocuments = testMode ? routedWritebackFixtureDocuments(routedRoutes) : undefined;

  const buildResult = await buildRoutedReadonly({
    config,
    routes: routedRoutes,
    outputBaseRoot,
    loadDocuments: testMode ? async () => loadedDocuments! : async (readonlyConfig) => {
      loadedDocuments = await loadDocuments(readonlyConfig);
      return loadedDocuments;
    },
    pdfRenderer: testMode ? createFixtureRoutedPdfRenderer() : undefined
  });
  const documents = loadedDocuments ?? [];
  const bundle = createRoutedUrlWritebackPlan({
    documents,
    routes: routedRoutes,
    config,
    buildResult,
    outputBaseRoot,
    mode,
    runId,
    now
  });
  const artifacts = await writeRoutedUrlWritebackArtifacts({ bundle, outputRoot: writebackOutputRoot, runId, now });

  if (!isGitIgnoredOrOutsideRepo(artifacts.privateBackupPath)) {
    throw new UserFacingError("Routed URL writeback blocked: private backup path is not gitignored.");
  }

  printPlanSummary(bundle.plan, artifacts.publicPlanPath, artifacts.privateBackupPath);
  if (mode === "dry-run") {
    console.log("Routed URL writeback dry-run complete. No Notion mutation was attempted.");
    return;
  }

  const client: RoutedUrlWritebackClient = testMode
    ? new FixtureRoutedUrlWritebackClient(documents)
    : new NotionWriteback(config);

  console.log(
    `Pre-write safety: eligible=${bundle.plan.eligibleRecordCount}, updates=${bundle.plan.urlUpdateCount}, ` +
    `max=10, url-breaking-risk=${bundle.plan.urlBreakingChangeCount}, property=PUBLISHED_URL only, backup=created.`
  );
  const execution = await executeRoutedUrlWriteback({ bundle, client, maxEligibleRecords: 10, maxUpdates: 10 });
  console.log(
    `Routed URL writeback execution: attempted=${execution.attemptedUpdateCount}, ` +
    `updated=${execution.successfulUpdateCount}, failed=${execution.failedUpdateCount}.`
  );
  if (execution.failedUpdateCount > 0) {
    throw new UserFacingError("Routed URL writeback failed. Private backup is available for an owner-approved rollback.");
  }

  const verification = await verifyRoutedUrlWriteback({ bundle, client });
  console.log(
    `Routed URL writeback verification: checked=${verification.checkedCount}, ` +
    `correct=${verification.correctCount}, failed=${verification.failedCount}.`
  );
  if (verification.failedCount > 0) {
    throw new UserFacingError("Routed URL writeback verification failed. Private backup is available for an owner-approved rollback.");
  }

  applyVerifiedUrlsToDocuments(documents, bundle, verification);
  const secondPlan = createRoutedUrlWritebackPlan({
    documents,
    routes: routedRoutes,
    config,
    buildResult,
    outputBaseRoot,
    mode: "dry-run",
    runId,
    now
  }).plan;
  console.log(`Second dry-run idempotency: updates=${secondPlan.urlUpdateCount}, unchanged=${secondPlan.unchangedUrlCount}.`);
}

function parseMode(args: string[]): "dry-run" | "write" {
  if (args.includes("--write")) {
    return "write";
  }
  if (args.includes("--dry-run") || args.length === 0) {
    return "dry-run";
  }
  throw new UserFacingError("Usage: writeback-routed-readonly [--dry-run|--write]");
}

function routedWritebackFixtureDocuments(routes: BrandRoute[]) {
  const routeByBrand = new Map(routes.map((route) => [normalizeBrand(route.brand), route]));
  return routedDryRunDocuments().map((document) => {
    const copy = structuredClone(document);
    const route = routeByBrand.get(normalizeBrand(copy.meta.brand.label));
    copy.meta.publishedUrl = copy.meta.brand.label === "ENERGIZE" && route
      ? computeRouteFinalUrl(route, copy.meta.canonicalPath)
      : "";
    return copy;
  });
}

function createRunId(): string {
  return `routed-url-writeback-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function printPlanSummary(plan: {
  eligibleRecordCount: number;
  eligibleByBrand: Record<string, number>;
  unchangedUrlCount: number;
  urlUpdateCount: number;
  skippedCount: number;
  skippedByReason: Record<string, number>;
  invalidCount: number;
  urlBreakingChangeCount: number;
}, publicPlanPath: string, privateBackupPath: string): void {
  console.log(
    `Routed URL writeback plan: eligible=${plan.eligibleRecordCount}, updates=${plan.urlUpdateCount}, ` +
    `unchanged=${plan.unchangedUrlCount}, skipped=${plan.skippedCount}, invalid=${plan.invalidCount}, ` +
    `url-breaking-risk=${plan.urlBreakingChangeCount}.`
  );
  console.log(`Eligible by brand: ${formatCounts(plan.eligibleByBrand)}`);
  console.log(`Skipped by reason: ${formatCounts(plan.skippedByReason)}`);
  console.log(`Sanitized plan: ${path.relative(process.cwd(), publicPlanPath)}`);
  console.log(`Private backup: ${path.relative(process.cwd(), privateBackupPath)} (gitignored)`);
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}

class FixtureRoutedUrlWritebackClient implements RoutedUrlWritebackClient {
  private readonly publishedUrls: Map<string, string>;

  constructor(documents: Array<{ source: { notionPageId: string }; meta: { publishedUrl?: string } }>) {
    this.publishedUrls = new Map(documents.map((document) => [
      document.source.notionPageId,
      document.meta.publishedUrl?.trim() ?? ""
    ]));
  }

  async updatePublishedUrlOnly(pageId: string, url: string): Promise<void> {
    this.publishedUrls.set(pageId, url);
  }

  async readPublishedUrl(pageId: string): Promise<string> {
    return this.publishedUrls.get(pageId) ?? "";
  }
}

await runCli(main);
