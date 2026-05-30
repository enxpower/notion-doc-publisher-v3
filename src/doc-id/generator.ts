import type { AppConfig } from "../config.js";
import { UserFacingError } from "../config.js";
import type { DocumentModel, ValidationIssue } from "../model/document.js";

export const DOC_ID_PATTERN = /^([A-Z0-9]+)-([A-Z0-9]+)-(\d{4})-(\d{4})$/;

export type AssignmentPlan = {
  yearMonth: string;
  assignments: Array<{
    pageId: string;
    title: string;
    docId: string;
  }>;
  errors: ValidationIssue[];
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
      errors.push({
        code: "MALFORMED_DOC_ID",
        message: `Malformed DOC_ID blocks assignment: ${docId}`,
        pageId: document.source.notionPageId,
        docId
      });
      continue;
    }
    if (existing.has(docId)) {
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
      errors.push({
        code: "MISSING_DOC_ID_TOKEN",
        message: `Cannot assign DOC_ID for "${document.meta.title}" because brand or document type token is missing.`,
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

  return { yearMonth: config.docIdYearMonth, assignments, errors, warnings };
}

export function assertPlanWritable(plan: AssignmentPlan): void {
  if (plan.errors.length > 0) {
    throw new UserFacingError(`DOC_ID assignment stopped: ${plan.errors.length} blocking issue(s). Run assign-id:dry for details.`);
  }
}
