import fs from "node:fs/promises";
import path from "node:path";
import { UserFacingError, type AppConfig, type BrandProfile } from "../config.js";
import { isPrivateLinkVisibility, normalizeVisibility, type DocumentModel, type ValidationIssue } from "../model/document.js";
import { enableNotionReadOnlyMode } from "../notion/read-only-guard.js";
import { isPublishableCandidate, validateDocuments } from "../validate/validate.js";
import { buildRoutedSites, type RoutedBuildResult } from "./routed-build.js";
import { normalizeBrand, type BrandRoute } from "./brand-routing.js";
import { renderRoutedDocumentPdf, type RoutedPdfRenderer } from "./routed-pdf.js";

export type RoutedReadonlyAuditRecord = {
  pageId: string;
  title: string;
  docId: string;
  brand: string;
  canonicalPath: string;
  publish: boolean;
  status: string;
  visibility: string;
  routeBrand?: string;
  rejected: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type RoutedReadonlyAuditReport = {
  schema: "notion-doc-publisher-v3/routed-readonly-audit";
  version: 1;
  generatedAt: string;
  outputBaseRoot: string;
  loadedDocumentCount: number;
  publicManifestCount: number;
  records: RoutedReadonlyAuditRecord[];
};

export type RoutedReadonlyBuildResult = RoutedBuildResult & {
  auditReport: RoutedReadonlyAuditReport;
  auditReportPath: string;
};

export async function loadRoutedReadonlyConfigFromEnvironment(routes: BrandRoute[]): Promise<AppConfig> {
  const runtimeEnv = await readPermittedReadonlyRuntimeEnv();
  const notionToken = readRequiredRuntimeEnv(runtimeEnv, "NOTION_TOKEN");
  const notionDatabaseId = readRequiredRuntimeEnv(runtimeEnv, "NOTION_DATABASE_ID");
  const brandTokens = Object.fromEntries(routes.map((route) => {
    const brand = normalizeBrand(route.brand);
    return [brand, brand];
  }));

  return createReadOnlyRoutedConfig({
    notionToken,
    notionDatabaseId,
    targetSiteDomain: undefined,
    docIdYearMonth: currentYearMonth(),
    allowedVisibility: new Set(["Public"]),
    publishableStatuses: new Set(["Approved", "Published", "Final"]),
    allowedBrands: readAllowedBrandsFromEnvironment(runtimeEnv),
    brandTokens,
    documentTypeTokens: {
      Agreement: "AGR",
      Specification: "SPEC",
      Memo: "MEM",
      Proposal: "PROP",
      Report: "RPT",
      Guide: "GUIDE"
    },
    brandProfiles: await readCommittedBrandProfiles(),
    registerPublic: false,
    robotsDisallowDocs: false,
    allowMissingShareToken: false,
    legacyUnlistedDocsPath: false,
    autoGenerateShareToken: false,
    autoFillPrivateNamespace: false,
    autoFillPortalCategory: false,
    legacyPrivateDocIdUrls: false
  });
}

export async function buildRoutedReadonly(input: {
  config: AppConfig;
  routes: BrandRoute[];
  outputBaseRoot: string;
  loadDocuments: (config: AppConfig) => Promise<DocumentModel[]>;
  now?: () => string;
  pdfRenderer?: RoutedPdfRenderer;
}): Promise<RoutedReadonlyBuildResult> {
  const restoreReadOnly = enableNotionReadOnlyMode("build:routed:readonly");
  try {
    const config = createReadOnlyRoutedConfig(input.config);
    const documents = await input.loadDocuments(config);
    validateDocuments(documents, config);
    applyReadOnlyPersistedFieldRequirements(documents, config);

    const result = await buildRoutedSites({
      documents,
      routes: input.routes,
      config,
      outputBaseRoot: input.outputBaseRoot,
      now: input.now,
      prevalidated: true,
      pdfRenderer: input.pdfRenderer ?? renderRoutedDocumentPdf,
      redactPrivateManifestPaths: true
    });
    const auditReport = createReadonlyAuditReport(documents, input.routes, input.outputBaseRoot, result, input.now?.());
    const auditReportPath = path.join(input.outputBaseRoot, "_audit", "read-only-audit.json");
    await writeAuditReport(auditReportPath, auditReport);
    return { ...result, auditReport, auditReportPath };
  } finally {
    restoreReadOnly();
  }
}

export function createReadOnlyRoutedConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    allowMissingShareToken: false,
    autoGenerateShareToken: false,
    autoFillPrivateNamespace: false,
    autoFillPortalCategory: false,
    legacyPrivateDocIdUrls: false,
    legacyUnlistedDocsPath: false
  };
}

export function applyReadOnlyPersistedFieldRequirements(documents: DocumentModel[], config: AppConfig): void {
  for (const document of documents) {
    const shouldPublishByStatus = document.meta.publish && config.publishableStatuses.has(document.meta.status);
    const publishable = isPublishableCandidate(document, config);
    if (!shouldPublishByStatus && !publishable) {
      continue;
    }

    if (!document.meta.brand.label.trim()) {
      pushReadOnlyError(document, "READONLY_MISSING_BRAND", "Brand must already be set for routed readonly publishing.", "Brand");
    }
    if (!document.meta.visibility.trim()) {
      pushReadOnlyError(document, "READONLY_MISSING_VISIBILITY", "Visibility must already be set for routed readonly publishing.", "Visibility");
    }
    if (!document.meta.docId.trim()) {
      pushReadOnlyError(document, "READONLY_MISSING_DOC_ID", "DOC_ID must already be assigned before routed readonly publishing.", "DOC_ID");
    }

    if (isPrivateLinkVisibility(document.meta.visibility)) {
      if (!document.meta.shareToken.trim()) {
        pushReadOnlyError(
          document,
          "READONLY_MISSING_SHARE_TOKEN",
          "Share Token must already be set for private routed readonly publishing.",
          "Share Token"
        );
      }
      if (normalizeVisibility(document.meta.visibility) === "unlisted" && !document.meta.privateLinkNamespace.trim()) {
        pushReadOnlyError(
          document,
          "READONLY_MISSING_PRIVATE_LINK_NAMESPACE",
          "Private Link Namespace must already be set for Unlisted routed readonly publishing.",
          "Private Link Namespace"
        );
      }
    }
  }
}

function pushReadOnlyError(document: DocumentModel, code: string, message: string, pathValue: string): void {
  document.validation.errors.push({
    code,
    message,
    path: pathValue,
    docId: document.meta.docId,
    pageId: document.source.notionPageId
  });
  document.validation.ok = false;
}

function createReadonlyAuditReport(
  documents: DocumentModel[],
  routes: BrandRoute[],
  outputBaseRoot: string,
  result: RoutedBuildResult,
  now?: string
): RoutedReadonlyAuditReport {
  const routeBrands = new Set(routes.map((route) => normalizeBrand(route.brand)));
  const builtDocIds = new Set(result.manifests.flatMap((manifest) => manifest.documents.map((document) => document.docId)));
  return {
    schema: "notion-doc-publisher-v3/routed-readonly-audit",
    version: 1,
    generatedAt: now ?? new Date().toISOString(),
    outputBaseRoot: path.resolve(outputBaseRoot),
    loadedDocumentCount: documents.length,
    publicManifestCount: result.manifests.length,
    records: documents.map((document) => {
      const brand = normalizeBrand(document.meta.brand.label);
      return {
        pageId: document.source.notionPageId,
        title: document.meta.title,
        docId: document.meta.docId,
        brand,
        canonicalPath: document.meta.canonicalPath,
        publish: document.meta.publish,
        status: document.meta.status,
        visibility: document.meta.visibility,
        routeBrand: routeBrands.has(brand) ? brand : undefined,
        rejected: document.validation.errors.length > 0 || (document.meta.docId ? !builtDocIds.has(document.meta.docId) : true),
        errors: document.validation.errors,
        warnings: document.validation.warnings
      };
    })
  };
}

async function writeAuditReport(filePath: string, report: RoutedReadonlyAuditReport): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function readPermittedReadonlyRuntimeEnv(): Promise<Record<"NOTION_TOKEN" | "NOTION_DATABASE_ID" | "ALLOWED_BRANDS", string | undefined>> {
  return {
    NOTION_TOKEN: process.env.NOTION_TOKEN ?? await readAllowedDotEnvValue("NOTION_TOKEN"),
    NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID ?? await readAllowedDotEnvValue("NOTION_DATABASE_ID"),
    ALLOWED_BRANDS: process.env.ALLOWED_BRANDS ?? await readAllowedDotEnvValue("ALLOWED_BRANDS")
  };
}

function readRequiredRuntimeEnv(
  runtimeEnv: Record<"NOTION_TOKEN" | "NOTION_DATABASE_ID" | "ALLOWED_BRANDS", string | undefined>,
  name: "NOTION_TOKEN" | "NOTION_DATABASE_ID"
): string {
  const value = runtimeEnv[name]?.trim();
  if (!value) {
    throw new UserFacingError(`Missing required environment variable ${name}.`);
  }
  return value;
}

function readAllowedBrandsFromEnvironment(
  runtimeEnv: Record<"NOTION_TOKEN" | "NOTION_DATABASE_ID" | "ALLOWED_BRANDS", string | undefined>
): Set<string> | null {
  const raw = runtimeEnv.ALLOWED_BRANDS?.trim();
  if (!raw) {
    return null;
  }
  const brands = raw
    .split(",")
    .map((brand) => normalizeBrand(brand))
    .filter(Boolean);
  return brands.length > 0 ? new Set(brands) : null;
}

async function readAllowedDotEnvValue(name: "NOTION_TOKEN" | "NOTION_DATABASE_ID" | "ALLOWED_BRANDS"): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.resolve(".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const equals = trimmed.indexOf("=");
      if (equals === -1) {
        continue;
      }
      const key = trimmed.slice(0, equals).trim();
      if (key !== name) {
        continue;
      }
      return trimmed.slice(equals + 1).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function readCommittedBrandProfiles(): Promise<Record<string, BrandProfile>> {
  try {
    const raw = await fs.readFile(path.resolve("config", "brands.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, BrandProfile> = {};
    for (const [brand, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const profile = value as Record<string, unknown>;
      result[brand] = {
        displayName: typeof profile.displayName === "string" ? profile.displayName : brand,
        tagline: typeof profile.tagline === "string" ? profile.tagline : "",
        shareImage: typeof profile.shareImage === "string" ? profile.shareImage : undefined
      };
    }
    return result;
  } catch {
    return {};
  }
}

function currentYearMonth(): string {
  const now = new Date();
  return `${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
