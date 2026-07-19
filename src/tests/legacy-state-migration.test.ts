import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import type { DocumentModel } from "../model/document.js";
import { normalizeBrand, type BrandRoute } from "../routing/brand-routing.js";
import {
  migrateLegacyPhase1State,
  sanitizeLegacyMigrationSummary,
  type LegacyRepositoryInput
} from "../routing/legacy-state-migration.js";
import { loadBrandRoutes } from "../routing/routes.js";

test("legacy migration reconstructs verified deployed documents and produces NOOP idempotency", async () => {
  const fixture = await makeFixture();
  const result = await migrateLegacyPhase1State(fixture);

  assert.equal(result.errors.length, 0);
  assert.equal(result.migratedRecordCount, 4);
  assert.equal(result.idempotencyPlan.counts.NOOP, 4);
  assert.equal(result.idempotencyPlan.counts.CREATE, 0);
  assert.equal(result.idempotencyPlan.counts.UPDATE, 0);
  assert.equal(result.idempotencyPlan.counts.MOVE, 0);
  assert.equal(result.idempotencyPlan.counts.REMOVE, 0);

  const gong = result.state.records.find((record) => record.brand === "GONG");
  assert.ok(gong);
  assert.ok(gong.ownedFiles.every((file) => file.startsWith("gong-docs/")));
  assert.ok(gong.ownedFiles.some((file) => file.startsWith("gong-docs/internal/") && file.endsWith("/index.html")));
  assert.ok(gong.ownedFiles.some((file) => file.startsWith("gong-docs/pdf/") && file.endsWith(".pdf")));
  assert.ok(!gong.ownedFiles.includes("CNAME"));
});

test("legacy migration blocks records whose deployed PDF cannot be proven", async () => {
  const fixture = await makeFixture({ omitPdfForBrand: "ENERGIZE" });
  const result = await migrateLegacyPhase1State(fixture);

  assert.equal(result.errors.some((error) => error.code === "MISSING_DEPLOYED_PDF"), true);
  assert.equal(result.migratedRecordCount, 3);
  assert.equal(result.state.records.some((record) => record.brand === "ENERGIZE"), false);
});

test("legacy migration reports unmanaged files separately and never assigns ambiguous files", async () => {
  const fixture = await makeFixture({ unmanagedFileBrand: "ARCBOS" });
  const result = await migrateLegacyPhase1State(fixture);
  const arcbos = result.state.records.find((record) => record.brand === "ARCBOS");

  assert.ok(arcbos);
  assert.equal(arcbos.ownedFiles.includes("legacy-report.json"), false);
  assert.equal(result.unmanagedLegacyFiles.some((file) => file.brand === "ARCBOS" && file.path === "legacy-report.json"), true);
});

test("legacy migration assigns only document-specific asset paths", async () => {
  const fixture = await makeFixture({ includeAssetForBrand: "ENERGIZE" });
  const result = await migrateLegacyPhase1State(fixture);
  const energize = result.state.records.find((record) => record.brand === "ENERGIZE");

  assert.ok(energize);
  assert.equal(energize.ownedFiles.some((file) => file.includes("/assets/doc-image.png")), true);
  assert.equal(energize.ownedFiles.includes("assets/shared-image.png"), false);
});

test("legacy migration sanitized summary excludes private state and page identifiers", async () => {
  const fixture = await makeFixture();
  const result = await migrateLegacyPhase1State(fixture);
  const summary = sanitizeLegacyMigrationSummary(result);
  const serialized = JSON.stringify(summary);

  for (const document of fixture.documents) {
    assert.equal(serialized.includes(document.source.notionPageId), false);
    if (document.meta.shareToken) {
      assert.equal(serialized.includes(document.meta.shareToken), false);
    }
    assert.equal(serialized.includes(document.meta.canonicalPath), false);
  }
  assert.deepEqual(summary.idempotencyCounts, result.idempotencyPlan.counts);
});

async function makeFixture(options: {
  omitPdfForBrand?: string;
  unmanagedFileBrand?: string;
  includeAssetForBrand?: string;
} = {}) {
  const config = await loadRoutedDryRunConfig();
  const routes = await loadBrandRoutes();
  const documents = routedDryRunDocuments().map((document) => structuredClone(document));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-state-migration-test-"));
  const repositories: LegacyRepositoryInput[] = [];

  if (options.includeAssetForBrand) {
    const document = documents.find((candidate) => normalizeBrand(candidate.meta.brand.label) === options.includeAssetForBrand);
    assert.ok(document);
    const canonicalRelative = document.meta.canonicalPath.replace(/^\/+|\/+$/g, "");
    document.assets = [
      {
        kind: "image",
        sourceUrl: "https://assets.example.test/doc-image.png",
        outputPath: `${canonicalRelative}/assets/doc-image.png`,
        local: false
      },
      {
        kind: "image",
        sourceUrl: "https://assets.example.test/shared-image.png",
        outputPath: "assets/shared-image.png",
        local: false
      }
    ];
  }

  for (const route of routes) {
    const brand = normalizeBrand(route.brand);
    const repositoryRoot = path.join(root, brand);
    await fs.mkdir(repositoryRoot, { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, "CNAME"), `${new URL(route.targetDomain).hostname}\n`, "utf8");
    await fs.mkdir(path.join(repositoryRoot, "assets", "css"), { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, "assets", "css", "screen.css"), "body{}\n", "utf8");
    await fs.writeFile(path.join(repositoryRoot, "assets", "css", "print.css"), "@media print{}\n", "utf8");
    if (options.unmanagedFileBrand === brand) {
      await fs.writeFile(path.join(repositoryRoot, "legacy-report.json"), "{}\n", "utf8");
    }

    const pages: Record<string, string> = {};
    for (const document of documents.filter((candidate) => normalizeBrand(candidate.meta.brand.label) === brand)) {
      await writeDeployedDocument({ repositoryRoot, route, document, omitPdf: options.omitPdfForBrand === brand });
      pages[document.source.notionPageId] = document.meta.docId;
    }
    await fs.writeFile(path.join(repositoryRoot, ".publisher_state.json"), `${JSON.stringify({ pages }, null, 2)}\n`, "utf8");
    repositories.push({ brand, repositoryRoot });
  }

  return { documents, routes, config, repositories, now: "2026-07-19T00:00:00.000Z" };
}

async function writeDeployedDocument(input: {
  repositoryRoot: string;
  route: BrandRoute;
  document: DocumentModel;
  omitPdf: boolean;
}): Promise<void> {
  const deploymentRoot = input.route.deploymentRoot?.replace(/^\/+|\/+$/g, "") ?? "";
  const prefix = deploymentRoot ? `${deploymentRoot}/` : "";
  const canonicalRelative = input.document.meta.canonicalPath.replace(/^\/+|\/+$/g, "");
  const htmlPath = path.join(input.repositoryRoot, prefix, canonicalRelative, "index.html");
  const pdfRelative = `${input.route.pdfPath ?? "pdf"}/${input.document.meta.docId}.pdf`;
  const pdfPath = path.join(input.repositoryRoot, prefix, pdfRelative);
  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.writeFile(
    htmlPath,
    `<html><head><link rel="canonical" href="${input.route.targetDomain}${input.document.meta.canonicalPath}"></head>` +
    `<body><button onclick="window.print()">Print</button><a href="../../${pdfRelative}">PDF</a>` +
    `<span>${input.document.meta.docId}</span></body></html>\n`,
    "utf8"
  );
  if (!input.omitPdf) {
    await fs.mkdir(path.dirname(pdfPath), { recursive: true });
    await fs.writeFile(pdfPath, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512, "0"), Buffer.from("\n%%EOF\n")]));
  }
  for (const asset of input.document.assets) {
    const assetPath = path.join(input.repositoryRoot, prefix, asset.outputPath);
    await fs.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.writeFile(assetPath, "asset\n", "utf8");
  }
}
