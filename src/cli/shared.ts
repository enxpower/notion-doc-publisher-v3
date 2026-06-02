import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { VALID_PRIVATE_LINK_NAMESPACES, normalizeVisibility, isPrivateLinkVisibility } from "../model/document.js";
import { NotionClient, type NotionBlock } from "../notion/client.js";
import { computeCanonicalPath, inferPortalCategory, inferPrivateLinkNamespace, pageToDocument } from "../notion/properties.js";
import { NotionWriteback } from "../notion/writeback.js";
import type { BuildReport, DocumentModel } from "../model/document.js";
import { collectIssues, isPublishableCandidate, validateDocuments } from "../validate/validate.js";

export async function loadDocuments(config: AppConfig): Promise<DocumentModel[]> {
  const client = new NotionClient(config);
  const pages = await client.queryDatabase();
  const documents: DocumentModel[] = [];
  for (const page of pages) {
    const blocks = await fetchPageBlocks(client, page.id);
    documents.push(pageToDocument(page, blocks, config));
  }
  return documents;
}

export async function fetchPageBlocks(client: NotionClient, pageId: string): Promise<NotionBlock[]> {
  const blocks = await client.listBlockChildren(pageId);
  for (const block of blocks) {
    if (block.type === "table") {
      block.children = await client.listBlockChildren(block.id);
    }
  }
  return blocks;
}

export async function autoFillDocuments(documents: DocumentModel[], config: AppConfig): Promise<void> {
  if (process.env.ALLOW_MISSING_SHARE_TOKEN === "true" && process.env.AUTO_GENERATE_SHARE_TOKEN === undefined) {
    console.warn(
      "[DEPRECATION] ALLOW_MISSING_SHARE_TOKEN is deprecated. Use AUTO_GENERATE_SHARE_TOKEN=true (the default) instead. " +
      "The old flag generated unstable in-memory tokens; AUTO_GENERATE_SHARE_TOKEN writes stable tokens to Notion."
    );
  }

  const writeback = new NotionWriteback(config);
  const toProcess = documents.filter((doc) => doc.meta.publish);

  for (const document of toProcess) {
    const meta = document.meta;
    const vis = meta.visibility.trim().toLowerCase();
    const v = normalizeVisibility(vis);
    const props: { shareToken?: string; namespace?: string; portalCategory?: string } = {};
    let pathChanged = false;

    if (isPrivateLinkVisibility(vis)) {
      if (!meta.shareToken && config.autoGenerateShareToken) {
        const token = crypto.randomBytes(8).toString("hex");
        console.log(`[AUTO] ${meta.docId || meta.title}: Generating Share Token "${token}".`);
        meta.shareToken = token;
        props.shareToken = token;
        pathChanged = true;
      }
      if (!meta.privateLinkNamespace) {
        const ns = v === "client" ? "clients"
          : v === "internal" ? "internal"
          : (config.autoFillPrivateNamespace
              ? inferPrivateLinkNamespace(meta.client.label, meta.category, meta.documentType.label)
              : "clients");
        console.log(`[AUTO] ${meta.docId || meta.title}: Resolved Private Link Namespace to "${ns}".`);
        meta.privateLinkNamespace = ns;
        if (config.autoFillPrivateNamespace) props.namespace = ns;
        if (v === "unlisted") pathChanged = true;
      }
      if (pathChanged && meta.shareToken) {
        meta.canonicalPath = computeCanonicalPath(meta.visibility, meta.docId, meta.shareToken, meta.privateLinkNamespace);
      }
    }

    if (vis === "public" && !meta.portalCategory && config.autoFillPortalCategory) {
      const cat = inferPortalCategory(meta.documentType.label, meta.category, meta.brand.label, meta.project.label);
      console.log(`[AUTO] ${meta.docId || meta.title}: Resolved Portal Category to "${cat}".`);
      meta.portalCategory = cat;
      props.portalCategory = cat;
    }

    if (Object.keys(props).length > 0 && document.source.notionPageId) {
      try {
        await writeback.writeAutoFillProperties(document.source.notionPageId, props);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (props.shareToken && !config.allowMissingShareToken) {
          throw new Error(`[${meta.docId}] Notion write-back for Share Token failed and ALLOW_MISSING_SHARE_TOKEN is not set: ${msg}`);
        }
        console.warn(`[WARN] ${meta.docId}: Notion write-back failed (continuing): ${msg}`);
      }
    }
  }
}

export function validateLoadedDocuments(documents: DocumentModel[], config: AppConfig): DocumentModel[] {
  return validateDocuments(documents, config);
}

export function publishableDocuments(documents: DocumentModel[], config: AppConfig): DocumentModel[] {
  return documents.filter((document) => isPublishableCandidate(document, config) && document.validation.errors.length === 0);
}

export function createReport(documents: DocumentModel[]): BuildReport {
  const issues = collectIssues(documents);
  return {
    generatedAt: new Date().toISOString(),
    documents: documents.map((document) => ({
      pageId: document.source.notionPageId,
      docId: document.meta.docId,
      title: document.meta.title,
      path: document.meta.canonicalPath,
      status: document.meta.status,
      visibility: document.meta.visibility,
      publish: document.meta.publish
    })),
    errors: issues.errors,
    warnings: issues.warnings
  };
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function hasErrors(documents: DocumentModel[]): boolean {
  return documents.some((document) => document.validation.errors.length > 0);
}

/**
 * Cross-document integrity errors that make output ambiguous and must halt the
 * whole build regardless of which document carries them.
 */
const GLOBAL_ERROR_CODES = new Set(["DUPLICATE_DOC_ID", "OUTPUT_PATH_COLLISION"]);

/**
 * Decides whether the build must stop. Publishing discipline is preserved:
 * any error on a document that is eligible for publishing still halts the
 * build, as do cross-document integrity errors. Quality problems on drafts or
 * otherwise non-publishable documents are reported but never block the valid,
 * publishable documents from being built and deployed.
 */
export function hasBuildBlockingErrors(documents: DocumentModel[], config: AppConfig): boolean {
  return documents.some((document) => {
    if (document.validation.errors.length === 0) {
      return false;
    }
    if (isPublishableCandidate(document, config)) {
      return true;
    }
    return document.validation.errors.some((issue) => GLOBAL_ERROR_CODES.has(issue.code));
  });
}

/**
 * Returns the documents whose errors are actually blocking the build, paired
 * with their human-readable reasons, for actionable console reporting.
 */
export function buildBlockers(
  documents: DocumentModel[],
  config: AppConfig
): Array<{ title: string; docId: string; reasons: string[] }> {
  const blockers: Array<{ title: string; docId: string; reasons: string[] }> = [];
  for (const document of documents) {
    if (document.validation.errors.length === 0) {
      continue;
    }
    const publishable = isPublishableCandidate(document, config);
    const blocking = document.validation.errors.filter(
      (issue) => publishable || GLOBAL_ERROR_CODES.has(issue.code)
    );
    if (blocking.length === 0) {
      continue;
    }
    blockers.push({
      title: document.meta.title || "(untitled)",
      docId: document.meta.docId || "(no DOC_ID)",
      reasons: blocking.map((issue) => `${issue.code}: ${issue.message}`)
    });
  }
  return blockers;
}
