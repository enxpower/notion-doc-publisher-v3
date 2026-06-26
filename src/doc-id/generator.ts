import type { AppConfig } from "../config.js";
import { UserFacingError } from "../config.js";
import type { DocumentModel, ValidationIssue } from "../model/document.js";

export const DOC_ID_PATTERN = /^([A-Z0-9]+)-([A-Z0-9]+)-(\d{4})-(\d{4})$/;

/**
 * Error codes that represent cross-document integrity violations.
 * These make the assignment output ambiguous or corrupt and must halt
 * the entire assign-id run even if only one document is affected.
 */
const INTEGRITY_BLOCKING_CODES = new Set([
  "DUPLICATE_DOC_ID",
  "DOC_ID_COLLISION",
  "DOC_ID_SEQUENCE_OVERFLOW"
]);

export type AssignmentPlan = {
  yearMonth: string;
  assignments: Array<{
    pageId: string;
    title: string;
    docId: string;
  }>;
  /** Cross-document integrity errors — block the entire run. */
  errors: ValidationIssue[];
  /**
   * Per-document issues — the affected document is skipped but
   * all other assignments proceed normally.
   */
  skipped: ValidationIssue[];
  warnings: ValidationIssue[];
};

export function parseDocId(docId: string):
  | { brandToken: string; typeToken: string; yearMonth: string; sequence: number }
  | undefined {
  const match = DOC_ID_PATTERN.exec(docId);
  if (!match) {
    return undefined;
  }
  return {
    brandToken: match[1]!,
    typeToken: match[2]!,
    yearMonth: match[3]!,
    sequence: Number(match[4]!)
  };
}

export function createAssignmentPlan(documents: DocumentModel[], config: AppConfig): AssignmentPlan {
  const errors: ValidationIssue[] = [];
  const skipped: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const existing = new Set<string>();
  let maxSequence = 0;

  for (const document of documents) {
    const docId = document.meta.docId;
    if (!docId) {
      continue;
    }
    const parsed = parseDocId(docId);
    if (!parsed) {
      // Malformed existing DOC_ID: warn but do not block others.
      skipped.push({
        code: "MALFORMED_DOC_ID",
        message: `Malformed DOC_ID skips assignment consideration: ${docId}`,
        pageId: document.source.notionPageId,
        docId
      });
      continue;
    }
    if (existing.has(docId)) {
      // Duplicate is a cross-document integrity error — must block.
      errors.push({
        code: "DUPLICATE_DOC_ID",
        message: `Duplicate DOC_ID blocks assignment: ${docId}`,
        pageId: document.source.notionPageId,
        docId
      });
    }
    existing.add(docId);
    if (parsed.yearMonth === config.docIdYearMonth) {
      maxSequence = Math.max(maxSequence, parsed.sequence);
    }
    if (
      (document.meta.brand.token && parsed.brandToken !== document.meta.brand.token) ||
      (document.meta.documentType.token && parsed.typeToken !== document.meta.documentType.token)
    ) {
      warnings.push({
        code: "DOC_ID_TOKEN_MISMATCH",
        message: `${docId} no longer matches current brand/type metadata; DOC_ID will not be rewritten.`,
        pageId: document.source.notionPageId,
        docId
      });
    }
  }

  const assignments: AssignmentPlan["assignments"] = [];
  const candidates = documents.filter((document) => !document.meta.docId);
  for (const document of candidates) {
    if (!document.meta.brand.token || !document.meta.documentType.token) {
      // Per-document issue: skip this document, continue with others.
      skipped.push({
        code: "MISSING_DOC_ID_TOKEN",
        message: `Skipping DOC_ID assignment for "${document.meta.title}": brand or document type token is missing.`,
        pageId: document.source.notionPageId
      });
      continue;
    }
    maxSequence += 1;
    if (maxSequence > 9999) {
      errors.push({
        code: "DOC_ID_SEQUENCE_OVERFLOW",
        message: `DOC_ID sequence for ${config.docIdYearMonth} exceeded 9999.`,
        pageId: document.source.notionPageId
      });
      continue;
    }
    const docId = `${document.meta.brand.token}-${document.meta.documentType.token}-${config.docIdYearMonth}-${String(maxSequence).padStart(4, "0")}`;
    if (existing.has(docId)) {
      errors.push({
        code: "DOC_ID_COLLISION",
        message: `Planned DOC_ID collides with existing ID: ${docId}`,
        pageId: document.source.notionPageId,
        docId
      });
      continue;
    }
    existing.add(docId);
    assignments.push({
      pageId: document.source.notionPageId,
      title: document.meta.title,
      docId
    });
  }

  return { yearMonth: config.docIdYearMonth, assignments, skipped, errors, warnings };
}

/**
 * Throws only when cross-document integrity errors are present.
 * Per-document issues (skipped) do not throw; the caller logs them.
 */
export function assertPlanWritable(plan: AssignmentPlan): void {
  const blocking = plan.errors.filter((issue) => INTEGRITY_BLOCKING_CODES.has(issue.code));
  if (blocking.length > 0) {
    throw new UserFacingError(
      `DOC_ID assignment stopped: ${blocking.length} integrity error(s). Run assign-id:dry for details.`
    );
  }
}
