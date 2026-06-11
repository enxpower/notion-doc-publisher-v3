/**
 * Automated PDF export.
 *
 * Renders already-built static pages from dist/ into US Letter PDFs using
 * Playwright (Chromium). This operates purely on local files produced by a
 * previous build — it performs NO Notion access of any kind.
 *
 * Usage:
 *   npm run pdf                  # export every document page found in dist/
 *   npm run pdf -- /docs/x/      # export a single canonical path
 *
 * Output: dist/pdf/{slug}.pdf  (slug = canonical path segments joined by "-")
 *
 * Playwright is an optional devDependency. If it is not installed, this
 * script explains how to enable it and exits cleanly without failing CI.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST = "dist";
const OUT_DIR = path.join(DIST, "pdf");
const DOCUMENT_NAMESPACES = ["docs", "clients", "partners", "internal"];

type PdfPage = {
  goto(url: string, options: { waitUntil: string }): Promise<unknown>;
  pdf(options: { path: string; format: string; printBackground: boolean; displayHeaderFooter: boolean }): Promise<unknown>;
  close(): Promise<void>;
};

type PdfBrowser = {
  newContext(): Promise<{ newPage(): Promise<PdfPage> }>;
  close(): Promise<void>;
};

async function findDocumentPages(): Promise<string[]> {
  const pages: string[] = [];
  for (const ns of DOCUMENT_NAMESPACES) {
    const nsDir = path.join(DIST, ns);
    let entries;
    try {
      entries = await fs.readdir(nsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const indexFile = path.join(nsDir, entry.name, "index.html");
      try {
        await fs.access(indexFile);
        pages.push(indexFile);
      } catch {
        // no index.html — skip
      }
    }
  }
  return pages;
}

function slugFor(indexFile: string): string {
  return path
    .relative(DIST, path.dirname(indexFile))
    .split(path.sep)
    .join("-");
}

async function main(): Promise<void> {
  // Playwright is an optional devDependency resolved at runtime only, so the
  // module is imported untyped to keep the core build free of its types.
  let chromium: { launch(): Promise<PdfBrowser> };
  try {
    ({ chromium } = (await import("playwright" as string)) as { chromium: { launch(): Promise<PdfBrowser> } });
  } catch {
    console.log(
      "PDF export skipped: playwright is not installed.\n" +
        "Enable with:  npm install --save-dev playwright && npx playwright install chromium"
    );
    return;
  }

  const filter = process.argv[2];
  let pages = await findDocumentPages();
  if (filter) {
    const wanted = filter.replace(/^\/+|\/+$/g, "");
    pages = pages.filter((p) => path.relative(DIST, path.dirname(p)).split(path.sep).join("/") === wanted);
    if (pages.length === 0) {
      console.error(`PDF export: no built page found for path "${filter}". Run a build first.`);
      process.exitCode = 1;
      return;
    }
  }
  if (pages.length === 0) {
    console.log("PDF export: no document pages found in dist/. Run a build first.");
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    for (const indexFile of pages) {
      const page = await context.newPage();
      await page.goto(pathToFileURL(path.resolve(indexFile)).href, { waitUntil: "networkidle" });
      const outFile = path.join(OUT_DIR, `${slugFor(indexFile)}.pdf`);
      // print.css drives all pagination, headers, and US Letter sizing.
      // displayHeaderFooter stays false per the no-browser-chrome requirement.
      await page.pdf({
        path: outFile,
        format: "Letter",
        printBackground: true,
        displayHeaderFooter: false
      });
      await page.close();
      console.log(`PDF written: ${outFile}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`PDF export complete: ${pages.length} document(s).`);
}

await main();
