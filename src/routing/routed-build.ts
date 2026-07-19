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
}): Promise<RoutedBuildResult> {
  const buildTimestamp = input.now?.() ?? new Date().toISOString();
  const outputBaseRoot = path.resolve(input.outputBaseRoot);
  assertUniqueRouteBrands(input.routes);
  await fs.mkdir(outputBaseRoot, { recursive: true });

  const documents = input.documents.map(cloneDocument);
  validateDocuments(documents, input.config);
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
    const successfullyBuiltDocumentCount = documentPlans.length;
    const rejectedDocumentCount = sourceDocuments.length - successfullyBuiltDocumentCount;
    const buildStatus: RoutedBuildStatus = routeErrors.length > 0
      ? successfullyBuiltDocumentCount > 0 ? "failed" : "blocked"
      : uniqueFiles.length > 0 ? "success" : "blocked";
    const brand = normalizeBrand(route.brand);
    const publicOutputRoot = path.posix.join(brand, "site");

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
      canonicalPaths: documentPlans.map((document) => document.canonicalPath),
      pdfPaths: documentPlans.flatMap((document) => document.pdfPath ? [document.pdfPath] : []),
      writebackPlan: documentPlans.map((document) => ({ docId: document.docId, url: document.finalUrl })),
      documents: documentPlans,
      files: uniqueFiles,
      buildTimestamp,
      buildStatus,
      errors: sanitizeManifestIssues(routeErrors),
      warnings: sanitizeManifestIssues(routeWarnings),
      deploymentPlan: publicDeploymentPlan(deploymentPlan, publicOutputRoot)
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

function publicDeploymentPlan(plan: DryRunDeploymentPlan, sourceDir: string): DryRunDeploymentPlan {
  return {
    ...plan,
    sourceDir,
    errors: plan.errors.map(sanitizeMessage),
    wouldDelete: [...plan.wouldDelete]
  };
}

function safeDocId(value: string | undefined): string | undefined {
  return value && DOC_ID_PATTERN.test(value) ? value : undefined;
}

function safeIssuePath(value: string | undefined): string | undefined {
  if (!value || value.includes("/Users/") || value.includes("/private/") || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) {
    return undefined;
  }
  return value.startsWith("/") || /^[a-z]+$/i.test(value) ? value : undefined;
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
