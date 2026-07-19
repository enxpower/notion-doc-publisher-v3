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
import { computeBrandCanonicalUrl } from "../routing/brand-routing.js";
import { loadBrandRoutes } from "../routing/routes.js";

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

test("NotionClient retries Notion 429 responses without exposing credentials", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push(String(input));
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-notion-token");
    if (calls.length === 1) {
      return new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "0" }
      });
    }
    return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
  };

  try {
    const client = new NotionClient(makeConfig());
    const pages = await client.queryDatabase();
    assert.deepEqual(pages, []);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("brand-aware canonical URL resolver covers ARCBOS and ENERGIZE private routes", async () => {
  const routes = await loadBrandRoutes();

  assert.equal(
    computeBrandCanonicalUrl({
      routes,
      brandLabel: " ARCBOS ",
      canonicalPath: "/clients/arcbosclienttoken/",
      docId: "ARCBOS-MEM-2607-0026"
    }),
    "https://docs.arcbos.com/clients/arcbosclienttoken/"
  );
  assert.equal(
    computeBrandCanonicalUrl({
      routes,
      brandLabel: "ARCBOS",
      canonicalPath: "/internal/arcbosinternaltoken/",
      docId: "ARCBOS-MEM-2607-0027"
    }),
    "https://docs.arcbos.com/internal/arcbosinternaltoken/"
  );
  assert.equal(
    computeBrandCanonicalUrl({
      routes,
      brandLabel: "ENERGIZE",
      canonicalPath: "/clients/energizeclienttoken/",
      docId: "ENERGIZE-MEM-2607-0029"
    }),
    "https://docs.energizeos.com/clients/energizeclienttoken/"
  );
  assert.equal(
    computeBrandCanonicalUrl({
      routes,
      brandLabel: " energize ",
      canonicalPath: "/internal/energizeinternaltoken/",
      docId: "ENERGIZE-MEM-2607-0028"
    }),
    "https://docs.energizeos.com/internal/energizeinternaltoken/"
  );
});

test("brand-aware canonical URL resolver fails closed and blocks cross-brand public paths", async () => {
  const routes = await loadBrandRoutes();

  assert.throws(
    () => computeBrandCanonicalUrl({ routes, brandLabel: "", canonicalPath: "/clients/token/", docId: "ARCBOS-MEM-2607-0026" }),
    /Brand is missing/
  );
  assert.throws(
    () => computeBrandCanonicalUrl({ routes, brandLabel: "UNKNOWN", canonicalPath: "/clients/token/", docId: "UNKNOWN-MEM-2607-0026" }),
    /unknown Brand UNKNOWN/
  );
  assert.throws(
    () => computeBrandCanonicalUrl({
      routes,
      brandLabel: "ENERGIZE",
      canonicalPath: "/docs/ARCBOS-MEM-2607-0026/",
      docId: "ARCBOS-MEM-2607-0026"
    }),
    /does not match ENERGIZE/
  );
});

test("brand-aware private URLs preserve token namespace and do not expose DOC_ID", async () => {
  const routes = await loadBrandRoutes();
  const doc = {
    docId: "ENERGIZE-MEM-2607-0029",
    shareToken: "energizeclienttoken",
    namespace: "clients",
    canonicalPath: "/clients/energizeclienttoken/"
  };
  const before = structuredClone(doc);
  const url = computeBrandCanonicalUrl({
    routes,
    brandLabel: "ENERGIZE",
    canonicalPath: doc.canonicalPath,
    docId: doc.docId
  });

  assert.deepEqual(doc, before);
  assert.ok(url.startsWith("https://docs.energizeos.com/clients/"));
  assert.ok(!url.includes(doc.docId), "private URL must not expose DOC_ID");
  assert.equal(doc.shareToken, before.shareToken);
  assert.equal(doc.namespace, before.namespace);
});

test("writeback-preview uses brand-aware routes, not PREVIEW_BASE_URL, for success URLs", async () => {
  const src = await fs.readFile(path.resolve("src/cli/writeback-preview.ts"), "utf8");

  assert.ok(
    src.includes("loadBrandRoutes"),
    "writeback-preview must load committed brand routes"
  );
  assert.ok(
    src.includes("computeBrandCanonicalUrl"),
    "writeback-preview must use the authoritative brand-aware canonical URL resolver"
  );
  assert.ok(
    !src.includes("publishedUrl(preview.baseUrl"),
    "writeback-preview must not derive success URLs from global PREVIEW_BASE_URL"
  );
  assert.ok(
    !src.includes("return `${baseUrl}${canonicalPath}`;"),
    "writeback-preview must not concatenate a single base URL with every canonical path"
  );
  assert.ok(
    src.includes("Preview deployment failed after static build."),
    "deploy failure branch must mark the page failed instead of writing success"
  );
  assert.ok(
    src.includes("updatePageOnce"),
    "writeback-preview must avoid duplicate Notion page mutations"
  );
});

test("Preview Publish workflow still calls the corrected writeback entry point", async () => {
  const workflow = await fs.readFile(path.resolve(".github/workflows/preview-publish.yml"), "utf8");
  const rawPackage = await fs.readFile(path.resolve("package.json"), "utf8");
  const pkg = JSON.parse(rawPackage) as { scripts: Record<string, string> };
  const src = await fs.readFile(path.resolve("src/cli/writeback-preview.ts"), "utf8");

  assert.ok(workflow.includes("run: npm run ci:writeback"));
  assert.ok(
    workflow.includes("ALLOWED_BRANDS: ${{ vars.ALLOWED_BRANDS || secrets.ALLOWED_BRANDS || 'ARCBOS' }}"),
    "same-repository Pages deployment must default to ARCBOS unless an owner-configured brand filter exists"
  );
  assert.equal(pkg.scripts["ci:writeback"], "tsc && node .tmp/cli/writeback-preview.js");
  assert.ok(src.includes("computeBrandCanonicalUrl"));
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
