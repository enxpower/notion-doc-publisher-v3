import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli, UserFacingError } from "../config.js";
import { routedDryRunDocuments, loadRoutedDryRunConfig } from "../fixtures/routed-dry-run.js";
import { NotionWriteback } from "../notion/writeback.js";
import { loadDocuments } from "./shared.js";
import { createIncrementalPlan, type IncrementalPlan, type IncrementalStateManifest } from "../routing/incremental.js";
import { assertIncrementalPlanUnchanged } from "../routing/incremental-plan-drift.js";
import {
  executeIncrementalApply,
  type IncrementalApplyMode,
  type IncrementalLifecycleWriteback,
  type IncrementalLifecycleWritebackClient
} from "../routing/incremental-apply.js";
import {
  applyReadOnlyPersistedFieldRequirements,
  loadRoutedReadonlyConfigFromEnvironment
} from "../routing/routed-readonly.js";
import { createFixtureRoutedPdfRenderer } from "../routing/routed-pdf.js";
import { normalizeBrand, type BrandRoute } from "../routing/brand-routing.js";
import { loadBrandRoutes } from "../routing/routes.js";
import { validateDocuments } from "../validate/validate.js";

class FixtureLifecycleWritebackClient implements IncrementalLifecycleWritebackClient {
  readonly updates: IncrementalLifecycleWriteback[] = [];

  async updateLifecycleResult(update: IncrementalLifecycleWriteback): Promise<void> {
    this.updates.push(update);
  }
}

await runCli(async () => {
  const mode = parseMode(process.argv.slice(2));
  const testMode = process.env.INCREMENTAL_APPLY_TEST_MODE === "fixture";
  const routes = await loadBrandRoutes();
  const config = testMode
    ? await loadRoutedDryRunConfig()
    : await loadRoutedReadonlyConfigFromEnvironment(routes);
  const statePath = path.resolve(process.env.PHASE2_STATE_PATH ?? "dist/phase2-state/private/incremental-state.json");
  const resultPath = path.resolve(process.env.INCREMENTAL_APPLY_RESULT_PATH ?? "dist/incremental-apply/result.json");
  const previousState = await readOptionalState(statePath);
  const documents = testMode ? routedDryRunDocuments() : await loadDocuments(config);
  validateDocuments(documents, config);
  applyReadOnlyPersistedFieldRequirements(documents, config);
  const plan = createIncrementalPlan({ documents, routes, config, previousState });
  const expectedPlanPath = process.env.INCREMENTAL_EXPECTED_PLAN_PATH?.trim() ||
    (process.env.GITHUB_ACTIONS === "true" ? process.env.INCREMENTAL_PLAN_PATH?.trim() : undefined);
  if (mode === "apply" && expectedPlanPath) {
    const expectedPlan = await readExpectedPlan(path.resolve(expectedPlanPath));
    assertIncrementalPlanUnchanged(expectedPlan, plan);
  }
  const repositoryRoots = testMode
    ? await createFixtureRepositories(routes)
    : mode === "apply" ? readRepositoryRootsFromEnvironment() : {};
  const lifecycleWritebackEnabled = testMode || process.env.INCREMENTAL_LIFECYCLE_WRITEBACK === "true";
  const client = mode === "apply" && lifecycleWritebackEnabled
    ? (testMode ? new FixtureLifecycleWritebackClient() : new NotionWriteback(config))
    : undefined;

  const result = await executeIncrementalApply({
    documents,
    routes,
    config,
    plan,
    previousState,
    repositoryRoots,
    stagingRoot: path.resolve("dist", testMode ? "incremental-apply-fixture-staging" : "incremental-apply-staging"),
    mode,
    pdfRenderer: testMode ? createFixtureRoutedPdfRenderer() : undefined,
    notionClient: client
  });

  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(sanitizeApplyResult(result), null, 2)}\n`, "utf8");
  if (mode === "apply") {
    const stateChanged = !previousState || !sameStateRecords(previousState, result.nextState);
    if (stateChanged) {
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(statePath, `${JSON.stringify(result.nextState, null, 2)}\n`, "utf8");
    } else {
      console.log("Private state unchanged; preserving the existing manifest byte-for-byte.");
    }
  }

  console.log(
    `Incremental content ${mode}: CREATE=${plan.counts.CREATE}, UPDATE=${plan.counts.UPDATE}, ` +
    `MOVE=${plan.counts.MOVE}, REMOVE=${plan.counts.REMOVE}, NOOP=${plan.counts.NOOP}, ` +
    `INVALID=${plan.counts.INVALID}, FILTERED=${plan.counts.FILTERED}.`
  );
  console.log(
    `Work: rendered=${result.renderedDocumentCount}, pdfs=${result.generatedPdfCount}, ` +
    `brands=${result.deployedBrandCount}, copied=${result.copiedFileCount}, deleted=${result.deletedFileCount}, ` +
    `notionMutations=${result.notionMutationCount}.`
  );
  console.log(`Result: ${path.relative(process.cwd(), resultPath)}`);
  if (mode === "apply") {
    console.log(`Private state: ${path.relative(process.cwd(), statePath)}`);
    if (!lifecycleWritebackEnabled) {
      console.log("Lifecycle Notion writeback is disabled. Set INCREMENTAL_LIFECYCLE_WRITEBACK=true only after deployment verification.");
    }
  }
});

function sameStateRecords(previous: IncrementalStateManifest, next: IncrementalStateManifest): boolean {
  return JSON.stringify(previous.records) === JSON.stringify(next.records);
}

function parseMode(args: string[]): IncrementalApplyMode {
  if (args.includes("--apply")) {
    return "apply";
  }
  if (args.includes("--dry-run") || args.length === 0) {
    return "dry-run";
  }
  throw new UserFacingError("Usage: publish-incremental [--dry-run|--apply]");
}

async function readOptionalState(filePath: string): Promise<IncrementalStateManifest | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as IncrementalStateManifest;
    if (parsed.schema !== "notion-doc-publisher-v3/incremental-state") {
      throw new UserFacingError("Incremental state manifest has an unexpected schema.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readExpectedPlan(filePath: string): Promise<IncrementalPlan> {
  let parsed: IncrementalPlan;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as IncrementalPlan;
  } catch (error) {
    throw new UserFacingError(`Could not read the prepared incremental plan: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.schema !== "notion-doc-publisher-v3/incremental-plan" || parsed.version !== 1 || !Array.isArray(parsed.records)) {
    throw new UserFacingError("Prepared incremental plan has an unexpected schema.");
  }
  return parsed;
}

function readRepositoryRootsFromEnvironment(): Record<string, string> {
  const raw = process.env.PHASE2_DEPLOYED_REPO_ROOTS_JSON;
  if (!raw?.trim()) {
    throw new UserFacingError("PHASE2_DEPLOYED_REPO_ROOTS_JSON is required for incremental apply.");
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UserFacingError("PHASE2_DEPLOYED_REPO_ROOTS_JSON must be a JSON object keyed by brand.");
  }
  const roots: Record<string, string> = {};
  for (const [brand, root] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof root !== "string" || !root.trim()) {
      throw new UserFacingError(`Repository root for ${brand} must be a non-empty string.`);
    }
    roots[normalizeBrand(brand)] = path.resolve(root);
  }
  return roots;
}

async function createFixtureRepositories(routes: BrandRoute[]): Promise<Record<string, string>> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "incremental-apply-fixture-"));
  const roots: Record<string, string> = {};
  for (const route of routes) {
    const brand = normalizeBrand(route.brand);
    const repositoryRoot = path.join(root, brand);
    await fs.mkdir(repositoryRoot, { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, "CNAME"), `${new URL(route.targetDomain).hostname}\n`, "utf8");
    roots[brand] = repositoryRoot;
  }
  return roots;
}

function sanitizeApplyResult(result: Awaited<ReturnType<typeof executeIncrementalApply>>): unknown {
  return {
    schema: result.schema,
    version: result.version,
    mode: result.mode,
    generatedAt: result.generatedAt,
    renderedDocumentCount: result.renderedDocumentCount,
    generatedPdfCount: result.generatedPdfCount,
    deployedBrandCount: result.deployedBrandCount,
    copiedFileCount: result.copiedFileCount,
    deletedFileCount: result.deletedFileCount,
    notionMutationCount: result.notionMutationCount,
    brandResults: result.brandResults,
    recordResults: result.recordResults.map((record) => ({
      action: record.action,
      brand: record.brand,
      docId: record.docId,
      status: record.status,
      reason: record.reason
    }))
  };
}
