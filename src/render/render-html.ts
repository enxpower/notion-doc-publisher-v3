import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { escapeHtml, renderBlocks } from "./render-blocks.js";
import { isPublishableCandidate } from "../validate/validate.js";

export async function renderDocumentHtml(document: DocumentModel, config: AppConfig): Promise<string> {
  const template = await readTemplate();
  const body = renderBlocks(document.content, isPublishableCandidate(document, config) ? "publishable" : "draft");
  return fillTemplate(template, {
    title: document.meta.title,
    docId: document.meta.docId,
    version: document.meta.version,
    brand: document.meta.brand.label,
    client: document.meta.client.label,
    project: document.meta.project.label,
    documentType: document.meta.documentType.label,
    status: document.meta.status,
    visibility: document.meta.visibility,
    body,
    siteDomain: config.targetSiteDomain ?? "",
    screenCss: "../../assets/css/screen.css",
    printCss: "../../assets/css/print.css"
  });
}

export function renderIndexHtml(documents: DocumentModel[]): string {
  const rows = documents
    .map(
      (document) => `<tr>
        <td><a href="${escapeHtml(document.meta.canonicalPath.replace(/^\//, ""))}">${escapeHtml(document.meta.title)}</a></td>
        <td><code>${escapeHtml(document.meta.docId)}</code></td>
        <td>${escapeHtml(document.meta.brand.label)}</td>
        <td>${escapeHtml(document.meta.client.label)}</td>
        <td>${escapeHtml(document.meta.project.label)}</td>
        <td>${escapeHtml(document.meta.documentType.label)}</td>
        <td>${escapeHtml(document.meta.version)}</td>
      </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Document Index</title>
    <link rel="stylesheet" href="assets/css/screen.css">
    <link rel="stylesheet" href="assets/css/print.css" media="print">
  </head>
  <body>
    <main class="site-index">
      <h1>Document Index</h1>
      <table>
        <thead>
          <tr><th>Title</th><th>DOC_ID</th><th>Brand</th><th>Client</th><th>Project</th><th>Type</th><th>Version</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </main>
  </body>
</html>
`;
}

async function readTemplate(): Promise<string> {
  return fs.readFile(path.resolve("templates/enterprise.html"), "utf8");
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key: string) => values[key] ?? "");
}
