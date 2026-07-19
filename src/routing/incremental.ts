import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { UserFacingError, type AppConfig, type BrandProfile } from "../config.js";
import type { DocumentAsset, DocumentBlock, DocumentModel } from "../model/document.js";
import { isPublishableCandidate } from "../validate/validate.js";
import {
  computeBrandCanonicalUrl,
  isSafeRelativePublicPath,
  normalizeBrand,
  type BrandRoute
} from "./brand-routing.js";

export type LifecycleAction = "CREATE" | "UPDATE" | "MOVE" | "REMOVE" | "NOOP" | "INVALID" | "FILTERED";

export type DocumentStateRecord = {
  pageId: string;
  docId: string;
  brand: string;
  visibility: string;
  namespace: string;
  shareToken: string;
  canonicalOrigin: string;
  pathPrefix: string;
  canonicalPath: string;
  finalUrl: string;
  deploymentTarget: string;
  deploymentRoot: string;
  ownedFiles: string[];
  contentHash: string;
  routingHash: string;
  rendererHash: string;
  assetHash: string;
  desiredStateHash: string;
  pdfRequired: boolean;
  publishedAt: string;
};

export type IncrementalStateManifest = {
  schema: "notion-doc-publisher-v3/incremental-state";
  version: 1;
  generatedAt: string;
  records: DocumentStateRecord[];
};

export type DesiredDocumentState = Omit<DocumentStateRecord, "publishedAt">;

export type IncrementalPlanRecord = {
  action: LifecycleAction;
  reason: string;
  brand: string;
  pageId: string;
  docId: string;
  previous?: DocumentStateRecord;
  desired?: DesiredDocumentState;
  errors: string[];
};

export type IncrementalPlan = {
  schema: "notion-doc-publisher-v3/incremental-plan";
  version: 1;
  generatedAt: string;
  counts: Record<LifecycleAction, number>;
  records: IncrementalPlanRecord[];
};

export type RendererFingerprintInput = {
  templateVersion: string;
  htmlRendererVersion: string;
  pdfRendererVersion: string;
  cssVersion: string;
  brandProfile: BrandProfile | undefined;
  route: BrandRoute;
};

export type RendererFingerprintResolver = (input: RendererFingerprintInput) => string;

export function createIncrementalPlan(input: {
  documents: DocumentModel[];
  routes: BrandRoute[];
  config: AppConfig;
  previousState?: IncrementalStateManifest;
  now?: string;
  rendererHash?: RendererFingerprintResolver;
  pdfRequired?: boolean;
}): IncrementalPlan {
  const routeByBrand = new Map(input.routes.map((route) => [normalizeBrand(route.brand), route]));
  const previousByPageId = new Map((input.previousState?.records ?? []).map((record) => [record.pageId, record]));
  const records: IncrementalPlanRecord[] = [];
  const seenPageIds = new Set<string>();

  for (const document of input.documents) {
    const pageId = document.source.notionPageId;
    const previous = previousByPageId.get(pageId);
    if (seenPageIds.has(pageId)) {
      records.push(invalidRecord(document, previous, "DUPLICATE_NOTION_PAGE"));
      continue;
    }
    seenPageIds.add(pageId);

    const brand = normalizeBrand(document.meta.brand.label);
    const route = brand ? routeByBrand.get(brand) : undefined;
    const publishable = isPublishableCandidate(document, input.config);

    if (!document.meta.publish) {
      records.push(previous
        ? removeRecord(document, previous)
        : filteredRecord(document, "PUBLISH_UNCHECKED_NEVER_PUBLISHED"));
      continue;
    }

    if (!brand || !route) {
      records.push(invalidRecord(document, previous, brand ? "UNKNOWN_BRAND" : "MISSING_BRAND"));
      continue;
    }

    if (!publishable) {
      records.push(previous
        ? filteredRecord(document, "PUBLISHABLE_FILTER_EXCLUDED", previous)
        : filteredRecord(document, "PUBLISHABLE_FILTER_EXCLUDED"));
      continue;
    }

    if (document.validation.errors.length > 0) {
      records.push(invalidRecord(document, previous, "VALIDATION_FAILED"));
      continue;
    }

    let desired: DesiredDocumentState;
    try {
      desired = createDesiredDocumentState({
        document,
        route,
        config: input.config,
        rendererHash: input.rendererHash,
        pdfRequired: input.pdfRequired ?? true
      });
    } catch (error) {
      records.push(invalidRecord(document, previous, sanitizeReason(error)));
      continue;
    }

    if (!previous) {
      records.push({ action: "CREATE", reason: "NO_PREVIOUS_SUCCESSFUL_STATE", brand, pageId, docId: document.meta.docId, desired, errors: [] });
      continue;
    }

    if (previous.routingHash !== desired.routingHash) {
      records.push({ action: "MOVE", reason: "ROUTING_CHANGED", brand, pageId, docId: document.meta.docId, previous, desired, errors: [] });
      continue;
    }

    if (
      previous.contentHash !== desired.contentHash ||
      previous.rendererHash !== desired.rendererHash ||
      previous.assetHash !== desired.assetHash ||
      previous.desiredStateHash !== desired.desiredStateHash
    ) {
      records.push({ action: "UPDATE", reason: "OUTPUT_RELEVANT_HASH_CHANGED", brand, pageId, docId: document.meta.docId, previous, desired, errors: [] });
      continue;
    }

    records.push({ action: "NOOP", reason: "STATE_UNCHANGED", brand, pageId, docId: document.meta.docId, previous, desired, errors: [] });
  }

  return {
    schema: "notion-doc-publisher-v3/incremental-plan",
    version: 1,
    generatedAt: input.now ?? new Date().toISOString(),
    counts: countActions(records),
    records
  };
}

export function createDesiredDocumentState(input: {
  document: DocumentModel;
  route: BrandRoute;
  config: AppConfig;
  rendererHash?: RendererFingerprintResolver;
  pdfRequired?: boolean;
  ownedFilesOverride?: string[];
}): DesiredDocumentState {
  const document = input.document;
  const route = input.route;
  const brand = normalizeBrand(route.brand);
  const finalUrl = computeBrandCanonicalUrl({
    routes: [route],
    brandLabel: document.meta.brand.label,
    canonicalPath: document.meta.canonicalPath,
    docId: document.meta.docId
  });
  const namespace = canonicalNamespace(document.meta.canonicalPath);
  if (!namespace) {
    throw new UserFacingError("CANONICAL_NAMESPACE_MISSING");
  }

  const contentHash = hashStable({
    title: document.meta.title,
    brand: document.meta.brand.label,
    documentType: document.meta.documentType.label,
    client: document.meta.client.label,
    project: document.meta.project.label,
    category: document.meta.category,
    portalCategory: document.meta.portalCategory,
    version: document.meta.version,
    status: document.meta.status,
    visibility: document.meta.visibility,
    body: normalizeBlocks(document.content)
  });
  const routingHash = hashStable({
    brand,
    origin: route.targetDomain,
    pathPrefix: route.pathPrefix ?? "",
    visibility: document.meta.visibility,
    namespace,
    shareToken: document.meta.shareToken,
    canonicalPath: document.meta.canonicalPath,
    deploymentTarget: route.targetRepository,
    deploymentRoot: route.deploymentRoot ?? ""
  });
  const assetHash = hashStable(normalizeAssets(document.assets));
  const rendererHash = input.rendererHash
    ? input.rendererHash({
        templateVersion: "enterprise-html-v1",
        htmlRendererVersion: "render-html-v1",
        pdfRendererVersion: "typst-pdf-v1",
        cssVersion: "screen-print-css-v1",
        brandProfile: route.presentationProfileKey ? input.config.brandProfiles[route.presentationProfileKey] : undefined,
        route
      })
    : defaultRendererHash(route, input.config);
  const ownedFiles = input.ownedFilesOverride
    ? uniqueSafeOwnedFiles(input.ownedFilesOverride)
    : ownedFilesForDocument(document, route);
  const desiredStateHash = hashStable({ contentHash, routingHash, rendererHash, assetHash, ownedFiles });

  return {
    pageId: document.source.notionPageId,
    docId: document.meta.docId,
    brand,
    visibility: document.meta.visibility,
    namespace,
    shareToken: document.meta.shareToken,
    canonicalOrigin: route.targetDomain,
    pathPrefix: route.pathPrefix ?? "",
    canonicalPath: document.meta.canonicalPath,
    finalUrl,
    deploymentTarget: route.targetRepository ?? "",
    deploymentRoot: route.deploymentRoot ?? "",
    ownedFiles,
    contentHash,
    routingHash,
    rendererHash,
    assetHash,
    desiredStateHash,
    pdfRequired: input.pdfRequired ?? true
  };
}

export function documentsToRender(plan: IncrementalPlan): IncrementalPlanRecord[] {
  return plan.records.filter((record) => record.action === "CREATE" || record.action === "UPDATE" || record.action === "MOVE");
}

export function documentsToRemove(plan: IncrementalPlan): IncrementalPlanRecord[] {
  return plan.records.filter((record) => record.action === "REMOVE");
}

export function committedStateAfterSuccessfulPlan(input: {
  previousState?: IncrementalStateManifest;
  plan: IncrementalPlan;
  deployedAt?: string;
}): IncrementalStateManifest {
  const deployedAt = input.deployedAt ?? new Date().toISOString();
  const next = new Map((input.previousState?.records ?? []).map((record) => [record.pageId, record]));
  for (const record of input.plan.records) {
    if ((record.action === "CREATE" || record.action === "UPDATE" || record.action === "MOVE" || record.action === "NOOP") && record.desired) {
      next.set(record.pageId, { ...record.desired, publishedAt: record.previous?.publishedAt ?? deployedAt });
    }
    if (record.action === "REMOVE" && record.previous) {
      next.delete(record.pageId);
    }
  }
  return {
    schema: "notion-doc-publisher-v3/incremental-state",
    version: 1,
    generatedAt: deployedAt,
    records: [...next.values()].sort((left, right) => left.pageId.localeCompare(right.pageId))
  };
}

export function deletionPlanForRecord(record: IncrementalPlanRecord, route: BrandRoute): string[] {
  if (record.action !== "REMOVE" && record.action !== "MOVE") {
    return [];
  }
  const previous = record.previous;
  if (!previous) {
    return [];
  }
  const brand = normalizeBrand(route.brand);
  if (normalizeBrand(previous.brand) !== brand) {
    throw new UserFacingError("Cross-brand deletion is blocked.");
  }
  const deploymentRoot = route.deploymentRoot ?? "";
  const allowedPrefix = deploymentRoot ? `${deploymentRoot.replace(/^\/+|\/+$/g, "")}/` : "";
  return previous.ownedFiles.map((file) => {
    if (!isSafeRelativePublicPath(file)) {
      throw new UserFacingError(`Unsafe manifest-owned deletion path is blocked: ${file}`);
    }
    if (allowedPrefix && !file.startsWith(allowedPrefix)) {
      throw new UserFacingError(`Deletion outside publisher-owned deployment root is blocked: ${file}`);
    }
    if (file === "CNAME" || file.startsWith("gong-vi/") || file === "index.html") {
      throw new UserFacingError(`Deletion of protected shared path is blocked: ${file}`);
    }
    return file;
  });
}

export async function removeManifestOwnedFiles(input: {
  repositoryRoot: string;
  files: string[];
  protectedPrefixes?: string[];
}): Promise<string[]> {
  const root = path.resolve(input.repositoryRoot);
  const removed: string[] = [];
  for (const file of input.files) {
    if (!isSafeRelativePublicPath(file)) {
      throw new UserFacingError(`Unsafe deletion path is blocked: ${file}`);
    }
    if (input.protectedPrefixes?.some((prefix) => file === prefix || file.startsWith(`${prefix.replace(/\/+$/, "")}/`))) {
      throw new UserFacingError(`Deletion of protected path is blocked: ${file}`);
    }
    const target = path.resolve(root, file);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new UserFacingError(`Deletion path escapes repository root: ${file}`);
    }
    await fs.rm(target, { force: true });
    removed.push(file);
  }
  return removed;
}

function ownedFilesForDocument(document: DocumentModel, route: BrandRoute): string[] {
  const deploymentRoot = route.deploymentRoot?.replace(/^\/+|\/+$/g, "") ?? "";
  const canonicalRelative = document.meta.canonicalPath.replace(/^\/+|\/+$/g, "");
  const prefix = deploymentRoot ? `${deploymentRoot}/` : "";
  const files = [
    `${prefix}${canonicalRelative}/index.html`,
    `${prefix}${route.pdfPath ?? "pdf"}/${document.meta.docId}.pdf`
  ];
  for (const asset of document.assets) {
    if (asset.outputPath && !asset.outputPath.startsWith("../")) {
      files.push(`${prefix}${asset.outputPath.replace(/^\/+/, "")}`);
    }
  }
  return [...new Set(files.map((file) => file.replace(/\\/g, "/")))].sort();
}

function uniqueSafeOwnedFiles(files: string[]): string[] {
  const unique = [...new Set(files.map((file) => file.replace(/\\/g, "/")))].sort();
  for (const file of unique) {
    if (!isSafeRelativePublicPath(file)) {
      throw new UserFacingError(`Unsafe manifest-owned file path is blocked: ${file}`);
    }
  }
  return unique;
}

function removeRecord(document: DocumentModel, previous: DocumentStateRecord): IncrementalPlanRecord {
  return {
    action: "REMOVE",
    reason: "PUBLISH_UNCHECKED_PREVIOUSLY_LIVE",
    brand: normalizeBrand(previous.brand),
    pageId: document.source.notionPageId,
    docId: document.meta.docId || previous.docId,
    previous,
    errors: []
  };
}

function filteredRecord(document: DocumentModel, reason: string, previous?: DocumentStateRecord): IncrementalPlanRecord {
  return {
    action: "FILTERED",
    reason,
    brand: normalizeBrand(document.meta.brand.label) || normalizeBrand(previous?.brand ?? ""),
    pageId: document.source.notionPageId,
    docId: document.meta.docId,
    previous,
    errors: []
  };
}

function invalidRecord(document: DocumentModel, previous: DocumentStateRecord | undefined, reason: string): IncrementalPlanRecord {
  return {
    action: "INVALID",
    reason,
    brand: normalizeBrand(document.meta.brand.label) || normalizeBrand(previous?.brand ?? ""),
    pageId: document.source.notionPageId,
    docId: document.meta.docId,
    previous,
    errors: document.validation.errors.map((error) => error.code)
  };
}

function canonicalNamespace(canonicalPath: string): string | undefined {
  return canonicalPath.replace(/^\/+/, "").split("/").filter(Boolean)[0];
}

function normalizeBlocks(blocks: DocumentBlock[]): unknown {
  return blocks.map((block) => {
    if ("id" in block) {
      const copy = structuredClone(block) as Record<string, unknown>;
      delete copy.id;
      return copy;
    }
    return block;
  });
}

function normalizeAssets(assets: DocumentAsset[]): unknown {
  return assets.map((asset) => ({
    sourceUrl: asset.sourceUrl,
    outputPath: asset.outputPath,
    kind: asset.kind,
    notionBlockId: asset.notionBlockId,
    alt: asset.alt,
    caption: asset.caption,
    contentType: asset.contentType
  })).sort((left, right) => `${left.kind}:${left.sourceUrl}:${left.outputPath}`.localeCompare(`${right.kind}:${right.sourceUrl}:${right.outputPath}`));
}

function defaultRendererHash(route: BrandRoute, config: AppConfig): string {
  const profile = route.presentationProfileKey ? config.brandProfiles[route.presentationProfileKey] : undefined;
  return hashStable({
    templateVersion: "enterprise-html-v1",
    htmlRendererVersion: "render-html-v1",
    pdfRendererVersion: "typst-pdf-v1",
    cssVersion: "screen-print-css-v1",
    route: {
      brand: normalizeBrand(route.brand),
      presentationProfileKey: route.presentationProfileKey,
      pathPrefix: route.pathPrefix ?? "",
      pdfPath: route.pdfPath ?? "pdf"
    },
    profile
  });
}

function countActions(records: IncrementalPlanRecord[]): Record<LifecycleAction, number> {
  const counts: Record<LifecycleAction, number> = {
    CREATE: 0,
    UPDATE: 0,
    MOVE: 0,
    REMOVE: 0,
    NOOP: 0,
    INVALID: 0,
    FILTERED: 0
  };
  for (const record of records) {
    counts[record.action] += 1;
  }
  return counts;
}

function hashStable(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function sanitizeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s"]+/g, "[redacted-url]")
    .replace(/[0-9a-f]{32}/gi, "[redacted-id]")
    .slice(0, 160);
}
