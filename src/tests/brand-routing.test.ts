/**
 * Pure tests for future Brand -> target repository routing contracts.
 *
 * These tests intentionally do not execute deployment commands, GitHub API
 * writes, filesystem deletion, or Notion access. They freeze fail-closed
 * planning behavior before production routing is implemented.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DocumentModel } from "../model/document.js";
import { emptyValidation } from "../model/document.js";
import {
  createDryRunDeploymentPlan,
  createRoutedPublishingPlan,
  normalizeBrand,
  type BrandOutputManifest,
  type BrandRoute
} from "../routing/brand-routing.js";

function makeDoc(
  pageId: string,
  brandLabel: unknown,
  overrides: Partial<DocumentModel["meta"]> = {}
): DocumentModel {
  const label = typeof brandLabel === "string" ? brandLabel : "";
  const token = normalizeBrand(brandLabel).replace(/[^A-Z0-9]/g, "");
  return {
    meta: {
      docId: `${token || "NONE"}-SPEC-2606-0001`,
      title: `${label || "Missing"} Document`,
      brand: { label: brandLabel as string, token, slug: label.trim().toLowerCase() },
      client: { label: "Test Client", slug: "test-client" },
      project: { label: "Test Project", slug: "test-project" },
      documentType: { label: "Specification", token: "SPEC", slug: "spec" },
      version: "v1.0",
      status: "Approved",
      visibility: "Public",
      publish: true,
      portalListed: true,
      shareToken: "",
      privateLinkNamespace: "",
      category: "",
      portalCategory: "",
      canonicalPath: `/docs/${token || "NONE"}-SPEC-2606-0001/`,
      ...overrides
    },
    content: [{ type: "paragraph", id: "p1", richText: [{ text: "Body." }] }],
    assets: [],
    source: { notionPageId: pageId, notionDatabaseId: "test-db" },
    validation: emptyValidation()
  };
}

function route(brand: string, overrides: Partial<BrandRoute> = {}): BrandRoute {
  const slug = normalizeBrand(brand).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    brand,
    outputRoot: `staging/${slug}`,
    targetRepository: `enxpower/${slug}-docs-preview`,
    targetDomain: `https://${slug}.docs.example.test`,
    ...overrides
  };
}

function manifest(routeValue: BrandRoute, overrides: Partial<BrandOutputManifest> = {}): BrandOutputManifest {
  return {
    brand: routeValue.brand,
    outputRoot: routeValue.outputRoot,
    targetRepository: routeValue.targetRepository,
    targetDomain: routeValue.targetDomain,
    files: ["index.html", "docs/ARCBOS-SPEC-2606-0001/index.html"],
    deletions: [],
    existingFileCount: 20,
    ...overrides
  };
}

async function tempSource(): Promise<{ stagingRoot: string; sourceDir: string }> {
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "notion-route-"));
  const sourceDir = path.join(stagingRoot, "brand-output");
  await fs.mkdir(sourceDir, { recursive: true });
  return { stagingRoot, sourceDir };
}

/* ---------------- Brand routing safety ---------------- */

test("routed publishing rejects documents with missing Brand", () => {
  const plan = createRoutedPublishingPlan([makeDoc("page-missing", "   ")], [route("ARCBOS")]);

  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0]!.pageId, "page-missing");
  assert.equal(plan.rejected[0]!.reason, "Missing Brand");
  assert.equal(plan.plans[0]!.documents.length, 0);
});

test("brand normalization is canonical for case and spacing, and null normalizes empty", () => {
  assert.equal(normalizeBrand("ARCBOS"), "ARCBOS");
  assert.equal(normalizeBrand(" arcbos "), "ARCBOS");
  assert.equal(normalizeBrand("ARCBOS   FIELD"), "ARCBOS FIELD");
  assert.equal(normalizeBrand(null), "");
});

test("routed publishing rejects null, empty, and whitespace-only Brand values", () => {
  const plan = createRoutedPublishingPlan(
    [makeDoc("page-null", null), makeDoc("page-empty", ""), makeDoc("page-space", "   ")],
    [route("ARCBOS")]
  );

  assert.equal(plan.rejected.length, 3);
  assert.ok(plan.rejected.every((rejected) => rejected.reason === "Missing Brand"));
});

test("routed publishing rejects documents with unknown Brand", () => {
  const plan = createRoutedPublishingPlan([makeDoc("page-unknown", "Unknown Brand")], [route("ARCBOS")]);

  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0]!.pageId, "page-unknown");
  assert.match(plan.rejected[0]!.reason, /Unknown Brand/);
  assert.equal(plan.plans[0]!.documents.length, 0);
});

test("routed publishing rejects visually different unknown Brand values", () => {
  const plan = createRoutedPublishingPlan([makeDoc("page-fullwidth", "ＡＲＣＢＯＳ")], [route("ARCBOS")]);

  assert.equal(plan.rejected.length, 1);
  assert.match(plan.rejected[0]!.reason, /Unknown Brand/);
});

test("routed publishing matches Brand labels case-insensitively and trims spacing", () => {
  const plan = createRoutedPublishingPlan(
    [makeDoc("page-energize", "  energize  ")],
    [route("ENERGIZE")]
  );

  assert.equal(plan.rejected.length, 0);
  assert.equal(plan.plans[0]!.ok, true);
  assert.equal(plan.plans[0]!.documents[0]!.source.notionPageId, "page-energize");
});

test("routed publishing blocks two brands from sharing the same output root", () => {
  const routes = [
    route("ARCBOS", { outputRoot: "staging/shared/" }),
    route("ENERGIZE", { outputRoot: "staging/shared" })
  ];
  const plan = createRoutedPublishingPlan(
    [makeDoc("page-arcbos", "ARCBOS"), makeDoc("page-energize", "ENERGIZE")],
    routes
  );

  assert.equal(plan.rejected.length, 0);
  assert.equal(plan.plans.length, 2);
  assert.ok(plan.plans.every((brandPlan) => !brandPlan.ok));
  assert.ok(plan.plans.every((brandPlan) => brandPlan.errors.some((error) => error.includes("Output root"))));
});

test("a failed brand route does not mutate another brand plan", () => {
  const routes = [
    route("ARCBOS", { outputRoot: "staging/shared" }),
    route("ENERGIZE", { outputRoot: "staging/shared/" }),
    route("AGIM", { outputRoot: "staging/agim" })
  ];
  const agimDoc = makeDoc("page-agim", "AGIM");
  const plan = createRoutedPublishingPlan([makeDoc("page-arcbos", "ARCBOS"), agimDoc], routes);
  const agimPlan = plan.plans.find((brandPlan) => brandPlan.brand === "AGIM");

  assert.ok(agimPlan, "AGIM route plan must exist");
  assert.equal(agimPlan.ok, true);
  assert.equal(agimPlan.errors.length, 0);
  assert.deepEqual(agimPlan.documents, [agimDoc]);
});

/* ---------------- Dry-run deployment safety ---------------- */

test("dry-run deployment blocks empty brand output", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute, { files: [] }),
    sourceDir: dirs.sourceDir,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("empty")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks missing manifests", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    sourceDir: dirs.sourceDir,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("Missing brand output manifest")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks manifest brand mismatch", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute, { brand: "ENERGIZE" }),
    sourceDir: dirs.sourceDir,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("Manifest brand mismatch")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks target repository mismatch", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute, { targetRepository: "enxpower/wrong-repo" }),
    sourceDir: dirs.sourceDir,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("target repository")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks target domain mismatch", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute, { targetDomain: "https://wrong.example.test" }),
    sourceDir: dirs.sourceDir,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("target domain")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks source directories outside the allowed staging root", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  const outsideSource = path.join(path.dirname(dirs.stagingRoot), `${path.basename(dirs.stagingRoot)}-outside`);
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute),
    sourceDir: outsideSource,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("outside the allowed staging root")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks symlinked source directories that escape staging root", async () => {
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "notion-route-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "notion-route-outside-"));
  const sourceLink = path.join(stagingRoot, "linked-source");
  await fs.symlink(outsideRoot, sourceLink, "dir");
  const arcbosRoute = route("ARCBOS", { outputRoot: sourceLink });
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute),
    sourceDir: sourceLink,
    allowedStagingRoot: stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("outside the allowed staging root")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks source directories that are the staging root, repository root, home, or filesystem root", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  for (const [label, sourceDir, allowedStagingRoot] of [
    ["staging root", dirs.stagingRoot, dirs.stagingRoot],
    ["repository root", process.cwd(), process.cwd()],
    ["home directory", os.homedir(), os.homedir()],
    ["filesystem root", path.parse(process.cwd()).root, path.parse(process.cwd()).root]
  ] as const) {
    const plan = createDryRunDeploymentPlan({
      route: { ...arcbosRoute, outputRoot: sourceDir },
      manifest: manifest({ ...arcbosRoute, outputRoot: sourceDir }),
      sourceDir,
      allowedStagingRoot
    });
    assert.equal(plan.ok, false, label);
    assert.ok(plan.errors.some((error) => error.includes("brand-specific child")), label);
    assert.deepEqual(plan.wouldDelete, [], label);
  }
});

test("dry-run deployment blocks excessive deletion", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute, {
      deletions: ["old-a.html", "old-b.html", "old-c.html"],
      existingFileCount: 10
    }),
    sourceDir: dirs.sourceDir,
    allowedStagingRoot: dirs.stagingRoot,
    maxDeletionRatio: 0.2
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("Excessive deletion")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks negative or malformed deletion thresholds and counts", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  for (const [label, maxDeletionRatio, existingFileCount] of [
    ["negative threshold", -0.1, 100],
    ["NaN threshold", Number.NaN, 100],
    ["overlarge threshold", 1.1, 100],
    ["negative existing count", 0.2, -1],
    ["fractional existing count", 0.2, 10.5],
    ["zero existing count with deletion", 0.2, 0]
  ] as const) {
    const plan = createDryRunDeploymentPlan({
      route: arcbosRoute,
      manifest: manifest(arcbosRoute, {
        deletions: ["old.html"],
        existingFileCount
      }),
      sourceDir: dirs.sourceDir,
      allowedStagingRoot: dirs.stagingRoot,
      maxDeletionRatio
    });

    assert.equal(plan.ok, false, label);
    assert.deepEqual(plan.wouldDelete, [], label);
  }
});

test("dry-run deployment blocks cross-brand deletion", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute, {
      deletions: ["../energize/index.html"],
      existingFileCount: 100
    }),
    sourceDir: dirs.sourceDir,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("Cross-brand deletion") || error.includes("Unsafe deletion path")));
  assert.deepEqual(plan.wouldDelete, []);
});

test("dry-run deployment blocks ../ and URL-encoded traversal in manifest paths", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  for (const file of [
    "../AGIM/site/index.html",
    "docs/../evil/index.html",
    "docs/%2e%2e/evil/index.html",
    "docs/%2E%2E/evil/index.html",
    "docs/%2fescape/index.html",
    "/tmp/notion-routed-build/index.html"
  ]) {
    const plan = createDryRunDeploymentPlan({
      route: arcbosRoute,
      manifest: manifest(arcbosRoute, { files: [file] }),
      sourceDir: dirs.sourceDir,
      allowedStagingRoot: dirs.stagingRoot
    });

    assert.equal(plan.ok, false, file);
    assert.ok(plan.errors.some((error) => error.includes("Unsafe manifest file path") || error.includes("Cross-brand file")), file);
    assert.deepEqual(plan.wouldDelete, [], file);
  }
});

test("dry-run deployment blocks manifest-only and HTML-missing output", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS");
  for (const files of [["manifest.json"], ["assets/css/screen.css"]]) {
    const plan = createDryRunDeploymentPlan({
      route: arcbosRoute,
      manifest: manifest(arcbosRoute, { files }),
      sourceDir: dirs.sourceDir,
      allowedStagingRoot: dirs.stagingRoot
    });

    assert.equal(plan.ok, false, files.join(","));
    assert.ok(plan.errors.some((error) => error.includes("HTML output is missing")));
    assert.deepEqual(plan.wouldDelete, []);
  }
});

test("one brand failing deployment validation does not invalidate another successful brand output", async () => {
  const dirs = await tempSource();
  const arcbosSource = path.join(dirs.stagingRoot, "arcbos");
  const energizeSource = path.join(dirs.stagingRoot, "energize");
  await fs.mkdir(arcbosSource, { recursive: true });
  await fs.mkdir(energizeSource, { recursive: true });

  const arcbosRoute = route("ARCBOS");
  const energizeRoute = route("ENERGIZE");
  const arcbosPlan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute, {
      deletions: ["docs/old-arcbos/index.html"],
      existingFileCount: 100
    }),
    sourceDir: arcbosSource,
    allowedStagingRoot: dirs.stagingRoot
  });
  const energizePlan = createDryRunDeploymentPlan({
    route: energizeRoute,
    manifest: manifest(energizeRoute, { targetRepository: "enxpower/wrong-repo" }),
    sourceDir: energizeSource,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(arcbosPlan.ok, true);
  assert.deepEqual(arcbosPlan.wouldDelete, ["docs/old-arcbos/index.html"]);
  assert.equal(energizePlan.ok, false);
  assert.deepEqual(energizePlan.wouldDelete, []);
});

test("production deployment defaults to disabled and fail-closed", async () => {
  const dirs = await tempSource();
  const arcbosRoute = route("ARCBOS", { production: true });
  const plan = createDryRunDeploymentPlan({
    route: arcbosRoute,
    manifest: manifest(arcbosRoute, {
      deletions: ["docs/old-arcbos/index.html"],
      existingFileCount: 100
    }),
    sourceDir: dirs.sourceDir,
    allowedStagingRoot: dirs.stagingRoot
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((error) => error.includes("Production deployment is disabled")));
  assert.deepEqual(plan.wouldDelete, []);
});
