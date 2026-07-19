/**
 * Integration tests for the local routed dry-run build path.
 *
 * These tests use committed fixtures and temporary output roots only. They do
 * not require .env, credentials, Notion, GitHub, deployment commands, or
 * network access.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import type { DocumentModel } from "../model/document.js";
import { emptyValidation } from "../model/document.js";
import { buildRoutedSites, type RoutedBuildResult } from "../routing/routed-build.js";
import { normalizeBrand } from "../routing/brand-routing.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";

type BuildInput = {
  documents?: DocumentModel[];
  config?: AppConfig;
  outputBaseRoot?: string;
};

test("brand route config contains exactly the four normalized dry-run brands", async () => {
  const routes = await loadBrandRoutes();
  const brands = routes.map((route) => route.brand).sort();

  assert.deepEqual(brands, ["AGIM", "ARCBOS", "ENERGIZE", "GONG"]);
  assert.equal(routes.find((route) => route.brand === "ARCBOS")!.targetRepository, "enxpower/docs-arcbos-v2");
  assert.equal(routes.find((route) => route.brand === "ARCBOS")!.targetDomain, "https://ref.arcbos.com");
  assert.equal(routes.find((route) => route.brand === "ENERGIZE")!.targetRepository, "enxpower/docs-energize-v2");
  assert.equal(routes.find((route) => route.brand === "ENERGIZE")!.targetDomain, "https://docs.energizeos.com");
  assert.equal(routes.find((route) => route.brand === "AGIM")!.targetRepository, "enxpower/agim-docs");
  assert.equal(routes.find((route) => route.brand === "AGIM")!.targetDomain, "https://docs.agim.ca");
  assert.equal(routes.find((route) => route.brand === "GONG")!.targetRepository, null);
  assert.equal(routes.find((route) => route.brand === "GONG")!.targetDomain, "https://enxpower.com");
  assert.equal(routes.find((route) => route.brand === "GONG")!.repositoryConfirmed, false);
  assert.equal(routes.find((route) => route.brand === "GONG")!.presentationProfileKey, null);
  const brandProfiles = JSON.parse(await fs.readFile(path.resolve("config/brands.json"), "utf8")) as Record<string, unknown>;
  assert.equal("GONG" in brandProfiles, false);
});

test("brand route config rejects duplicate route identifiers", async () => {
  const configPath = await tempRouteConfig((config) => {
    config.ENERGIZE.routeId = "arcbos";
  });

  await assert.rejects(() => loadBrandRoutes(configPath), /Duplicate route identifier/);
});

test("brand route config rejects duplicate repository/domain combinations", async () => {
  const configPath = await tempRouteConfig((config) => {
    config.ENERGIZE.targetRepository = "enxpower/docs-arcbos-v2";
    config.ENERGIZE.targetDomain = "https://ref.arcbos.com";
    config.ENERGIZE.cname = "ref.arcbos.com";
  });

  await assert.rejects(() => loadBrandRoutes(configPath), /Duplicate target repository\/domain combination/);
});

test("brand route config rejects unsupported namespaces", async () => {
  const configPath = await tempRouteConfig((config) => {
    config.ARCBOS.allowedUrlNamespaces = ["docs", "admin"];
  });

  await assert.rejects(() => loadBrandRoutes(configPath), /unsupported namespace: admin/);
});

test("GONG route rejects automatic use of an unconfirmed presentation profile", async () => {
  const configPath = await tempRouteConfig((config) => {
    config.GONG.presentationProfileKey = "GONG";
  });

  await assert.rejects(() => loadBrandRoutes(configPath), /GONG presentation profile is unconfirmed/);
});

test("routed dry-run builds all four brands into separate temporary roots", async () => {
  const { result, outputBaseRoot } = await buildFixture();
  const brands = result.manifests.map((manifest) => manifest.brand).sort();

  assert.deepEqual(brands, ["AGIM", "ARCBOS", "ENERGIZE", "GONG"]);
  for (const manifest of result.manifests) {
    assert.equal(manifest.sourceDocumentCount, 1, manifest.brand);
    assert.equal(manifest.successfullyBuiltDocumentCount, 1, manifest.brand);
    assert.equal(manifest.buildStatus, "success", manifest.brand);
    assert.equal(manifest.outputRoot, `${manifest.brand}/site`);
    assert.equal(manifest.deploymentPlan.sourceDir, `${manifest.brand}/site`);
    assert.ok(await exists(path.join(outputBaseRoot, manifest.outputRoot, "index.html")), `${manifest.brand} index missing`);
    assert.ok(await exists(path.join(outputBaseRoot, manifest.brand, "manifest.json")), `${manifest.brand} manifest missing`);
  }

  assert.equal(result.manifests.find((manifest) => manifest.brand === "GONG")!.deploymentPlan.ok, false);
  assert.ok(
    result.manifests.find((manifest) => manifest.brand === "GONG")!.deploymentPlan.errors.some((error) => error.includes("No confirmed GONG target repository"))
  );
  assert.equal(result.manifests.filter((manifest) => manifest.brand !== "GONG").every((manifest) => manifest.deploymentPlan.ok), true);
});

test("duplicate normalized route brands cannot overwrite another brand manifest", async () => {
  const outputBaseRoot = await tempRoot();
  const routes = routesWithOutputBase(await loadBrandRoutes(), outputBaseRoot);
  const config = await loadRoutedDryRunConfig();
  const arcbosRoute = routes.find((route) => route.brand === "ARCBOS")!;
  const duplicateArcbosRoute = {
    ...arcbosRoute,
    brand: " arcbos ",
    outputRoot: path.join(outputBaseRoot, "ARCBOS-DUPE", "site")
  };

  await assert.rejects(
    () => buildRoutedSites({
      documents: [],
      routes: [arcbosRoute, duplicateArcbosRoute],
      config,
      outputBaseRoot,
      now: () => "2026-07-19T00:00:00.000Z"
    }),
    /Duplicate route brand/
  );
});

test("stale files from another brand are not counted as current output", async () => {
  const outputBaseRoot = await tempRoot();
  const staleArcbosHtml = path.join(outputBaseRoot, "ARCBOS", "site", "docs", "STALE", "index.html");
  await fs.mkdir(path.dirname(staleArcbosHtml), { recursive: true });
  await fs.writeFile(staleArcbosHtml, "<!doctype html><title>stale</title>", "utf8");

  const { result } = await buildFixture({
    outputBaseRoot,
    documents: [
      makeDoc("ENERGIZE", "page-energize-only", {
        docId: "ENERGIZE-SPEC-2606-0200",
        canonicalPath: "/docs/ENERGIZE-SPEC-2606-0200/"
      })
    ]
  });

  const arcbos = result.manifests.find((manifest) => manifest.brand === "ARCBOS")!;
  const energize = result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!;
  assert.equal(arcbos.sourceDocumentCount, 0);
  assert.equal(arcbos.files.includes("docs/STALE/index.html"), false);
  assert.equal(energize.successfullyBuiltDocumentCount, 1);
  assert.deepEqual(energize.canonicalPaths, ["/docs/ENERGIZE-SPEC-2606-0200/"]);
});

test("stale cross-brand assets are not counted as current route output", async () => {
  const outputBaseRoot = await tempRoot();
  const staleAsset = path.join(outputBaseRoot, "ENERGIZE", "site", "assets", "arcbos-share-preview.png");
  await fs.mkdir(path.dirname(staleAsset), { recursive: true });
  await fs.writeFile(staleAsset, "stale cross-brand asset", "utf8");

  const { result } = await buildFixture({
    outputBaseRoot,
    documents: [
      makeDoc("ENERGIZE", "page-energize-asset", {
        docId: "ENERGIZE-SPEC-2606-0201",
        canonicalPath: "/docs/ENERGIZE-SPEC-2606-0201/"
      })
    ]
  });

  const energize = result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!;
  assert.equal(energize.files.includes("assets/energizeos-share-preview.png"), true);
  assert.equal(energize.files.includes("assets/arcbos-share-preview.png"), false);
});

test("two brands with identical DOC_ID values cannot overwrite each other", async () => {
  const docs = [
    makeDoc("ARCBOS", "page-a", {
      docId: "ARCBOS-SPEC-2606-0099",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0099/"
    }),
    makeDoc("ENERGIZE", "page-b", {
      docId: "ARCBOS-SPEC-2606-0099",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0099/"
    })
  ];
  const { result, outputBaseRoot } = await buildFixture({ documents: docs });
  const arcbos = result.manifests.find((manifest) => manifest.brand === "ARCBOS")!;
  const energize = result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!;

  assert.equal(arcbos.successfullyBuiltDocumentCount, 1);
  assert.equal(energize.successfullyBuiltDocumentCount, 0);
  assert.equal(energize.rejectedDocumentCount, 1);
  assert.ok(energize.errors.some((error) => error.code === "DUPLICATE_DOC_ID" || error.code === "OUTPUT_PATH_COLLISION"));
  assert.ok(await exists(path.join(outputBaseRoot, "ARCBOS", "site", "docs", "ARCBOS-SPEC-2606-0099", "index.html")));
  assert.equal(await exists(path.join(outputBaseRoot, "ENERGIZE", "site", "docs", "ARCBOS-SPEC-2606-0099", "index.html")), false);
});

test("existing randomized token paths remain stable in routed dry-run output", async () => {
  const first = await buildFixture();
  const second = await buildFixture();
  const firstEnergize = first.result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!;
  const secondEnergize = second.result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!;

  assert.deepEqual(firstEnergize.canonicalPaths, ["/clients/energizeclient01/"]);
  assert.deepEqual(secondEnergize.canonicalPaths, ["/clients/energizeclient01/"]);
  assert.deepEqual(firstEnergize.writebackPlan.map((item) => item.url), ["https://docs.energizeos.com/clients/energizeclient01/"]);
  assert.deepEqual(secondEnergize.writebackPlan.map((item) => item.url), ["https://docs.energizeos.com/clients/energizeclient01/"]);
});

test("HTML print and PDF actions remain present for every routed brand", async () => {
  const { result, outputBaseRoot } = await buildFixture();

  for (const manifest of result.manifests) {
    const document = manifest.documents[0]!;
    const html = await fs.readFile(path.join(outputBaseRoot, manifest.outputRoot, document.htmlPath), "utf8");
    assert.ok(html.includes("window.print()"), `${manifest.brand} must include print action`);
    assert.ok(html.includes("Download PDF"), `${manifest.brand} must include PDF download action`);
    assert.ok(html.includes(`href="../../pdf/${document.docId}.pdf"`), `${manifest.brand} must include existing relative PDF link`);
    assert.ok(html.includes(`content="${document.finalUrl}"`) || html.includes("noindex"), `${manifest.brand} metadata must remain route-aware`);
  }
});

test("routed manifests match generated output and expose only public-safe paths", async () => {
  const { result, outputBaseRoot } = await buildFixture();

  for (const manifest of result.manifests) {
    const manifestRaw = await fs.readFile(path.join(outputBaseRoot, manifest.brand, "manifest.json"), "utf8");
    assert.ok(!manifestRaw.includes("notionPageId"));
    assert.ok(!manifestRaw.includes("notionDatabaseId"));
    assert.ok(!manifestRaw.includes("fixture-"));
    assert.ok(!manifestRaw.includes(outputBaseRoot));
    assert.ok(!manifestRaw.includes(os.homedir()));
    assert.ok(!manifestRaw.includes(process.cwd()));
    assert.ok(!manifestRaw.includes("dry-run-notion-token"));
    assert.ok(!manifestRaw.includes("@"));
    assert.equal(manifest.schema, "notion-doc-publisher-v3/routed-brand-manifest");
    assert.equal(manifest.version, 1);
    assert.equal(manifest.outputRoot, `${manifest.brand}/site`);
    assert.equal(manifest.deploymentPlan.sourceDir, `${manifest.brand}/site`);
    assert.equal(manifest.files.length > 0, true, manifest.brand);
    const actualOutputRoot = path.join(outputBaseRoot, manifest.outputRoot);
    for (const file of manifest.files) {
      assert.ok(await exists(path.join(actualOutputRoot, file)), `${manifest.brand} manifest file missing: ${file}`);
    }
    for (const document of manifest.documents) {
      assert.ok(manifest.canonicalPaths.includes(document.canonicalPath));
      assert.ok(manifest.pdfPaths.includes(`pdf/${document.docId}.pdf`));
      assert.equal(document.finalUrl, `${manifest.targetBaseUrl}${document.canonicalPath}`);
    }
  }
});

test("routed summary exposes relative manifest and output paths", async () => {
  const { result, outputBaseRoot } = await buildFixture();
  const summaryRaw = await fs.readFile(path.join(outputBaseRoot, "routed-build-summary.json"), "utf8");

  assert.ok(!summaryRaw.includes(outputBaseRoot));
  assert.ok(!summaryRaw.includes(os.homedir()));
  assert.equal(result.summary.outputBaseRoot, ".");
  for (const brand of result.summary.brands) {
    assert.equal(brand.outputRoot, `${brand.brand}/site`);
    assert.equal(brand.manifestPath, `${brand.brand}/manifest.json`);
  }
});

test("unknown Brand blocks only that record while known routes still build", async () => {
  const docs = [
    makeDoc("ARCBOS", "page-known", {
      docId: "ARCBOS-SPEC-2606-0100",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0100/"
    }),
    makeDoc("UNKNOWN", "page-unknown", {
      docId: "UNKNOWN-SPEC-2606-0101",
      canonicalPath: "/docs/UNKNOWN-SPEC-2606-0101/"
    })
  ];
  const { result, outputBaseRoot } = await buildFixture({ documents: docs });
  const arcbos = result.manifests.find((manifest) => manifest.brand === "ARCBOS")!;

  assert.equal(arcbos.successfullyBuiltDocumentCount, 1);
  assert.equal(result.summary.rejectedDocuments.length, 1);
  assert.match(result.summary.rejectedDocuments[0]!.reason, /Unknown Brand/);
  assert.equal(await exists(path.join(outputBaseRoot, "UNKNOWN")), false);
  assert.ok(await exists(path.join(outputBaseRoot, arcbos.outputRoot, "docs", "ARCBOS-SPEC-2606-0100", "index.html")));
});

test("canonical path belonging to another brand cannot enter the current manifest", async () => {
  const docs = [
    makeDoc("ENERGIZE", "page-cross-brand-path", {
      docId: "ARCBOS-SPEC-2606-0103",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0103/"
    })
  ];
  const { result } = await buildFixture({ documents: docs });
  const energize = result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!;

  assert.equal(energize.successfullyBuiltDocumentCount, 0);
  assert.equal(energize.buildStatus, "blocked");
  assert.ok(energize.errors.some((error) => error.code === "ROUTE_DOC_ID_BRAND_MISMATCH"));
  assert.deepEqual(energize.canonicalPaths, []);
});

test("one brand build failure does not delete or mutate another brand output", async () => {
  const outputBaseRoot = await tempRoot();
  const gongSentinel = path.join(outputBaseRoot, "GONG", "site", "sentinel.txt");
  await fs.mkdir(path.dirname(gongSentinel), { recursive: true });
  await fs.writeFile(gongSentinel, "do not delete", "utf8");
  const docs = [
    makeDoc("ENERGIZE", "page-bad", {
      docId: "ENERGIZE-SPEC-2606-0102",
      canonicalPath: "/otherbrand/energizeclient01/"
    })
  ];

  const { result } = await buildFixture({ documents: docs, outputBaseRoot });
  const energize = result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!;

  assert.equal(energize.buildStatus, "blocked");
  assert.ok(energize.errors.some((error) => error.code === "ROUTE_NAMESPACE_BLOCKED"));
  assert.equal(await fs.readFile(gongSentinel, "utf8"), "do not delete");
});

test("ALLOWED_BRANDS remains supported as a routed build filter", async () => {
  const baseConfig = await loadRoutedDryRunConfig();
  const { result } = await buildFixture({
    config: {
      ...baseConfig,
      allowedBrands: new Set(["ENERGIZE"])
    }
  });

  assert.equal(result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!.successfullyBuiltDocumentCount, 1);
  assert.equal(result.manifests.find((manifest) => manifest.brand === "ARCBOS")!.sourceDocumentCount, 0);
  assert.equal(result.manifests.find((manifest) => manifest.brand === "AGIM")!.sourceDocumentCount, 0);
  assert.equal(result.manifests.find((manifest) => manifest.brand === "GONG")!.sourceDocumentCount, 0);
});

test("routed output content is isolated per brand", async () => {
  const { result, outputBaseRoot } = await buildFixture();
  const domainsByBrand = new Map(result.manifests.map((manifest) => [manifest.brand, manifest.targetBaseUrl]));
  const displayByBrand = new Map([
    ["ARCBOS", "ARCBOS"],
    ["ENERGIZE", "ENERGIZE"],
    ["AGIM", "AGI&amp;M"],
    ["GONG", "GONG"]
  ]);

  for (const manifest of result.manifests) {
    const outputRoot = path.join(outputBaseRoot, manifest.outputRoot);
    const document = manifest.documents[0]!;
    const htmlPath = path.join(outputRoot, document.htmlPath);
    const html = await fs.readFile(htmlPath, "utf8");
    assert.ok(await exists(htmlPath), `${manifest.brand} canonical index missing`);
    assert.ok(html.includes("window.print()"), manifest.brand);
    assert.ok(html.includes("Download PDF"), manifest.brand);
    assert.ok(html.includes(`href="../../pdf/${document.docId}.pdf"`), manifest.brand);
    if (document.canonicalPath.startsWith("/docs/")) {
      assert.ok(html.includes(`content="${manifest.targetBaseUrl}${document.canonicalPath}"`), manifest.brand);
    } else {
      assert.ok(html.includes("noindex, nofollow"), manifest.brand);
    }

    for (const [otherBrand, otherDomain] of domainsByBrand) {
      if (otherBrand !== manifest.brand) {
        assert.ok(!html.includes(otherDomain), `${manifest.brand} must not include ${otherDomain}`);
        assert.ok(!html.includes(displayByBrand.get(otherBrand)!), `${manifest.brand} must not include ${otherBrand} display name`);
      }
    }

    const robots = await fs.readFile(path.join(outputRoot, "robots.txt"), "utf8");
    assert.ok(robots.includes("Disallow: /clients/"));
    assert.ok(robots.includes("Disallow: /partners/"));
    assert.ok(robots.includes("Disallow: /internal/"));
    assert.ok(robots.includes("Disallow: /register/"));
    assert.ok(await exists(path.join(outputRoot, "register", "index.html")));
    assert.ok(await exists(path.join(outputRoot, "docs", "index.html")));
    assert.ok(await exists(path.join(outputRoot, "clients", "index.html")));
    assert.ok(await exists(path.join(outputRoot, "partners", "index.html")));
    assert.ok(await exists(path.join(outputRoot, "internal", "index.html")));
    const sitemapPath = path.join(outputRoot, "sitemap.xml");
    if (document.canonicalPath.startsWith("/docs/")) {
      const sitemap = await fs.readFile(sitemapPath, "utf8");
      assert.ok(sitemap.includes(`${manifest.targetBaseUrl}${document.canonicalPath}`), manifest.brand);
    } else {
      assert.equal(await exists(sitemapPath), false, `${manifest.brand} should not emit sitemap without listed docs`);
    }

    const files = await listFiles(outputRoot);
    for (const file of files) {
      assert.ok(!file.startsWith(".."), `${manifest.brand} file escaped route root: ${file}`);
      assert.ok(!file.includes(`${path.sep}..${path.sep}`), `${manifest.brand} file has traversal: ${file}`);
    }
    for (const otherBrand of result.manifests.map((item) => item.brand).filter((brand) => brand !== manifest.brand)) {
      assert.ok(!files.some((file) => file.startsWith(`${otherBrand}/`)), `${manifest.brand} includes cross-brand root ${otherBrand}`);
    }
  }

  const arcbosFiles = await listFiles(path.join(outputBaseRoot, "ARCBOS", "site"));
  assert.ok(arcbosFiles.includes("assets/arcbos-share-preview.png"));
  assert.ok(!arcbosFiles.includes("assets/energizeos-share-preview.png"));
  assert.ok(!arcbosFiles.includes("assets/agim-share-preview.png"));
});

test("existing npm run build behavior remains unchanged and routed dry-run command is separate", async () => {
  const raw = await fs.readFile(path.resolve("package.json"), "utf8");
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  const buildSrc = await fs.readFile(path.resolve("src/cli/build.ts"), "utf8");

  assert.equal(pkg.scripts.build, "tsc && node .tmp/cli/security-lint.js && node .tmp/cli/build.js");
  assert.equal(pkg.scripts["build:routed:dry-run"], "tsc && node .tmp/cli/build-routed-dry-run.js");
  assert.ok(!buildSrc.includes("routed-build"));
  assert.ok(!buildSrc.includes("brand-routing"));
});

async function buildFixture(input: BuildInput = {}): Promise<{ result: RoutedBuildResult; outputBaseRoot: string }> {
  const outputBaseRoot = input.outputBaseRoot ?? await tempRoot();
  const routes = routesWithOutputBase(await loadBrandRoutes(), outputBaseRoot);
  const config = input.config ?? await loadRoutedDryRunConfig();
  const documents = input.documents ?? routedDryRunDocuments();
  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  globalThis.fetch = async (): Promise<Response> => {
    networkCalled = true;
    throw new Error("Network access is forbidden in routed dry-run tests");
  };
  try {
    const result = await buildRoutedSites({
      documents,
      routes,
      config,
      outputBaseRoot,
      now: () => "2026-07-19T00:00:00.000Z"
    });
    assert.equal(networkCalled, false, "routed dry-run build must not perform network calls");
    return { result, outputBaseRoot };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function tempRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "notion-routed-build-"));
}

async function tempRouteConfig(
  mutate: (config: Record<string, {
    brand: string;
    targetRepository: string | null;
    targetDomain: string;
    cname: string;
    routeId: string;
    presentationProfileKey: string | null;
    allowedUrlNamespaces: string[];
    repositoryConfirmed: boolean;
    blockedReason?: string;
  }>) => void
): Promise<string> {
  const raw = await fs.readFile(path.resolve("config/brand-routes.json"), "utf8");
  const parsed = JSON.parse(raw) as Record<string, {
    brand: string;
    targetRepository: string | null;
    targetDomain: string;
    cname: string;
    routeId: string;
    presentationProfileKey: string | null;
    allowedUrlNamespaces: string[];
    repositoryConfirmed: boolean;
    blockedReason?: string;
  }>;
  mutate(parsed);
  const dir = await tempRoot();
  const configPath = path.join(dir, "brand-routes.json");
  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return configPath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string, dir = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, filePath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, filePath).replace(/\\/g, "/"));
    }
  }
  return files.sort();
}

function makeDoc(
  brandLabel: string,
  pageId: string,
  overrides: Partial<DocumentModel["meta"]> & Pick<DocumentModel["meta"], "docId" | "canonicalPath">
): DocumentModel {
  const brand = normalizeBrand(brandLabel);
  const docIdParts = overrides.docId.split("-");
  const typeToken = docIdParts[1] ?? "SPEC";
  const typeLabel = typeToken === "AGR" ? "Agreement" : typeToken === "MEM" ? "Memo" : typeToken === "RPT" ? "Report" : "Specification";
  const { docId, canonicalPath, ...rest } = overrides;
  return {
    meta: {
      docId,
      title: `${brandLabel} Routed Test`,
      brand: { label: brandLabel, token: brand, slug: brand.toLowerCase() },
      client: { label: "Test Client", slug: "test-client" },
      project: { label: "Routed Test", slug: "routed-test" },
      documentType: { label: typeLabel, token: typeToken, slug: typeLabel.toLowerCase() },
      version: "v1.0",
      status: "Approved",
      visibility: "Public",
      publish: true,
      portalListed: true,
      shareToken: "",
      privateLinkNamespace: "",
      category: "",
      portalCategory: "",
      canonicalPath,
      ...rest
    },
    content: [{ type: "paragraph", id: `${pageId}-p1`, richText: [{ text: "Routed build test content." }] }],
    assets: [],
    source: { notionPageId: pageId, notionDatabaseId: "test-db" },
    validation: emptyValidation()
  };
}
