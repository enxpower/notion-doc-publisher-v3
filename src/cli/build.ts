import fs from "node:fs/promises";
import path from "node:path";
import { copyDocumentAssets, copyStyles } from "../assets/copy-assets.js";
import { loadConfigOrThrow, runCli } from "../config.js";
import { VALID_PRIVATE_LINK_NAMESPACES, isPrivateLinkVisibility, normalizeVisibility } from "../model/document.js";
import { renderDocumentHtml, renderDocsRootHtml, renderIndexHtml, renderNamespaceRootHtml } from "../render/render-html.js";
import { autoFillDocuments, createReport, loadDocuments, publishableDocuments, skippedDueToErrors, validateLoadedDocuments, writeJson } from "./shared.js";
import { isPublicIndexListed, isPublishableCandidate } from "../validate/validate.js";

await runCli(async () => {
  const config = loadConfigOrThrow();
  await fs.mkdir("dist", { recursive: true });
  await copyStyles("dist");

  // Prune stale document subdirectories from all namespace paths before writing fresh output
  for (const ns of ["docs", "clients", "partners", "internal"]) {
    try {
      for (const entry of await fs.readdir(path.join("dist", ns), { withFileTypes: true })) {
        if (entry.isDirectory()) {
          await fs.rm(path.join("dist", ns, entry.name), { recursive: true, force: true });
        }
      }
    } catch {
      // Directory doesn't exist yet — nothing to prune
    }
  }

  // Write an empty emergency report immediately so writeback-preview never fails
  // to find the file if an unhandled exception occurs later in this script
  // (e.g. Notion API timeout during loadDocuments / autoFillDocuments).
  await writeJson("dist/reports/validation-report.json", {
    generatedAt: new Date().toISOString(),
    documents: [],
    errors: [{ code: "BUILD_CRASH", message: "Build process did not complete. Check workflow logs for details.", pageId: null }],
    warnings: []
  });

  const documents = await loadDocuments(config);

  // Auto-fill missing Share Token / Namespace / Portal Category and write back to Notion
  await autoFillDocuments(documents, config);

  const candidates = documents.filter((document) => isPublishableCandidate(document, config));

  // Prune stale asset directories for documents no longer in the current build
  const currentDocIds = new Set(candidates.map((doc) => doc.meta.docId).filter(Boolean));
  try {
    for (const entry of await fs.readdir(path.join("dist", "assets", "docs"), { withFileTypes: true })) {
      if (entry.isDirectory() && !currentDocIds.has(entry.name)) {
        await fs.rm(path.join("dist", "assets", "docs", entry.name), { recursive: true, force: true });
      }
    }
  } catch {
    // assets/docs doesn't exist yet — nothing to prune
  }

  for (const document of candidates) {
    await copyDocumentAssets(document, "dist");
  }

  validateLoadedDocuments(documents, config);
  const report = createReport(documents);
  await writeJson("dist/reports/validation-report.json", report);

  // Documents with validation errors are skipped — not built, not deployed.
  // They are written back to Notion as failed by writeback-preview.
  // All other publishable documents proceed normally.
  const skipped = skippedDueToErrors(documents, config);
  if (skipped.length > 0) {
    console.warn(`[WARN] ${skipped.length} document(s) skipped due to validation errors (other documents will still publish):`);
    for (const doc of skipped) {
      const reasons = doc.validation.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
      console.warn(`  - ${doc.meta.title || "(untitled)"} [${doc.meta.docId || "(no DOC_ID)"}]: ${reasons}`);
    }
  }

  const published = publishableDocuments(documents, config);

  // Write document pages
  for (const document of published) {
    if (!document.meta.canonicalPath) {
      console.error(`[SKIP] ${document.meta.docId || "(no id)"}: skipped — no canonical path (missing Share Token?).`);
      continue;
    }
    const segments = document.meta.canonicalPath.replace(/^\/|\/$/g, "").split("/");
    const outputDir = path.join("dist", ...segments);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "index.html"), await renderDocumentHtml(document, config), "utf8");

    const vis = document.meta.visibility.trim().toLowerCase();
    const vNorm = normalizeVisibility(vis);

    // LEGACY_PRIVATE_DOC_ID_URLS: also emit /{ns}/{DOC_ID}-{token}/ with noindex (exposes DOC_ID — external use only with explicit flag)
    if (isPrivateLinkVisibility(vis) && config.legacyPrivateDocIdUrls && document.meta.docId && document.meta.shareToken) {
      const ns = vNorm === "client" ? "clients"
        : vNorm === "internal" ? "internal"
        : (VALID_PRIVATE_LINK_NAMESPACES.has(document.meta.privateLinkNamespace)
            ? document.meta.privateLinkNamespace
            : "clients");
      const legacySlug = `${document.meta.docId}-${document.meta.shareToken}`;
      const legacyDir = path.join("dist", ns, legacySlug);
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(path.join(legacyDir, "index.html"), await renderDocumentHtml(document, config), "utf8");
      console.warn(
        `[WARN] ${document.meta.docId}: Also written to legacy URL /${ns}/${legacySlug}/ (LEGACY_PRIVATE_DOC_ID_URLS=true). ` +
        `DOC_ID is exposed in this path and must not be shared externally.`
      );
    }

    // LEGACY_UNLISTED_DOCS_PATH: also emit /docs/{DOC_ID}/ for Unlisted docs (guessable by sequential DOC_ID)
    if (vNorm === "unlisted" && config.legacyUnlistedDocsPath && document.meta.docId) {
      const legacyDir = path.join("dist", "docs", document.meta.docId);
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(path.join(legacyDir, "index.html"), await renderDocumentHtml(document, config), "utf8");
      console.warn(
        `[WARN] ${document.meta.docId}: Also written to legacy /docs/${document.meta.docId}/ (LEGACY_UNLISTED_DOCS_PATH=true). ` +
        `Sequential DOC_IDs are guessable. Do not share these URLs with clients.`
      );
    }
  }

  // Public index: only Public + Portal Listed documents
  const indexListed = published.filter(isPublicIndexListed);

  // Homepage at root (same content as register)
  await fs.writeFile(path.join("dist", "index.html"), renderIndexHtml(indexListed, config, ""), "utf8");

  // Document Register at /register/
  await fs.mkdir(path.join("dist", "register"), { recursive: true });
  await fs.writeFile(path.join("dist", "register", "index.html"), renderIndexHtml(indexListed, config, "../"), "utf8");

  // Namespace root index pages (prevent directory listing and inventory exposure)
  await fs.mkdir(path.join("dist", "docs"), { recursive: true });
  await fs.writeFile(path.join("dist", "docs", "index.html"), renderDocsRootHtml(config.registerPublic), "utf8");
  for (const namespace of ["clients", "partners", "internal"] as const) {
    await fs.mkdir(path.join("dist", namespace), { recursive: true });
    await fs.writeFile(path.join("dist", namespace, "index.html"), renderNamespaceRootHtml(namespace), "utf8");
  }

  // robots.txt — guidance only, not access control
  const robotsDisallows: string[] = [
    "Disallow: /clients/",
    "Disallow: /partners/",
    "Disallow: /internal/",
    "Disallow: /document-register/",
    "Disallow: /search-index.json"
  ];
  if (!config.registerPublic) robotsDisallows.push("Disallow: /register/");
  if (config.robotsDisallowDocs) robotsDisallows.push("Disallow: /docs/");
  await fs.writeFile(
    path.join("dist", "robots.txt"),
    `User-agent: *\n${robotsDisallows.join("\n")}\n`,
    "utf8"
  );

  // sitemap.xml — only Public + Portal Listed documents
  if (config.targetSiteDomain && indexListed.length > 0) {
    const domain = config.targetSiteDomain.replace(/\/+$/, "");
    const urls = indexListed
      .filter((doc) => doc.meta.canonicalPath)
      .map((doc) => {
        const lastmod = doc.source.lastEditedTime ?? doc.source.createdTime;
        const modTag = lastmod ? `\n      <lastmod>${lastmod.slice(0, 10)}</lastmod>` : "";
        return `  <url>\n    <loc>${domain}${doc.meta.canonicalPath}</loc>${modTag}\n  </url>`;
      })
      .join("\n");
    await fs.writeFile(
      path.join("dist", "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      "utf8"
    );
  }

  const buildReport = createReport(published);
  await writeJson("dist/reports/build-report.json", buildReport);
  console.log(`Built ${published.length} document(s) into dist/. Skipped ${skipped.length} document(s) with errors.`);
});
