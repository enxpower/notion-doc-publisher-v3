import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { escapeHtml, renderBlocks } from "./render-blocks.js";
import { isPublishableCandidate } from "../validate/validate.js";

type BrandPresentation = {
  displayName: string;
  tagline: string;
};

export async function renderDocumentHtml(document: DocumentModel, config: AppConfig): Promise<string> {
  const template = await readTemplate();
  const body = renderBlocks(document.content, isPublishableCandidate(document, config) ? "publishable" : "draft");
  const brand = resolveBrand(document.meta.brand.label, config);
  const tagline = brand.tagline
    ? `<p class="masthead-slogan">${escapeHtml(brand.tagline)}</p>`
    : "";

  return fillTemplate(template, {
    title: escapeHtml(document.meta.title),
    docId: escapeHtml(document.meta.docId),
    version: escapeHtml(document.meta.version),
    brand: escapeHtml(brand.displayName),
    sloganBlock: tagline,
    client: escapeHtml(document.meta.client.label),
    project: escapeHtml(document.meta.project.label),
    documentType: escapeHtml(document.meta.documentType.label),
    status: escapeHtml(document.meta.status),
    visibility: escapeHtml(document.meta.visibility),
    body,
    siteDomain: config.targetSiteDomain ?? "",
    screenCss: "../../assets/css/screen.css",
    printCss: "../../assets/css/print.css"
  });
}

export function renderIndexHtml(documents: DocumentModel[], config?: AppConfig): string {
  const rows = documents
    .map((document) => {
      const brand = config ? resolveBrand(document.meta.brand.label, config).displayName : document.meta.brand.label;
      return `<tr>
        <td class="register-title"><a href="${escapeHtml(document.meta.canonicalPath.replace(/^\//, ""))}">${escapeHtml(document.meta.title)}</a></td>
        <td><code>${escapeHtml(document.meta.docId)}</code></td>
        <td>${escapeHtml(brand)}</td>
        <td>${escapeHtml(document.meta.client.label)}</td>
        <td>${escapeHtml(document.meta.project.label)}</td>
        <td>${escapeHtml(document.meta.documentType.label)}</td>
        <td>${escapeHtml(document.meta.version)}</td>
      </tr>`;
    })
    .join("\n");

  const count = documents.length;
  const countLabel = `${count} ${count === 1 ? "document" : "documents"}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Document Register</title>
    <link rel="stylesheet" href="assets/css/screen.css">
    <link rel="stylesheet" href="assets/css/print.css" media="print">
  </head>
  <body>
    <main class="site-index">
      <header class="register-header">
        <p class="document-kicker">Published Documents</p>
        <h1>Document Register</h1>
        <p class="register-intro">A formal register of published documents. Select a title to open the full document.</p>
      </header>
      <div class="register-table-wrap">
        <table class="document-register">
          <thead>
            <tr><th>Title</th><th>DOC_ID</th><th>Brand</th><th>Client</th><th>Project</th><th>Type</th><th>Version</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <footer class="site-footer">
        <span>Document Register</span>
        <span>${escapeHtml(countLabel)}</span>
      </footer>
    </main>
  </body>
</html>
`;
}

/**
 * Resolves a Notion Brand value to its presentation. When a brand has no
 * configured profile, the raw Brand label is used and no tagline is shown,
 * keeping the masthead brand-neutral by default.
 */
function resolveBrand(label: string, config: AppConfig): BrandPresentation {
  const profile = config.brandProfiles[label];
  return {
    displayName: profile?.displayName?.trim() || label,
    tagline: profile?.tagline?.trim() || ""
  };
}

async function readTemplate(): Promise<string> {
  return fs.readFile(path.resolve("templates/enterprise.html"), "utf8");
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key: string) => values[key] ?? "");
}
