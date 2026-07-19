/**
 * Tests for Stage 10 routed Published URL writeback.
 *
 * These tests use fixture documents, mocked Notion writeback, and temporary
 * directories only. They must not require .env, production Notion, deployment,
 * GitHub, or network access.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { emptyValidation, type DocumentModel } from "../model/document.js";
import { pageToDocument } from "../notion/properties.js";
import { buildRoutedReadonly } from "../routing/routed-readonly.js";
import { createFixtureRoutedPdfRenderer, type FixturePdfRendererOptions } from "../routing/routed-pdf.js";
import { computeRouteFinalUrl, normalizeBrand, type BrandRoute } from "../routing/brand-routing.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";
import {
  applyVerifiedUrlsToDocuments,
  createRoutedUrlWritebackPlan,
  executeRoutedUrlWriteback,
  verifyRoutedUrlWriteback,
  writeRoutedUrlWritebackArtifacts,
  type RoutedUrlWritebackClient
} from "../routing/routed-url-writeback.js";

test("routed writeback commands are separate and legacy build/writeback commands stay unchanged", async () => {
  const raw = await fs.readFile(path.resolve("package.json"), "utf8");
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  const cliSource = await fs.readFile(path.resolve("src/cli/writeback-routed-readonly.ts"), "utf8");

  assert.equal(pkg.scripts.build, "tsc && node .tmp/cli/security-lint.js && node .tmp/cli/build.js");
  assert.equal(pkg.scripts["ci:writeback"], "tsc && node .tmp/cli/writeback-preview.js");
  assert.equal(pkg.scripts["writeback:routed:dry-run"], "tsc && node .tmp/cli/writeback-routed-readonly.js --dry-run");
  assert.equal(pkg.scripts["writeback:routed"], "tsc && node .tmp/cli/writeback-routed-readonly.js --write");
  assert.ok(cliSource.includes("routes-readonly-fixture"), "writeback fixture mode must not share the production readonly staging root");
  assert.ok(cliSource.includes("updatePublishedUrlOnly"));
  assert.ok(!cliSource.includes("updateDocumentSuccess"));
  assert.ok(!cliSource.includes("updateDocumentFailed"));
  assert.ok(!cliSource.includes("writeAutoFillProperties"));
});

test("routed URL plan uses correct ARCBOS and ENERGIZE routed domains", async () => {
  const { bundle } = await buildWritebackFixture();
  const arcbos = bundle.privateRecords.find((record) => record.brand === "ARCBOS")!;
  const energize = bundle.privateRecords.find((record) => record.brand === "ENERGIZE")!;

  assert.equal(arcbos.targetPublishedUrl, "https://ref.arcbos.com/docs/ARCBOS-SPEC-2606-0001/");
  assert.equal(energize.targetPublishedUrl, "https://docs.energizeos.com/clients/energizeclient01/");
  assert.equal(bundle.plan.eligibleByBrand.ARCBOS, 1);
  assert.equal(bundle.plan.eligibleByBrand.ENERGIZE, 1);
  assert.equal(bundle.plan.records.some((record) => record.brand === "ARCBOS" && record.action === "update"), true);
});

test("pageToDocument preserves existing PUBLISHED_URL for idempotent routed writeback", async () => {
  const config = await loadRoutedDryRunConfig();
  const document = pageToDocument({
    id: "page-with-url",
    properties: {
      Title: titleProperty("Fixture"),
      DOC_ID: richTextProperty("ARCBOS-SPEC-2606-0001"),
      Brand: selectProperty("ARCBOS"),
      Client: selectProperty("Client"),
      Project: selectProperty("Project"),
      "Document Type": selectProperty("Specification"),
      Version: selectProperty("v1.0"),
      Status: selectProperty("Approved"),
      Visibility: selectProperty("Public"),
      Publish: { type: "checkbox", checkbox: true },
      PUBLISHED_URL: { type: "url", url: "https://ref.arcbos.com/docs/ARCBOS-SPEC-2606-0001/" }
    }
  }, [], config);

  assert.equal(document.meta.publishedUrl, "https://ref.arcbos.com/docs/ARCBOS-SPEC-2606-0001/");
});

test("cross-brand routed URL mismatch is rejected before writeback", async () => {
  const fixture = await buildWritebackFixture();
  const badRoutes = fixture.routes.map((route) => route.brand === "ARCBOS"
    ? { ...route, targetDomain: "https://docs.energizeos.com" }
    : route
  );
  const bundle = createRoutedUrlWritebackPlan({
    documents: fixture.documents,
    routes: badRoutes,
    config: fixture.config,
    buildResult: fixture.result,
    outputBaseRoot: fixture.outputBaseRoot,
    mode: "dry-run",
    runId: "test-run",
    now: "2026-07-19T00:00:00.000Z",
    salt: "test-salt"
  });
  const arcbos = bundle.plan.records.find((record) => record.brand === "ARCBOS")!;

  assert.equal(arcbos.action, "invalid");
  assert.equal(arcbos.reason, "INVALID_TARGET_URL");
  assert.equal(bundle.plan.invalidCount, 1);
});

test("unsupported GONG route is blocked and empty AGIM is a no-op", async () => {
  const documents = routedDryRunDocuments().filter((document) => document.meta.brand.label !== "AGIM");
  const { bundle } = await buildWritebackFixture({ documents });
  const gong = bundle.plan.records.find((record) => record.brand === "GONG")!;

  assert.equal(bundle.plan.eligibleByBrand.AGIM, 0);
  assert.equal(bundle.privateRecords.some((record) => record.brand === "AGIM" && record.action === "update"), false);
  assert.equal(gong.action, "skipped");
  assert.equal(gong.reason, "DEPLOYMENT_NOT_VALID");
});

test("rejected and collision-affected records are skipped", async () => {
  const documents = [
    makeDoc("ARCBOS", "page-publish-false", {
      docId: "ARCBOS-SPEC-2606-0200",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0200/",
      publish: false
    }),
    makeDoc("ARCBOS", "page-first", {
      docId: "ARCBOS-SPEC-2606-0201",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0201/"
    }),
    makeDoc("ARCBOS", "page-collision", {
      docId: "ARCBOS-SPEC-2606-0202",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0201/"
    })
  ];
  const { bundle } = await buildWritebackFixture({ documents });

  assert.equal(bundle.plan.records.find((record) => record.alias === "WRITEBACK-001")!.reason, "NONPUBLISHABLE_OR_FILTERED");
  assert.equal(bundle.plan.records.find((record) => record.alias === "WRITEBACK-003")!.reason, "OUTPUT_COLLISION");
  assert.equal(bundle.plan.urlUpdateCount, 0);
});

test("failed PDF records and missing HTML output are skipped", async () => {
  const documents = routedDryRunDocuments().filter((document) => document.meta.brand.label !== "GONG");
  const failingDocId = documents[0]!.meta.docId;
  const failedPdf = await buildWritebackFixture({
    documents,
    pdfOptions: { failDocIds: new Set([failingDocId]) }
  });
  const arcbos = failedPdf.bundle.plan.records.find((record) => record.brand === "ARCBOS")!;
  assert.equal(arcbos.reason, "PDF_NOT_SUCCESS");

  const missingHtml = await buildWritebackFixture({ documents });
  await fs.rm(path.join(missingHtml.outputBaseRoot, "ENERGIZE", "site", "clients", "energizeclient01", "index.html"));
  const replanned = createRoutedUrlWritebackPlan({
    documents: missingHtml.documents,
    routes: missingHtml.routes,
    config: missingHtml.config,
    buildResult: missingHtml.result,
    outputBaseRoot: missingHtml.outputBaseRoot,
    mode: "dry-run",
    runId: "test-run",
    now: "2026-07-19T00:00:00.000Z",
    salt: "test-salt"
  });
  assert.equal(replanned.plan.records.find((record) => record.brand === "ENERGIZE")!.reason, "HTML_MISSING");
});

test("unchanged URLs are skipped and incorrect old URLs update once", async () => {
  const { bundle, documents, routes, config, result, outputBaseRoot } = await buildWritebackFixture({
    documents: [
      withPublishedUrl(routedDryRunDocuments()[0]!, "https://old.example.test/docs/legacy/"),
      withPublishedUrl(routedDryRunDocuments()[1]!, "https://docs.energizeos.com/clients/energizeclient01/")
    ]
  });
  const client = new MockWritebackClient(documents);
  const execution = await executeRoutedUrlWriteback({ bundle, client });
  const verification = await verifyRoutedUrlWriteback({ bundle, client });
  applyVerifiedUrlsToDocuments(documents, bundle, verification);
  const second = createRoutedUrlWritebackPlan({
    documents,
    routes,
    config,
    buildResult: result,
    outputBaseRoot,
    mode: "dry-run",
    runId: "test-run",
    now: "2026-07-19T00:00:00.000Z",
    salt: "test-salt"
  }).plan;

  assert.equal(bundle.plan.urlUpdateCount, 1);
  assert.equal(bundle.plan.unchangedUrlCount, 1);
  assert.equal(bundle.plan.urlBreakingChangeCount, 1);
  assert.equal(execution.successfulUpdateCount, 1);
  assert.equal(client.calls.length, 1);
  assert.equal(second.urlUpdateCount, 0);
});

test("duplicate Notion page updates are prevented", async () => {
  const documents = [
    makeDoc("ARCBOS", "same-page", {
      docId: "ARCBOS-SPEC-2606-0300",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0300/"
    }),
    makeDoc("ARCBOS", "same-page", {
      docId: "ARCBOS-SPEC-2606-0301",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0301/"
    })
  ];
  const { bundle } = await buildWritebackFixture({ documents });

  assert.equal(bundle.plan.urlUpdateCount, 1);
  assert.equal(bundle.plan.invalidCount, 1);
  assert.equal(bundle.plan.records.find((record) => record.action === "invalid")!.reason, "DUPLICATE_NOTION_PAGE");
});

test("mutation failures are reported and successful updates can safely resume", async () => {
  const documents = [
    makeDoc("ARCBOS", "page-arcbos", {
      docId: "ARCBOS-SPEC-2606-0400",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0400/"
    }),
    makeDoc("ENERGIZE", "page-energize", {
      docId: "ENERGIZE-SPEC-2606-0401",
      canonicalPath: "/docs/ENERGIZE-SPEC-2606-0401/"
    })
  ];
  const fixture = await buildWritebackFixture({ documents });
  const client = new MockWritebackClient(documents, new Set(["page-energize"]));
  const execution = await executeRoutedUrlWriteback({ bundle: fixture.bundle, client });

  documents[0]!.meta.publishedUrl = await client.readPublishedUrl("page-arcbos");
  const resume = createRoutedUrlWritebackPlan({
    documents,
    routes: fixture.routes,
    config: fixture.config,
    buildResult: fixture.result,
    outputBaseRoot: fixture.outputBaseRoot,
    mode: "dry-run",
    runId: "test-run",
    now: "2026-07-19T00:00:00.000Z",
    salt: "test-salt"
  }).plan;

  assert.equal(execution.successfulUpdateCount, 1);
  assert.equal(execution.failedUpdateCount, 1);
  assert.equal(resume.urlUpdateCount, 1);
  assert.equal(resume.records.find((record) => record.brand === "ARCBOS")!.action, "unchanged");
});

test("backup contains previous values while public plan does not expose private fields", async () => {
  const documents = [
    withPublishedUrl(routedDryRunDocuments()[0]!, "https://old.example.test/docs/legacy/"),
    withPublishedUrl(routedDryRunDocuments()[1]!, "")
  ];
  const { bundle } = await buildWritebackFixture({ documents });
  const outputRoot = await tempRoot();
  const artifacts = await writeRoutedUrlWritebackArtifacts({
    bundle,
    outputRoot,
    runId: "test-run",
    now: "2026-07-19T00:00:00.000Z"
  });
  const publicPlan = await fs.readFile(artifacts.publicPlanPath, "utf8");
  const backup = await fs.readFile(artifacts.privateBackupPath, "utf8");

  assert.ok(backup.includes("https://old.example.test/docs/legacy/"));
  assert.ok(!backup.includes("ARCBOS Routed Dry Run Specification"));
  assert.ok(!backup.includes("ENERGIZE Routed Dry Run Agreement"));
  assert.ok(!publicPlan.includes("fixture-"));
  assert.ok(!publicPlan.includes("ARCBOS-SPEC-2606-0001"));
  assert.ok(!publicPlan.includes("ENERGIZE-AGR-2606-0002"));
  assert.ok(!publicPlan.includes("energizeclient01"));
  assert.ok(!publicPlan.includes("https://docs.energizeos.com/clients/energizeclient01/"));
});

type BuildInput = {
  documents?: DocumentModel[];
  config?: AppConfig;
  pdfOptions?: FixturePdfRendererOptions;
};

async function buildWritebackFixture(input: BuildInput = {}) {
  const outputBaseRoot = await tempRoot();
  const config = input.config ?? await loadRoutedDryRunConfig();
  const documents = (input.documents ?? routedDryRunDocuments()).map((document) => structuredClone(document));
  const routes = routesWithOutputBase(await loadBrandRoutes(), outputBaseRoot);
  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  globalThis.fetch = async (): Promise<Response> => {
    networkCalled = true;
    throw new Error("Network access is forbidden in routed writeback tests");
  };
  try {
    const result = await buildRoutedReadonly({
      config,
      routes,
      outputBaseRoot,
      loadDocuments: async () => documents,
      now: () => "2026-07-19T00:00:00.000Z",
      pdfRenderer: createFixtureRoutedPdfRenderer(input.pdfOptions)
    });
    const bundle = createRoutedUrlWritebackPlan({
      documents,
      routes,
      config,
      buildResult: result,
      outputBaseRoot,
      mode: "dry-run",
      runId: "test-run",
      now: "2026-07-19T00:00:00.000Z",
      salt: "test-salt"
    });
    assert.equal(networkCalled, false);
    return { bundle, documents, routes, config, result, outputBaseRoot };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function makeDoc(
  brand: string,
  pageId: string,
  overrides: Partial<DocumentModel["meta"]> & Pick<DocumentModel["meta"], "docId" | "canonicalPath">
): DocumentModel {
  const base = routedDryRunDocuments().find((document) => normalizeBrand(document.meta.brand.label) === normalizeBrand(brand)) ?? routedDryRunDocuments()[0]!;
  return {
    ...structuredClone(base),
    meta: {
      ...structuredClone(base.meta),
      ...overrides,
      brand: { label: brand, token: normalizeBrand(brand), slug: normalizeBrand(brand).toLowerCase() },
      title: `${brand} fixture`,
      publish: overrides.publish ?? true,
      status: overrides.status ?? "Approved",
      publishedUrl: overrides.publishedUrl ?? ""
    },
    source: {
      ...structuredClone(base.source),
      notionPageId: pageId
    },
    validation: emptyValidation()
  };
}

function withPublishedUrl(document: DocumentModel, publishedUrl: string): DocumentModel {
  const copy = structuredClone(document);
  copy.meta.publishedUrl = publishedUrl;
  return copy;
}

async function tempRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "notion-routed-url-writeback-"));
}

class MockWritebackClient implements RoutedUrlWritebackClient {
  readonly calls: Array<{ pageId: string; url: string }> = [];
  private readonly publishedUrls: Map<string, string>;

  constructor(
    documents: DocumentModel[],
    private readonly failPageIds = new Set<string>()
  ) {
    this.publishedUrls = new Map(documents.map((document) => [
      document.source.notionPageId,
      document.meta.publishedUrl?.trim() ?? ""
    ]));
  }

  async updatePublishedUrlOnly(pageId: string, url: string): Promise<void> {
    if (this.failPageIds.has(pageId)) {
      throw new Error("mock write failure");
    }
    this.calls.push({ pageId, url });
    this.publishedUrls.set(pageId, url);
  }

  async readPublishedUrl(pageId: string): Promise<string> {
    return this.publishedUrls.get(pageId) ?? "";
  }
}

function titleProperty(value: string): Record<string, unknown> {
  return {
    type: "title",
    title: [{ type: "text", plain_text: value, text: { content: value } }]
  };
}

function richTextProperty(value: string): Record<string, unknown> {
  return {
    type: "rich_text",
    rich_text: [{ type: "text", plain_text: value, text: { content: value } }]
  };
}

function selectProperty(value: string): Record<string, unknown> {
  return {
    type: "select",
    select: { name: value }
  };
}
