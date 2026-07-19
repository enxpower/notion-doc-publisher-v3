import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import {
  isPrivateLinkVisibility,
  normalizeVisibility,
  type DocumentModel,
  type ValidationIssue
} from "../model/document.js";
import { enableNotionReadOnlyMode } from "../notion/read-only-guard.js";
import { isPublishableCandidate, validateDocuments } from "../validate/validate.js";
import { normalizeBrand, type BrandRoute } from "./brand-routing.js";
import { applyReadOnlyPersistedFieldRequirements, createReadOnlyRoutedConfig } from "./routed-readonly.js";

export type DiagnosticCollisionType =
  | "identical_doc_id"
  | "identical_share_token"
  | "same_token_different_namespaces"
  | "identical_canonical_path"
  | "namespace_path_normalization_collision"
  | "case_insensitive_collision"
  | "trailing_slash_or_url_normalization_collision"
  | "public_private_path_collision"
  | "duplicated_record_same_document"
  | "another_identifiable_cause";

export type DiagnosticCollisionScope = "doc_id" | "share_token" | "output_path";

export type DiagnosticRecordRef = {
  alias: string;
  normalizedBrand: string;
  visibilityClass: string;
  namespaceClass: string;
  docIdFingerprint: string | null;
  shareTokenFingerprint: string | null;
  canonicalPathFingerprint: string | null;
  currentlyPublishable: boolean;
  blockedByValidation: boolean;
};

export type DiagnosticCollisionGroup = {
  alias: string;
  scope: DiagnosticCollisionScope;
  collisionType: DiagnosticCollisionType;
  collisionTypes: DiagnosticCollisionType[];
  recordCount: number;
  records: DiagnosticRecordRef[];
  recommendedOwnerAction: string;
  wouldChangeExistingPublishedUrl: boolean;
};

export type MissingShareTokenRecord = {
  alias: string;
  normalizedBrand: string;
  visibilityClass: string;
  requiredNamespace: string;
  publishStatus: string;
  tokenRequiredByCanonicalPathRules: boolean;
  draftOrNonpublishable: boolean;
  blockedByAnotherIssue: boolean;
  wouldCreateNewUrl: boolean;
  mayConflictWithExistingTokenOrPath: boolean;
  remediationCategory: RemediationCategory;
  docIdFingerprint: string | null;
  canonicalPathFingerprint: string | null;
};

export type RemediationCategory =
  | "no_action_required"
  | "owner_review_required"
  | "safe_future_auto_fill_candidate"
  | "manual_doc_id_correction_required"
  | "url_breaking_change_risk"
  | "duplicate_record_cleanup_candidate"
  | "false_positive_validation_candidate"
  | "future_owner_approved_notion_mutation_required";

export type MissingShareTokenDiagnostics = {
  total: number;
  byBrand: Record<string, number>;
  byVisibility: Record<string, number>;
  byRequiredNamespace: Record<string, number>;
  byPublishStatus: Record<string, number>;
  publishableImmediateRemediationCount: number;
  nonpublishableDraftOnlyCount: number;
  falsePositiveCandidateCount: number;
  blockedByAnotherIssueCount: number;
  futureOwnerMutationRequiredCount: number;
  urlBreakingRiskCount: number;
  records: MissingShareTokenRecord[];
};

export type RemediationPlan = Record<RemediationCategory, number>;

export type RoutedReadonlyDiagnosticReport = {
  schema: "notion-doc-publisher-v3/routed-readonly-diagnostics";
  version: 1;
  generatedAt: string;
  loadedDocumentCount: number;
  publishableCandidateCount: number;
  routeBrands: string[];
  collisionSummary: {
    totalGroups: number;
    outputPathGroups: number;
    docIdGroups: number;
    shareTokenGroups: number;
    outputPathValidationIssueCount: number;
    byType: Record<string, number>;
  };
  collisions: DiagnosticCollisionGroup[];
  missingShareTokens: MissingShareTokenDiagnostics;
  remediationPlan: RemediationPlan;
};

export type DiagnosticCorrelationReport = {
  schema: "notion-doc-publisher-v3/routed-readonly-diagnostic-correlation";
  version: 1;
  generatedAt: string;
  records: Array<{
    alias: string;
    pageId: string;
  }>;
};

export type RoutedReadonlyDiagnosticResult = {
  report: RoutedReadonlyDiagnosticReport;
  correlationReport: DiagnosticCorrelationReport;
  reportPath: string;
  correlationPath: string;
};

type InternalDiagnosticRecord = {
  document: DocumentModel;
  index: number;
  normalizedBrand: string;
  visibilityClass: string;
  namespaceClass: string;
  docId: string;
  shareToken: string;
  canonicalPath: string;
  normalizedCanonicalPath: string;
  publishableCandidate: boolean;
  blockedByValidation: boolean;
};

type CollisionCandidateGroup = {
  scope: DiagnosticCollisionScope;
  key: string;
  records: InternalDiagnosticRecord[];
};

const REPORT_SCHEMA = "notion-doc-publisher-v3/routed-readonly-diagnostics";
const CORRELATION_SCHEMA = "notion-doc-publisher-v3/routed-readonly-diagnostic-correlation";

export async function runRoutedReadonlyDiagnostics(input: {
  config: AppConfig;
  routes: BrandRoute[];
  outputRoot: string;
  loadDocuments: (config: AppConfig) => Promise<DocumentModel[]>;
  now?: () => string;
  salt?: string;
}): Promise<RoutedReadonlyDiagnosticResult> {
  const restoreReadOnly = enableNotionReadOnlyMode("diagnose:routed:readonly");
  try {
    const config = createReadOnlyRoutedConfig(input.config);
    const documents = await input.loadDocuments(config);
    validateDocuments(documents, config);
    applyReadOnlyPersistedFieldRequirements(documents, config);

    const generatedAt = input.now?.() ?? new Date().toISOString();
    const salt = input.salt ?? crypto.randomBytes(24).toString("hex");
    const report = analyzeRoutedReadonlyDiagnostics({
      documents,
      config,
      routes: input.routes,
      generatedAt,
      salt
    });
    const correlationReport = createCorrelationReport(documents, config, generatedAt);
    const reportPath = path.join(input.outputRoot, "diagnostics-summary.json");
    const correlationPath = path.join(input.outputRoot, "_private", "correlation.json");

    await writeJson(reportPath, report);
    await writeJson(correlationPath, correlationReport);
    return { report, correlationReport, reportPath, correlationPath };
  } finally {
    restoreReadOnly();
  }
}

export function analyzeRoutedReadonlyDiagnostics(input: {
  documents: DocumentModel[];
  config: AppConfig;
  routes: BrandRoute[];
  generatedAt: string;
  salt: string;
}): RoutedReadonlyDiagnosticReport {
  const records = input.documents.map((document, index): InternalDiagnosticRecord => ({
    document,
    index,
    normalizedBrand: normalizeBrand(document.meta.brand.label),
    visibilityClass: visibilityClass(document),
    namespaceClass: namespaceClass(document),
    docId: document.meta.docId.trim(),
    shareToken: document.meta.shareToken.trim(),
    canonicalPath: document.meta.canonicalPath.trim(),
    normalizedCanonicalPath: normalizeDiagnosticPath(document.meta.canonicalPath),
    publishableCandidate: isPublishableCandidate(document, input.config),
    blockedByValidation: document.validation.errors.length > 0
  }));

  const collisions = buildCollisionGroups(records, input.salt);
  const missingShareTokens = buildMissingShareTokenDiagnostics(records, input.salt);
  const remediationPlan = buildRemediationPlan(collisions, missingShareTokens);
  const byType: Record<string, number> = {};
  for (const group of collisions) {
    byType[group.collisionType] = (byType[group.collisionType] ?? 0) + 1;
  }

  return {
    schema: REPORT_SCHEMA,
    version: 1,
    generatedAt: input.generatedAt,
    loadedDocumentCount: input.documents.length,
    publishableCandidateCount: records.filter((record) => record.publishableCandidate).length,
    routeBrands: input.routes.map((route) => normalizeBrand(route.brand)).filter(Boolean).sort(),
    collisionSummary: {
      totalGroups: collisions.length,
      outputPathGroups: collisions.filter((group) => group.scope === "output_path").length,
      docIdGroups: collisions.filter((group) => group.scope === "doc_id").length,
      shareTokenGroups: collisions.filter((group) => group.scope === "share_token").length,
      outputPathValidationIssueCount: countValidationIssues(input.documents, "OUTPUT_PATH_COLLISION"),
      byType
    },
    collisions,
    missingShareTokens,
    remediationPlan
  };
}

function buildCollisionGroups(records: InternalDiagnosticRecord[], salt: string): DiagnosticCollisionGroup[] {
  const groups = collisionCandidateGroups(records);
  let index = 0;
  return groups
    .map((group) => {
      index += 1;
      const collisionTypes = classifyCollision(group.records);
      const collisionType = primaryCollisionType(group.scope, collisionTypes);
      const alias = `COLLISION-${String(index).padStart(3, "0")}`;
      return {
        alias,
        scope: group.scope,
        collisionType,
        collisionTypes,
        recordCount: group.records.length,
        records: group.records.map((record, recordIndex) => sanitizedRecordRef(record, salt, `${alias}-${letter(recordIndex)}`)),
        recommendedOwnerAction: recommendedCollisionAction(collisionType),
        wouldChangeExistingPublishedUrl: group.records.some((record) => Boolean(record.canonicalPath))
      };
    });
}

function buildMissingShareTokenDiagnostics(records: InternalDiagnosticRecord[], salt: string): MissingShareTokenDiagnostics {
  const tokenRecords = records.filter((record) => isPrivateLinkVisibility(record.document.meta.visibility) && !record.shareToken);
  const diagnostics = tokenRecords.map((record, index): MissingShareTokenRecord => {
    const otherBlockingIssues = blockingIssuesExcludingMissingToken(record.document.validation.errors);
    const tokenRequired = Boolean(record.docId && isPrivateLinkVisibility(record.document.meta.visibility));
    const draftOrNonpublishable = !record.publishableCandidate;
    const blockedByAnotherIssue = otherBlockingIssues.length > 0;
    const wouldCreateNewUrl = tokenRequired && !record.canonicalPath;
    const urlBreakingRisk = tokenRequired && Boolean(record.canonicalPath);
    return {
      alias: `TOKEN-${String(index + 1).padStart(3, "0")}`,
      normalizedBrand: record.normalizedBrand || "UNKNOWN",
      visibilityClass: record.visibilityClass,
      requiredNamespace: record.namespaceClass,
      publishStatus: publishStatusClass(record),
      tokenRequiredByCanonicalPathRules: tokenRequired,
      draftOrNonpublishable,
      blockedByAnotherIssue,
      wouldCreateNewUrl,
      mayConflictWithExistingTokenOrPath: false,
      remediationCategory: missingTokenRemediationCategory({
        tokenRequired,
        draftOrNonpublishable,
        blockedByAnotherIssue,
        urlBreakingRisk
      }),
      docIdFingerprint: fingerprint(record.docId, salt),
      canonicalPathFingerprint: fingerprint(record.canonicalPath, salt)
    };
  });

  return {
    total: diagnostics.length,
    byBrand: countBy(diagnostics, (record) => record.normalizedBrand),
    byVisibility: countBy(diagnostics, (record) => record.visibilityClass),
    byRequiredNamespace: countBy(diagnostics, (record) => record.requiredNamespace),
    byPublishStatus: countBy(diagnostics, (record) => record.publishStatus),
    publishableImmediateRemediationCount: diagnostics.filter((record) => !record.draftOrNonpublishable && !record.blockedByAnotherIssue && record.tokenRequiredByCanonicalPathRules).length,
    nonpublishableDraftOnlyCount: diagnostics.filter((record) => record.draftOrNonpublishable).length,
    falsePositiveCandidateCount: diagnostics.filter((record) => !record.tokenRequiredByCanonicalPathRules).length,
    blockedByAnotherIssueCount: diagnostics.filter((record) => record.blockedByAnotherIssue).length,
    futureOwnerMutationRequiredCount: diagnostics.filter((record) => record.remediationCategory === "future_owner_approved_notion_mutation_required").length,
    urlBreakingRiskCount: diagnostics.filter((record) => record.remediationCategory === "url_breaking_change_risk").length,
    records: diagnostics
  };
}

function collisionCandidateGroups(records: InternalDiagnosticRecord[]): CollisionCandidateGroup[] {
  const groups: CollisionCandidateGroup[] = [];
  groups.push(...groupBy(records.filter((record) => record.docId), "doc_id", (record) => record.docId.toUpperCase()));
  groups.push(...groupBy(records.filter((record) => record.shareToken), "share_token", shareTokenNamespaceKey));
  groups.push(...groupByDifferentNamespaceTokens(records.filter((record) => record.shareToken)));
  groups.push(...groupBy(records.filter((record) => record.normalizedCanonicalPath), "output_path", (record) => record.normalizedCanonicalPath));

  const seen = new Set<string>();
  return groups
    .filter((group) => group.records.length > 1)
    .filter((group) => {
      const signature = `${group.scope}:${group.key}:${group.records.map((record) => record.index).sort((a, b) => a - b).join(",")}`;
      if (seen.has(signature)) {
        return false;
      }
      seen.add(signature);
      return true;
    });
}

function buildRemediationPlan(
  collisions: DiagnosticCollisionGroup[],
  missingShareTokens: MissingShareTokenDiagnostics
): RemediationPlan {
  const plan = emptyRemediationPlan();
  for (const group of collisions) {
    if (group.collisionTypes.includes("duplicated_record_same_document")) {
      plan.duplicate_record_cleanup_candidate += group.recordCount;
    } else if (group.collisionTypes.includes("identical_doc_id")) {
      plan.manual_doc_id_correction_required += group.recordCount;
    } else {
      plan.owner_review_required += group.recordCount;
    }
    if (group.wouldChangeExistingPublishedUrl) {
      plan.url_breaking_change_risk += group.recordCount;
    }
  }
  for (const record of missingShareTokens.records) {
    plan[record.remediationCategory] += 1;
  }
  return plan;
}

function emptyRemediationPlan(): RemediationPlan {
  return {
    no_action_required: 0,
    owner_review_required: 0,
    safe_future_auto_fill_candidate: 0,
    manual_doc_id_correction_required: 0,
    url_breaking_change_risk: 0,
    duplicate_record_cleanup_candidate: 0,
    false_positive_validation_candidate: 0,
    future_owner_approved_notion_mutation_required: 0
  };
}

function groupBy(
  records: InternalDiagnosticRecord[],
  scope: DiagnosticCollisionScope,
  keyForRecord: (record: InternalDiagnosticRecord) => string
): CollisionCandidateGroup[] {
  const groups = new Map<string, InternalDiagnosticRecord[]>();
  for (const record of records) {
    const key = keyForRecord(record);
    if (!key) {
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, groupedRecords]) => ({ scope, key, records: groupedRecords }));
}

function groupByDifferentNamespaceTokens(records: InternalDiagnosticRecord[]): CollisionCandidateGroup[] {
  return groupBy(records, "share_token", (record) => record.shareToken.toLowerCase())
    .filter((group) => new Set(group.records.map((record) => record.namespaceClass)).size > 1)
    .map((group) => ({ ...group, key: `cross-namespace:${group.key}` }));
}

function classifyCollision(records: InternalDiagnosticRecord[]): DiagnosticCollisionType[] {
  const types: DiagnosticCollisionType[] = [];
  const docIds = uniqueNonEmpty(records.map((record) => record.docId.toUpperCase()));
  const shareTokens = uniqueNonEmpty(records.map((record) => record.shareToken.toLowerCase()));
  const namespaces = uniqueNonEmpty(records.map((record) => record.namespaceClass));
  const rawPaths = uniqueNonEmpty(records.map((record) => record.canonicalPath));
  const lowerPaths = uniqueNonEmpty(records.map((record) => record.canonicalPath.toLowerCase()));
  const normalizedPaths = uniqueNonEmpty(records.map((record) => record.normalizedCanonicalPath));
  const visibilityClasses = new Set(records.map((record) => record.visibilityClass));

  if (docIds.length > 0 && docIds.length < records.length) {
    types.push("identical_doc_id");
  }
  if (shareTokens.length > 0 && shareTokens.length < records.length) {
    types.push(namespaces.length > 1 ? "same_token_different_namespaces" : "identical_share_token");
  }
  if (rawPaths.length > 0 && rawPaths.length < records.length) {
    types.push("identical_canonical_path");
  }
  if (lowerPaths.length > 0 && lowerPaths.length < records.length && rawPaths.length > lowerPaths.length) {
    types.push("case_insensitive_collision");
  }
  if (normalizedPaths.length > 0 && normalizedPaths.length < records.length && lowerPaths.length > normalizedPaths.length) {
    types.push("trailing_slash_or_url_normalization_collision");
  }
  if (shareTokens.length > 0 && shareTokens.length < records.length && normalizedPaths.length < records.length) {
    types.push("namespace_path_normalization_collision");
  }
  if (visibilityClasses.has("public") && [...visibilityClasses].some((visibility) => visibility !== "public")) {
    types.push("public_private_path_collision");
  }
  if (docIds.length === 1 && rawPaths.length === 1 && records.length > 1 && uniqueNonEmpty(records.map((record) => record.document.source.notionPageId)).length > 1) {
    types.push("duplicated_record_same_document");
  }
  if (types.length === 0) {
    types.push("another_identifiable_cause");
  }
  return unique(types);
}

function primaryCollisionType(scope: DiagnosticCollisionScope, types: DiagnosticCollisionType[]): DiagnosticCollisionType {
  if (scope === "doc_id" && types.includes("identical_doc_id")) {
    return "identical_doc_id";
  }
  if (scope === "share_token" && types.includes("identical_share_token")) {
    return "identical_share_token";
  }
  if (scope === "share_token" && types.includes("same_token_different_namespaces")) {
    return "same_token_different_namespaces";
  }
  const priority: DiagnosticCollisionType[] = [
    "public_private_path_collision",
    "duplicated_record_same_document",
    "identical_doc_id",
    "identical_share_token",
    "same_token_different_namespaces",
    "identical_canonical_path",
    "case_insensitive_collision",
    "trailing_slash_or_url_normalization_collision",
    "namespace_path_normalization_collision",
    "another_identifiable_cause"
  ];
  return priority.find((type) => types.includes(type)) ?? "another_identifiable_cause";
}

function sanitizedRecordRef(record: InternalDiagnosticRecord, salt: string, alias: string): DiagnosticRecordRef {
  return {
    alias,
    normalizedBrand: record.normalizedBrand || "UNKNOWN",
    visibilityClass: record.visibilityClass,
    namespaceClass: record.namespaceClass,
    docIdFingerprint: fingerprint(record.docId, salt),
    shareTokenFingerprint: fingerprint(record.shareToken, salt),
    canonicalPathFingerprint: fingerprint(record.canonicalPath, salt),
    currentlyPublishable: record.publishableCandidate,
    blockedByValidation: record.blockedByValidation
  };
}

function recommendedCollisionAction(type: DiagnosticCollisionType): string {
  switch (type) {
    case "identical_doc_id":
      return "Owner review required; one record likely needs manual DOC_ID correction before publishing.";
    case "identical_share_token":
      return "Owner review required; assign a unique Share Token in a future approved Notion write stage.";
    case "same_token_different_namespaces":
      return "Owner review required; confirm intentional namespace separation before any token changes.";
    case "duplicated_record_same_document":
      return "Owner review required; likely duplicate Notion record cleanup candidate.";
    case "public_private_path_collision":
      return "Owner review required; public and private records resolve to the same output path.";
    default:
      return "Owner review required; inspect private local correlation before changing source data.";
  }
}

function missingTokenRemediationCategory(input: {
  tokenRequired: boolean;
  draftOrNonpublishable: boolean;
  blockedByAnotherIssue: boolean;
  urlBreakingRisk: boolean;
}): RemediationCategory {
  if (!input.tokenRequired) {
    return "false_positive_validation_candidate";
  }
  if (input.urlBreakingRisk) {
    return "url_breaking_change_risk";
  }
  if (input.blockedByAnotherIssue) {
    return "owner_review_required";
  }
  if (input.draftOrNonpublishable) {
    return "no_action_required";
  }
  return "future_owner_approved_notion_mutation_required";
}

function blockingIssuesExcludingMissingToken(errors: ValidationIssue[]): ValidationIssue[] {
  const ignored = new Set(["SHARE_TOKEN_REQUIRED", "READONLY_MISSING_SHARE_TOKEN"]);
  return errors.filter((issue) => !ignored.has(issue.code));
}

function visibilityClass(record: { meta: { visibility: string } }): string {
  return normalizeVisibility(record.meta.visibility);
}

function namespaceClass(record: { meta: { visibility: string; privateLinkNamespace: string } }): string {
  const visibility = normalizeVisibility(record.meta.visibility);
  if (visibility === "public") {
    return "public";
  }
  if (visibility === "client") {
    return "clients";
  }
  if (visibility === "internal") {
    return "internal";
  }
  return record.meta.privateLinkNamespace.trim() || "clients";
}

function publishStatusClass(record: InternalDiagnosticRecord): string {
  return record.document.meta.publish ? record.document.meta.status || "UNKNOWN" : "not-publish-checked";
}

function shareTokenNamespaceKey(record: InternalDiagnosticRecord): string {
  return `${record.namespaceClass}:${record.shareToken.toLowerCase()}`;
}

function normalizeDiagnosticPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  const normalized = decoded.replace(/\\/g, "/").replace(/\/+/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/g, "");
  return `${withoutTrailingSlash || "/"}/`.toLowerCase();
}

function fingerprint(value: string, salt: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return `sha256:${crypto.createHash("sha256").update(salt).update("\0").update(trimmed).digest("hex").slice(0, 16)}`;
}

function countValidationIssues(documents: DocumentModel[], code: string): number {
  return documents.reduce((sum, document) => sum + document.validation.errors.filter((issue) => issue.code === code).length, 0);
}

function countBy<T>(values: T[], keyForValue: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyForValue(value) || "UNKNOWN";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueNonEmpty(values: string[]): string[] {
  return unique(values.filter((value) => value.trim()));
}

function letter(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode("A".charCodeAt(0) + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function createCorrelationReport(
  documents: DocumentModel[],
  config: AppConfig,
  generatedAt: string
): DiagnosticCorrelationReport {
  const records: DiagnosticCorrelationReport["records"] = [];
  const seen = new Set<string>();
  const internalRecords = documents.map((document, index): InternalDiagnosticRecord => ({
    document,
    index,
    normalizedBrand: normalizeBrand(document.meta.brand.label),
    visibilityClass: visibilityClass(document),
    namespaceClass: namespaceClass(document),
    docId: document.meta.docId.trim(),
    shareToken: document.meta.shareToken.trim(),
    canonicalPath: document.meta.canonicalPath.trim(),
    normalizedCanonicalPath: normalizeDiagnosticPath(document.meta.canonicalPath),
    publishableCandidate: isPublishableCandidate(document, config),
    blockedByValidation: document.validation.errors.length > 0
  }));

  collisionCandidateGroups(internalRecords).forEach((group, groupIndex) => {
    const groupAlias = `COLLISION-${String(groupIndex + 1).padStart(3, "0")}`;
    group.records.forEach((record, recordIndex) => {
      const alias = `${groupAlias}-${letter(recordIndex)}`;
      if (!seen.has(alias)) {
        records.push({ alias, pageId: record.document.source.notionPageId });
        seen.add(alias);
      }
    });
  });

  internalRecords
    .filter((record) => isPrivateLinkVisibility(record.document.meta.visibility) && !record.shareToken)
    .forEach((record, index) => {
      const alias = `TOKEN-${String(index + 1).padStart(3, "0")}`;
      if (!seen.has(alias)) {
        records.push({ alias, pageId: record.document.source.notionPageId });
        seen.add(alias);
      }
    });

  return {
    schema: CORRELATION_SCHEMA,
    version: 1,
    generatedAt,
    records
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
