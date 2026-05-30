import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { NotionClient, type NotionBlock } from "../notion/client.js";
import { pageToDocument } from "../notion/properties.js";
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
