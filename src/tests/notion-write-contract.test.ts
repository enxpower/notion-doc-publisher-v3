/**
 * Tests for Notion writeback contracts.
 *
 * These tests use in-memory fakes only. They must never call the real Notion
 * API and must not require a .env file or GitHub secrets.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { NotionClient } from "../notion/client.js";
import { enableNotionMutationAllowList } from "../notion/read-only-guard.js";
import { NotionWriteback } from "../notion/writeback.js";

type RequestCall = {
  path: string;
  init: RequestInit;
};

type PagePropertyCall = {
  pageId: string;
  properties: Record<string, unknown>;
};

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    notionToken: "test-notion-token",
    notionDatabaseId: "test-database-id",
    targetSiteDomain: "https://docs.example.test",
    publishableStatuses: new Set(["Approved", "Published"]),
    allowedVisibility: new Set(["Public"]),
    allowedBrands: null,
    docIdYearMonth: "2606",
    brandTokens: { ARCBOS: "ARCBOS", ENERGIZE: "ENERGIZE", AGIM: "AGIM" },
    documentTypeTokens: { Specification: "SPEC", Agreement: "AGR", Memo: "MEM" },
    brandProfiles: {},
    registerPublic: false,
    robotsDisallowDocs: false,
    allowMissingShareToken: false,
    legacyUnlistedDocsPath: false,
    autoGenerateShareToken: true,
    autoFillPrivateNamespace: true,
    autoFillPortalCategory: true,
    legacyPrivateDocIdUrls: false,
    ...overrides
  };
}

function fakeNotionClient(calls: PagePropertyCall[]): { updatePageProperties: (pageId: string, properties: Record<string, unknown>, guardOperation?: string) => Promise<void> } {
  return {
    async updatePageProperties(pageId: string, properties: Record<string, unknown>): Promise<void> {
      calls.push({ pageId, properties });
    }
  };
}

/* ---------------- DOC_ID writeback ---------------- */

test("NotionClient.updateDocId writes DOC_ID only to the matching page", async () => {
  const calls: RequestCall[] = [];
  const client = new NotionClient(makeConfig());
  (client as unknown as { request: <T>(requestPath: string, init: RequestInit) => Promise<T> }).request =
    async <T>(requestPath: string, init: RequestInit): Promise<T> => {
      calls.push({ path: requestPath, init });
      return {} as T;
    };

  await client.updateDocId("page-target", "ARCBOS-SPEC-2606-0008");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/pages/page-target");
  assert.equal(calls[0]!.init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    properties: {
      DOC_ID: {
        rich_text: [{ type: "text", text: { content: "ARCBOS-SPEC-2606-0008" } }]
      }
    }
  });
});

/* ---------------- Published URL writeback ---------------- */

test("NotionWriteback.updateDocumentSuccess writes URL only to the matching page", async () => {
  const calls: PagePropertyCall[] = [];
  const writeback = new NotionWriteback(makeConfig());
  (writeback as unknown as { client: ReturnType<typeof fakeNotionClient> }).client = fakeNotionClient(calls);

  await writeback.updateDocumentSuccess(
    "page-success",
    "https://docs.example.test/clients/sharetoken001/",
    "run-123"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.pageId, "page-success");
  assert.deepEqual(calls[0]!.properties.PUBLISHED_URL, {
    url: "https://docs.example.test/clients/sharetoken001/"
  });
  assert.ok("PUBLISHED_AT" in calls[0]!.properties);
  assert.deepEqual(calls[0]!.properties.BUILD_STATUS, { select: { name: "success" } });
  assert.ok(!("DOC_ID" in calls[0]!.properties), "URL writeback must not rewrite DOC_ID");
});

test("failed deployment status writeback never writes a successful published URL", async () => {
  const calls: PagePropertyCall[] = [];
  const writeback = new NotionWriteback(makeConfig());
  (writeback as unknown as { client: ReturnType<typeof fakeNotionClient> }).client = fakeNotionClient(calls);

  await writeback.updateDocumentFailed(
    "page-failed",
    "Preview deployment failed after static build.",
    "run-456"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.pageId, "page-failed");
  assert.deepEqual(calls[0]!.properties.BUILD_STATUS, { select: { name: "failed" } });
  assert.ok(!("PUBLISHED_URL" in calls[0]!.properties), "failed deployment must not write PUBLISHED_URL");
  assert.ok(!("PUBLISHED_AT" in calls[0]!.properties), "failed deployment must not write PUBLISHED_AT");
});

test("NotionWriteback.updatePublishedUrlOnly writes only PUBLISHED_URL", async () => {
  const calls: PagePropertyCall[] = [];
  const writeback = new NotionWriteback(makeConfig());
  (writeback as unknown as { client: ReturnType<typeof fakeNotionClient> }).client = fakeNotionClient(calls);

  await writeback.updatePublishedUrlOnly("page-url-only", "https://docs.example.test/docs/ARCBOS-SPEC-2606-0001/");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.pageId, "page-url-only");
  assert.deepEqual(calls[0]!.properties, {
    PUBLISHED_URL: { url: "https://docs.example.test/docs/ARCBOS-SPEC-2606-0001/" }
  });
});

test("Notion mutation allow-list permits only routed URL writeback operation", async () => {
  const calls: PagePropertyCall[] = [];
  const writeback = new NotionWriteback(makeConfig());
  (writeback as unknown as { client: ReturnType<typeof fakeNotionClient> }).client = fakeNotionClient(calls);
  const restore = enableNotionMutationAllowList("test-writeback", ["updatePublishedUrlOnly"]);
  try {
    await writeback.updatePublishedUrlOnly("page-url-only", "https://docs.example.test/docs/ARCBOS-SPEC-2606-0001/");
    await assert.rejects(
      () => writeback.updateDocumentSuccess("page-success", "https://docs.example.test/docs/x/", "run"),
      /Notion mutation blocked/
    );
    await assert.rejects(
      () => writeback.writeAutoFillProperties("page-token", { shareToken: "stabletoken1" }),
      /Notion mutation blocked/
    );
  } finally {
    restore();
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]!.properties), ["PUBLISHED_URL"]);
});

test("writeback-preview composes success URL from supplied base URL and canonical path", async () => {
  const src = await fs.readFile(path.resolve("src/cli/writeback-preview.ts"), "utf8");

  assert.ok(
    src.includes("const url = publishedUrl(preview.baseUrl, document.path);"),
    "writeback-preview must derive the success URL from preview base URL plus document canonical path"
  );
  assert.ok(
    src.includes("return `${baseUrl}${canonicalPath}`;"),
    "publishedUrl must concatenate the supplied base URL and canonical path"
  );
  assert.ok(
    src.includes("await writeback.updateDocumentFailed(document.pageId, \"Preview deployment failed after static build.\", preview.runId);"),
    "deploy failure branch must mark the page failed instead of writing success"
  );
});

/* ---------------- Single database contract ---------------- */

test("configuration preserves NOTION_DATABASE_ID as the only database ID configuration", async () => {
  const sources = await readProductionSources(path.resolve("src"));
  const combined = sources.map((source) => source.content).join("\n");

  assert.ok(combined.includes("readRequiredEnv(\"NOTION_DATABASE_ID\")"));
  for (const forbidden of [
    /NOTION_DATABASE_IDS/,
    /NOTION_DATABASE_ID_[A-Z0-9_]+/,
    /[A-Z0-9_]+_NOTION_DATABASE_ID/,
    /PER_BRAND_NOTION_DATABASE/,
    /BRAND_DATABASE_ID/,
    /databaseIds/,
    /databaseByBrand/,
    /notionDatabaseIds/
  ]) {
    assert.equal(forbidden.test(combined), false, `forbidden per-brand database configuration matched ${forbidden}`);
  }
});

async function readProductionSources(dir: string): Promise<Array<{ file: string; content: string }>> {
  const result: Array<{ file: string; content: string }> = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests") {
        result.push(...await readProductionSources(filePath));
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      result.push({ file: filePath, content: await fs.readFile(filePath, "utf8") });
    }
  }
  return result;
}
