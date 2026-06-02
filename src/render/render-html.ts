import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, BrandProfile } from "../config.js";
import { isPrivateLinkVisibility, normalizeVisibility, type DocumentModel } from "../model/document.js";
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

  const isPrivateLink = isPrivateLinkVisibility(meta.visibility);
  const classification = classify(meta.visibility, meta.privateLinkNamespace);
  const updated = formatDate(document.source.lastEditedTime ?? document.source.createdTime);

  const sloganBlock = brand.tagline ? `<p class="masthead-slogan">${escapeHtml(brand.tagline)}</p>` : "";
  const noindex = isPrivateLink ? '<meta name="robots" content="noindex, nofollow">' : "";

  return fillTemplate(template, {
    noindex,
    title: escapeHtml(meta.title),
    docId: escapeHtml(meta.docId),
    documentType: escapeHtml(meta.documentType.label),
    brand: escapeHtml(brand.displayName),
    sloganBlock,
    topbar: renderTopbar(brand.displayName, ROOT_RELATIVE_FROM_DOC, !isPrivateLink),
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

export function renderIndexHtml(documents: DocumentModel[], config: AppConfig, rootRelative = ""): string {
  const noindex = config.registerPublic ? "" : '<meta name="robots" content="noindex, nofollow">';
  const rows = documents
    .map((document) => {
      const meta = document.meta;
      const brand = resolveBrand(meta.brand.label, config).displayName;
      const classification = classify(meta.visibility);
      return `<tr>
        <td class="register-title"><a href="${escapeHtml(meta.canonicalPath)}">${escapeHtml(meta.title)}</a></td>
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
    ${noindex}
    <title>Document Register</title>
    <link rel="stylesheet" href="${rootRelative}assets/css/screen.css">
    <link rel="stylesheet" href="${rootRelative}assets/css/print.css" media="print">
  </head>
  <body>
    ${renderTopbar("Documents", rootRelative)}
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

export function renderNamespaceRootHtml(namespace: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>No Public Index</title>
    <link rel="stylesheet" href="../assets/css/screen.css">
    <link rel="stylesheet" href="../assets/css/print.css" media="print">
  </head>
  <body>
    <header class="site-topbar no-print"><span class="topbar-brand">Documents</span></header>
    <main class="site-index">
      <header class="register-header">
        <h1>No Public Index Available</h1>
        <p class="register-intro">This area does not have a public document listing.</p>
      </header>
    </main>
  </body>
</html>
`;
}

export function renderDocsRootHtml(registerPublic: boolean): string {
  const noindex = '<meta name="robots" content="noindex, nofollow">';
  const body = registerPublic
    ? `<meta http-equiv="refresh" content="0; url=/register/">`
    : "";
  const message = registerPublic
    ? `<p class="register-intro">Redirecting to <a href="/register/">Document Register</a>&hellip;</p>`
    : `<p class="register-intro">Public documents are listed in the Document Register.</p>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${noindex}
    ${body}
    <title>Document Index</title>
    <link rel="stylesheet" href="../assets/css/screen.css">
    <link rel="stylesheet" href="../assets/css/print.css" media="print">
  </head>
  <body>
    <header class="site-topbar no-print"><a class="topbar-brand" href="../">Documents</a></header>
    <main class="site-index">
      <header class="register-header">
        <h1>Document Index</h1>
        ${message}
      </header>
    </main>
  </body>
</html>
`;
}

/* ----------------------------------------------------------------
   Presentation partials
   ---------------------------------------------------------------- */

function renderTopbar(brandLabel: string, rootRelative: string, linkHome = true): string {
  const home = rootRelative || "./";
  const brand = linkHome
    ? `<a class="topbar-brand" href="${escapeHtml(home)}">${escapeHtml(brandLabel)}</a>`
    : `<span class="topbar-brand">${escapeHtml(brandLabel)}</span>`;
  return `<header class="site-topbar no-print">${brand}</header>`;
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
 * UI.
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

function classify(visibility: string, privateLinkNamespace = ""): Classification {
  switch (normalizeVisibility(visibility)) {
    case "public":
      return { label: "Public Release", cls: "is-public" };
    case "client":
      return { label: "Client Link", cls: "is-client-link" };
    case "internal":
      return { label: "Internal Link", cls: "is-internal-link" };
    case "unlisted":
      switch (privateLinkNamespace.trim().toLowerCase()) {
        case "partners": return { label: "Partner Link", cls: "is-partner-link" };
        case "internal": return { label: "Internal Link", cls: "is-internal-link" };
        default: return { label: "Client Link", cls: "is-client-link" };
      }
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
