import type { AppConfig } from "../config.js";
import { DOC_ID_PATTERN, parseDocId } from "../doc-id/generator.js";
import type { DocumentModel, RichTextSpan, ValidationIssue } from "../model/document.js";

const VERSION_PATTERN = /^v[0-9]+\.[0-9]+$/;
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function validateDocuments(documents: DocumentModel[], config: AppConfig): DocumentModel[] {
  const seenDocIds = new Map<string, string>();
  const seenPaths = new Map<string, string>();

  for (const document of documents) {
    const errors = document.validation.errors;
    const warnings = document.validation.warnings;
    const publishable = isPublishableCandidate(document, config);

    if (!document.meta.title.trim()) {
      errors.push(issue("MISSING_TITLE", "Title is required.", document));
    }
    if (!document.meta.version || !VERSION_PATTERN.test(document.meta.version)) {
      errors.push(issue("INVALID_VERSION", `Version must match vMAJOR.MINOR: ${document.meta.version || "(empty)"}`, document));
    }
    if (!document.meta.brand.token) {
      errors.push(issue("MISSING_BRAND_TOKEN", "Brand token is required.", document));
    }
    if (!document.meta.documentType.token) {
      errors.push(issue("MISSING_DOCUMENT_TYPE_TOKEN", "Document Type token is required.", document));
    }
    if (document.meta.docId) {
      if (!DOC_ID_PATTERN.test(document.meta.docId)) {
        errors.push(issue("MALFORMED_DOC_ID", `DOC_ID is malformed: ${document.meta.docId}`, document));
      } else {
        const parsed = parseDocId(document.meta.docId);
        if (
          parsed &&
          ((document.meta.brand.token && parsed.brandToken !== document.meta.brand.token) ||
            (document.meta.documentType.token && parsed.typeToken !== document.meta.documentType.token))
        ) {
          warnings.push(issue("DOC_ID_TOKEN_MISMATCH", "DOC_ID brand/type tokens no longer match current metadata.", document));
        }
      }
      const previousPageId = seenDocIds.get(document.meta.docId);
      if (previousPageId && previousPageId !== document.source.notionPageId) {
        errors.push(issue("DUPLICATE_DOC_ID", `Duplicate DOC_ID: ${document.meta.docId}`, document));
      }
      seenDocIds.set(document.meta.docId, document.source.notionPageId);
    }

    if (document.meta.publish && !config.publishableStatuses.has(document.meta.status)) {
      errors.push(
        issue(
          "INVALID_PUBLISH_STATUS",
          `Publish is checked but Status "${document.meta.status}" is not configured as publishable.`,
          document
        )
      );
    }
    if (document.meta.publish && !config.allowedVisibility.has(document.meta.visibility)) {
      errors.push(issue("VISIBILITY_NOT_ALLOWED", `Visibility ${document.meta.visibility} is not allowed for this build target.`, document));
    }
    if (publishable && !document.meta.docId) {
      errors.push(issue("MISSING_DOC_ID", "Publishable documents require DOC_ID. Run npm run assign-id first.", document));
    }
    if (publishable && document.content.filter((block) => block.type !== "unsupported").length === 0) {
      errors.push(issue("EMPTY_CONTENT", "Publishable documents require renderable content.", document));
    }
    for (const block of document.content) {
      if (block.type === "unsupported") {
        const target = publishable ? errors : warnings;
        target.push({
          code: "UNSUPPORTED_BLOCK",
          message: publishable ? `${block.message} Publishable documents cannot contain unsupported blocks.` : block.message,
          pageId: document.source.notionPageId,
          docId: document.meta.docId,
          notionBlockId: block.id,
          path: "content"
        });
      }
    }

    for (const span of collectSpans(document)) {
      if (span.href && !isSafeUrl(span.href)) {
        errors.push(issue("UNSAFE_LINK", `Unsafe link protocol: ${span.href}`, document));
      }
    }

    if (document.meta.canonicalPath) {
      const previousPageId = seenPaths.get(document.meta.canonicalPath.toLowerCase());
      if (previousPageId && previousPageId !== document.source.notionPageId) {
        errors.push(issue("OUTPUT_PATH_COLLISION", `Output path collision: ${document.meta.canonicalPath}`, document));
      }
      seenPaths.set(document.meta.canonicalPath.toLowerCase(), document.source.notionPageId);
    }

    if (publishable) {
      for (const asset of document.assets) {
        if (!asset.local) {
          errors.push(issue("REMOTE_ASSET_PUBLISH_BLOCKED", `Publishable output requires local asset copy: ${asset.sourceUrl}`, document));
        }
      }
    } else if (document.assets.some((asset) => !asset.local)) {
      warnings.push(issue("REMOTE_ASSET_DRAFT_ONLY", "Remote Notion assets are allowed only for draft preview output.", document));
    }

    document.validation.ok = errors.length === 0;
  }
  return documents;
}

export function isPublishableCandidate(document: DocumentModel, config: AppConfig): boolean {
  return (
    document.meta.publish &&
    config.publishableStatuses.has(document.meta.status) &&
    config.allowedVisibility.has(document.meta.visibility)
  );
}

export function collectIssues(documents: DocumentModel[]): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  return {
    errors: documents.flatMap((document) => document.validation.errors),
    warnings: documents.flatMap((document) => document.validation.warnings)
  };
}

function collectSpans(document: DocumentModel): RichTextSpan[] {
  const spans: RichTextSpan[] = [];
  for (const block of document.content) {
    if ("richText" in block) {
      spans.push(...block.richText);
    }
    if (block.type === "image" || block.type === "file") {
      spans.push(...(block.asset.caption ?? []));
    }
    if (block.type === "table") {
      for (const row of block.rows) {
        for (const cell of row) {
          spans.push(...cell);
        }
      }
    }
  }
  return spans;
}

function isSafeUrl(value: string): boolean {
  try {
    return SAFE_URL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function issue(code: string, message: string, document: DocumentModel): ValidationIssue {
  return {
    code,
    message,
    pageId: document.source.notionPageId,
    docId: document.meta.docId
  };
}
