import type { AppConfig } from "../config.js";
import { DOC_ID_PATTERN, parseDocId } from "../doc-id/generator.js";
import type { DocumentModel, RichTextSpan, ValidationIssue } from "../model/document.js";
import { VALID_PRIVATE_LINK_NAMESPACES, normalizeVisibility, isPrivateLinkVisibility } from "../model/document.js";

const VERSION_PATTERN = /^v[0-9]+\.[0-9]+$/;
const SHARE_TOKEN_VALID = /^[a-z0-9]{10,}$/;
const SHARE_TOKEN_WARN_LENGTH = 12;
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

      // DUPLICATE_DOC_ID: only the later document (the duplicate) gets the error.
      // The first document seen keeps its DOC_ID and may still be published.
      const previousPageId = seenDocIds.get(document.meta.docId);
      if (previousPageId && previousPageId !== document.source.notionPageId) {
        errors.push(issue(
          "DUPLICATE_DOC_ID",
          `Duplicate DOC_ID: ${document.meta.docId} — this document is skipped; the first occurrence will still publish.`,
          document
        ));
      }
      seenDocIds.set(document.meta.docId, document.source.notionPageId);
    }

    if (document.meta.publish && !config.publishableStatuses.has(document.meta.status)) {
      warnings.push(
        issue(
          "INVALID_PUBLISH_STATUS",
          `Publish is checked but Status "${document.meta.status}" is not configured as publishable; document will be skipped.`,
          document
        )
      );
    }
    if (
      document.meta.publish &&
      !isPrivateLinkVisibility(document.meta.visibility) &&
      !config.allowedVisibility.has(document.meta.visibility)
    ) {
      warnings.push(
        issue(
          "VISIBILITY_NOT_ALLOWED",
          `Visibility "${document.meta.visibility}" is not allowed for this build target; document will be skipped.`,
          document
        )
      );
    }

    const v = normalizeVisibility(document.meta.visibility);
    if (isPrivateLinkVisibility(document.meta.visibility)) {
      if (!document.meta.shareToken) {
        const canAutoGenerate = config.autoGenerateShareToken || config.allowMissingShareToken;
        const visLabel = v === "client" ? "Client" : v === "internal" ? "Internal" : "Unlisted";
        const tokenIssue = issue(
          "SHARE_TOKEN_REQUIRED",
          canAutoGenerate
            ? `${visLabel} document has no Share Token; one will be generated and written to Notion automatically.`
            : `${visLabel} documents require a Share Token (Notion property: 'Share Token'). Set AUTO_GENERATE_SHARE_TOKEN=true to auto-generate a stable token.`,
          document
        );
        if (canAutoGenerate) warnings.push(tokenIssue);
        else errors.push(tokenIssue);
      } else if (!SHARE_TOKEN_VALID.test(document.meta.shareToken)) {
        errors.push(issue(
          "INVALID_SHARE_TOKEN",
          `Share Token "${document.meta.shareToken}" is invalid. Must be at least 10 lowercase alphanumeric characters (a-z, 0-9).`,
          document
        ));
      } else if (document.meta.shareToken.length < SHARE_TOKEN_WARN_LENGTH) {
        warnings.push(issue(
          "SHORT_SHARE_TOKEN",
          `Share Token "${document.meta.shareToken}" is valid but short (${document.meta.shareToken.length} chars). Recommended minimum is ${SHARE_TOKEN_WARN_LENGTH} characters for adequate entropy.`,
          document
        ));
      }

      if (v === "unlisted") {
        if (!document.meta.privateLinkNamespace) {
          warnings.push(issue(
            "MISSING_PRIVATE_LINK_NAMESPACE",
            config.autoFillPrivateNamespace
              ? "Unlisted document has no Private Link Namespace; it will be inferred and written to Notion automatically."
              : "Unlisted document has no Private Link Namespace; defaulting to 'clients' in memory.",
            document
          ));
        } else if (!VALID_PRIVATE_LINK_NAMESPACES.has(document.meta.privateLinkNamespace)) {
          errors.push(issue(
            "INVALID_PRIVATE_LINK_NAMESPACE",
            `Private Link Namespace "${document.meta.privateLinkNamespace}" is not supported. Valid values: clients, partners, internal.`,
            document
          ));
        }
      } else if (v === "client") {
        if (document.meta.privateLinkNamespace && document.meta.privateLinkNamespace !== "clients") {
          warnings.push(issue(
            "PRIVATE_LINK_NAMESPACE_MISMATCH",
            `Client documents use namespace "clients"; Private Link Namespace "${document.meta.privateLinkNamespace}" will be ignored.`,
            document
          ));
        }
      } else if (v === "internal") {
        if (document.meta.privateLinkNamespace && document.meta.privateLinkNamespace !== "internal") {
          warnings.push(issue(
            "PRIVATE_LINK_NAMESPACE_MISMATCH",
            `Internal documents use namespace "internal"; Private Link Namespace "${document.meta.privateLinkNamespace}" will be ignored.`,
            document
          ));
        }
      }
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
      // OUTPUT_PATH_COLLISION: only the later document gets the error.
      // The first document to claim a path keeps it and may still be published.
      const previousPageId = seenPaths.get(document.meta.canonicalPath.toLowerCase());
      if (previousPageId && previousPageId !== document.source.notionPageId) {
        errors.push(issue(
          "OUTPUT_PATH_COLLISION",
          `Output path collision: ${document.meta.canonicalPath} — this document is skipped; the first occurrence will still publish.`,
          document
        ));
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
  if (!document.meta.publish || !config.publishableStatuses.has(document.meta.status)) {
    return false;
  }
  // Private-link documents (Client, Internal, Unlisted) always generate pages regardless of allowedVisibility
  if (isPrivateLinkVisibility(document.meta.visibility)) {
    return true;
  }
  return config.allowedVisibility.has(document.meta.visibility);
}

export function isPublicIndexListed(document: DocumentModel): boolean {
  return document.meta.visibility.trim().toLowerCase() === "public" && document.meta.portalListed;
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
