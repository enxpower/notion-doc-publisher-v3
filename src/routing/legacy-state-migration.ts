import fs from "node:fs/promises";
import path from "node:path";

import { UserFacingError, type AppConfig } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { isPublishableCandidate } from "../validate/validate.js";
import { computeRouteFinalUrl, isSafeRelativePublicPath, normalizeBrand, type BrandRoute } from "./brand-routing.js";
import {
  createDesiredDocumentState,
  createIncrementalPlan,
  type DocumentStateRecord,
  type IncrementalPlan,
  type IncrementalStateManifest
} from "./incremental.js";

export type LegacyStateFile = {
  pages?: Record<string, unknown>;
  [key: string]: unknown;
};

export type LegacyRepositoryInput = {
  brand: string;
  repositoryRoot: string;
  legacyStatePath?: string;
};

export type LegacyMigrationIssue = {
  brand: string;
  code: string;
  message: string;
  docId?: string;
};

export type LegacyMigratedDocument = {
  brand: string;
  docId: string;
  canonicalUrl: string;
  htmlPath: string;
  pdfPath: string;
  ownedFileCount: number;
  provenance: string[];
};

export type LegacyRepairCandidate = {
  brand: string;
  pageId: string;
  docId: string;
  visibility: string;
  namespace: string;
  shareToken: string;
  expectedHtmlPath: string;
  expectedPdfPath: string;
  publish: boolean;
  validationStatus: "valid" | "invalid";
  publishedUrlExists: boolean;
  htmlStatus: "present" | "missing";
  pdfStatus: string;
  classification: "CREATE";
  reason: string;
  provenance: string[];
};

export type UnmanagedLegacyFile = {
  brand: string;
  path: string;
  reason: string;
};

export type LegacyStateMigrationResult = {
  schema: "notion-doc-publisher-v3/legacy-state-migration";
  version: 1;
  generatedAt: string;
  migratedRecordCount: number;
  unmanagedLegacyFileCount: number;
  state: IncrementalStateManifest;
  idempotencyPlan: IncrementalPlan;
  migratedDocuments: LegacyMigratedDocument[];
  repairCandidates: LegacyRepairCandidate[];
  unmanagedLegacyFiles: UnmanagedLegacyFile[];
  errors: LegacyMigrationIssue[];
  warnings: LegacyMigrationIssue[];
};

export async function migrateLegacyPhase1State(input: {
  documents: DocumentModel[];
  routes: BrandRoute[];
  config: AppConfig;
  repositories: LegacyRepositoryInput[];
  now?: string;
}): Promise<LegacyStateMigrationResult> {
  const generatedAt = input.now ?? new Date().toISOString();
  const routeByBrand = new Map(input.routes.map((route) => [normalizeBrand(route.brand), route]));
  const repositories = await loadRepositoryContexts(input.repositories);
  const records: DocumentStateRecord[] = [];
  const migratedDocuments: LegacyMigratedDocument[] = [];
  const errors: LegacyMigrationIssue[] = [];
  const warnings: LegacyMigrationIssue[] = [];
  const repairCandidates: LegacyRepairCandidate[] = [];
  const ownedByBrand = new Map<string, Set<string>>();

  for (const document of input.documents) {
    const brand = normalizeBrand(document.meta.brand.label);
    const route = routeByBrand.get(brand);
    if (!document.meta.publish || !isPublishableCandidate(document, input.config)) {
      continue;
    }
    if (!route) {
      errors.push(issue(brand, "UNKNOWN_BRAND", "Published document has no configured route.", document.meta.docId));
      continue;
    }
    if (document.validation.errors.length > 0) {
      errors.push(issue(brand, "VALIDATION_FAILED", "Published document has validation errors.", document.meta.docId));
      continue;
    }
    const repository = repositories.get(brand);
    if (!repository) {
      errors.push(issue(brand, "MISSING_REPOSITORY_ROOT", "No deployed repository tree was supplied for this brand.", document.meta.docId));
      continue;
    }

    const proof = await proveDocumentOwnership({
      document,
      route,
      repositoryRoot: repository.repositoryRoot,
      legacyState: repository.legacyState
    });
    warnings.push(...proof.warnings);
    if (proof.errors.length > 0) {
      errors.push(...proof.errors);
      continue;
    }
    if (!proof.existingPublicationProven) {
      repairCandidates.push({
        brand,
        pageId: document.source.notionPageId,
        docId: document.meta.docId,
        visibility: document.meta.visibility,
        namespace: document.meta.privateLinkNamespace,
        shareToken: document.meta.shareToken,
        expectedHtmlPath: proof.htmlPath,
        expectedPdfPath: proof.pdfPath,
        publish: document.meta.publish,
        validationStatus: document.validation.errors.length > 0 ? "invalid" : "valid",
        publishedUrlExists: Boolean(document.meta.publishedUrl?.trim()),
        htmlStatus: proof.htmlStatus,
        pdfStatus: proof.pdfStatus,
        classification: "CREATE",
        reason: "PUBLISH_CHECKED_VALID_OUTPUT_ABSENT_OR_UNPROVEN",
        provenance: proof.provenance
      });
      continue;
    }

    const desired = createDesiredDocumentState({
      document,
      route,
      config: input.config,
      ownedFilesOverride: proof.ownedFiles
    });
    records.push({ ...desired, publishedAt: generatedAt });
    migratedDocuments.push({
      brand,
      docId: document.meta.docId,
      canonicalUrl: computeRouteFinalUrl(route, document.meta.canonicalPath),
      htmlPath: proof.htmlPath,
      pdfPath: proof.pdfPath,
      ownedFileCount: proof.ownedFiles.length,
      provenance: proof.provenance
    });

    const owned = ownedByBrand.get(brand) ?? new Set<string>();
    proof.ownedFiles.forEach((file) => owned.add(file));
    ownedByBrand.set(brand, owned);
  }

  const unmanagedLegacyFiles: UnmanagedLegacyFile[] = [];
  for (const [brand, repository] of repositories) {
    const route = routeByBrand.get(brand);
    if (!route) {
      continue;
    }
    const owned = ownedByBrand.get(brand) ?? new Set<string>();
    const allFiles = await listFilesRelative(repository.repositoryRoot);
    for (const file of allFiles) {
      const normalized = normalizePublicPath(file);
      if (owned.has(normalized) || isSiteOwnedFile(normalized, route)) {
        continue;
      }
      unmanagedLegacyFiles.push({
        brand,
        path: normalized,
        reason: "Not assigned to a document by strict ownership proof."
      });
    }
  }

  const state: IncrementalStateManifest = {
    schema: "notion-doc-publisher-v3/incremental-state",
    version: 1,
    generatedAt,
    records: records.sort((left, right) => left.pageId.localeCompare(right.pageId))
  };
  const idempotencyPlan = createIncrementalPlan({
    documents: input.documents,
    routes: input.routes,
    config: input.config,
    previousState: state,
    now: generatedAt
  });

  return {
    schema: "notion-doc-publisher-v3/legacy-state-migration",
    version: 1,
    generatedAt,
    migratedRecordCount: state.records.length,
    unmanagedLegacyFileCount: unmanagedLegacyFiles.length,
    state,
    idempotencyPlan,
    migratedDocuments: migratedDocuments.sort((left, right) => `${left.brand}:${left.docId}`.localeCompare(`${right.brand}:${right.docId}`)),
    repairCandidates: repairCandidates.sort((left, right) => `${left.brand}:${left.docId}`.localeCompare(`${right.brand}:${right.docId}`)),
    unmanagedLegacyFiles: unmanagedLegacyFiles.sort((left, right) => `${left.brand}:${left.path}`.localeCompare(`${right.brand}:${right.path}`)),
    errors,
    warnings
  };
}

export function sanitizeLegacyMigrationSummary(result: LegacyStateMigrationResult): Omit<
  LegacyStateMigrationResult,
  "state" | "idempotencyPlan" | "migratedDocuments" | "repairCandidates" | "unmanagedLegacyFiles"
> & {
  idempotencyCounts: IncrementalPlan["counts"];
  migratedByBrand: Record<string, number>;
  repairCandidatesByBrand: Record<string, number>;
  repairCandidatesByReason: Record<string, number>;
  unmanagedByBrand: Record<string, number>;
} {
  return {
    schema: result.schema,
    version: result.version,
    generatedAt: result.generatedAt,
    migratedRecordCount: result.migratedRecordCount,
    unmanagedLegacyFileCount: result.unmanagedLegacyFileCount,
    idempotencyCounts: result.idempotencyPlan.counts,
    migratedByBrand: countBy(result.migratedDocuments.map((record) => record.brand)),
    repairCandidatesByBrand: countBy(result.repairCandidates.map((record) => record.brand)),
    repairCandidatesByReason: countBy(result.repairCandidates.map((record) => record.reason)),
    unmanagedByBrand: countBy(result.unmanagedLegacyFiles.map((record) => record.brand)),
    errors: result.errors.map(sanitizeIssue),
    warnings: result.warnings.map(sanitizeIssue)
  };
}

async function loadRepositoryContexts(inputs: LegacyRepositoryInput[]): Promise<Map<string, {
  repositoryRoot: string;
  legacyState: LegacyStateFile | undefined;
}>> {
  const contexts = new Map<string, { repositoryRoot: string; legacyState: LegacyStateFile | undefined }>();
  for (const input of inputs) {
    const brand = normalizeBrand(input.brand);
    const repositoryRoot = path.resolve(input.repositoryRoot);
    const stat = await fs.stat(repositoryRoot).catch(() => undefined);
    if (!stat?.isDirectory()) {
      throw new UserFacingError(`Deployed repository root for ${brand} does not exist or is not a directory.`);
    }
    const legacyStatePath = input.legacyStatePath ?? path.join(repositoryRoot, ".publisher_state.json");
    contexts.set(brand, {
      repositoryRoot,
      legacyState: await readOptionalLegacyState(legacyStatePath)
    });
  }
  return contexts;
}

async function proveDocumentOwnership(input: {
  document: DocumentModel;
  route: BrandRoute;
  repositoryRoot: string;
  legacyState: LegacyStateFile | undefined;
}): Promise<{
  htmlPath: string;
  pdfPath: string;
  ownedFiles: string[];
  provenance: string[];
  errors: LegacyMigrationIssue[];
  warnings: LegacyMigrationIssue[];
  existingPublicationProven: boolean;
  htmlStatus: "present" | "missing";
  pdfStatus: string;
}> {
  const brand = normalizeBrand(input.route.brand);
  const canonicalRelative = input.document.meta.canonicalPath.replace(/^\/+|\/+$/g, "");
  const deploymentRoot = input.route.deploymentRoot?.replace(/^\/+|\/+$/g, "") ?? "";
  const prefix = deploymentRoot ? `${deploymentRoot}/` : "";
  const htmlPath = normalizePublicPath(`${prefix}${canonicalRelative}/index.html`);
  const pdfPath = normalizePublicPath(`${prefix}${input.route.pdfPath ?? "pdf"}/${input.document.meta.docId}.pdf`);
  const errors: LegacyMigrationIssue[] = [];
  const warnings: LegacyMigrationIssue[] = [];
  const provenance: string[] = [];
  let htmlStatus: "present" | "missing" = "missing";
  let pdfStatus = "missing";

  if (!canonicalRelative || !isSafeRelativePublicPath(htmlPath) || !isSafeRelativePublicPath(pdfPath)) {
    errors.push(issue(brand, "UNSAFE_EXPECTED_PATH", "Expected document path is not safe.", input.document.meta.docId));
    return { htmlPath, pdfPath, ownedFiles: [], provenance, errors, warnings, existingPublicationProven: false, htmlStatus, pdfStatus };
  }

  const html = await readOwnedTextFile(input.repositoryRoot, htmlPath);
  if (!html) {
    warnings.push(issue(brand, "MISSING_DEPLOYED_HTML_CREATE_REQUIRED", "Expected deployed HTML route is missing; document will be treated as CREATE.", input.document.meta.docId));
  } else {
    htmlStatus = "present";
    provenance.push("exact-canonical-token-path");
    if (html.includes(input.document.meta.docId)) {
      provenance.push("html-metadata-doc-id");
    } else {
      warnings.push(issue(brand, "HTML_DOC_ID_NOT_FOUND", "Deployed HTML did not contain the expected DOC_ID metadata.", input.document.meta.docId));
    }
    const expectedPdfHref = `../../${input.route.pdfPath ?? "pdf"}/${input.document.meta.docId}.pdf`;
    if (html.includes(expectedPdfHref)) {
      provenance.push("html-pdf-link");
    } else {
      warnings.push(issue(brand, "HTML_PDF_LINK_NOT_FOUND", "Deployed HTML did not contain the expected same-brand PDF link.", input.document.meta.docId));
    }
  }

  const pdf = await inspectPdf(input.repositoryRoot, pdfPath);
  if (!pdf.ok) {
    pdfStatus = pdf.code;
    warnings.push(issue(brand, `${pdf.code}_CREATE_REQUIRED`, `${pdf.message} Document will be treated as CREATE.`, input.document.meta.docId));
  } else {
    pdfStatus = "present-valid";
    provenance.push("doc-id-pdf-path");
  }

  if (legacyStateMatches(input.legacyState, input.document)) {
    provenance.push("legacy-state-page-match");
  }

  const ownedFiles = [htmlPath, pdfPath];
  for (const asset of input.document.assets) {
    const candidate = normalizePublicPath(`${prefix}${asset.outputPath.replace(/^\/+/, "")}`);
    if (await isProvenDocumentAsset(input.repositoryRoot, candidate, canonicalRelative, input.document.meta.docId, prefix)) {
      ownedFiles.push(candidate);
      provenance.push("document-specific-asset-path");
    }
  }

  return {
    htmlPath,
    pdfPath,
    ownedFiles: [...new Set(ownedFiles)].sort(),
    provenance: [...new Set(provenance)].sort(),
    errors,
    warnings,
    existingPublicationProven: htmlStatus === "present" && pdfStatus === "present-valid",
    htmlStatus,
    pdfStatus
  };
}

async function readOptionalLegacyState(filePath: string): Promise<LegacyStateFile | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as LegacyStateFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readOwnedTextFile(root: string, relativePath: string): Promise<string | undefined> {
  if (!isSafeRelativePublicPath(relativePath)) {
    return undefined;
  }
  const filePath = path.resolve(root, relativePath);
  if (!isPathInsideRoot(filePath, root)) {
    return undefined;
  }
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function inspectPdf(root: string, relativePath: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!isSafeRelativePublicPath(relativePath)) {
    return { ok: false, code: "UNSAFE_PDF_PATH", message: "Expected PDF path is unsafe." };
  }
  const filePath = path.resolve(root, relativePath);
  if (!isPathInsideRoot(filePath, root)) {
    return { ok: false, code: "PDF_PATH_ESCAPES_REPOSITORY", message: "Expected PDF path escapes the deployed repository root." };
  }
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const stat = await handle.stat();
      const header = Buffer.alloc(5);
      await handle.read(header, 0, 5, 0);
      if (stat.size <= 256) {
        return { ok: false, code: "PDF_TOO_SMALL", message: "Expected PDF file is missing or too small." };
      }
      if (header.toString("utf8") !== "%PDF-") {
        return { ok: false, code: "PDF_HEADER_INVALID", message: "Expected PDF file does not have a valid PDF header." };
      }
      return { ok: true };
    } finally {
      await handle.close();
    }
  } catch {
    return { ok: false, code: "MISSING_DEPLOYED_PDF", message: "Expected deployed PDF is missing." };
  }
}

async function isProvenDocumentAsset(
  root: string,
  candidate: string,
  canonicalRelative: string,
  docId: string,
  deploymentPrefix: string
): Promise<boolean> {
  if (!isSafeRelativePublicPath(candidate)) {
    return false;
  }
  const allowedPrefixes = [
    normalizePublicPath(`${deploymentPrefix}${canonicalRelative}/assets/`),
    normalizePublicPath(`${deploymentPrefix}assets/docs/${docId}/`)
  ];
  if (!allowedPrefixes.some((prefix) => candidate.startsWith(prefix))) {
    return false;
  }
  const filePath = path.resolve(root, candidate);
  if (!isPathInsideRoot(filePath, root)) {
    return false;
  }
  const stat = await fs.stat(filePath).catch(() => undefined);
  return stat?.isFile() === true;
}

async function listFilesRelative(root: string): Promise<string[]> {
  const result: string[] = [];
  await walk(root, root, result);
  return result.sort();
}

async function walk(root: string, dir: string, result: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (!isPathInsideRoot(filePath, root)) {
      continue;
    }
    if (entry.isDirectory()) {
      await walk(root, filePath, result);
    } else if (entry.isFile()) {
      result.push(normalizePublicPath(path.relative(root, filePath)));
    }
  }
}

function isSiteOwnedFile(file: string, route: BrandRoute): boolean {
  const deploymentRoot = route.deploymentRoot?.replace(/^\/+|\/+$/g, "") ?? "";
  const prefix = deploymentRoot ? `${deploymentRoot}/` : "";
  const stripped = file.startsWith(prefix) ? file.slice(prefix.length) : file;
  if (deploymentRoot && !file.startsWith(prefix)) {
    return true;
  }
  if (stripped === "CNAME" || stripped === "index.html" || stripped === "robots.txt" || stripped === "sitemap.xml") {
    return true;
  }
  if (["register/index.html", "docs/index.html", "clients/index.html", "partners/index.html", "internal/index.html"].includes(stripped)) {
    return true;
  }
  if (stripped.startsWith("assets/css/") || /^assets\/[^/]+\.(ico|png|jpg|jpeg|svg|webp)$/.test(stripped)) {
    return true;
  }
  return false;
}

function legacyStateMatches(legacyState: LegacyStateFile | undefined, document: DocumentModel): boolean {
  const pages = legacyState?.pages;
  if (!pages || typeof pages !== "object" || Array.isArray(pages)) {
    return false;
  }
  const pageId = document.source.notionPageId;
  const docId = document.meta.docId;
  return Object.entries(pages).some(([key, value]) => key === pageId || key === docId || value === pageId || value === docId);
}

function normalizePublicPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function isPathInsideRoot(filePath: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function issue(brand: string, code: string, message: string, docId?: string): LegacyMigrationIssue {
  return { brand: normalizeBrand(brand), code, message, docId };
}

function sanitizeIssue(input: LegacyMigrationIssue): LegacyMigrationIssue {
  return {
    brand: input.brand,
    code: input.code,
    message: input.message
      .replace(/https?:\/\/[^\s"]+/g, "[redacted-url]")
      .replace(/[0-9a-f]{32}/gi, "[redacted-id]"),
    docId: input.docId
  };
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
