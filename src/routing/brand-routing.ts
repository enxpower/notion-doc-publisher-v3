import fs from "node:fs";
import path from "node:path";
import { UserFacingError } from "../config.js";
import { parseDocId } from "../doc-id/generator.js";
import type { DocumentModel } from "../model/document.js";

export type BrandRoute = {
  brand: string;
  routeId?: string;
  outputRoot: string;
  targetRepository: string | null;
  targetDomain: string;
  pathPrefix?: string;
  deploymentRoot?: string;
  deploymentMode?: "branch" | "github-pages-artifact";
  pdfPath?: string;
  cname?: string;
  presentationProfileKey?: string | null;
  allowedUrlNamespaces?: string[];
  repositoryConfirmed?: boolean;
  allowSharedTarget?: boolean;
  blockedReason?: string;
  production?: boolean;
};

export type RoutedBrandPlan = {
  brand: string;
  route: BrandRoute;
  documents: DocumentModel[];
  errors: string[];
  ok: boolean;
};

export type RoutedPublishingPlan = {
  plans: RoutedBrandPlan[];
  rejected: Array<{ pageId: string; brand: string; reason: string }>;
};

export type BrandOutputManifest = {
  brand: string;
  outputRoot: string;
  targetRepository: string | null;
  targetDomain: string;
  pathPrefix?: string;
  deploymentRoot?: string;
  files: string[];
  deletions?: string[];
  existingFileCount?: number;
};

export type DryRunDeploymentPlan = {
  brand: string;
  ok: boolean;
  errors: string[];
  sourceDir: string;
  targetRepository: string | null;
  targetDomain: string;
  pathPrefix: string;
  deploymentRoot: string;
  expectedFileCount: number;
  deletionCount: number;
  wouldDelete: string[];
};

export function normalizeBrand(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : "";
}

export function createRoutedPublishingPlan(
  documents: DocumentModel[],
  routes: BrandRoute[]
): RoutedPublishingPlan {
  const routeByBrand = new Map(routes.map((route) => [normalizeBrand(route.brand), route]));
  const outputRootCounts = new Map<string, number>();
  for (const route of routes) {
    const key = normalizeOutputRoot(route.outputRoot);
    outputRootCounts.set(key, (outputRootCounts.get(key) ?? 0) + 1);
  }

  const plans = routes.map((route): RoutedBrandPlan => {
    const outputRoot = normalizeOutputRoot(route.outputRoot);
    const errors = outputRootCounts.get(outputRoot)! > 1
      ? [`Output root is shared by multiple brand routes: ${route.outputRoot}`]
      : [];
    return {
      brand: normalizeBrand(route.brand),
      route,
      documents: [],
      errors,
      ok: errors.length === 0
    };
  });
  const planByBrand = new Map(plans.map((plan) => [plan.brand, plan]));
  const rejected: RoutedPublishingPlan["rejected"] = [];

  for (const document of documents) {
    const brand = normalizeBrand(document.meta.brand.label);
    if (!brand) {
      rejected.push({
        pageId: document.source.notionPageId,
        brand,
        reason: "Missing Brand"
      });
      continue;
    }

    const route = routeByBrand.get(brand);
    const plan = planByBrand.get(brand);
    if (!route || !plan) {
      rejected.push({
        pageId: document.source.notionPageId,
        brand,
        reason: `Unknown Brand: ${document.meta.brand.label}`
      });
      continue;
    }

    plan.documents.push(document);
  }

  return { plans, rejected };
}

export function createDryRunDeploymentPlan(input: {
  route: BrandRoute;
  manifest?: BrandOutputManifest;
  sourceDir: string;
  allowedStagingRoot: string;
  productionDeploymentEnabled?: boolean;
  maxDeletionRatio?: number;
}): DryRunDeploymentPlan {
  const brand = normalizeBrand(input.route.brand);
  const errors: string[] = [];
  const manifest = input.manifest;
  const maxDeletionRatio = input.maxDeletionRatio ?? 0.2;

  if (!Number.isFinite(maxDeletionRatio) || maxDeletionRatio < 0 || maxDeletionRatio > 1) {
    errors.push("Deletion threshold must be a finite number between 0 and 1.");
  }

  if (input.route.production && input.productionDeploymentEnabled !== true) {
    errors.push("Production deployment is disabled by default.");
  }

  if (!input.route.targetRepository || input.route.repositoryConfirmed === false) {
    errors.push(input.route.blockedReason ?? "Target repository is not confirmed.");
  }

  if (!isWithinRoot(input.sourceDir, input.allowedStagingRoot)) {
    errors.push("Source directory is outside the allowed staging root.");
  }
  if (sameBoundaryPath(input.sourceDir, input.allowedStagingRoot)) {
    errors.push("Source directory must be a brand-specific child of the allowed staging root.");
  }

  if (!manifest) {
    errors.push("Missing brand output manifest.");
    return {
      brand,
      ok: false,
      errors,
      sourceDir: input.sourceDir,
      targetRepository: input.route.targetRepository,
      targetDomain: input.route.targetDomain,
      pathPrefix: normalizedPathPrefix(input.route),
      deploymentRoot: normalizedDeploymentRoot(input.route),
      expectedFileCount: 0,
      deletionCount: 0,
      wouldDelete: []
    };
  }

  if (normalizeBrand(manifest.brand) !== brand) {
    errors.push(`Manifest brand mismatch: expected ${brand}, found ${manifest.brand}.`);
  }

  if (normalizeOutputRoot(manifest.outputRoot) !== normalizeOutputRoot(input.route.outputRoot)) {
    errors.push("Manifest output root does not match route output root.");
  }

  if (manifest.targetRepository !== input.route.targetRepository) {
    errors.push("Manifest target repository does not match route target repository.");
  }

  if (normalizeDomain(manifest.targetDomain) !== normalizeDomain(input.route.targetDomain)) {
    errors.push("Manifest target domain does not match route target domain.");
  }

  if (normalizedPathPrefixFromManifest(manifest) !== normalizedPathPrefix(input.route)) {
    errors.push("Manifest path prefix does not match route path prefix.");
  }

  if (normalizedDeploymentRootFromManifest(manifest) !== normalizedDeploymentRoot(input.route)) {
    errors.push("Manifest deployment root does not match route deployment root.");
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!Array.isArray(manifest.files)) {
    errors.push("Manifest files must be an array.");
  }
  if (files.length === 0) {
    errors.push("Brand output is empty.");
  }

  if (files.length > 0 && !files.some((file) => isSafeRelativePublicPath(file) && file.endsWith(".html"))) {
    errors.push("HTML output is missing.");
  }

  for (const file of files) {
    if (!isSafeRelativePublicPath(file)) {
      errors.push(`Unsafe manifest file path is blocked: ${String(file)}`);
      continue;
    }
    if (!isWithinRoot(path.resolve(input.sourceDir, file), input.sourceDir)) {
      errors.push(`Cross-brand file is blocked: ${file}`);
    }
  }

  const deletions = Array.isArray(manifest.deletions) ? manifest.deletions : [];
  if (manifest.deletions !== undefined && !Array.isArray(manifest.deletions)) {
    errors.push("Manifest deletions must be an array.");
  }
  for (const deletion of deletions) {
    if (!isSafeRelativePublicPath(deletion)) {
      errors.push(`Unsafe deletion path is blocked: ${String(deletion)}`);
      continue;
    }
    if (!isWithinRoot(path.resolve(input.sourceDir, deletion), input.sourceDir)) {
      errors.push(`Cross-brand deletion is blocked: ${deletion}`);
    }
  }

  const existingFileCount = manifest.existingFileCount ?? 0;
  if (!Number.isInteger(existingFileCount) || existingFileCount < 0) {
    errors.push("Existing file count must be a non-negative integer.");
  } else if (existingFileCount === 0 && deletions.length > 0) {
    errors.push("Deletion count requires a positive existing file count.");
  } else if (existingFileCount > 0) {
    const ratio = deletions.length / existingFileCount;
    if (ratio > maxDeletionRatio) {
      errors.push(`Excessive deletion is blocked: ${deletions.length}/${existingFileCount}.`);
    }
  }

  return {
    brand,
    ok: errors.length === 0,
    errors,
    sourceDir: input.sourceDir,
    targetRepository: input.route.targetRepository,
    targetDomain: input.route.targetDomain,
    pathPrefix: normalizedPathPrefix(input.route),
    deploymentRoot: normalizedDeploymentRoot(input.route),
    expectedFileCount: files.length,
    deletionCount: deletions.length,
    wouldDelete: errors.length === 0 ? deletions : []
  };
}

export function computeRouteFinalUrl(route: BrandRoute, canonicalPath: string): string {
  const base = computeRouteBaseUrl(route);
  const pathValue = canonicalPath.startsWith("/") ? canonicalPath : `/${canonicalPath}`;
  return `${base}${pathValue}`;
}

export function computeRouteBaseUrl(route: BrandRoute): string {
  const base = route.targetDomain.trim().replace(/\/+$/, "");
  const prefix = normalizedPathPrefix(route);
  return `${base}${prefix}`;
}

export function resolveBrandRoute(routes: BrandRoute[], brandLabel: string): BrandRoute {
  const brand = normalizeBrand(brandLabel);
  if (!brand) {
    throw new UserFacingError("Brand-aware canonical URL resolution blocked: Brand is missing.");
  }
  const route = routes.find((candidate) => normalizeBrand(candidate.brand) === brand);
  if (!route) {
    throw new UserFacingError(`Brand-aware canonical URL resolution blocked: unknown Brand ${brand}.`);
  }
  return route;
}

export function computeBrandCanonicalUrl(input: {
  routes: BrandRoute[];
  brandLabel: string;
  canonicalPath: string;
  docId?: string;
}): string {
  const route = resolveBrandRoute(input.routes, input.brandLabel);
  assertCanonicalPathAllowedForRoute(route, input.canonicalPath, input.docId);
  return computeRouteFinalUrl(route, input.canonicalPath);
}

export function assertCanonicalPathAllowedForRoute(route: BrandRoute, canonicalPath: string, docId?: string): void {
  const relative = canonicalPathToSafeRelative(canonicalPath);
  if (!relative) {
    throw new UserFacingError("Brand-aware canonical URL resolution blocked: canonical path is missing or unsafe.");
  }
  const namespace = relative.split("/")[0] ?? "";
  if (!route.allowedUrlNamespaces?.includes(namespace)) {
    throw new UserFacingError(
      `Brand-aware canonical URL resolution blocked: namespace ${namespace || "(empty)"} is not allowed for ${normalizeBrand(route.brand)}.`
    );
  }
  if (namespace === "docs" && docId) {
    const parsed = parseDocId(docId);
    if (parsed && parsed.brandToken !== normalizeBrand(route.brand)) {
      throw new UserFacingError(
        `Brand-aware canonical URL resolution blocked: DOC_ID brand token ${parsed.brandToken} does not match ${normalizeBrand(route.brand)}.`
      );
    }
  }
}

function canonicalPathToSafeRelative(canonicalPath: string): string | undefined {
  if (!canonicalPath.startsWith("/")) {
    return undefined;
  }
  const relative = canonicalPath.replace(/^\/|\/$/g, "");
  return isSafeRelativePublicPath(relative) ? relative : undefined;
}

function normalizeOutputRoot(value: string): string {
  return path.normalize(value).replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizeDomain(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizedPathPrefix(route: Pick<BrandRoute, "pathPrefix">): string {
  const raw = route.pathPrefix?.trim() ?? "";
  if (!raw || raw === "/") {
    return "";
  }
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

function normalizedPathPrefixFromManifest(manifest: Pick<BrandOutputManifest, "pathPrefix">): string {
  const raw = manifest.pathPrefix?.trim() ?? "";
  if (!raw || raw === "/") {
    return "";
  }
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

function normalizedDeploymentRoot(route: Pick<BrandRoute, "deploymentRoot">): string {
  return normalizeDeploymentRootValue(route.deploymentRoot);
}

function normalizedDeploymentRootFromManifest(manifest: Pick<BrandOutputManifest, "deploymentRoot">): string {
  return normalizeDeploymentRootValue(manifest.deploymentRoot);
}

function normalizeDeploymentRootValue(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw || raw === ".") {
    return "";
  }
  return raw.replace(/^\/+|\/+$/g, "");
}

function isWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = resolveBoundaryPath(candidate);
  const resolvedRoot = resolveBoundaryPath(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sameBoundaryPath(left: string, right: string): boolean {
  return resolveBoundaryPath(left) === resolveBoundaryPath(right);
}

function resolveBoundaryPath(value: string): string {
  let resolved = path.resolve(value);
  try {
    if (fs.existsSync(resolved)) {
      return fs.realpathSync.native(resolved);
    }
    const missingSegments: string[] = [];
    while (!fs.existsSync(resolved)) {
      const parent = path.dirname(resolved);
      if (parent === resolved) {
        return path.resolve(value);
      }
      missingSegments.unshift(path.basename(resolved));
      resolved = parent;
    }
    return path.resolve(fs.realpathSync.native(resolved), ...missingSegments);
  } catch {
    return path.resolve(value);
  }
}

export function isSafeRelativePublicPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  const normalized = value.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized.includes("//")) {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !isSafePathSegment(segment))) {
    return false;
  }
  try {
    const decoded = decodeURIComponent(normalized);
    if (decoded !== normalized) {
      const decodedSegments = decoded.replace(/\\/g, "/").split("/");
      return decodedSegments.every(isSafePathSegment);
    }
  } catch {
    return false;
  }
  return true;
}

function isSafePathSegment(segment: string): boolean {
  return Boolean(segment) && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}
