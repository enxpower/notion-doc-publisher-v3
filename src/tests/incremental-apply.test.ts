import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import type { DocumentModel } from "../model/document.js";
import { normalizeBrand, type BrandRoute } from "../routing/brand-routing.js";
import { createFixtureRoutedPdfRenderer } from "../routing/routed-pdf.js";
import {
  createDesiredDocumentState,
  createIncrementalPlan,
  type IncrementalStateManifest
} from "../routing/incremental.js";
import {
  executeIncrementalApply,
  type IncrementalLifecycleWriteback,
  type IncrementalLifecycleWritebackClient
} from "../routing/incremental-apply.js";
import { loadBrandRoutes } from "../routing/routes.js";

test("incremental apply creates only action documents and writes lifecycle success", async () => {
  const fixture = await makeFixture();
  const branchDocuments = fixture.documents.filter((document) => normalizeBrand(document.meta.brand.label) !== "ARCBOS");
  const plan = createIncrementalPlan({ documents: branchDocuments, routes: fixture.routes, config: fixture.config, now: NOW });
  const client = new RecordingLifecycleClient();

  const result = await executeIncrementalApply({
    documents: branchDocuments,
    routes: fixture.routes,
    config: fixture.config,
    plan,
    repositoryRoots: fixture.repositories,
    stagingRoot: fixture.stagingRoot,
    mode: "apply",
    now: NOW,
    pdfRenderer: createFixtureRoutedPdfRenderer(),
    notionClient: client
  });

  assert.equal(result.renderedDocumentCount, 3);
  assert.equal(result.generatedPdfCount, 3);
  assert.equal(result.deployedBrandCount, 3);
  assert.equal(result.notionMutationCount, 3);
  assert.equal(result.nextState.records.length, 3);
  assert.equal(client.updates.every((update) => update.status === "success" && update.publishedUrl), true);
  await assertFileExists(path.join(fixture.repositories.GONG!, "gong-docs", "internal", "gonginternal01", "index.html"));
  const gongPdf = result.nextState.records.find((record) => record.brand === "GONG")!.ownedFiles.find((file) => file.endsWith(".pdf"));
  assert.ok(gongPdf);
  await assertFileExists(path.join(fixture.repositories.GONG!, gongPdf));
});

test("incremental apply fails closed for ARCBOS Pages artifact changes without artifact support", async () => {
  const fixture = await makeFixture();
  const arcbosDocument = fixture.documents.find((document) => normalizeBrand(document.meta.brand.label) === "ARCBOS")!;
  const plan = createIncrementalPlan({ documents: [arcbosDocument], routes: fixture.routes, config: fixture.config, now: NOW });

  await assert.rejects(
    () => executeIncrementalApply({
      documents: [arcbosDocument],
      routes: fixture.routes,
      config: fixture.config,
      plan,
      repositoryRoots: fixture.repositories,
      stagingRoot: fixture.stagingRoot,
      mode: "apply",
      now: NOW,
      pdfRenderer: createFixtureRoutedPdfRenderer()
    }),
    /requires github-pages-artifact deployment support/
  );
});

test("incremental apply NOOP renders nothing, deploys nothing, and does not mutate Notion", async () => {
  const fixture = await makeFixture();
  const previousState = successfulState(fixture.documents, fixture.routes, fixture.config);
  const plan = createIncrementalPlan({
    documents: fixture.documents,
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: NOW
  });
  const client = new RecordingLifecycleClient();
  const result = await executeIncrementalApply({
    documents: fixture.documents,
    routes: fixture.routes,
    config: fixture.config,
    plan,
    previousState,
    repositoryRoots: fixture.repositories,
    stagingRoot: fixture.stagingRoot,
    mode: "apply",
    now: NOW,
    pdfRenderer: createFixtureRoutedPdfRenderer(),
    notionClient: client
  });

  assert.equal(plan.counts.NOOP, 4);
  assert.equal(result.renderedDocumentCount, 0);
  assert.equal(result.generatedPdfCount, 0);
  assert.equal(result.deployedBrandCount, 0);
  assert.equal(result.notionMutationCount, 0);
  assert.deepEqual(client.updates, []);
});

test("incremental apply REMOVE deletes only prior manifest-owned files and marks unpublished", async () => {
  const fixture = await makeFixture();
  const document = structuredClone(fixture.documents.find((candidate) => normalizeBrand(candidate.meta.brand.label) === "ENERGIZE")!);
  const previousState = successfulState([document], fixture.routes, fixture.config);
  await writePreviousOwnedFiles(fixture.repositories.ENERGIZE!, previousState.records[0]!);
  await fs.writeFile(path.join(fixture.repositories.ENERGIZE!, "assets", "shared.css"), "shared\n", "utf8");
  document.meta.publish = false;
  const plan = createIncrementalPlan({ documents: [document], routes: fixture.routes, config: fixture.config, previousState, now: NOW });
  const client = new RecordingLifecycleClient();

  const result = await executeIncrementalApply({
    documents: [document],
    routes: fixture.routes,
    config: fixture.config,
    plan,
    previousState,
    repositoryRoots: fixture.repositories,
    stagingRoot: fixture.stagingRoot,
    mode: "apply",
    now: NOW,
    notionClient: client
  });

  assert.equal(result.deletedFileCount, 2);
  assert.equal(result.nextState.records.length, 0);
  assert.equal(client.updates[0]?.status, "unpublished");
  await assertFileMissing(path.join(fixture.repositories.ENERGIZE!, "clients", "energizeclient01", "index.html"));
  await assertFileMissing(path.join(fixture.repositories.ENERGIZE!, "pdf", "ENERGIZE-MEM-2606-0002.pdf"));
  await assertFileExists(path.join(fixture.repositories.ENERGIZE!, "assets", "shared.css"));
});

test("incremental apply MOVE preserves identity, writes new route, and removes old route", async () => {
  const fixture = await makeFixture();
  const base = structuredClone(fixture.documents[1]!);
  const previousState = successfulState([base], fixture.routes, fixture.config);
  await writePreviousOwnedFiles(fixture.repositories.ENERGIZE!, previousState.records[0]!);
  const moved = structuredClone(base);
  moved.meta.visibility = "Internal";
  moved.meta.privateLinkNamespace = "internal";
  moved.meta.canonicalPath = "/internal/energizeclient01/";
  const plan = createIncrementalPlan({ documents: [moved], routes: fixture.routes, config: fixture.config, previousState, now: NOW });
  const client = new RecordingLifecycleClient();

  const result = await executeIncrementalApply({
    documents: [moved],
    routes: fixture.routes,
    config: fixture.config,
    plan,
    previousState,
    repositoryRoots: fixture.repositories,
    stagingRoot: fixture.stagingRoot,
    mode: "apply",
    now: NOW,
    pdfRenderer: createFixtureRoutedPdfRenderer(),
    notionClient: client
  });

  assert.equal(plan.records[0]!.action, "MOVE");
  assert.equal(result.deletedFileCount, 2);
  assert.equal(result.nextState.records[0]!.docId, base.meta.docId);
  assert.equal(result.nextState.records[0]!.shareToken, base.meta.shareToken);
  await assertFileMissing(path.join(fixture.repositories.ENERGIZE!, "clients", "energizeclient01", "index.html"));
  await assertFileExists(path.join(fixture.repositories.ENERGIZE!, "internal", "energizeclient01", "index.html"));
});

test("incremental apply failed UPDATE preserves prior output and successful state", async () => {
  const fixture = await makeFixture();
  const base = structuredClone(fixture.documents[2]!);
  const previousState = successfulState([base], fixture.routes, fixture.config);
  await writePreviousOwnedFiles(fixture.repositories.AGIM!, previousState.records[0]!);
  const changed = structuredClone(base);
  changed.content = [{ type: "paragraph", id: "changed", richText: [{ text: "Changed." }] }];
  const plan = createIncrementalPlan({ documents: [changed], routes: fixture.routes, config: fixture.config, previousState, now: NOW });
  const client = new RecordingLifecycleClient();

  const result = await executeIncrementalApply({
    documents: [changed],
    routes: fixture.routes,
    config: fixture.config,
    plan,
    previousState,
    repositoryRoots: fixture.repositories,
    stagingRoot: fixture.stagingRoot,
    mode: "apply",
    now: NOW,
    pdfRenderer: async () => {
      throw new Error("synthetic pdf failure");
    },
    notionClient: client
  });

  assert.equal(plan.records[0]!.action, "UPDATE");
  assert.equal(result.recordResults[0]!.status, "failed");
  assert.equal(result.nextState.records[0]!.desiredStateHash, previousState.records[0]!.desiredStateHash);
  assert.equal(client.updates[0]?.status, "failed");
  await assertFileExists(path.join(fixture.repositories.AGIM!, "partners", "agimpartner01", "index.html"));
  await assertFileExists(path.join(fixture.repositories.AGIM!, "pdf", "AGIM-MEM-2606-0003.pdf"));
});

async function makeFixture() {
  const config = await loadRoutedDryRunConfig();
  const routes = await loadBrandRoutes();
  const documents = routedDryRunDocuments();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "incremental-apply-test-"));
  const repositories: Record<string, string> = {};
  for (const route of routes) {
    const brand = normalizeBrand(route.brand);
    const repositoryRoot = path.join(root, brand);
    await fs.mkdir(path.join(repositoryRoot, "assets"), { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, "CNAME"), `${new URL(route.targetDomain).hostname}\n`, "utf8");
    repositories[brand] = repositoryRoot;
  }
  return {
    config,
    routes,
    documents,
    repositories,
    stagingRoot: path.join(root, "staging")
  };
}

function successfulState(
  documents: DocumentModel[],
  routes: BrandRoute[],
  config: AppConfig
): IncrementalStateManifest {
  return {
    schema: "notion-doc-publisher-v3/incremental-state",
    version: 1,
    generatedAt: NOW,
    records: documents.map((document) => {
      const route = routes.find((candidate) => normalizeBrand(candidate.brand) === normalizeBrand(document.meta.brand.label));
      assert.ok(route);
      return {
        ...createDesiredDocumentState({ document, route, config }),
        publishedAt: NOW
      };
    })
  };
}

async function writePreviousOwnedFiles(repositoryRoot: string, record: { ownedFiles: string[] }): Promise<void> {
  for (const file of record.ownedFiles) {
    const target = path.join(repositoryRoot, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (file.endsWith(".pdf")) {
      await fs.writeFile(target, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512, "0"), Buffer.from("\n%%EOF\n")]));
    } else {
      await fs.writeFile(target, `<html>${file}</html>\n`, "utf8");
    }
  }
}

async function assertFileExists(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  assert.equal(stat.isFile(), true);
}

async function assertFileMissing(filePath: string): Promise<void> {
  await assert.rejects(fs.stat(filePath), /ENOENT/);
}

class RecordingLifecycleClient implements IncrementalLifecycleWritebackClient {
  readonly updates: IncrementalLifecycleWriteback[] = [];

  async updateLifecycleResult(update: IncrementalLifecycleWriteback): Promise<void> {
    this.updates.push(update);
  }
}

const NOW = "2026-07-19T00:00:00.000Z";
