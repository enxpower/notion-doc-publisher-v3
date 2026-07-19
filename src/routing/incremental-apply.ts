import fs from "node:fs/promises";
import path from "node:path";

import { UserFacingError, type AppConfig } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { enableNotionMutationAllowList } from "../notion/read-only-guard.js";
import { renderRoutedDocumentPdf, type RoutedPdfRenderer } from "./routed-pdf.js";
import { buildRoutedSites } from "./routed-build.js";
import { isSafeRelativePublicPath, normalizeBrand, type BrandRoute } from "./brand-routing.js";
import { routeWithOutputRoot } from "./routes.js";
import {
  committedStateAfterSuccessfulPlan,
  deletionPlanForRecord,
  documentsToRender,
  documentsToRemove,
  type IncrementalPlan,
  type IncrementalPlanRecord,
  type IncrementalStateManifest
} from "./incremental.js";

export type IncrementalApplyMode = "dry-run" | "apply";

export type IncrementalLifecycleStatus = "success" | "unchanged" | "unpublished" | "failed" | "filtered";

export type IncrementalLifecycleWriteback = {
  pageId: string;
  status: Exclude<IncrementalLifecycleStatus, "unchanged" | "filtered">;
  action: IncrementalPlanRecord["action"];
  message: string;
  publishedUrl?: string;
};

export type IncrementalLifecycleWritebackClient = {
  updateLifecycleResult(update: IncrementalLifecycleWriteback): Promise<void>;
};

export type IncrementalApplyResult = {
  schema: "notion-doc-publisher-v3/incremental-apply-result";
  version: 1;
  mode: IncrementalApplyMode;
  generatedAt: string;
  renderedDocumentCount: number;
  generatedPdfCount: number;
  deployedBrandCount: number;
  copiedFileCount: number;
  deletedFileCount: number;
  notionMutationCount: number;
  nextState: IncrementalStateManifest;
  brandResults: Array<{
    brand: string;
    actionCount: number;
    copiedFileCount: number;
    deletedFileCount: number;
    deployed: boolean;
  }>;
  recordResults: Array<{
    action: IncrementalPlanRecord["action"];
    brand: string;
    docId: string;
    status: "planned" | "success" | "failed" | "skipped";
    reason: string;
  }>;
};

export async function executeIncrementalApply(input: {
  documents: DocumentModel[];
  routes: BrandRoute[];
  config: AppConfig;
  plan: IncrementalPlan;
  previousState?: IncrementalStateManifest;
  repositoryRoots: Record<string, string>;
  stagingRoot: string;
  mode: IncrementalApplyMode;
  now?: string;
  pdfRenderer?: RoutedPdfRenderer;
  notionClient?: IncrementalLifecycleWritebackClient;
}): Promise<IncrementalApplyResult> {
  const generatedAt = input.now ?? new Date().toISOString();
  const routesByBrand = new Map(input.routes.map((route) => [normalizeBrand(route.brand), route]));
  const renderRecords = documentsToRender(input.plan);
  const removeRecords = documentsToRemove(input.plan);
  const changedBrands = new Set([...renderRecords, ...removeRecords].map((record) => normalizeBrand(record.brand)));
  const artifactChangedBrands = new Set(
    [...changedBrands].filter((brand) => routesByBrand.get(brand)?.deploymentMode === "github-pages-artifact")
  );
  const recordResults: IncrementalApplyResult["recordResults"] = input.plan.records.map((record) => ({
    action: record.action,
    brand: record.brand,
    docId: record.docId,
    status: record.action === "NOOP" || record.action === "FILTERED" ? "skipped" : "planned",
    reason: record.reason
  }));

  const brandResults = new Map<string, {
    brand: string;
    actionCount: number;
    copiedFileCount: number;
    deletedFileCount: number;
    deployed: boolean;
  }>();
  for (const brand of changedBrands) {
    brandResults.set(brand, { brand, actionCount: 0, copiedFileCount: 0, deletedFileCount: 0, deployed: false });
  }

  if (input.mode === "dry-run") {
    return {
      schema: "notion-doc-publisher-v3/incremental-apply-result",
      version: 1,
      mode: input.mode,
      generatedAt,
      renderedDocumentCount: renderRecords.length,
      generatedPdfCount: renderRecords.filter((record) => record.desired?.pdfRequired).length,
      deployedBrandCount: changedBrands.size,
      copiedFileCount: 0,
      deletedFileCount: 0,
      notionMutationCount: 0,
      nextState: input.previousState ?? emptyState(generatedAt),
      brandResults: [...brandResults.values()],
      recordResults
    };
  }

  await assertRepositoryRoots(input.repositoryRoots, changedBrands, routesByBrand);
  const stagedRoutes = input.routes.map((route) => routeWithOutputRoot(route, path.resolve(input.stagingRoot)));
  const documentsByPageId = new Map(input.documents.map((document) => [document.source.notionPageId, document]));
  const renderPageIds = new Set(renderRecords.map((record) => record.pageId));

  for (const record of input.plan.records) {
    const brand = normalizeBrand(record.desired?.brand ?? record.brand);
    if (!artifactChangedBrands.has(brand) || !record.desired) {
      continue;
    }
    if (record.action === "REMOVE" || record.action === "INVALID" || record.action === "FILTERED") {
      continue;
    }
    renderPageIds.add(record.pageId);
  }

  const renderDocuments = [...renderPageIds].flatMap((pageId) => {
    const document = documentsByPageId.get(pageId);
    return document ? [document] : [];
  });
  const builtBrands = new Set<string>();
  let copiedFileCount = 0;
  let deletedFileCount = 0;
  let notionMutationCount = 0;

  if (renderDocuments.length > 0) {
    const build = await buildRoutedSites({
      documents: renderDocuments,
      routes: stagedRoutes,
      config: input.config,
      outputBaseRoot: path.resolve(input.stagingRoot),
      prevalidated: true,
      pdfRenderer: input.pdfRenderer ?? renderRoutedDocumentPdf
    });
    for (const manifest of build.manifests) {
      const brand = normalizeBrand(manifest.brand);
      if (!changedBrands.has(brand) || manifest.successfullyBuiltDocumentCount === 0) {
        continue;
      }
      if (manifest.buildStatus !== "success" || !manifest.deploymentPlan.ok) {
        markBrandFailed(recordResults, brand, "STAGED_BUILD_FAILED");
        continue;
      }
      const route = stagedRoutes.find((candidate) => normalizeBrand(candidate.brand) === brand);
      const repositoryRoot = input.repositoryRoots[brand];
      if (!route || !repositoryRoot) {
        throw new UserFacingError(`Missing staged route or repository root for ${brand}.`);
      }
      const filesToCopy = route.deploymentMode === "github-pages-artifact"
        ? manifest.files
        : filesToCopyForBrand(manifest.files, renderRecords, brand, route);
      for (const file of filesToCopy) {
        if (!isSafeRelativePublicPath(file)) {
          throw new UserFacingError(`Unsafe staged artifact path is blocked: ${file}`);
        }
        await copyStagedFile({
          stagingRouteRoot: route.outputRoot,
          repositoryRoot,
          sourceRelativePath: file,
          targetRelativePath: addDeploymentRoot(file, route)
        });
        copiedFileCount += 1;
      }
      builtBrands.add(brand);
      const brandResult = brandResults.get(brand);
      if (brandResult) {
        brandResult.copiedFileCount += filesToCopy.length;
        brandResult.deployed = true;
      }
    }
  }

  for (const record of renderRecords) {
    const brand = normalizeBrand(record.brand);
    const brandResult = brandResults.get(brand);
    if (brandResult) {
      brandResult.actionCount += 1;
    }
    if (!builtBrands.has(brand)) {
      setRecordResult(recordResults, record, "failed", "STAGED_BUILD_FAILED");
      continue;
    }
    setRecordResult(recordResults, record, "success", record.action);
  }

  for (const record of removeRecords) {
    const brand = normalizeBrand(record.previous?.brand ?? record.brand);
    const route = routesByBrand.get(brand);
    const repositoryRoot = input.repositoryRoots[brand];
    if (!route || !repositoryRoot) {
      setRecordResult(recordResults, record, "failed", "MISSING_PREVIOUS_ROUTE_OR_REPOSITORY");
      continue;
    }
    const removed = route.deploymentMode === "github-pages-artifact"
      ? []
      : await removeOwnedFiles({ repositoryRoot, files: deletionPlanForRecord(record, route), route });
    deletedFileCount += removed.length;
    const brandResult = brandResults.get(brand);
    if (brandResult) {
      brandResult.actionCount += 1;
      brandResult.deletedFileCount += removed.length;
      brandResult.deployed = true;
    }
    setRecordResult(recordResults, record, "success", "REMOVE");
  }

  for (const record of renderRecords.filter((record) => record.action === "MOVE")) {
    if (!record.previous) {
      continue;
    }
    const previousBrand = normalizeBrand(record.previous.brand);
    const previousRoute = routesByBrand.get(previousBrand);
    const repositoryRoot = input.repositoryRoots[previousBrand];
    if (!previousRoute || !repositoryRoot) {
      setRecordResult(recordResults, record, "failed", "MISSING_PREVIOUS_ROUTE_OR_REPOSITORY");
      continue;
    }
    if (previousRoute.deploymentMode === "github-pages-artifact") {
      continue;
    }
    const files = moveDeletionPlan(record, previousRoute);
    const removed = await removeOwnedFiles({ repositoryRoot, files, route: previousRoute });
    deletedFileCount += removed.length;
    const brandResult = brandResults.get(previousBrand);
    if (brandResult) {
      brandResult.deletedFileCount += removed.length;
      brandResult.deployed = true;
    }
  }

  const successfulRecords = new Set(recordResults.filter((record) => record.status === "success").map((record) => `${record.action}:${record.docId}`));
  const successfulPlan: IncrementalPlan = {
    ...input.plan,
    records: input.plan.records.filter((record) => {
      if (record.action === "NOOP") {
        return true;
      }
      return successfulRecords.has(`${record.action}:${record.docId}`);
    })
  };
  const nextState = committedStateAfterSuccessfulPlan({
    previousState: input.previousState,
    plan: successfulPlan,
    deployedAt: generatedAt
  });

  if (input.notionClient) {
    const restoreMutationAllowList = enableNotionMutationAllowList("incremental-content-publish", ["updateLifecycleResult"]);
    try {
      for (const record of input.plan.records) {
        const result = recordResults.find((item) => item.action === record.action && item.docId === record.docId);
        const writeback = lifecycleWritebackForRecord(record, result?.status ?? "failed");
        if (!writeback) {
          continue;
        }
        await input.notionClient.updateLifecycleResult(writeback);
        notionMutationCount += 1;
      }
    } finally {
      restoreMutationAllowList();
    }
  }

  return {
    schema: "notion-doc-publisher-v3/incremental-apply-result",
    version: 1,
    mode: input.mode,
    generatedAt,
    renderedDocumentCount: renderRecords.length,
    generatedPdfCount: renderRecords.filter((record) => record.desired?.pdfRequired).length,
    deployedBrandCount: [...brandResults.values()].filter((result) => result.deployed).length,
    copiedFileCount,
    deletedFileCount,
    notionMutationCount,
    nextState,
    brandResults: [...brandResults.values()].sort((left, right) => left.brand.localeCompare(right.brand)),
    recordResults
  };
}

async function assertRepositoryRoots(
  repositoryRoots: Record<string, string>,
  changedBrands: Set<string>,
  routesByBrand: Map<string, BrandRoute>
): Promise<void> {
  for (const brand of changedBrands) {
    const root = repositoryRoots[brand];
    if (!root) {
      throw new UserFacingError(`Repository root for ${brand} is required for incremental apply.`);
    }
    const route = routesByBrand.get(brand);
    if (!route?.targetRepository || route.repositoryConfirmed !== true) {
      throw new UserFacingError(`Target repository for ${brand} is not confirmed.`);
    }
    if (route.deploymentMode === "github-pages-artifact") {
      await fs.rm(root, { recursive: true, force: true });
      await fs.mkdir(root, { recursive: true });
      continue;
    }
    if ((route.deploymentMode ?? "branch") !== "branch") {
      throw new UserFacingError(`Unsupported deployment mode for ${brand}: ${route.deploymentMode}.`);
    }
    const stat = await fs.stat(root).catch(() => undefined);
    if (!stat?.isDirectory()) {
      throw new UserFacingError(`Repository root for ${brand} is not a directory.`);
    }
  }
}

async function copyStagedFile(input: {
  stagingRouteRoot: string;
  repositoryRoot: string;
  sourceRelativePath: string;
  targetRelativePath: string;
}): Promise<void> {
  const source = path.resolve(input.stagingRouteRoot, input.sourceRelativePath);
  const target = path.resolve(input.repositoryRoot, input.targetRelativePath);
  assertInsideRoot(source, input.stagingRouteRoot, `Staged source escapes route root: ${input.sourceRelativePath}`);
  assertInsideRoot(target, input.repositoryRoot, `Deployment target escapes repository root: ${input.targetRelativePath}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

function emptyState(generatedAt: string): IncrementalStateManifest {
  return {
    schema: "notion-doc-publisher-v3/incremental-state",
    version: 1,
    generatedAt,
    records: []
  };
}

function markBrandFailed(results: IncrementalApplyResult["recordResults"], brand: string, reason: string): void {
  for (const result of results) {
    if (normalizeBrand(result.brand) === brand && result.status === "planned") {
      result.status = "failed";
      result.reason = reason;
    }
  }
}

function setRecordResult(
  results: IncrementalApplyResult["recordResults"],
  record: IncrementalPlanRecord,
  status: "success" | "failed",
  reason: string
): void {
  const result = results.find((candidate) => candidate.action === record.action && candidate.docId === record.docId);
  if (result) {
    result.status = status;
    result.reason = reason;
  }
}

function filesToCopyForBrand(files: string[], records: IncrementalPlanRecord[], brand: string, route: BrandRoute): string[] {
  const ownedFiles = new Set<string>();
  for (const record of records) {
    if (normalizeBrand(record.brand) !== brand || !record.desired) {
      continue;
    }
    for (const file of record.desired.ownedFiles) {
      ownedFiles.add(removeDeploymentRoot(file, route));
    }
  }
  for (const file of files) {
    if (isRuntimeAsset(file)) {
      ownedFiles.add(file);
    }
  }
  return [...ownedFiles].filter((file) => files.includes(file)).sort();
}

function isRuntimeAsset(file: string): boolean {
  return file === "CNAME" || file === ".nojekyll" || file.startsWith("assets/css/") || /^assets\/[^/]+$/.test(file);
}

function removeDeploymentRoot(file: string, route: BrandRoute): string {
  const root = route.deploymentRoot?.replace(/^\/+|\/+$/g, "") ?? "";
  if (!root) {
    return file;
  }
  return file === root ? "" : file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

function addDeploymentRoot(file: string, route: BrandRoute): string {
  const root = route.deploymentRoot?.replace(/^\/+|\/+$/g, "") ?? "";
  return root ? `${root}/${file}` : file;
}

async function removeOwnedFiles(input: {
  repositoryRoot: string;
  files: string[];
  route: BrandRoute;
}): Promise<string[]> {
  const removed: string[] = [];
  for (const file of input.files) {
    const target = path.resolve(input.repositoryRoot, file);
    assertInsideRoot(target, input.repositoryRoot, `Deletion target escapes repository root: ${file}`);
    await fs.rm(target, { force: true });
    removed.push(file);
    await removeEmptyParents(path.dirname(target), path.resolve(input.repositoryRoot, input.route.deploymentRoot ?? ""));
  }
  return removed;
}

async function removeEmptyParents(start: string, stop: string): Promise<void> {
  let current = start;
  while (current.startsWith(stop) && current !== stop) {
    const entries = await fs.readdir(current).catch(() => undefined);
    if (!entries || entries.length > 0) {
      return;
    }
    await fs.rmdir(current);
    current = path.dirname(current);
  }
}

function moveDeletionPlan(record: IncrementalPlanRecord, previousRoute: BrandRoute): string[] {
  const oldFiles = deletionPlanForRecord(record, previousRoute);
  if (!record.desired || !record.previous || record.previous.targetRepository !== record.desired.targetRepository) {
    return oldFiles;
  }
  const retained = new Set(record.desired.ownedFiles);
  return oldFiles.filter((file) => !retained.has(file));
}

function lifecycleWritebackForRecord(
  record: IncrementalPlanRecord,
  status: IncrementalApplyResult["recordResults"][number]["status"]
): IncrementalLifecycleWriteback | undefined {
  if (record.action === "NOOP" || record.action === "FILTERED") {
    return undefined;
  }
  if (status !== "success") {
    return {
      pageId: record.pageId,
      status: "failed",
      action: record.action,
      message: record.reason
    };
  }
  if (record.action === "REMOVE") {
    return {
      pageId: record.pageId,
      status: "unpublished",
      action: record.action,
      message: "Removed the previous verified production output."
    };
  }
  return {
    pageId: record.pageId,
    status: "success",
    action: record.action,
    message: `Incremental lifecycle ${record.action.toLowerCase()} completed.`,
    publishedUrl: record.desired?.publishedUrl
  };
}

function assertInsideRoot(target: string, root: string, message: string): void {
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UserFacingError(message);
  }
}
