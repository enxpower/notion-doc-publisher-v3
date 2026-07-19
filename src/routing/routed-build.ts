import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { VALID_PRIVATE_LINK_NAMESPACES, type DocumentModel, type ValidationIssue } from "../model/document.js";
import { DOC_ID_PATTERN, parseDocId } from "../doc-id/generator.js";
import { renderDocumentHtml, renderDocsRootHtml, renderIndexHtml, renderNamespaceRootHtml } from "../render/render-html.js";
import { isPublicIndexListed, isPublishableCandidate, validateDocuments } from "../validate/validate.js";
import {
  computeRouteFinalUrl,
  createDryRunDeploymentPlan,
  createRoutedPublishingPlan,
  isSafeRelativePublicPath,
  normalizeBrand,
  type BrandOutputManifest,
  type BrandRoute,
  type DryRunDeploymentPlan
} from "./brand-routing.js";
import { inspectPdfFile, type RoutedPdfRenderer } from "./routed-pdf.js";

export type RoutedBuildStatus = "success" | "blocked" | "failed";

export type RoutedManifestIssue = {
  code: string;
  message: string;
  docId?: string;
  path?: string;
};

export type RoutedDocumentPlan = {
  docId: string;
  canonicalPath: string;
  finalUrl: string;
  htmlPath: string;
  pdfPath?: string;
};

export type RoutedPdfRenderStatus = "planned" | "success" | "failed";

export type RoutedPdfManifestResult = {
  docId: string;
  path: string;
  status: RoutedPdfRenderStatus;
  presentationProfileKey?: string | null;
  byteSize?: number;
  pageCount?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type RoutedBrandManifest = {
  schema: "notion-doc-publisher-v3/routed-brand-manifest";
  version: 1;
  brand: string;
  routeId: string;
  sourceDocumentCount: number;
  successfullyBuiltDocumentCount: number;
  rejectedDocumentCount: number;
  outputRoot: string;
  targetRepository: string | null;
  targetBaseUrl: string;
  targetDomain: string;
  cname?: string;
  presentationProfileKey?: string | null;
  allowedUrlNamespaces: string[];
  canonicalPaths: string[];
  pdfPaths: string[];
  plannedPdfCount: number;
  successfulPdfCount: number;
  failedPdfCount: number;
  pdfResults: RoutedPdfManifestResult[];
  writebackPlan: Array<{ docId: string; url: string }>;
  documents: RoutedDocumentPlan[];
  files: string[];
  buildTimestamp: string;
  buildStatus: RoutedBuildStatus;
  errors: RoutedManifestIssue[];
  warnings: RoutedManifestIssue[];
  deploymentPlan: DryRunDeploymentPlan;
};

export type RoutedBuildSummary = {
  schema: "notion-doc-publisher-v3/routed-build-summary";
  version: 1;
  buildTimestamp: string;
  outputBaseRoot: string;
  routeCount: number;
  sourceDocumentCount: number;
  rejectedDocumentCount: number;
  brands: Array<{
    brand: string;
    routeId: string;
    manifestPath: string;
    outputRoot: string;
    buildStatus: RoutedBuildStatus;
    deploymentOk: boolean;
    successfullyBuiltDocumentCount: number;
    rejectedDocumentCount: number;
  }>;
  rejectedDocuments: Array<{ brand: string; docId?: string; reason: string }>;
};

export type RoutedBuildResult = {
  summary: RoutedBuildSummary;
  manifests: RoutedBrandManifest[];
};

export async function buildRoutedSites(input: {
  documents: DocumentModel[];
  routes: BrandRoute[];
  config: AppConfig;
  outputBaseRoot: string;
  previousSnapshots?: Record<string, string[]>;
  now?: () => string;
  prevalidated?: boolean;
  pdfRenderer?: RoutedPdfRenderer;
  redactPrivateManifestPaths?: boolean;
}): Promise<RoutedBuildResult> {
  const buildTimestamp = input.now?.() ?? new Date().toISOString();
  const outputBaseRoot = path.resolve(input.outputBaseRoot);
  assertUniqueRouteBrands(input.routes);
  await fs.mkdir(outputBaseRoot, { recursive: true });

  const documents = input.documents.map(cloneDocument);
  if (input.prevalidated !== true) {
    validateDocuments(documents, input.config);
  }
  const candidates = documents.filter((document) => isPublishableCandidate(document, input.config));
  const routed = createRoutedPublishingPlan(candidates, input.routes);
  const manifests: RoutedBrandManifest[] = [];
  const rejectedDocuments = routed.rejected.map((rejected) => ({
    brand: rejected.brand,
    reason: sanitizeMessage(rejected.reason)
  }));

  for (const plan of routed.plans) {
    const route = {
      ...plan.route,
      outputRoot: path.resolve(plan.route.outputRoot)
    };
    const brand = normalizeBrand(route.brand);
    const sourceDocuments = plan.documents;
    const routeErrors: RoutedManifestIssue[] = plan.errors.map((message) => ({
      code: "ROUTE_PLAN_BLOCKED",
      message
    }));
    const routeWarnings: RoutedManifestIssue[] = [];

    const validatedDocuments = plan.ok
      ? sourceDocuments.filter((document) => document.validation.errors.length === 0)
      : [];
    const rejectedForValidation = sourceDocuments.filter((document) => document.validation.errors.length > 0);
    routeErrors.push(...rejectedForValidation.flatMap((document) => sanitizeIssues(document.validation.errors)));
    routeWarnings.push(...sourceDocuments.flatMap((document) => sanitizeIssues(document.validation.warnings)));

    const documentsForOutput = validatedDocuments.filter((document) => {
      const pathIssues = validateDocumentRoutePath(document, route);
      if (pathIssues.length > 0) {
        routeErrors.push(...pathIssues);
        return false;
      }
      const namespace = canonicalNamespace(document.meta.canonicalPath);
      if (!namespace || !(route.allowedUrlNamespaces ?? []).includes(namespace)) {
        routeErrors.push({
          code: "ROUTE_NAMESPACE_BLOCKED",
          message: `Canonical path namespace is not allowed for route ${route.brand}: ${document.meta.canonicalPath || "(empty)"}.`,
          docId: document.meta.docId,
          path: document.meta.canonicalPath
        });
        return false;
      }
      return true;
    });

    const trackedFiles: string[] = [];
    const documentPlans: RoutedDocumentPlan[] = [];
    const pdfResults: RoutedPdfManifestResult[] = [];

    if (plan.ok && routeErrors.length === 0 && documentsForOutput.length > 0) {
      const routeConfig = {
        ...input.config,
        targetSiteDomain: route.targetDomain
      };
      trackedFiles.push(...await copyRouteStaticAssets(route.outputRoot, route, input.config));

      for (const document of documentsForOutput) {
        const canonicalRelativePath = canonicalPathToRelative(document.meta.canonicalPath);
        if (!canonicalRelativePath) {
          routeErrors.push({
            code: "ROUTE_CANONICAL_PATH_BLOCKED",
            message: `Canonical path is unsafe for route ${route.brand}: ${document.meta.canonicalPath || "(empty)"}.`,
            docId: document.meta.docId,
            path: document.meta.canonicalPath
          });
          continue;
        }
        const segments = canonicalRelativePath.split("/");
        const outputDir = path.join(route.outputRoot, ...segments);
        await fs.mkdir(outputDir, { recursive: true });
        const html = await renderDocumentHtml(document, routeConfig);
        const htmlValidation = validateRenderedHtml(html, document, input.routes, route);
        if (htmlValidation.length > 0) {
          routeErrors.push(...htmlValidation);
          continue;
        }
        const htmlPath = path.join(...segments, "index.html");
        await fs.writeFile(path.join(outputDir, "index.html"), html, "utf8");
        trackedFiles.push(htmlPath);
        documentPlans.push({
          docId: document.meta.docId,
          canonicalPath: document.meta.canonicalPath,
          finalUrl: computeRouteFinalUrl(route, document.meta.canonicalPath),
          htmlPath,
          pdfPath: document.meta.docId ? `pdf/${document.meta.docId}.pdf` : undefined
        });
      }

      await writeRouteShellPages(route.outputRoot, documentsForOutput, routeConfig, trackedFiles);

      if (input.pdfRenderer) {
        const pdfRenderResult = await renderRoutePdfs({
          documents: documentsForOutput,
          documentPlans,
          route,
          config: routeConfig,
          outputBaseRoot,
          renderer: input.pdfRenderer
        });
        trackedFiles.push(...pdfRenderResult.files);
        routeErrors.push(...pdfRenderResult.errors);
        pdfResults.push(...pdfRenderResult.results);
      } else {
        pdfResults.push(...documentPlans.flatMap((document) => document.pdfPath
          ? [{
              docId: document.docId,
              path: document.pdfPath,
              status: "planned" as const,
              presentationProfileKey: route.presentationProfileKey ?? null
            }]
          : []
        ));
      }
    }

    const uniqueFiles = uniqueSorted(trackedFiles);
    const previous = input.previousSnapshots?.[normalizeBrand(route.brand)] ?? [];
    const deletions = previous.filter((file) => !uniqueFiles.includes(file));
    const deploymentManifest: BrandOutputManifest = {
      brand: route.brand,
      outputRoot: route.outputRoot,
      targetRepository: route.targetRepository,
      targetDomain: route.targetDomain,
      files: uniqueFiles,
      deletions,
      existingFileCount: previous.length
    };
    const deploymentPlan = createDryRunDeploymentPlan({
      route,
      manifest: deploymentManifest,
      sourceDir: route.outputRoot,
      allowedStagingRoot: outputBaseRoot,
      productionDeploymentEnabled: false
    });
    const finalDeploymentPlan = routeErrors.length > 0
      ? blockDeploymentPlan(deploymentPlan, "Route output has blocking build errors.")
      : deploymentPlan;
    const successfullyBuiltDocumentCount = documentPlans.length;
    const rejectedDocumentCount = sourceDocuments.length - successfullyBuiltDocumentCount;
    const buildStatus: RoutedBuildStatus = routeErrors.length > 0
      ? successfullyBuiltDocumentCount > 0 ? "failed" : "blocked"
      : uniqueFiles.length > 0 ? "success" : "blocked";
    const publicOutputRoot = path.posix.join(brand, "site");
    const successfulPdfResults = pdfResults.filter((result) => result.status === "success");
    const failedPdfResults = pdfResults.filter((result) => result.status === "failed");
    const plannedPdfCount = documentPlans.filter((document) => document.pdfPath).length;
    const manifestDocuments = input.redactPrivateManifestPaths
      ? documentPlans.map((document) => redactPrivateDocumentPlan(document))
      : documentPlans;
    const manifestFiles = input.redactPrivateManifestPaths ? redactPrivateFileList(uniqueFiles) : uniqueFiles;
    const manifestCanonicalPaths = input.redactPrivateManifestPaths
      ? documentPlans.map((document) => redactPrivateCanonicalPath(document.canonicalPath))
      : documentPlans.map((document) => document.canonicalPath);
    const manifestWritebackPlan = input.redactPrivateManifestPaths
      ? documentPlans.map((document) => ({
          docId: document.docId,
          url: isPrivateCanonicalPath(document.canonicalPath) ? "[redacted-private-url]" : document.finalUrl
        }))
      : documentPlans.map((document) => ({ docId: document.docId, url: document.finalUrl }));

    const manifest: RoutedBrandManifest = {
      schema: "notion-doc-publisher-v3/routed-brand-manifest",
      version: 1,
      brand,
      routeId: route.routeId ?? brand.toLowerCase(),
      sourceDocumentCount: sourceDocuments.length,
      successfullyBuiltDocumentCount,
      rejectedDocumentCount,
      outputRoot: publicOutputRoot,
      targetRepository: route.targetRepository,
      targetBaseUrl: route.targetDomain,
      targetDomain: route.targetDomain,
      cname: route.cname,
      presentationProfileKey: route.presentationProfileKey,
      allowedUrlNamespaces: route.allowedUrlNamespaces ?? [],
      canonicalPaths: manifestCanonicalPaths,
      pdfPaths: input.pdfRenderer
        ? successfulPdfResults.map((result) => result.path)
        : documentPlans.flatMap((document) => document.pdfPath ? [document.pdfPath] : []),
      plannedPdfCount,
      successfulPdfCount: successfulPdfResults.length,
      failedPdfCount: failedPdfResults.length,
      pdfResults,
      writebackPlan: manifestWritebackPlan,
      documents: manifestDocuments,
      files: manifestFiles,
      buildTimestamp,
      buildStatus,
      errors: sanitizeManifestIssues(routeErrors),
      warnings: sanitizeManifestIssues(routeWarnings),
      deploymentPlan: publicDeploymentPlan(finalDeploymentPlan, publicOutputRoot, input.redactPrivateManifestPaths === true)
    };

    await writeManifest(outputBaseRoot, manifest);
    manifests.push(manifest);
  }

  const summary: RoutedBuildSummary = {
    schema: "notion-doc-publisher-v3/routed-build-summary",
    version: 1,
    buildTimestamp,
    outputBaseRoot: ".",
    routeCount: input.routes.length,
    sourceDocumentCount: documents.length,
    rejectedDocumentCount: rejectedDocuments.length + manifests.reduce((sum, manifest) => sum + manifest.rejectedDocumentCount, 0),
    brands: manifests.map((manifest) => ({
      brand: manifest.brand,
      routeId: manifest.routeId,
      manifestPath: path.posix.join(manifest.brand, "manifest.json"),
      outputRoot: manifest.outputRoot,
      buildStatus: manifest.buildStatus,
      deploymentOk: manifest.deploymentPlan.ok,
      successfullyBuiltDocumentCount: manifest.successfullyBuiltDocumentCount,
      rejectedDocumentCount: manifest.rejectedDocumentCount
    })),
    rejectedDocuments
  };
  await fs.writeFile(path.join(outputBaseRoot, "routed-build-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  return { summary, manifests };
}

async function renderRoutePdfs(input: {
  documents: DocumentModel[];
  documentPlans: RoutedDocumentPlan[];
  route: BrandRoute;
  config: AppConfig;
  outputBaseRoot: string;
  renderer: RoutedPdfRenderer;
}): Promise<{
  results: RoutedPdfManifestResult[];
  files: string[];
  errors: RoutedManifestIssue[];
}> {
  const brand = normalizeBrand(input.route.brand);
  const documentByDocId = new Map(input.documents.map((document) => [document.meta.docId, document]));
  const results: RoutedPdfManifestResult[] = [];
  const files: string[] = [];
  const errors: RoutedManifestIssue[] = [];

  for (const plan of input.documentPlans) {
    if (!plan.pdfPath || !plan.docId) {
      const issue = {
        code: "PDF_PATH_MISSING",
        message: "Expected PDF path is missing from the routed document plan.",
        docId: plan.docId
      };
      errors.push(issue);
      results.push(failedPdfResult(plan, input.route, issue));
      continue;
    }

    if (!isSafeRelativePublicPath(plan.pdfPath)) {
      const issue = {
        code: "PDF_PATH_UNSAFE",
        message: "Expected PDF path is not a safe relative public path.",
        docId: plan.docId,
        path: plan.pdfPath
      };
      errors.push(issue);
      results.push(failedPdfResult(plan, input.route, issue));
      continue;
    }

    const document = documentByDocId.get(plan.docId);
    if (!document) {
      const issue = {
        code: "PDF_DOCUMENT_MISSING",
        message: "Routed PDF plan does not match an accepted in-memory document.",
        docId: plan.docId
      };
      errors.push(issue);
      results.push(failedPdfResult(plan, input.route, issue));
      continue;
    }

    const outputPdfPath = path.resolve(input.route.outputRoot, plan.pdfPath);
    if (!isPathInsideRoot(outputPdfPath, input.route.outputRoot)) {
      const issue = {
        code: "PDF_OUTPUT_ESCAPES_ROUTE",
        message: "Expected PDF output path escapes the brand site root.",
        docId: plan.docId,
        path: plan.pdfPath
      };
      errors.push(issue);
      results.push(failedPdfResult(plan, input.route, issue));
      continue;
    }

    try {
      await input.renderer({
        document,
        config: input.config,
        route: input.route,
        outputPdfPath,
        workDir: path.join(input.outputBaseRoot, "_pdf-work", brand, plan.docId)
      });
    } catch (error) {
      const issue = {
        code: "PDF_RENDER_FAILED",
        message: sanitizeMessage(error instanceof Error ? error.message : "PDF rendering failed."),
        docId: plan.docId
      };
      errors.push(issue);
      results.push(failedPdfResult(plan, input.route, issue));
      continue;
    }

    const inspection = await inspectPdfFile(outputPdfPath);
    if (!inspection.ok) {
      const issue = {
        code: inspection.errorCode ?? "PDF_INTEGRITY_FAILED",
        message: sanitizeMessage(inspection.errorMessage ?? "Generated PDF did not pass integrity checks."),
        docId: plan.docId,
        path: plan.pdfPath
      };
      errors.push(issue);
      results.push({
        docId: plan.docId,
        path: plan.pdfPath,
        status: "failed",
        presentationProfileKey: input.route.presentationProfileKey ?? null,
        byteSize: inspection.byteSize,
        pageCount: inspection.pageCount,
        errorCode: issue.code,
        errorMessage: issue.message
      });
      continue;
    }

    const htmlLinkIssue = await validatePdfHtmlLink(input.route.outputRoot, plan);
    if (htmlLinkIssue) {
      errors.push(htmlLinkIssue);
      results.push({
        docId: plan.docId,
        path: plan.pdfPath,
        status: "failed",
        presentationProfileKey: input.route.presentationProfileKey ?? null,
        byteSize: inspection.byteSize,
        pageCount: inspection.pageCount,
        errorCode: htmlLinkIssue.code,
        errorMessage: htmlLinkIssue.message
      });
      continue;
    }

    files.push(plan.pdfPath);
    results.push({
      docId: plan.docId,
      path: plan.pdfPath,
      status: "success",
      presentationProfileKey: input.route.presentationProfileKey ?? null,
      byteSize: inspection.byteSize,
      pageCount: inspection.pageCount
    });
  }

  return { results, files, errors };
}

function failedPdfResult(
  plan: RoutedDocumentPlan,
  route: BrandRoute,
  issue: RoutedManifestIssue
): RoutedPdfManifestResult {
  return {
    docId: plan.docId,
    path: plan.pdfPath ?? "",
    status: "failed",
    presentationProfileKey: route.presentationProfileKey ?? null,
    errorCode: issue.code,
    errorMessage: issue.message
  };
}

async function validatePdfHtmlLink(
  outputRoot: string,
  plan: RoutedDocumentPlan
): Promise<RoutedManifestIssue | undefined> {
  const htmlPath = path.resolve(outputRoot, plan.htmlPath);
  if (!isPathInsideRoot(htmlPath, outputRoot)) {
    return {
      code: "HTML_PATH_ESCAPES_ROUTE",
      message: "Rendered HTML path escapes the brand site root.",
      docId: plan.docId,
      path: plan.htmlPath
    };
  }

  try {
    const html = await fs.readFile(htmlPath, "utf8");
    const expectedHref = `href="../../${plan.pdfPath}"`;
    if (!html.includes(expectedHref)) {
      return {
        code: "HTML_PDF_LINK_MISSING",
        message: "Rendered HTML does not link to the generated same-brand PDF path.",
        docId: plan.docId
      };
    }
  } catch {
    return {
      code: "HTML_OUTPUT_MISSING",
      message: "Rendered HTML file was not found for PDF link validation.",
      docId: plan.docId,
      path: plan.htmlPath
    };
  }

  return undefined;
}

function blockDeploymentPlan(plan: DryRunDeploymentPlan, reason: string): DryRunDeploymentPlan {
  return {
    ...plan,
    ok: false,
    errors: [...new Set([...plan.errors, reason])]
  };
}

async function writeRouteShellPages(
  outputRoot: string,
  documents: DocumentModel[],
  config: AppConfig,
  trackedFiles: string[]
): Promise<void> {
  const indexListed = documents.filter(isPublicIndexListed);

  await fs.writeFile(path.join(outputRoot, "index.html"), renderIndexHtml(indexListed, config, ""), "utf8");
  trackedFiles.push("index.html");

  await fs.mkdir(path.join(outputRoot, "register"), { recursive: true });
  await fs.writeFile(path.join(outputRoot, "register", "index.html"), renderIndexHtml(indexListed, config, "../"), "utf8");
  trackedFiles.push(path.join("register", "index.html"));

  await fs.mkdir(path.join(outputRoot, "docs"), { recursive: true });
  await fs.writeFile(path.join(outputRoot, "docs", "index.html"), renderDocsRootHtml(config.registerPublic), "utf8");
  trackedFiles.push(path.join("docs", "index.html"));

  for (const namespace of VALID_PRIVATE_LINK_NAMESPACES) {
    await fs.mkdir(path.join(outputRoot, namespace), { recursive: true });
    await fs.writeFile(path.join(outputRoot, namespace, "index.html"), renderNamespaceRootHtml(namespace), "utf8");
    trackedFiles.push(path.join(namespace, "index.html"));
  }

  await fs.writeFile(
    path.join(outputRoot, "robots.txt"),
    [
      "User-agent: *",
      "Disallow: /clients/",
      "Disallow: /partners/",
      "Disallow: /internal/",
      "Disallow: /document-register/",
      "Disallow: /search-index.json/",
      config.registerPublic ? "" : "Disallow: /register/"
    ].filter(Boolean).join("\n") + "\n",
    "utf8"
  );
  trackedFiles.push("robots.txt");

  if (config.targetSiteDomain && indexListed.length > 0) {
    const domain = config.targetSiteDomain.replace(/\/+$/, "");
    const urls = indexListed
      .filter((document) => document.meta.canonicalPath)
      .map((document) => `  <url>\n    <loc>${domain}${document.meta.canonicalPath}</loc>\n  </url>`)
      .join("\n");
    await fs.writeFile(
      path.join(outputRoot, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      "utf8"
    );
    trackedFiles.push("sitemap.xml");
  }
}

async function copyRouteStaticAssets(outputRoot: string, route: BrandRoute, config: AppConfig): Promise<string[]> {
  await fs.mkdir(path.join(outputRoot, "assets", "css"), { recursive: true });
  await fs.copyFile("styles/screen.css", path.join(outputRoot, "assets", "css", "screen.css"));
  await fs.copyFile("styles/print.css", path.join(outputRoot, "assets", "css", "print.css"));
  const copied = [
    path.join("assets", "css", "screen.css"),
    path.join("assets", "css", "print.css")
  ];

  const assets = new Set(["favicon.ico", "favicon.png"]);
  const profile = route.presentationProfileKey ? config.brandProfiles[route.presentationProfileKey] : undefined;
  assets.add(profile?.shareImage ?? "share-preview.png");

  for (const asset of assets) {
    try {
      await fs.copyFile(path.join("assets", asset), path.join(outputRoot, "assets", asset));
      copied.push(path.join("assets", asset));
    } catch {
      // Optional static asset missing; renderer metadata may still point at it.
    }
  }

  return copied;
}

async function writeManifest(outputBaseRoot: string, manifest: RoutedBrandManifest): Promise<void> {
  const manifestDir = path.join(outputBaseRoot, manifest.brand);
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(path.join(manifestDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function validateRenderedHtml(
  html: string,
  document: DocumentModel,
  routes: BrandRoute[],
  currentRoute: BrandRoute
): RoutedManifestIssue[] {
  const issues: RoutedManifestIssue[] = [];
  if (!html.includes("window.print()")) {
    issues.push({ code: "HTML_PRINT_ACTION_MISSING", message: "Rendered HTML is missing window.print().", docId: document.meta.docId });
  }
  if (document.meta.docId && !html.includes(`href="../../pdf/${document.meta.docId}.pdf"`)) {
    issues.push({ code: "HTML_PDF_LINK_MISSING", message: "Rendered HTML is missing the expected relative PDF link.", docId: document.meta.docId });
  }
  for (const route of routes) {
    const otherBrand = normalizeBrand(route.brand);
    if (otherBrand === normalizeBrand(currentRoute.brand)) {
      continue;
    }
    const otherRoot = `/routes/${otherBrand}/`;
    if (html.includes(otherRoot)) {
      issues.push({
        code: "CROSS_BRAND_ROUTE_ROOT_DETECTED",
        message: `Rendered HTML includes another brand route root: ${otherRoot}`,
        docId: document.meta.docId
      });
    }
    if (html.includes(route.targetDomain)) {
      issues.push({
        code: "CROSS_BRAND_DOMAIN_DETECTED",
        message: `Rendered HTML includes another brand domain: ${route.targetDomain}`,
        docId: document.meta.docId
      });
    }
  }
  return issues;
}

async function listFilesRelative(dir: string, root: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listFilesRelative(filePath, root));
      } else if (entry.isFile()) {
        files.push(path.relative(root, filePath));
      }
    }
  } catch {
    return files;
  }
  return files;
}

function canonicalNamespace(canonicalPath: string): string | undefined {
  return canonicalPath.replace(/^\/+/, "").split("/").filter(Boolean)[0];
}

function validateDocumentRoutePath(document: DocumentModel, route: BrandRoute): RoutedManifestIssue[] {
  const issues: RoutedManifestIssue[] = [];
  const relativePath = canonicalPathToRelative(document.meta.canonicalPath);
  if (!relativePath) {
    issues.push({
      code: "ROUTE_CANONICAL_PATH_BLOCKED",
      message: `Canonical path is unsafe for route ${route.brand}: ${document.meta.canonicalPath || "(empty)"}.`,
      docId: document.meta.docId,
      path: document.meta.canonicalPath
    });
    return issues;
  }

  if (relativePath.startsWith("docs/") && document.meta.docId) {
    const parsed = parseDocId(document.meta.docId);
    if (parsed && parsed.brandToken !== normalizeBrand(route.brand)) {
      issues.push({
        code: "ROUTE_DOC_ID_BRAND_MISMATCH",
        message: `DOC_ID brand token ${parsed.brandToken} cannot be routed through ${normalizeBrand(route.brand)}.`,
        docId: document.meta.docId,
        path: document.meta.canonicalPath
      });
    }
  }

  return issues;
}

function canonicalPathToRelative(canonicalPath: string): string | undefined {
  if (!canonicalPath.startsWith("/")) {
    return undefined;
  }
  const relative = canonicalPath.replace(/^\/|\/$/g, "");
  return isSafeRelativePublicPath(relative) ? relative : undefined;
}

function redactPrivateDocumentPlan(plan: RoutedDocumentPlan): RoutedDocumentPlan {
  if (!isPrivateCanonicalPath(plan.canonicalPath)) {
    return plan;
  }
  return {
    ...plan,
    canonicalPath: redactPrivateCanonicalPath(plan.canonicalPath),
    finalUrl: "[redacted-private-url]",
    htmlPath: redactPrivateRelativePath(plan.htmlPath)
  };
}

function redactPrivateFileList(files: string[]): string[] {
  const aliases = new Map<string, string>();
  const counters = new Map<string, number>();
  return files.map((file) => redactPrivateRelativePath(file, aliases, counters));
}

function redactPrivateCanonicalPath(value: string): string {
  if (!isPrivateCanonicalPath(value)) {
    return value;
  }
  const namespace = canonicalNamespace(value) ?? "private";
  return `/${namespace}/[redacted]/`;
}

function redactPrivateRelativePath(
  value: string,
  aliases?: Map<string, string>,
  counters?: Map<string, number>
): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const namespace = parts[0];
  const token = parts[1];
  if (!namespace || !token || !VALID_PRIVATE_LINK_NAMESPACES.has(namespace)) {
    return normalized;
  }

  let redacted = "[redacted]";
  if (aliases && counters) {
    const key = `${namespace}/${token}`;
    const existing = aliases.get(key);
    if (existing) {
      redacted = existing;
    } else {
      const next = (counters.get(namespace) ?? 0) + 1;
      counters.set(namespace, next);
      redacted = `[redacted-${next}]`;
      aliases.set(key, redacted);
    }
  }
  return [namespace, redacted, ...parts.slice(2)].join("/");
}

function isPrivateCanonicalPath(value: string): boolean {
  const namespace = canonicalNamespace(value);
  return namespace ? VALID_PRIVATE_LINK_NAMESPACES.has(namespace) : false;
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sanitizeIssues(issues: ValidationIssue[]): RoutedManifestIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: sanitizeMessage(issue.message),
    docId: safeDocId(issue.docId),
    path: safeIssuePath(issue.path)
  }));
}

function sanitizeManifestIssues(issues: RoutedManifestIssue[]): RoutedManifestIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: sanitizeMessage(issue.message),
    docId: safeDocId(issue.docId),
    path: safeIssuePath(issue.path)
  }));
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/Share Token "[^"]*"/g, 'Share Token "[redacted]"')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\/Users\/[^\s"]+/g, "[redacted-path]")
    .replace(/\/private\/[^\s"]+/g, "[redacted-path]");
}

function publicDeploymentPlan(plan: DryRunDeploymentPlan, sourceDir: string, redactPrivatePaths = false): DryRunDeploymentPlan {
  return {
    ...plan,
    sourceDir,
    errors: plan.errors.map(sanitizeMessage),
    wouldDelete: redactPrivatePaths ? redactPrivateFileList(plan.wouldDelete) : [...plan.wouldDelete]
  };
}

function safeDocId(value: string | undefined): string | undefined {
  return value && DOC_ID_PATTERN.test(value) ? value : undefined;
}

function safeIssuePath(value: string | undefined): string | undefined {
  if (!value || value.includes("/Users/") || value.includes("/private/") || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) {
    return undefined;
  }
  if (value.startsWith("/")) {
    return redactPrivateCanonicalPath(value);
  }
  if (isSafeRelativePublicPath(value)) {
    return redactPrivateRelativePath(value);
  }
  return /^[a-z]+$/i.test(value) ? value : undefined;
}

function assertUniqueRouteBrands(routes: BrandRoute[]): void {
  const seen = new Set<string>();
  for (const route of routes) {
    const brand = normalizeBrand(route.brand);
    if (!/^[A-Z0-9]+$/.test(brand)) {
      throw new Error(`Route brand is not a safe manifest key: ${brand || "(empty)"}.`);
    }
    if (seen.has(brand)) {
      throw new Error(`Duplicate route brand is not allowed: ${brand}.`);
    }
    seen.add(brand);
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, "/")))].sort();
}

function cloneDocument(document: DocumentModel): DocumentModel {
  return {
    meta: {
      ...document.meta,
      brand: { ...document.meta.brand },
      client: { ...document.meta.client },
      project: { ...document.meta.project },
      documentType: { ...document.meta.documentType }
    },
    content: structuredClone(document.content),
    assets: structuredClone(document.assets),
    source: { ...document.source },
    validation: {
      ok: document.validation.ok,
      errors: [...document.validation.errors],
      warnings: [...document.validation.warnings]
    }
  };
}
