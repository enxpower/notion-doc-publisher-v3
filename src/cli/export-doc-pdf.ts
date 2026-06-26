/**
 * Sidecar document PDF export — npm run pdf:doc
 *
 * Reads dist/reports/build-report.json (produced by a prior npm run build),
 * re-renders each published document using templates/pdf-document.html and
 * styles/pdf-document.css, and writes dist/pdf/{DOC_ID}.pdf.
 *
 * Safety boundaries:
 *   - No Notion access of any kind.
 *   - Does not modify dist/docs/{DOC_ID}/ HTML output.
 *   - Does not modify GitHub Actions workflows.
 *   - Does not write to Notion.
 *   - Output is dist/pdf/{DOC_ID}.pdf only.
 *
 * Usage:
 *   npm run pdf:doc                           -- export all published documents
 *   npm run pdf:doc -- ARCBOS-CON-2606-0001   -- export one document by DOC_ID
 *
 * Prerequisites:
 *   npm run build            (requires NOTION_TOKEN, produces dist/)
 *   npx playwright install chromium
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST = "dist";
const OUT_DIR = path.join(DIST, "pdf");
const BUILD_REPORT = path.join(DIST, "reports", "build-report.json");
const PDF_TEMPLATE = "templates/pdf-document.html";
const PDF_CSS = "styles/pdf-document.css";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type ReportDoc = {
  docId: string;
  title: string;
  path: string;
  status: string;
  visibility: string;
  publish: boolean;
};

type ParsedDocHtml = {
  brand: string;
  tagline: string;
  documentType: string;
  version: string;
  client: string;
  project: string;
  body: string;
  heroAbsSrc: string;
};

type PdfBrowser = {
  newContext(): Promise<PdfContext>;
  close(): Promise<void>;
};

type PdfContext = {
  newPage(): Promise<PdfPage>;
};

type PdfPage = {
  goto(url: string, opts: { waitUntil: string }): Promise<unknown>;
  pdf(opts: {
    path: string;
    format: string;
    printBackground: boolean;
    displayHeaderFooter: boolean;
    headerTemplate?: string;
    footerTemplate?: string;
    margin?: { top?: string; bottom?: string; left?: string; right?: string };
  }): Promise<unknown>;
  close(): Promise<void>;
};

/* ------------------------------------------------------------------ */
/* Build report                                                        */
/* ------------------------------------------------------------------ */

async function readBuildReport(): Promise<ReportDoc[]> {
  let raw: string;
  try {
    raw = await fs.readFile(BUILD_REPORT, "utf8");
  } catch {
    throw new Error(
      `PDF export: ${BUILD_REPORT} not found.\n` +
      `Run "npm run build" first (requires NOTION_TOKEN).`
    );
  }
  let parsed: { documents?: unknown };
  try {
    parsed = JSON.parse(raw) as { documents?: unknown };
  } catch {
    throw new Error(`PDF export: ${BUILD_REPORT} is not valid JSON.`);
  }
  if (!Array.isArray(parsed.documents)) {
    throw new Error(`PDF export: ${BUILD_REPORT} has no "documents" array.`);
  }
  return parsed.documents as ReportDoc[];
}

/* ------------------------------------------------------------------ */
/* HTML extraction from built enterprise.html output                   */
/* ------------------------------------------------------------------ */

function extractBetweenTags(html: string, openTag: string, closeTag: string): string {
  const start = html.indexOf(openTag);
  if (start === -1) return "";
  const inner = start + openTag.length;
  const end = html.indexOf(closeTag, inner);
  if (end === -1) return "";
  return html.slice(inner, end).trim();
}

function extractPlainText(html: string, openTag: string, closeTag: string): string {
  return extractBetweenTags(html, openTag, closeTag).replace(/<[^>]+>/g, "").trim();
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absolutifyImgSrcs(bodyHtml: string, distDocDir: string): string {
  return bodyHtml.replace(/(<img\b[^>]*\ssrc=")([^"]+)(")/g, (_m, pre, src: string, post) => {
    if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("file:")) {
      return pre + src + post;
    }
    const abs = path.resolve(distDocDir, src);
    return `${pre}${pathToFileURL(abs).href}${post}`;
  });
}

function extractHeroAbsSrc(bodyHtml: string): string {
  const figMatch = bodyHtml.match(/<figure[\s\S]*?<img\b[^>]*\ssrc="(file:[^"]+)"/);
  if (figMatch) return figMatch[1]!;
  const imgMatch = bodyHtml.match(/<img\b[^>]*\ssrc="(file:[^"]+)"/);
  if (imgMatch) return imgMatch[1]!;
  return "";
}

function parseBuiltHtml(html: string, distDocDir: string): ParsedDocHtml {
  const brand = unescapeHtml(extractPlainText(html, '<div class="masthead-brand">', "</div>"));
  const tagline = unescapeHtml(extractPlainText(html, '<p class="masthead-slogan">', "</p>"));

  // Document type kicker: use first occurrence, which is inside the title block
  const documentType = unescapeHtml(extractPlainText(html, '<p class="document-kicker">', "</p>"));

  // Version from identity-facts: "Version v1.0" pattern
  const identityHtml = extractBetweenTags(html, '<div class="identity-facts">', "</div>");
  const versionMatch = identityHtml.match(/Version\s+([^<\s]+)/);
  const version = versionMatch ? unescapeHtml(versionMatch[1]!) : "";

  // Client and project from document-meta dl
  const metaHtml = extractBetweenTags(html, '<dl class="document-meta">', "</dl>");
  let client = "";
  let project = "";
  for (const divMatch of metaHtml.matchAll(/<div>([\s\S]*?)<\/div>/g)) {
    const div = divMatch[1]!;
    const labelMatch = div.match(/<dt>([^<]+)<\/dt>/);
    const valueMatch = div.match(/<dd>([\s\S]*?)<\/dd>/);
    if (!labelMatch || !valueMatch) continue;
    const label = labelMatch[1]!.trim();
    const value = unescapeHtml(valueMatch[1]!.replace(/<[^>]+>/g, "").trim());
    if (label === "Client") client = value;
    else if (label === "Project") project = value;
  }

  // Body: content between <section class="document-content"> and </section>
  let body = extractBetweenTags(html, '<section class="document-content">', "</section>");
  // Rewrite relative img src to absolute file:// paths for Playwright
  body = absolutifyImgSrcs(body, distDocDir);

  // Hero: first image in body (src already absolutified)
  const heroAbsSrc = extractHeroAbsSrc(body);

  return { brand, tagline, documentType, version, client, project, body, heroAbsSrc };
}

/* ------------------------------------------------------------------ */
/* PDF HTML composition                                                */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPdfHtml(template: string, css: string, parsed: ParsedDocHtml, doc: ReportDoc): string {
  const taglineBlock = parsed.tagline
    ? `<span class="pdf-tagline">${escapeHtml(parsed.tagline)}</span>`
    : "";

  const identityParts: string[] = [];
  if (doc.docId)
    identityParts.push(`<span class="pdf-identity-id">${escapeHtml(doc.docId)}</span>`);
  if (parsed.documentType)
    identityParts.push(`<span>${escapeHtml(parsed.documentType)}</span>`);
  if (parsed.version)
    identityParts.push(`<span>Version ${escapeHtml(parsed.version)}</span>`);
  if (doc.status)
    identityParts.push(`<span>${escapeHtml(doc.status)}</span>`);
  const identityLine = identityParts.join('<span class="pdf-sep"> · </span>');

  const metaFields: Array<[string, string]> = (
    [
      ["Client", parsed.client] as [string, string],
      ["Project", parsed.project] as [string, string],
    ]
  ).filter(([, v]) => Boolean(v));
  const metaSection =
    metaFields.length > 0
      ? `<section class="pdf-meta"><dl class="pdf-meta-dl">${metaFields
          .map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`)
          .join("")}</dl></section>`
      : "";

  const heroBlock = parsed.heroAbsSrc
    ? `<figure class="pdf-hero"><img src="${escapeHtml(parsed.heroAbsSrc)}" alt=""></figure>`
    : "";

  const footerRef = [doc.docId, parsed.version ? `Version ${parsed.version}` : ""]
    .filter(Boolean)
    .join(" · ");

  const slots: Record<string, string> = {
    title: escapeHtml(doc.title),
    docId: escapeHtml(doc.docId),
    brand: escapeHtml(parsed.brand || doc.title),
    taglineBlock,
    documentType: escapeHtml(parsed.documentType),
    heroBlock,
    identityLine,
    metaSection,
    body: parsed.body,
    footerRef: escapeHtml(footerRef),
    inlineCss: css,
  };

  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_m, key: string) => slots[key] ?? "");
}

/* ------------------------------------------------------------------ */
/* Running footer template for Playwright displayHeaderFooter          */
/* ------------------------------------------------------------------ */

function buildFooterTemplate(brand: string, docId: string, version: string): string {
  const ref = [docId, version ? `Version ${version}` : ""].filter(Boolean).join(" · ");
  const left = escapeHtml(`${brand} · ${ref}`);
  return (
    `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:7pt;color:#555;` +
    `display:flex;justify-content:space-between;padding:0 18mm;box-sizing:border-box;">` +
    `<span>${left}</span>` +
    `<span><span class="pageNumber"></span>&thinsp;/&thinsp;<span class="totalPages"></span></span>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  // Playwright is an optional devDependency — resolved at runtime only.
  let chromium: { launch(): Promise<PdfBrowser> };
  try {
    ({ chromium } = (await import("playwright" as string)) as {
      chromium: { launch(): Promise<PdfBrowser> };
    });
  } catch {
    console.error(
      "PDF export failed: playwright is not installed.\n" +
        "Install with:  npm install --save-dev playwright && npx playwright install chromium"
    );
    process.exitCode = 1;
    return;
  }

  // Read build report
  let allDocs: ReportDoc[];
  try {
    allDocs = await readBuildReport();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (allDocs.length === 0) {
    console.log("PDF export: no documents in build-report.json. Run npm run build first.");
    return;
  }

  // Optional single-document filter: npm run pdf:doc -- ARCBOS-CON-2606-0001
  const filter = process.argv[2]?.trim();
  let targets = allDocs.filter((d) => d.publish && d.docId);

  if (filter) {
    targets = targets.filter((d) => d.docId === filter);
    if (targets.length === 0) {
      const available = allDocs
        .filter((d) => d.docId)
        .map((d) => d.docId)
        .join(", ");
      console.error(
        `PDF export: document "${filter}" not found in build-report.json.\n` +
          `Available DOC_IDs: ${available || "(none)"}`
      );
      process.exitCode = 1;
      return;
    }
  }

  if (targets.length === 0) {
    console.log("PDF export: no publishable documents with DOC_IDs in build-report.json.");
    return;
  }

  // Read PDF-specific template and CSS
  let template: string;
  let css: string;
  try {
    template = await fs.readFile(PDF_TEMPLATE, "utf8");
  } catch {
    console.error(`PDF export: template not found at ${PDF_TEMPLATE}`);
    process.exitCode = 1;
    return;
  }
  try {
    css = await fs.readFile(PDF_CSS, "utf8");
  } catch {
    console.error(`PDF export: CSS not found at ${PDF_CSS}`);
    process.exitCode = 1;
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-doc-"));
  let count = 0;
  try {
    const ctx = await browser.newContext();
    for (const doc of targets) {
      if (!doc.path) {
        console.warn(`[SKIP] ${doc.docId}: no canonical path in build report.`);
        continue;
      }

      // Find built HTML from existing dist/
      const relPath = doc.path.replace(/^\/|\/$/g, "");
      const indexFile = path.join(DIST, relPath, "index.html");
      let builtHtml: string;
      try {
        builtHtml = await fs.readFile(indexFile, "utf8");
      } catch {
        console.warn(
          `[SKIP] ${doc.docId}: built HTML not found at ${indexFile}.\n` +
            `       Run "npm run build" first.`
        );
        continue;
      }

      // Parse metadata and body from built HTML (sidecar — no Notion access)
      const distDocDir = path.resolve(DIST, relPath);
      const parsed = parseBuiltHtml(builtHtml, distDocDir);

      // Compose PDF-specific HTML
      const pdfHtml = buildPdfHtml(template, css, parsed, doc);

      // Write to temp file so Playwright can load it via file:// URL
      const tmpFile = path.join(tmpDir, `${doc.docId}.html`);
      await fs.writeFile(tmpFile, pdfHtml, "utf8");

      const outFile = path.join(OUT_DIR, `${doc.docId}.pdf`);
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(path.resolve(tmpFile)).href, { waitUntil: "networkidle" });

      const footerTemplate = buildFooterTemplate(
        parsed.brand || doc.docId,
        doc.docId,
        parsed.version
      );

      await page.pdf({
        path: outFile,
        format: "Letter",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate,
        margin: { top: "18mm", bottom: "24mm", left: "18mm", right: "18mm" },
      });

      await page.close();
      console.log(`PDF written: ${outFile}`);
      count++;
    }
  } finally {
    await browser.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  if (count === 0 && targets.length > 0) {
    console.error(
      `PDF export: 0 of ${targets.length} document(s) exported (see warnings above).`
    );
    process.exitCode = 1;
  } else {
    console.log(`PDF export complete: ${count} document(s).`);
  }
}

await main();
