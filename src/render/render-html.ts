import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, BrandProfile } from "../config.js";
import { isPrivateLinkVisibility, normalizeVisibility, type DocumentBlock, type DocumentMeta, type DocumentModel } from "../model/document.js";
import { escapeHtml, renderBlocks } from "./render-blocks.js";
import { isPublishableCandidate } from "../validate/validate.js";

type BrandPresentation = {
  displayName: string;
  tagline: string;
  shareImage?: string;
  favicon?: string;
};

type TocEntry = { level: number; text: string; id: string };

type Classification = { label: string; cls: string };

const ROOT_RELATIVE_FROM_DOC = "../../";

export async function renderDocumentHtml(document: DocumentModel, config: AppConfig): Promise<string> {
  const template = await readTemplate();
  const meta = document.meta;
  const brand = resolveBrand(meta.brand.label, config);

  // Heading ids and TOC entries are generated at the block-render stage from
  // structured rich text — no post-hoc HTML parsing. h2/h3 (Notion heading_1/2)
  // enter the TOC; h4 receives an anchor id only, matching prior behavior.
  const toc: TocEntry[] = [];
  const body = renderBlocks(document.content, isPublishableCandidate(document, config) ? "publishable" : "draft", {
    collectHeading: (level, text, id) => {
      if (level === 2 || level === 3) {
        toc.push({ level, text, id });
      }
    }
  });

  const isPrivateLink = isPrivateLinkVisibility(meta.visibility);
  const classification = classify(meta.visibility, meta.privateLinkNamespace);
  const updated = formatDate(document.source.lastEditedTime ?? document.source.createdTime);

  const sloganBlock = brand.tagline ? `<p class="masthead-slogan">${escapeHtml(brand.tagline)}</p>` : "";
  const noindex = isPrivateLink ? '<meta name="robots" content="noindex, nofollow">' : "";
  const metaTags = buildMetaTags(meta, document.content, isPrivateLink, brand, config);

  return fillTemplate(template, {
    noindex,
    metaTags,
    title: escapeHtml(meta.title),
    docId: escapeHtml(meta.docId),
    documentType: escapeHtml(meta.documentType.label),
    brand: escapeHtml(brand.displayName),
    sloganBlock,
    topbar: renderTopbar(brand.displayName, ROOT_RELATIVE_FROM_DOC, !isPrivateLink),
    metaGrid: renderMetaGrid(meta.docId, meta.documentType.label, meta.version, meta.status, classification, meta.client.label, meta.project.label, updated),
    actions: renderActions(meta.docId, ROOT_RELATIVE_FROM_DOC, config.pdfPath),
    toc: renderToc(toc),
    body,
    footer: renderFooter(brand.displayName, meta.docId, meta.version),
    screenCss: `${ROOT_RELATIVE_FROM_DOC}assets/css/screen.css`,
    printCss: `${ROOT_RELATIVE_FROM_DOC}assets/css/print.css`
  });
}

export function renderIndexHtml(documents: DocumentModel[], config: AppConfig, rootRelative = ""): string {
  const noindex = config.registerPublic ? "" : '<meta name="robots" content="noindex, nofollow">';
  const registerMetaTags = buildRegisterMetaTags(config, rootRelative);
  const rows = documents
    .map((document) => {
      const meta = document.meta;
      const brand = resolveBrand(meta.brand.label, config).displayName;
      const classification = classify(meta.visibility);
      return `<tr>
        <td class="register-title" data-label="Title"><a href="${escapeHtml(meta.canonicalPath)}">${escapeHtml(meta.title)}</a></td>
        <td data-label="DOC_ID"><code>${escapeHtml(meta.docId)}</code></td>
        <td data-label="Brand">${escapeHtml(brand)}</td>
        <td data-label="Client">${escapeHtml(meta.client.label)}</td>
        <td data-label="Type">${escapeHtml(meta.documentType.label)}</td>
        <td data-label="Version">${escapeHtml(meta.version)}</td>
        <td data-label="Classification"><span class="tag ${classification.cls}">${escapeHtml(classification.label)}</span></td>
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
    ${registerMetaTags}
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
        <p class="document-kicker">Private Area</p>
        <h1>No Public Index Available</h1>
        <p class="register-intro">This area does not have a public document listing. Documents here are accessible only through their private links.</p>
      </header>
      <footer class="site-footer">
        <span>Document Portal</span>
        <span>Restricted</span>
      </footer>
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
        <p class="document-kicker">Document Portal</p>
        <h1>Document Index</h1>
        ${message}
      </header>
      <footer class="site-footer">
        <span>Document Portal</span>
        <span>&nbsp;</span>
      </footer>
    </main>
  </body>
</html>
`;
}

/* ----------------------------------------------------------------
   Share metadata (description / OG / Twitter Card / favicon)
   ---------------------------------------------------------------- */

function buildMetaTags(
  meta: DocumentMeta,
  content: DocumentBlock[],
  isPrivateLink: boolean,
  brand: BrandPresentation,
  config: AppConfig
): string {
  const lines: string[] = [];
  const domain = config.targetSiteDomain?.replace(/\/+$/, "") ?? "";
  const shareImageFile = brand.shareImage ?? "share-preview.png";
  const faviconFile = brand.favicon ?? "favicon.ico";
  const ogImage = domain ? escapeHtml(`${domain}/assets/${shareImageFile}`) : "";
  const twitterCard = ogImage ? "summary_large_image" : "summary";

  lines.push(renderFaviconLink(faviconFile, ROOT_RELATIVE_FROM_DOC));

  if (isPrivateLink) {
    const ogTitle = escapeHtml(truncate(meta.title || `${brand.displayName} Document`, 60));
    const rawDesc = extractDescription(content, brand);
    const ogDesc = rawDesc
      ? escapeHtml(truncate(rawDesc, 160))
      : escapeHtml(`${brand.displayName}${meta.documentType.label ? ` · ${meta.documentType.label}` : ""}`);

    lines.push(`<meta name="description" content="${ogDesc}">`);
    lines.push(`<meta property="og:type" content="article">`);
    lines.push(`<meta property="og:title" content="${ogTitle}">`);
    lines.push(`<meta property="og:description" content="${ogDesc}">`);
    if (ogImage) {
      lines.push(`<meta property="og:image" content="${ogImage}">`);
      lines.push(`<meta property="og:image:width" content="1200">`);
      lines.push(`<meta property="og:image:height" content="630">`);
    }
    lines.push(`<meta name="twitter:card" content="${twitterCard}">`);
    lines.push(`<meta name="twitter:title" content="${ogTitle}">`);
    lines.push(`<meta name="twitter:description" content="${ogDesc}">`);
    if (ogImage) lines.push(`<meta name="twitter:image" content="${ogImage}">`);
  } else {
    const ogTitle = escapeHtml(truncate(meta.title, 60));
    const rawDesc = extractDescription(content, brand);
    const ogDesc = rawDesc ? escapeHtml(truncate(rawDesc, 160)) : "";

    if (ogDesc) lines.push(`<meta name="description" content="${ogDesc}">`);
    lines.push(`<meta property="og:type" content="article">`);
    lines.push(`<meta property="og:title" content="${ogTitle}">`);
    if (ogDesc) lines.push(`<meta property="og:description" content="${ogDesc}">`);
    if (domain && meta.canonicalPath) {
      lines.push(`<meta property="og:url" content="${escapeHtml(domain + meta.canonicalPath)}">`);
    }
    if (ogImage) {
      lines.push(`<meta property="og:image" content="${ogImage}">`);
      lines.push(`<meta property="og:image:width" content="1200">`);
      lines.push(`<meta property="og:image:height" content="630">`);
    }
    lines.push(`<meta name="twitter:card" content="${twitterCard}">`);
    lines.push(`<meta name="twitter:title" content="${ogTitle}">`);
    if (ogDesc) lines.push(`<meta name="twitter:description" content="${ogDesc}">`);
    if (ogImage) lines.push(`<meta name="twitter:image" content="${ogImage}">`);
  }

  return lines.join("\n    ");
}

function extractDescription(content: DocumentBlock[], brand: BrandPresentation): string {
  for (const block of content) {
    if (block.type === "paragraph" && block.richText.length > 0) {
      const text = block.richText.map((span) => span.text).join("").trim();
      if (text.length >= 10) {
        return text;
      }
    }
  }
  return brand.tagline || "";
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "\u2026";
}

function buildRegisterMetaTags(config: AppConfig, rootRelative: string): string {
  const domain = config.targetSiteDomain?.replace(/\/+$/, "") ?? "";
  const ogTitle = "Document Register";
  const ogDesc = "A formal register of published documents.";
  const canonicalPath = rootRelative === "" ? "/" : "/register/";
  const ogImage = domain ? escapeHtml(`${domain}/assets/share-preview.png`) : "";
  const twitterCard = ogImage ? "summary_large_image" : "summary";
  const lines: string[] = [];

  lines.push(renderFaviconLink("favicon.ico", rootRelative));
  lines.push(`<meta name="description" content="${escapeHtml(ogDesc)}">`);
  lines.push(`<meta property="og:type" content="website">`);
  lines.push(`<meta property="og:title" content="${escapeHtml(ogTitle)}">`);
  lines.push(`<meta property="og:description" content="${escapeHtml(ogDesc)}">`);
  if (domain) lines.push(`<meta property="og:url" content="${escapeHtml(domain + canonicalPath)}">`);
  if (ogImage) {
    lines.push(`<meta property="og:image" content="${ogImage}">`);
    lines.push(`<meta property="og:image:width" content="1200">`);
    lines.push(`<meta property="og:image:height" content="630">`);
  }
  lines.push(`<meta name="twitter:card" content="${twitterCard}">`);
  lines.push(`<meta name="twitter:title" content="${escapeHtml(ogTitle)}">`);
  lines.push(`<meta name="twitter:description" content="${escapeHtml(ogDesc)}">`);
  if (ogImage) lines.push(`<meta name="twitter:image" content="${ogImage}">`);

  return lines.join("\n    ");
}

function renderFaviconLink(file: string, rootRelative: string): string {
  const type = file.endsWith(".png") ? ' type="image/png"' : file.endsWith(".svg") ? ' type="image/svg+xml"' : "";
  return `<link rel="icon"${type} href="${rootRelative}assets/${escapeHtml(file)}">`;
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

function renderMetaGrid(
  docId: string,
  type: string,
  version: string,
  status: string,
  classification: Classification,
  client: string,
  project: string,
  updated: string
): string {
  const cell = (label: string, value: string, valueCls = "") => {
    const v = value
      ? `<span class="meta-value${valueCls ? ` ${valueCls}` : ""}">${escapeHtml(value)}</span>`
      : `<span class="meta-value meta-value--empty">\u2014</span>`;
    return `<div class="meta-item"><span class="meta-label">${escapeHtml(label)}</span>${v}</div>`;
  };
  const tagCell = (label: string, tagCls: string, tagLabel: string) =>
    `<div class="meta-item"><span class="meta-label">${escapeHtml(label)}</span><span class="tag ${tagCls}">${escapeHtml(tagLabel)}</span></div>`;

  return [
    cell("Document ID", docId, "meta-value--id"),
    cell("Type", type),
    cell("Version", version),
    status ? tagCell("Status", `status-${slugify(status)}`, status) : cell("Status", ""),
    cell("Client", client),
    cell("Project", project),
    cell("Updated", updated),
    tagCell("Access", classification.cls, classification.label),
  ].join("");
}

/**
 * Compact, secondary print/download actions.
 * Print opens the browser's native print dialog.
 * Download PDF links to the pre-generated site PDF at {rootRelative}{pdfPath}/{DOC_ID}.pdf.
 * Uses a relative path (rootRelative) so the link works correctly on both
 * root deployments (docs.arcbos.com) and sub-path deployments
 * (e.g. enxpower.github.io/publisher-energize/).
 * Exported for unit testing.
 */
export function renderActions(docId?: string | null, rootRelative = "../../", pdfPath = "pdf"): string {
  const printBtn = `<button type="button" class="action-btn" onclick="window.print()" title="Print this document using your browser" aria-label="Print this document">Print</button>`;
  if (!docId) return printBtn;
  const safePdfPath = pdfPath.replace(/^\/+|\/+$/g, "") || "pdf";
  const pdfBtn = `<a href="${rootRelative}${escapeHtml(safePdfPath)}/${escapeHtml(docId)}.pdf" class="action-btn action-btn--download-pdf" title="Download pre-generated PDF" aria-label="Download PDF" download>Download PDF</a>`;
  return `${printBtn}${pdfBtn}`;
}

function renderToc(entries: TocEntry[]): string {
  if (entries.length < 4) {
    return "";
  }
  const minLevel = Math.min(...entries.map((entry) => entry.level));
  const items = entries
    .map((entry) => {
      const depth = entry.level - minLevel;
      return `<li class="toc-d${depth}"><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`;
    })
    .join("");
  const sectionCount = entries.length;
  const isLong = sectionCount > 12;
  return `<nav class="document-toc no-print" aria-label="Contents">
        <details class="toc-details"${isLong ? "" : " open"}>
          <summary class="toc-title">Contents<span class="toc-count">${sectionCount} sections</span></summary>
          <ol class="toc-list">${items}</ol>
        </details>
      </nav>`;
}

function renderFooter(brandLabel: string, docId: string, version: string): string {
  const ref = [docId, version ? `Version ${version}` : ""].filter(Boolean).map(escapeHtml).join(" \u00b7 ");
  return `<div class="footer-row">
          <span class="footer-brand">${escapeHtml(brandLabel)}</span>
          <span class="footer-ref">${ref}</span>
        </div>`;
}

/* ----------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------- */

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
    tagline: profile?.tagline?.trim() || "",
    shareImage: profile?.shareImage?.trim() || undefined,
    favicon: profile?.favicon?.trim() || undefined
  };
}

async function readTemplate(): Promise<string> {
  return fs.readFile(path.resolve("templates/enterprise.html"), "utf8");
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key: string) => values[key] ?? "");
}
