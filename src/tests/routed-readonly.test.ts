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
import { emptyValidation, type DocumentModel } from "../model/document.js";
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
import {
  createFixtureRoutedPdfRenderer,
  MIN_ROUTED_PDF_BYTES,
  type RoutedPdfRenderer,
  type RoutedPdfRendererInput
} from "../routing/routed-pdf.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";

type BuildInput = {
  documents?: DocumentModel[];
  config?: AppConfig;
  outputBaseRoot?: string;
  pdfRenderer?: RoutedPdfRenderer;
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
  assert.ok(cliSource.includes("routes-readonly-fixture"), "fixture mode must not write to the production readonly staging root");
  assert.ok(cliSource.includes("resetReadonlyOutputRoot(outputBaseRoot)"), "readonly CLI must reset its selected local staging root before build");
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
    assert.equal(config.brandProfiles.ENERGIZE?.favicon, "energizeos-favicon.svg");
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

async function readSources(root: string): Promise<Array<{ path: string; content: string }>> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const sources: Array<{ path: string; content: string }> = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      sources.push(...await readSources(target));
      continue;
    }
    if (entry.isFile() && target.endsWith(".ts")) {
      sources.push({ path: target, content: await fs.readFile(target, "utf8") });
    }
  }
  return sources;
}

void os.tmpdir;
void emptyValidation;
void NotionClient;
void enableNotionReadOnlyMode;
void NotionWriteback;
void writePdfResult;
void buildRoutedReadonly;
void RoutedReadonlyBuildResult;
void createFixtureRoutedPdfRenderer;
void MIN_ROUTED_PDF_BYTES;
void RoutedPdfRendererInput;
void routesWithOutputBase;
void routedDryRunDocuments;
void BuildInput;
