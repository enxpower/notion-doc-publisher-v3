import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, BrandProfile } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { escapeHtml, renderBlocks } from "./render-blocks.js";
import { isPublishableCandidate } from "../validate/validate.js";

type BrandPresentation = {
  displayName: string;
  tagline: string;
};

type TocEntry = { level: number; text: string; id: string };

type Classification = { label: string; cls: string };

const ROOT_RELATIVE_FROM_DOC = "../../";

export async function renderDocumentHtml(document: DocumentModel, config: AppConfig): Promise<string> {
  const template = await readTemplate();
  const meta = document.meta;
  const brand = resolveBrand(meta.brand.label, config);

  const rawBody = renderBlocks(document.content, isPublishableCandidate(document, config) ? "publishable" : "draft");
  const { html: body, toc } = enrichBody(rawBody);

  const classification = classify(meta.visibility);
  const updated = formatDate(document.source.lastEditedTime ?? document.source.createdTime);

  const sloganBlock = brand.tagline ? `<p class="masthead-slogan">${escapeHtml(brand.tagline)}</p>` : "";

  return fillTemplate(template, {
    title: escapeHtml(meta.title),
    docId: escapeHtml(meta.docId),
    documentType: escapeHtml(meta.documentType.label),
    brand: escapeHtml(brand.displayName),
    sloganBlock,
    topbar: renderTopbar(brand.displayName, ROOT_RELATIVE_FROM_DOC),
    identity: renderIdentity(meta.docId, meta.documentType.label, meta.version, meta.status, classification),
    metaStrip: renderMetaStrip(meta.client.label, meta.project.label, updated),
    actions: renderActions(),
    toc: renderToc(toc),
    body,
    footer: renderFooter(brand.displayName, meta.docId, meta.version),
    screenCss: `${ROOT_RELATIVE_FROM_DOC}assets/css/screen.css`,
    printCss: `${ROOT_RELATIVE_FROM_DOC}assets/css/print.css`
  });
}

export function renderIndexHtml(documents: DocumentModel[], config?: AppConfig): string {
  const rows = documents
    .map((document) => {
      const meta = document.meta;
      const brand = config ? resolveBrand(meta.brand.label, config).displayName : meta.brand.label;
      const classification = classify(meta.visibility);
      return `<tr>
        <td class="register-title"><a href="${escapeHtml(meta.canonicalPath.replace(/^\//, ""))}">${escapeHtml(meta.title)}</a></td>
        <td><code>${escapeHtml(meta.docId)}</code></td>
        <td>${escapeHtml(brand)}</td>
        <td>${escapeHtml(meta.client.label)}</td>
        <td>${escapeHtml(meta.documentType.label)}</td>
        <td>${escapeHtml(meta.version)}</td>
        <td><span class="tag ${classification.cls}">${escapeHtml(classification.label)}</span></td>
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
    ${renderTopbar("Documents", "")}
    <main class="site-index">
      <header class="register-header">
        <p class="document-kicker">Published Documents</p>
        <h1>Document Register</h1>
        <p class="register-intro">A formal register of published documents. Select a title to open the full document.</p>
      </header>
      <div class="register-table-wrap">
        <table class="document-register">
          <thead>
            <tr><th>Title</th><th>DOC_ID</th><th>Brand</th><th>Client</th><th>Type</th><th>Version</th><th>Classification</th></tr>
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

/* ----------------------------------------------------------------
   Presentation partials
   ---------------------------------------------------------------- */

function renderTopbar(brandLabel: string, rootRelative: string): string {
  const home = rootRelative || "./";
  return `<header class="site-topbar no-print">
      <a class="topbar-brand" href="${escapeHtml(home)}">${escapeHtml(brandLabel)}</a>
      <a class="topbar-link" href="${escapeHtml(home)}">Document Register</a>
    </header>`;
}

function renderIdentity(
  docId: string,
  type: string,
  version: string,
  status: string,
  classification: Classification
): string {
  const facts: string[] = [];
  if (docId) facts.push(`<span class="identity-id">${escapeHtml(docId)}</span>`);
  if (type) facts.push(`<span>${escapeHtml(type)}</span>`);
  if (version) facts.push(`<span>Version ${escapeHtml(version)}</span>`);
  const factLine = facts.join(`<span class="identity-sep">·</span>`);
  const tags: string[] = [];
  if (status) tags.push(`<span class="tag status-${slugify(status)}">${escapeHtml(status)}</span>`);
  tags.push(`<span class="tag ${classification.cls}">${escapeHtml(classification.label)}</span>`);
  return `<div class="identity-facts">${factLine}</div><div class="identity-tags">${tags.join("")}</div>`;
}

/**
 * The metadata strip intentionally omits Classification: it is already shown as
 * a chip in the identity line, and repeating it here read as redundant. The
 * strip carries the remaining executive facts.
 */
function renderMetaStrip(client: string, project: string, updated: string): string {
  const fields: Array<[string, string]> = [
    ["Client", client],
    ["Project", project],
    ["Updated", updated]
  ];
  const cells = fields
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${value ? escapeHtml(value) : "<span class=\"meta-empty\">—</span>"}</dd></div>`
    )
    .join("");
  return `<dl class="document-meta">${cells}</dl>`;
}

/**
 * Compact, secondary print action. It opens the browser's native print dialog
 * (the only print path in this build). The customer-facing label is simply
 * "Print"; any explanation lives in the title/aria-label, never in visible body
 * UI. Controlled PDF export is tracked as future work in the docs, not here.
 */
function renderActions(): string {
  return `<button type="button" class="action-btn" onclick="window.print()" title="Print this document using your browser" aria-label="Print this document">Print</button>`;
}

function renderToc(entries: TocEntry[]): string {
  if (entries.length < 4) {
    return "";
  }
  // Normalize indentation to the shallowest heading actually present. A document
  // whose sections are all one level (e.g. a contract authored entirely with
  // Notion heading_2) should render a flat TOC, not one indented across the board.
  const minLevel = Math.min(...entries.map((entry) => entry.level));
  const items = entries
    .map((entry) => {
      const depth = entry.level - minLevel; // 0 = top level
      return `<li class="toc-d${depth}"><a href="#${entry.id}">${entry.text}</a></li>`;
    })
    .join("");
  return `<nav class="document-toc no-print" aria-label="Contents">
        <p class="toc-title">Contents</p>
        <ol class="toc-list">${items}</ol>
      </nav>`;
}

function renderFooter(brandLabel: string, docId: string, version: string): string {
  const ref = [docId, version ? `Version ${version}` : ""].filter(Boolean).map(escapeHtml).join(" · ");
  return `<div class="footer-row">
          <span class="footer-brand">${escapeHtml(brandLabel)}</span>
          <span class="footer-ref">${ref}</span>
        </div>`;
}

/* ----------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------- */

/**
 * Adds stable anchor ids to body headings and extracts a table of contents.
 * Operates on the already-escaped HTML from renderBlocks, so heading text in
 * the TOC is safe. h2/h3 feed the TOC; h4 still gets an id for deep-linking.
 */
function enrichBody(body: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  let counter = 0;
  const html = body.replace(/<(h[234])>([\s\S]*?)<\/\1>/g, (_match, tag: string, inner: string) => {
    counter += 1;
    const level = Number(tag.slice(1));
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const id = `sec-${counter}-${slugify(text).slice(0, 40)}`.replace(/-+$/g, "");
    if (level === 2 || level === 3) {
      toc.push({ level, text, id });
    }
    return `<${tag} id="${id}">${inner}</${tag}>`;
  });
  return { html, toc };
}

/**
 * Maps the Notion Visibility value to a printable classification label.
 * Derived from existing metadata — no schema change.
 */
function classify(visibility: string): Classification {
  switch (visibility.trim().toLowerCase()) {
    case "public":
      return { label: "Public Release", cls: "is-public" };
    case "internal":
      return { label: "Internal Use", cls: "is-internal" };
    case "confidential":
      return { label: "Confidential", cls: "is-confidential" };
    default:
      return { label: visibility || "Unspecified", cls: "is-other" };
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function resolveBrand(label: string, config: AppConfig): BrandPresentation {
  const profile: BrandProfile | undefined = config.brandProfiles[label];
  return {
    displayName: profile?.displayName?.trim() || label || "Document",
    tagline: profile?.tagline?.trim() || ""
  };
}

async function readTemplate(): Promise<string> {
  return fs.readFile(path.resolve("templates/enterprise.html"), "utf8");
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key: string) => values[key] ?? "");
}
