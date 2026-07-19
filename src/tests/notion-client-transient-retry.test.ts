import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { AppConfig } from "../config.js";
import { NotionClient } from "../notion/client.js";

function makeConfig(): AppConfig {
  return {
    notionToken: "test-notion-token",
    notionDatabaseId: "test-database-id",
    targetSiteDomain: "https://docs.example.test",
    docIdYearMonth: "2607",
    allowedVisibility: new Set(["Public"]),
    publishableStatuses: new Set(["Final"]),
    allowedBrands: null,
    brandTokens: { ARCBOS: "ARCBOS" },
    documentTypeTokens: { Memo: "MEM" },
    brandProfiles: {},
    registerPublic: false,
    robotsDisallowDocs: false,
    allowMissingShareToken: false,
    legacyUnlistedDocsPath: false,
    autoGenerateShareToken: false,
    autoFillPrivateNamespace: false,
    autoFillPortalCategory: false,
    legacyPrivateDocIdUrls: false
  };
}

test("NotionClient retries a transient fetch failure", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (): Promise<Response> => {
    calls += 1;
    if (calls === 1) {
      throw new TypeError("temporary network failure");
    }
    return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
  };

  try {
    const pages = await new NotionClient(makeConfig()).queryDatabase();
    assert.deepEqual(pages, []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("NotionClient retries a transient 503 response", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (): Promise<Response> => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: "temporarily unavailable" }), {
        status: 503,
        headers: { "retry-after": "0" }
      });
    }
    return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
  };

  try {
    const pages = await new NotionClient(makeConfig()).queryDatabase();
    assert.deepEqual(pages, []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
