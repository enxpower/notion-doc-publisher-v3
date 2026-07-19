/**
 * Tests for Stage 6 routed readonly builds.
 *
 * These tests use mocked document loaders, fixture documents, and temporary
 * output roots only. They must not require .env, GitHub secrets, production
 * Notion, deployment commands, or network access.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { NotionClient } from "../notion/client.js";
import { enableNotionReadOnlyMode } from "../notion/read-only-guard.js";
import { NotionWriteback } from "../notion/writeback.js";
import { writePdfResult } from "../pdf/notion-writeback.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import {
  buildRoutedReadonly,
  createReadOnlyRoutedConfig,
  loadRoutedReadonlyConfigFromEnvironment,
  type RoutedReadonlyBuildResult
} from "../routing/routed-readonly.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";

type BuildInput = {
  documents?: DocumentModel[];
  config?: AppConfig;
  outputBaseRoot?: string;
};

test("routed readonly command is separate and existing build commands remain unchanged", async () => {
  const raw = await fs.readFile(path.resolve("package.json"), "utf8");
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  const cliSource = await fs.readFile(path.resolve("src/cli/build-routed-readonly.ts"), "utf8");

  assert.equal(pkg.scripts.build, "tsc && node .tmp/cli/security-lint.js && node .tmp/cli/build.js");
  assert.equal(pkg.scripts["build:routed:dry-run"], "tsc && node .tmp/cli/build-routed-dry-run.js");
  assert.equal(pkg.scripts["build:routed:readonly"], "tsc && node .tmp/cli/build-routed-readonly.js");
  assert.ok(cliSource.includes("loadDocuments"), "readonly CLI must use the existing Notion document load path outside test mode");
  assert.ok(cliSource.includes("loadRoutedReadonlyConfigFromEnvironment"), "readonly CLI must use the restricted readonly config loader");
  assert.ok(!cliSource.includes("loadConfigOrThrow"), "readonly CLI must not use the general environment loader");
  assert.ok(!cliSource.includes("autoFillDocuments"), "readonly CLI must not call autofill");
  assert.ok(!cliSource.includes("createAssignmentPlan"), "readonly CLI must not assign DOC_IDs");
});

test("readonly production config reads only permitted runtime environment variables", async () => {
  const routes = await loadBrandRoutes();
  const originalEnv = { ...process.env };
  try {
    process.env.NOTION_TOKEN = "test-readonly-token";
    process.env.NOTION_DATABASE_ID = "test-readonly-database";
    process.env.ALLOWED_BRANDS = " arcbos, energize ";
    process.env.PUBLISHABLE_STATUSES = "";
    process.env.BRAND_TOKENS_JSON = "";
    process.env.DOCUMENT_TYPE_TOKENS_JSON = "";
    process.env.AUTO_GENERATE_SHARE_TOKEN = "true";

    const config = await loadRoutedReadonlyConfigFromEnvironment(routes);

    assert.equal(config.notionToken, "test-readonly-token");
    assert.equal(config.notionDatabaseId, "test-readonly-database");
    assert.deepEqual(config.allowedBrands, new Set(["ARCBOS", "ENERGIZE"]));
    assert.equal(config.autoGenerateShareToken, false);
    assert.equal(config.autoFillPrivateNamespace, false);
    assert.equal(config.autoFillPortalCategory, false);
    assert.equal(config.allowMissingShareToken, false);
    assert.equal(config.brandTokens.GONG, "GONG");
    assert.equal(config.documentTypeTokens.Report, "RPT");
    assert.ok(config.publishableStatuses.has("Approved"));
    assert.ok(config.publishableStatuses.has("Published"));
    assert.ok(config.publishableStatuses.has("Final"));
  } finally {
    process.env = originalEnv;
  }
});

test("readonly routed config preserves the single NOTION_DATABASE_ID model", async () => {
  const sources = await readSources(path.resolve("src"));
  const combined = sources.map((source) => source.content).join("\n");

  assert.ok(combined.includes("readRequiredEnv(\"NOTION_DATABASE_ID\")"));
  for (const forbidden of [
    /ARCBOS_DATABASE_ID/,
    /ENERGIZE_DATABASE_ID/,
    /AGIM_DATABASE_ID/,
    /GONG_DATABASE_ID/,
    /NOTION_DATABASE_IDS/,
    /NOTION_DATABASE_ID_[A-Z0-9_]+/,
    /[A-Z0-9_]+_NOTION_DATABASE_ID/,
    /databaseByBrand/,
    /notionDatabaseIds/
  ]) {
    assert.equal(forbidden.test(combined), false, `forbidden per-brand database configuration matched ${forbidden}`);
  }
});

test("readonly config disables every autofill and legacy generated-path option", async () => {
  const config = createReadOnlyRoutedConfig(await loadRoutedDryRunConfig());

  assert.equal(config.allowMissingShareToken, false);
  assert.equal(config.autoGenerateShareToken, false);
  assert.equal(config.autoFillPrivateNamespace, false);
  assert.equal(config.autoFillPortalCategory, false);
  assert.equal(config.legacyPrivateDocIdUrls, false);
  assert.equal(config.legacyUnlistedDocsPath, false);
});

test("Notion mutation methods throw while readonly guard is active", async () => {
  const config = await loadRoutedDryRunConfig();
  const restore = enableNotionReadOnlyMode("test-readonly");
  try {
    const client = new NotionClient(config);
    const writeback = new NotionWriteback(config);

    await assert.rejects(() => client.updateDocId("page-a", "ARCBOS-SPEC-2606-0999"), /Notion mutation blocked/);
    await assert.rejects(() => client.updatePageProperties("page-a", {}), /Notion mutation blocked/);
    await assert.rejects(() => writeback.updateDocumentSuccess("page-a", "https://example.test/docs/x/", "run"), /Notion mutation blocked/);
    await assert.rejects(() => writeback.updateDocumentFailed("page-a", "failed", "run"), /Notion mutation blocked/);
    await assert.rejects(() => writeback.writeAutoFillProperties("page-a", { shareToken: "stabletoken1" }), /Notion mutation blocked/);
    await assert.rejects(() => writePdfResult("page-a", { pdfStatus: "Generated" }, config), /Notion mutation blocked/);
  } finally {
    restore();
  }
});

test("mocked mutation attempt inside readonly command fails the command", async () => {
  const outputBaseRoot = await tempRoot();
  const config = await loadRoutedDryRunConfig();
  const routes = routesWithOutputBase(await loadBrandRoutes(), outputBaseRoot);

  await assert.rejects(
    () => buildRoutedReadonly({
      config,
      routes,
      outputBaseRoot,
      loadDocuments: async (guardedConfig) => {
        await new NotionClient(guardedConfig).updatePageProperties("page-a", {});
        return routedDryRunDocuments();
      },
      now: () => "2026-07-19T00:00:00.000Z"
    }),
    /Notion mutation blocked/
  );
});

test("one mocked database load feeds all readonly brand groups", async () => {
  let loadCount = 0;
  const { result } = await buildReadonlyFixture({
    documents: routedDryRunDocuments()
  }, async () => {
    loadCount += 1;
    return routedDryRunDocuments();
  });

  assert.equal(loadCount, 1);
  assert.deepEqual(result.manifests.map((manifest) => manifest.brand).sort(), ["AGIM", "ARCBOS", "ENERGIZE", "GONG"]);
});

test("valid ARCBOS, ENERGIZE, AGIM, and GONG records build into separate readonly route roots", async () => {
  const { result, outputBaseRoot } = await buildReadonlyFixture();

  for (const brand of ["ARCBOS", "ENERGIZE", "AGIM", "GONG"]) {
    const manifest = result.manifests.find((item) => item.brand === brand)!;
    assert.equal(manifest.sourceDocumentCount, 1, brand);
    assert.equal(manifest.successfullyBuiltDocumentCount, 1, brand);
    assert.equal(manifest.outputRoot, `${brand}/site`, brand);
    assert.ok(await exists(path.join(outputBaseRoot, manifest.outputRoot, "index.html")), `${brand} readonly output missing`);
  }
  assert.equal(result.manifests.find((item) => item.brand === "GONG")!.deploymentPlan.ok, false);
});

test("readonly records missing DOC_ID are rejected and never assigned", async () => {
  const documents = routedDryRunDocuments();
  documents[0]!.meta.docId = "";
  documents[0]!.meta.canonicalPath = "";
  const { result } = await buildReadonlyFixture({ documents });
  const arcbos = result.manifests.find((manifest) => manifest.brand === "ARCBOS")!;

  assert.equal(arcbos.successfullyBuiltDocumentCount, 0);
  assert.equal(arcbos.rejectedDocumentCount, 1);
  assert.ok(arcbos.errors.some((error) => error.code === "READONLY_MISSING_DOC_ID" || error.code === "MISSING_DOC_ID"));
  assert.equal(arcbos.documents.length, 0);
});

test("readonly records missing required Share Token are rejected and never auto-filled", async () => {
  const documents = routedDryRunDocuments();
  documents[1]!.meta.shareToken = "";
  documents[1]!.meta.canonicalPath = "";
  const { result } = await buildReadonlyFixture({ documents });
  const energize = result.manifests.find((manifest) => manifest.brand === "ENERGIZE")!;

  assert.equal(energize.successfullyBuiltDocumentCount, 0);
  assert.equal(energize.rejectedDocumentCount, 1);
  assert.ok(energize.errors.some((error) => error.code === "READONLY_MISSING_SHARE_TOKEN" || error.code === "SHARE_TOKEN_REQUIRED"));
  assert.equal(documents[1]!.meta.shareToken, "");
});

test("readonly Unlisted records missing Private Link Namespace are rejected", async () => {
  const documents = routedDryRunDocuments();
  documents[2]!.meta.privateLinkNamespace = "";
  documents[2]!.meta.canonicalPath = "/clients/agimpartner01/";
  const { result } = await buildReadonlyFixture({ documents });
  const agim = result.manifests.find((manifest) => manifest.brand === "AGIM")!;

  assert.equal(agim.successfullyBuiltDocumentCount, 0);
  assert.ok(agim.errors.some((error) => error.code === "READONLY_MISSING_PRIVATE_LINK_NAMESPACE"));
});

test("unknown Brand rejection does not corrupt valid readonly brand output", async () => {
  const documents = routedDryRunDocuments();
  documents[1]!.meta.brand = { label: "UNKNOWN", token: "UNKNOWN", slug: "unknown" };
  const { result, outputBaseRoot } = await buildReadonlyFixture({ documents });
  const arcbos = result.manifests.find((manifest) => manifest.brand === "ARCBOS")!;

  assert.equal(arcbos.successfullyBuiltDocumentCount, 1);
  assert.equal(result.summary.rejectedDocuments.length, 1);
  assert.match(result.summary.rejectedDocuments[0]!.reason, /Unknown Brand/);
  assert.equal(await exists(path.join(outputBaseRoot, "UNKNOWN")), false);
  assert.ok(await exists(path.join(outputBaseRoot, arcbos.outputRoot, "docs", "ARCBOS-SPEC-2606-0001", "index.html")));
});

test("readonly public manifests omit Notion internals while private audit stays outside site roots", async () => {
  const { result, outputBaseRoot } = await buildReadonlyFixture();
  const auditPath = result.auditReportPath;

  assert.equal(auditPath.startsWith(path.join(outputBaseRoot, "_audit")), true);
  assert.equal(auditPath.includes(`${path.sep}site${path.sep}`), false);
  assert.equal(result.auditReport.records.length, 4);
  assert.ok(result.auditReport.records.every((record) => record.pageId.startsWith("fixture-")));

  for (const manifest of result.manifests) {
    const raw = await fs.readFile(path.join(outputBaseRoot, manifest.brand, "manifest.json"), "utf8");
    assert.ok(!raw.includes("notionPageId"), manifest.brand);
    assert.ok(!raw.includes("notionDatabaseId"), manifest.brand);
    assert.ok(!raw.includes("fixture-"), manifest.brand);
    assert.ok(!raw.includes(outputBaseRoot), manifest.brand);
    assert.ok(!raw.includes(os.homedir()), manifest.brand);
    assert.ok(!raw.includes("dry-run-notion-token"), manifest.brand);
  }
});

test("readonly tests do not allow network calls beyond mocked document reads", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  globalThis.fetch = async (): Promise<Response> => {
    networkCalled = true;
    throw new Error("Network access is forbidden in routed readonly tests");
  };
  try {
    await buildReadonlyFixture();
    assert.equal(networkCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function buildReadonlyFixture(
  input: BuildInput = {},
  loader?: (config: AppConfig) => Promise<DocumentModel[]>
): Promise<{ result: RoutedReadonlyBuildResult; outputBaseRoot: string }> {
  const outputBaseRoot = input.outputBaseRoot ?? await tempRoot();
  const config = input.config ?? await loadRoutedDryRunConfig();
  const documents = input.documents ?? routedDryRunDocuments();
  const routes = routesWithOutputBase(await loadBrandRoutes(), outputBaseRoot);
  const result = await buildRoutedReadonly({
    config,
    routes,
    outputBaseRoot,
    loadDocuments: loader ?? (async () => documents),
    now: () => "2026-07-19T00:00:00.000Z"
  });
  return { result, outputBaseRoot };
}

async function tempRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "notion-routed-readonly-"));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readSources(dir: string): Promise<Array<{ file: string; content: string }>> {
  const result: Array<{ file: string; content: string }> = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests") {
        result.push(...await readSources(filePath));
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      result.push({ file: filePath, content: await fs.readFile(filePath, "utf8") });
    }
  }
  return result;
}
