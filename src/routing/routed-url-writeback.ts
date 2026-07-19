import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { UserFacingError, type AppConfig } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { enableNotionMutationAllowList } from "../notion/read-only-guard.js";
import { isPublishableCandidate } from "../validate/validate.js";
import {
  computeBrandCanonicalUrl,
  isSafeRelativePublicPath,
  normalizeBrand,
  type BrandRoute
} from "./brand-routing.js";
import type { RoutedBrandManifest, RoutedBuildResult } from "./routed-build.js";

export type RoutedUrlWritebackMode = "dry-run" | "write";
export type RoutedUrlWritebackAction = "update" | "unchanged" | "skipped" | "invalid";

export type RoutedUrlWritebackPlanRecord = {
  alias: string;
  brand: string;
  action: RoutedUrlWritebackAction;
  reason: string;
  idempotent: boolean;
  wouldBreakExistingPublishedUrl: boolean;
  visibilityClass: string;
  currentUrlFingerprint: string | null;
  targetUrlFingerprint: string | null;
};

export type RoutedUrlWritebackPlan = {
  schema: "notion-doc-publisher-v3/routed-url-writeback-plan";
  version: 1;
  generatedAt: string;
  runId: string;
  mode: RoutedUrlWritebackMode;
  eligibleRecordCount: number;
  eligibleByBrand: Record<string, number>;
  unchangedUrlCount: number;
  urlUpdateCount: number;
  skippedCount: number;
  skippedByReason: Record<string, number>;
  invalidCount: number;
  urlBreakingChangeCount: number;
  records: RoutedUrlWritebackPlanRecord[];
};

export type RoutedUrlWritebackPrivateRecord = {
  alias: string;
  pageId: string;
  brand: string;
  docId: string;
  previousPublishedUrl: string;
  targetPublishedUrl: string;
  action: RoutedUrlWritebackAction;
  reason: string;
  wouldBreakExistingPublishedUrl: boolean;
};

export type RoutedUrlWritebackPlanBundle = {
  plan: RoutedUrlWritebackPlan;
  privateRecords: RoutedUrlWritebackPrivateRecord[];
};

export type RoutedUrlWritebackArtifacts = {
  publicPlanPath: string;
  privateBackupPath: string;
};

export type RoutedUrlWritebackClient = {
  updatePublishedUrlOnly(pageId: string, url: string): Promise<void>;
  readPublishedUrl?(pageId: string): Promise<string>;
};

export type RoutedUrlWritebackExecutionResult = {
  attemptedUpdateCount: number;
  successfulUpdateCount: number;
  failedUpdateCount: number;
  duplicateUpdateCount: number;
  failures: Array<{ alias: string; reason: string }>;
};

export type RoutedUrlWritebackVerificationResult = {
  checkedCount: number;
  correctCount: number;
  failedCount: number;
  failures: Array<{ alias: string; reason: string }>;
};

export function createRoutedUrlWritebackPlan(input: {
  documents: DocumentModel[];
  routes: BrandRoute[];
  config: AppConfig;
  buildResult: RoutedBuildResult;
  outputBaseRoot: string;
  mode: RoutedUrlWritebackMode;
  runId: string;
  now?: string;
  salt?: string;
}): RoutedUrlWritebackPlanBundle {
  const salt = input.salt ?? crypto.randomBytes(16).toString("hex");
  const routeByBrand = new Map(input.routes.map((route) => [normalizeBrand(route.brand), route]));
  const manifestByBrand = new Map(input.buildResult.manifests.map((manifest) => [manifest.brand, manifest]));
  const seenPageIds = new Set<string>();
  const publicRecords: RoutedUrlWritebackPlanRecord[] = [];
  const privateRecords: RoutedUrlWritebackPrivateRecord[] = [];

  for (const document of input.documents) {
    const alias = `WRITEBACK-${String(publicRecords.length + 1).padStart(3, "0")}`;
    const brand = normalizeBrand(document.meta.brand.label);
    const route = routeByBrand.get(brand);
    const manifest = manifestByBrand.get(brand);
    const pageId = document.source.notionPageId;
    const currentUrl = document.meta.publishedUrl?.trim() ?? "";
    let action: RoutedUrlWritebackAction = "skipped";
    let reason = skipReason(document, input.config, route, manifest);
    let targetUrl = "";

    if (!reason && route && manifest) {
      targetUrl = computeBrandCanonicalUrl({
        routes: input.routes,
        brandLabel: document.meta.brand.label,
        canonicalPath: document.meta.canonicalPath,
        docId: document.meta.docId
      });
      reason = validateEligibleOutput(document, manifest, targetUrl, input.outputBaseRoot);
      if (!reason && seenPageIds.has(pageId)) {
        action = "invalid";
        reason = "DUPLICATE_NOTION_PAGE";
      } else if (!reason) {
        seenPageIds.add(pageId);
        action = currentUrl === targetUrl ? "unchanged" : "update";
        reason = action === "unchanged" ? "URL_ALREADY_CORRECT" : "URL_UPDATE_REQUIRED";
      } else {
        action = reason.startsWith("INVALID_") ? "invalid" : "skipped";
      }
    }

    const wouldBreakExistingPublishedUrl = Boolean(currentUrl && targetUrl && currentUrl !== targetUrl);
    publicRecords.push({
      alias,
      brand: brand || "UNKNOWN",
      action,
      reason,
      idempotent: action !== "update",
      wouldBreakExistingPublishedUrl,
      visibilityClass: document.meta.visibility.trim() || "UNKNOWN",
      currentUrlFingerprint: currentUrl ? fingerprint(currentUrl, salt) : null,
      targetUrlFingerprint: targetUrl ? fingerprint(targetUrl, salt) : null
    });
    privateRecords.push({
      alias,
      pageId,
      brand: brand || "UNKNOWN",
      docId: document.meta.docId,
      previousPublishedUrl: currentUrl,
      targetPublishedUrl: targetUrl,
      action,
      reason,
      wouldBreakExistingPublishedUrl
    });
  }

  const updateRecords = publicRecords.filter((record) => record.action === "update");
  const unchangedRecords = publicRecords.filter((record) => record.action === "unchanged");
  const skippedRecords = publicRecords.filter((record) => record.action === "skipped");
  const invalidRecords = publicRecords.filter((record) => record.action === "invalid");
  const eligibleRecords = publicRecords.filter((record) => record.action === "update" || record.action === "unchanged");

  return {
    plan: {
      schema: "notion-doc-publisher-v3/routed-url-writeback-plan",
      version: 1,
      generatedAt: input.now ?? new Date().toISOString(),
      runId: input.runId,
      mode: input.mode,
      eligibleRecordCount: eligibleRecords.length,
      eligibleByBrand: countByBrand(eligibleRecords, input.routes),
      unchangedUrlCount: unchangedRecords.length,
      urlUpdateCount: updateRecords.length,
      skippedCount: skippedRecords.length,
      skippedByReason: countByReason(skippedRecords),
      invalidCount: invalidRecords.length,
      urlBreakingChangeCount: publicRecords.filter((record) => record.wouldBreakExistingPublishedUrl).length,
      records: publicRecords
    },
    privateRecords
  };
}

export async function writeRoutedUrlWritebackArtifacts(input: {
  bundle: RoutedUrlWritebackPlanBundle;
  outputRoot: string;
  runId: string;
  now?: string;
}): Promise<RoutedUrlWritebackArtifacts> {
  const root = path.resolve(input.outputRoot, input.runId);
  const publicPlanPath = path.join(root, "writeback-plan.json");
  const privateBackupPath = path.join(root, "_private", "published-url-backup.json");
  await fs.mkdir(path.dirname(publicPlanPath), { recursive: true });
  await fs.mkdir(path.dirname(privateBackupPath), { recursive: true });
  await fs.writeFile(publicPlanPath, `${JSON.stringify(input.bundle.plan, null, 2)}\n`, "utf8");
  await fs.writeFile(privateBackupPath, `${JSON.stringify({
    schema: "notion-doc-publisher-v3/routed-published-url-backup",
    version: 1,
    runId: input.runId,
    generatedAt: input.now ?? new Date().toISOString(),
    records: input.bundle.privateRecords
      .filter((record) => record.action === "update")
      .map((record) => ({
        alias: record.alias,
        pageId: record.pageId,
        brand: record.brand,
        previousPublishedUrl: record.previousPublishedUrl,
        targetPublishedUrl: record.targetPublishedUrl
      }))
  }, null, 2)}\n`, "utf8");
  return { publicPlanPath, privateBackupPath };
}

export function isGitIgnoredOrOutsideRepo(filePath: string, cwd = process.cwd()): boolean {
  const relative = path.relative(cwd, path.resolve(filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return true;
  }
  try {
    execFileSync("git", ["check-ignore", "-q", relative], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function executeRoutedUrlWriteback(input: {
  bundle: RoutedUrlWritebackPlanBundle;
  client: RoutedUrlWritebackClient;
  maxEligibleRecords?: number;
  maxUpdates?: number;
}): Promise<RoutedUrlWritebackExecutionResult> {
  const maxEligibleRecords = input.maxEligibleRecords ?? 10;
  const maxUpdates = input.maxUpdates ?? 10;
  if (input.bundle.plan.eligibleRecordCount > maxEligibleRecords) {
    throw new UserFacingError(`Routed URL writeback blocked: ${input.bundle.plan.eligibleRecordCount} eligible records exceeds ${maxEligibleRecords}.`);
  }
  if (input.bundle.plan.urlUpdateCount > maxUpdates) {
    throw new UserFacingError(`Routed URL writeback blocked: ${input.bundle.plan.urlUpdateCount} URL updates exceeds ${maxUpdates}.`);
  }
  if (input.bundle.plan.invalidCount > 0) {
    throw new UserFacingError("Routed URL writeback blocked: plan contains invalid records.");
  }

  const seenPageIds = new Set<string>();
  const failures: RoutedUrlWritebackExecutionResult["failures"] = [];
  let attemptedUpdateCount = 0;
  let successfulUpdateCount = 0;
  let duplicateUpdateCount = 0;
  const restoreMutationAllowList = enableNotionMutationAllowList("writeback:routed", ["updatePublishedUrlOnly"]);
  try {
    for (const record of input.bundle.privateRecords.filter((item) => item.action === "update")) {
      if (seenPageIds.has(record.pageId)) {
        duplicateUpdateCount += 1;
        failures.push({ alias: record.alias, reason: "DUPLICATE_NOTION_PAGE" });
        continue;
      }
      seenPageIds.add(record.pageId);
      attemptedUpdateCount += 1;
      try {
        await input.client.updatePublishedUrlOnly(record.pageId, record.targetPublishedUrl);
        successfulUpdateCount += 1;
      } catch (error) {
        failures.push({ alias: record.alias, reason: sanitizeFailure(error) });
      }
    }
  } finally {
    restoreMutationAllowList();
  }

  return {
    attemptedUpdateCount,
    successfulUpdateCount,
    failedUpdateCount: failures.length,
    duplicateUpdateCount,
    failures
  };
}

export async function verifyRoutedUrlWriteback(input: {
  bundle: RoutedUrlWritebackPlanBundle;
  client: RoutedUrlWritebackClient;
}): Promise<RoutedUrlWritebackVerificationResult> {
  if (!input.client.readPublishedUrl) {
    return { checkedCount: 0, correctCount: 0, failedCount: 0, failures: [] };
  }

  const failures: RoutedUrlWritebackVerificationResult["failures"] = [];
  let checkedCount = 0;
  let correctCount = 0;
  for (const record of input.bundle.privateRecords.filter((item) => item.action === "update")) {
    checkedCount += 1;
    try {
      const observed = await input.client.readPublishedUrl(record.pageId);
      if (observed === record.targetPublishedUrl) {
        correctCount += 1;
      } else {
        failures.push({ alias: record.alias, reason: "PUBLISHED_URL_VERIFICATION_MISMATCH" });
      }
    } catch (error) {
      failures.push({ alias: record.alias, reason: sanitizeFailure(error) });
    }
  }
  return {
    checkedCount,
    correctCount,
    failedCount: failures.length,
    failures
  };
}

export function applyVerifiedUrlsToDocuments(
  documents: DocumentModel[],
  bundle: RoutedUrlWritebackPlanBundle,
  verification: RoutedUrlWritebackVerificationResult
): void {
  if (verification.failedCount > 0) {
    return;
  }
  const targetByPageId = new Map(
    bundle.privateRecords
      .filter((record) => record.action === "update")
      .map((record) => [record.pageId, record.targetPublishedUrl])
  );
  for (const document of documents) {
    const target = targetByPageId.get(document.source.notionPageId);
    if (target) {
      document.meta.publishedUrl = target;
    }
  }
}

function skipReason(
  document: DocumentModel,
  config: AppConfig,
  route: BrandRoute | undefined,
  manifest: RoutedBrandManifest | undefined
): string {
  const brand = normalizeBrand(document.meta.brand.label);
  if (!brand) {
    return "MISSING_BRAND";
  }
  if (config.allowedBrands && !config.allowedBrands.has(brand)) {
    return "BRAND_FILTERED";
  }
  if (!route) {
    return "UNKNOWN_BRAND";
  }
  if (!isPublishableCandidate(document, config)) {
    return "NONPUBLISHABLE_OR_FILTERED";
  }
  if (document.validation.errors.some((error) => error.code === "OUTPUT_PATH_COLLISION" || error.code === "DUPLICATE_DOC_ID")) {
    return "OUTPUT_COLLISION";
  }
  if (document.validation.errors.length > 0) {
    return "VALIDATION_ERROR";
  }
  if (!manifest) {
    return "ROUTE_MANIFEST_MISSING";
  }
  const documentPlan = manifest.documents.find((item) => item.docId === document.meta.docId);
  if (documentPlan && !manifest.pdfResults.some((pdf) => pdf.docId === document.meta.docId && pdf.status === "success")) {
    return "PDF_NOT_SUCCESS";
  }
  if (!manifest.deploymentPlan.ok) {
    return "DEPLOYMENT_NOT_VALID";
  }
  if (manifest.buildStatus !== "success") {
    return "BRAND_BUILD_NOT_SUCCESS";
  }
  return "";
}

function validateEligibleOutput(
  document: DocumentModel,
  manifest: RoutedBrandManifest,
  targetUrl: string,
  outputBaseRoot: string
): string {
  const documentPlan = manifest.documents.find((item) => item.docId === document.meta.docId);
  if (!documentPlan) {
    return "NOT_IN_ACCEPTED_ROUTED_OUTPUT";
  }
  if (!isSafeFinalUrl(targetUrl, manifest.targetBaseUrl)) {
    return "INVALID_TARGET_URL";
  }
  if (targetUrl !== `${manifest.targetBaseUrl.replace(/\/+$/, "")}${document.meta.canonicalPath}`) {
    return "INVALID_TARGET_URL_MISMATCH";
  }
  const successfulPdf = manifest.pdfResults.some((pdf) => pdf.docId === document.meta.docId && pdf.status === "success");
  if (!successfulPdf) {
    return "PDF_NOT_SUCCESS";
  }
  const htmlRelativePath = canonicalPathToHtmlPath(document.meta.canonicalPath);
  if (!htmlRelativePath || !isSafeRelativePublicPath(htmlRelativePath)) {
    return "INVALID_HTML_PATH";
  }
  if (!documentPlan.pdfPath || !isSafeRelativePublicPath(documentPlan.pdfPath)) {
    return "INVALID_PDF_PATH";
  }
  if (!manifest.files.includes(documentPlan.pdfPath)) {
    return "PDF_MISSING";
  }

  const siteRoot = path.resolve(outputBaseRoot, manifest.outputRoot);
  const htmlPath = path.resolve(siteRoot, htmlRelativePath);
  const pdfPath = path.resolve(siteRoot, documentPlan.pdfPath);
  if (!isPathInsideRoot(htmlPath, siteRoot) || !isPathInsideRoot(pdfPath, siteRoot)) {
    return "INVALID_OUTPUT_PATH";
  }
  if (!fsSync.existsSync(htmlPath)) {
    return "HTML_MISSING";
  }
  return "";
}

function canonicalPathToHtmlPath(canonicalPath: string): string | undefined {
  if (!canonicalPath.startsWith("/")) {
    return undefined;
  }
  const relative = canonicalPath.replace(/^\/|\/$/g, "");
  if (!isSafeRelativePublicPath(relative)) {
    return undefined;
  }
  return path.posix.join(relative, "index.html");
}

function isSafeFinalUrl(value: string, expectedBaseUrl: string): boolean {
  try {
    const url = new URL(value);
    const base = new URL(expectedBaseUrl);
    return (
      url.protocol === "https:" &&
      url.origin === base.origin &&
      !value.includes("localhost") &&
      !value.includes("127.0.0.1") &&
      !value.includes("file:")
    );
  } catch {
    return false;
  }
}

function countByBrand(records: RoutedUrlWritebackPlanRecord[], routes: BrandRoute[]): Record<string, number> {
  const result = countBy(records, (record) => record.brand);
  for (const route of routes) {
    result[normalizeBrand(route.brand)] = result[normalizeBrand(route.brand)] ?? 0;
  }
  return result;
}

function countByReason(records: RoutedUrlWritebackPlanRecord[]): Record<string, number> {
  return countBy(records, (record) => record.reason);
}

function countBy(records: RoutedUrlWritebackPlanRecord[], key: (record: RoutedUrlWritebackPlanRecord) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const record of records) {
    const value = key(record);
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function fingerprint(value: string, salt: string): string {
  return crypto.createHash("sha256").update(salt).update("\0").update(value).digest("hex").slice(0, 16);
}

function sanitizeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s"]+/g, "[redacted-url]")
    .replace(/[0-9a-f]{32}/gi, "[redacted-id]")
    .slice(0, 180);
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
