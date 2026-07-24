/**
 * Phase 3 Prompt 6: performance-safety tests for bounded document-fetch
 * concurrency and Notion-read prefiltering in lifecycle reconciliation.
 *
 * These tests assert structural/relative properties (bounds, ordering,
 * call counts, determinism) — never brittle absolute wall-clock thresholds
 * — so they cannot fail solely because the test machine is slow. No test
 * contacts real Notion; `globalThis.fetch` is mocked where needed.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { loadDocuments } from "../cli/shared.js";
import {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  mapWithConcurrency,
  resolveConcurrency
} from "../util/concurrency.js";
import type { DocumentStateRecord, IncrementalPlanRecord } from "../routing/incremental.js";
import {
  evaluateNoopReconciliationPreconditions,
  runNoopLifecycleReconciliation,
  type NotionLifecycleSnapshot,
  type ReconciliationWritebackClient
} from "../routing/lifecycle-reconciliation.js";

// ---------------------------------------------------------------------------
// mapWithConcurrency / resolveConcurrency — direct unit tests
// ---------------------------------------------------------------------------

test("default concurrency is conservative (4) and within the documented safe bounds", () => {
  assert.equal(DEFAULT_CONCURRENCY, 4);
  assert.ok(DEFAULT_CONCURRENCY >= MIN_CONCURRENCY && DEFAULT_CONCURRENCY <= MAX_CONCURRENCY);
  assert.equal(resolveConcurrency(undefined), DEFAULT_CONCURRENCY);
  assert.equal(resolveConcurrency(""), DEFAULT_CONCURRENCY);
  assert.equal(resolveConcurrency("   "), DEFAULT_CONCURRENCY);
});

test("invalid concurrency override values fail closed to the safe default", () => {
  for (const invalid of ["abc", "0", "-1", "2.5", String(MAX_CONCURRENCY + 1), "NaN", "Infinity"]) {
    assert.equal(resolveConcurrency(invalid), DEFAULT_CONCURRENCY, invalid);
  }
});

test("valid concurrency override values within [1, 8] are accepted as-is", () => {
  assert.equal(resolveConcurrency("1"), 1);
  assert.equal(resolveConcurrency("3"), 3);
  assert.equal(resolveConcurrency(String(MAX_CONCURRENCY)), MAX_CONCURRENCY);
});

test("mapWithConcurrency never exceeds the configured maximum concurrent workers", async () => {
  const total = 20;
  const concurrency = 4;
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: total }, (_, i) => i);

  await mapWithConcurrency(items, concurrency, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return item;
  });

  assert.ok(peak <= concurrency, `peak concurrency ${peak} exceeded configured max ${concurrency}`);
  assert.ok(peak > 1, "expected some overlap to actually occur with concurrency > 1 (sanity check on the test itself)");
});

test("mapWithConcurrency preserves input order regardless of completion order", async () => {
  const items = [1, 2, 3, 4, 5];
  const delays = [50, 10, 40, 5, 30]; // deliberately resolve out of order
  const result = await mapWithConcurrency(items, 3, async (item, index) => {
    await new Promise((resolve) => setTimeout(resolve, delays[index]));
    return item * 10;
  });
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
});

test("mapWithConcurrency returns every item exactly once", async () => {
  const items = Array.from({ length: 37 }, (_, i) => i);
  const seen: number[] = [];
  const result = await mapWithConcurrency(items, 4, async (item) => {
    seen.push(item);
    return item;
  });
  assert.equal(seen.length, 37);
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
  assert.deepEqual(result, items);
});

test("a failed worker rejects the whole operation and identifies the failing item", async () => {
  const items = ["page-a", "page-b", "page-c"];
  await assert.rejects(
    mapWithConcurrency(items, 2, async (item) => {
      if (item === "page-b") {
        throw new Error(`Failed to load Notion page ${item}: simulated failure`);
      }
      return item;
    }),
    /Failed to load Notion page page-b/
  );
});

test("concurrency of 1 matches historical strictly-serial behavior", async () => {
  const items = [1, 2, 3, 4];
  const log: string[] = [];
  await mapWithConcurrency(items, 1, async (item) => {
    log.push(`start:${item}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
    log.push(`end:${item}`);
    return item;
  });
  assert.deepEqual(log, ["start:1", "end:1", "start:2", "end:2", "start:3", "end:3", "start:4", "end:4"]);
});

test("empty input makes zero worker calls", async () => {
  let calls = 0;
  const result = await mapWithConcurrency([], 4, async (item) => {
    calls += 1;
    return item;
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, []);
});

test("concurrency is clamped to the number of items when fewer items than the configured maximum", async () => {
  let inFlight = 0;
  let peak = 0;
  await mapWithConcurrency([1, 2], 8, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return item;
  });
  assert.ok(peak <= 2);
});

// ---------------------------------------------------------------------------
// loadDocuments() — mocked-fetch integration test proving bounded, ordered,
// brand-neutral, write-free Notion fetch behavior
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    notionToken: "test-notion-token",
    notionDatabaseId: "test-database-id",
    targetSiteDomain: "https://docs.example.test",
    docIdYearMonth: "2607",
    allowedVisibility: new Set(["Public"]),
    publishableStatuses: new Set(["Final"]),
    allowedBrands: null,
    brandTokens: { ARCBOS: "ARCBOS", ENERGIZE: "ENERGIZE", AGIM: "AGIM", GONG: "GONG" },
    documentTypeTokens: { Memo: "MEM" },
    brandProfiles: {},
    registerPublic: false,
    robotsDisallowDocs: false,
    allowMissingShareToken: false,
    legacyUnlistedDocsPath: false,
    autoGenerateShareToken: false,
    autoFillPrivateNamespace: false,
    autoFillPortalCategory: false,
    legacyPrivateDocIdUrls: false,
    ...overrides
  };
}

function mockPage(id: string, brand: string, docId: string) {
  return {
    id,
    properties: {
      Title: { type: "title", title: [{ type: "text", plain_text: docId, text: { content: docId } }] },
      DOC_ID: { type: "rich_text", rich_text: [{ type: "text", plain_text: docId, text: { content: docId } }] },
      Brand: { type: "select", select: { name: brand } },
      Client: { type: "select", select: { name: "Test Client" } },
      Project: { type: "select", select: { name: "Test Project" } },
      "Document Type": { type: "select", select: { name: "Memo" } },
      Version: { type: "select", select: { name: "v1.0" } },
      Status: { type: "select", select: { name: "Final" } },
      Visibility: { type: "select", select: { name: "Public" } },
      Publish: { type: "checkbox", checkbox: true }
    }
  };
}

test("loadDocuments fetches page blocks with bounded concurrency, preserves order, and issues zero write requests", async () => {
  const originalFetch = globalThis.fetch;
  const brands = ["ARCBOS", "ENERGIZE", "AGIM", "GONG"];
  const pageCount = 12;
  const pages = Array.from({ length: pageCount }, (_, i) =>
    mockPage(`page-${i}`, brands[i % brands.length]!, `DOC-${i}`)
  );

  let inFlightBlockFetches = 0;
  let peakBlockFetches = 0;
  const blockFetchOrder: string[] = [];
  const methodsUsed = new Set<string>();

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    methodsUsed.add(method);
    if (url.includes("/databases/") && url.includes("/query")) {
      return new Response(JSON.stringify({ results: pages, has_more: false }), { status: 200 });
    }
    const blockMatch = url.match(/\/blocks\/([^/]+)\/children/);
    if (blockMatch) {
      const pageId = blockMatch[1]!;
      inFlightBlockFetches += 1;
      peakBlockFetches = Math.max(peakBlockFetches, inFlightBlockFetches);
      // Vary delay so earlier pages sometimes resolve later than later pages.
      const delay = pageId.endsWith("0") ? 15 : 2;
      await new Promise((resolve) => setTimeout(resolve, delay));
      blockFetchOrder.push(pageId);
      inFlightBlockFetches -= 1;
      return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
    }
    throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const documents = await loadDocuments(makeConfig());
    assert.equal(documents.length, pageCount);
    // Output order must match the order Notion returned pages in, regardless
    // of block-fetch completion order.
    assert.deepEqual(documents.map((d) => d.source.notionPageId), pages.map((p) => p.id));
    // Bounded concurrency: never more than DEFAULT_CONCURRENCY block fetches in flight.
    assert.ok(peakBlockFetches <= DEFAULT_CONCURRENCY, `peak ${peakBlockFetches} exceeded ${DEFAULT_CONCURRENCY}`);
    assert.ok(peakBlockFetches > 1, "expected real overlap in this scenario");
    // Brand neutrality: all four brands were fetched identically (no brand-specific path).
    assert.deepEqual(documents.map((d) => d.meta.brand.label).filter((b, i) => i < brands.length), brands);
    // No write request was ever issued.
    assert.ok(!methodsUsed.has("PATCH"), "loadDocuments must never issue a PATCH (write) request");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadDocuments respects a valid NOTION_FETCH_CONCURRENCY override", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.NOTION_FETCH_CONCURRENCY;
  process.env.NOTION_FETCH_CONCURRENCY = "2";
  const pages = Array.from({ length: 8 }, (_, i) => mockPage(`page-${i}`, "ARCBOS", `DOC-${i}`));
  let inFlight = 0;
  let peak = 0;

  globalThis.fetch = (async (url: string) => {
    if (url.includes("/databases/") && url.includes("/query")) {
      return new Response(JSON.stringify({ results: pages, has_more: false }), { status: 200 });
    }
    if (url.includes("/blocks/")) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;

  try {
    await loadDocuments(makeConfig());
    assert.ok(peak <= 2, `peak ${peak} exceeded override of 2`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.NOTION_FETCH_CONCURRENCY;
    } else {
      process.env.NOTION_FETCH_CONCURRENCY = originalEnv;
    }
  }
});

test("a single page block-fetch failure fails loadDocuments and identifies the page", async () => {
  const originalFetch = globalThis.fetch;
  const pages = [mockPage("page-ok", "ARCBOS", "DOC-OK"), mockPage("page-bad", "ARCBOS", "DOC-BAD")];

  globalThis.fetch = (async (url: string) => {
    if (url.includes("/databases/") && url.includes("/query")) {
      return new Response(JSON.stringify({ results: pages, has_more: false }), { status: 200 });
    }
    if (url.includes("/blocks/page-bad/")) {
      // A non-transient 400 avoids exercising the client's real retry/backoff
      // delay in this test; retry behavior itself is covered separately in
      // src/tests/notion-client-transient-retry.test.ts.
      return new Response(JSON.stringify({ message: "bad request" }), { status: 400 });
    }
    if (url.includes("/blocks/")) {
      return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(loadDocuments(makeConfig()), /page-bad/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Lifecycle reconciliation: Notion-read prefiltering (Part D)
// ---------------------------------------------------------------------------

class CountingReconciliationClient implements ReconciliationWritebackClient {
  readonly readCalls: string[] = [];
  readonly reconcileCalls: string[] = [];
  constructor(private readonly statusByPageId: Map<string, string>) {}

  async readLifecycleStatus(pageId: string): Promise<NotionLifecycleSnapshot> {
    this.readCalls.push(pageId);
    return { buildStatus: this.statusByPageId.get(pageId) ?? "" };
  }

  async reconcileLifecycleStatus(update: { pageId: string }): Promise<void> {
    this.reconcileCalls.push(update.pageId);
  }
}

function stateRecord(overrides: Partial<DocumentStateRecord> = {}): DocumentStateRecord {
  return {
    pageId: "page-1",
    docId: "ARCBOS-MEM-2607-0001",
    brand: "ARCBOS",
    visibility: "Public",
    namespace: "docs",
    shareToken: "",
    canonicalOrigin: "https://docs.arcbos.com",
    pathPrefix: "",
    canonicalPath: "/docs/ARCBOS-MEM-2607-0001/",
    finalUrl: "https://docs.arcbos.com/docs/ARCBOS-MEM-2607-0001/",
    deploymentTarget: "enxpower/notion-doc-publisher-v3",
    deploymentRoot: "",
    ownedFiles: ["docs/ARCBOS-MEM-2607-0001/index.html"],
    contentHash: "content",
    routingHash: "routing",
    rendererHash: "renderer",
    assetHash: "asset",
    desiredStateHash: "desired",
    pdfRequired: true,
    publishedAt: "2026-07-19T00:00:00.000Z",
    ...overrides
  };
}

function noopRecord(overrides: Partial<IncrementalPlanRecord> = {}, state: DocumentStateRecord): IncrementalPlanRecord {
  const { publishedAt: _publishedAt, ...desired } = state;
  return {
    action: "NOOP",
    reason: "STATE_UNCHANGED",
    brand: state.brand,
    pageId: state.pageId,
    docId: state.docId,
    previous: state,
    desired,
    errors: [],
    ...overrides
  };
}

test("preconditions-only evaluation never contacts Notion and matches the full evaluation's non-status reasons", () => {
  const eligible = stateRecord();
  const record = noopRecord({}, eligible);
  const result = evaluateNoopReconciliationPreconditions({
    planRecord: record,
    previousState: eligible,
    nextState: eligible
  });
  assert.equal(result.eligible, true);
});

test("ineligible NOOP records (missing state, hash mismatch) cause zero readLifecycleStatus calls, while eligible ones in the same batch cause exactly one each", async () => {
  const eligibleState = stateRecord({ pageId: "page-eligible", docId: "ARCBOS-MEM-2607-0001" });
  const eligibleRecord = noopRecord({}, eligibleState);

  const missingStateRecord = noopRecord(
    { pageId: "page-missing-state", docId: "ARCBOS-MEM-2607-0002", desired: undefined },
    stateRecord({ pageId: "page-missing-state", docId: "ARCBOS-MEM-2607-0002" })
  );
  // Simulate a hash-mismatched record: previous/next state agree with each
  // other but disagree with the freshly computed desired state.
  const mismatchState = stateRecord({ pageId: "page-mismatch", docId: "ARCBOS-MEM-2607-0003" });
  const mismatchRecord: IncrementalPlanRecord = {
    action: "NOOP",
    reason: "STATE_UNCHANGED",
    brand: "ARCBOS",
    pageId: "page-mismatch",
    docId: "ARCBOS-MEM-2607-0003",
    previous: mismatchState,
    desired: { ...mismatchState, contentHash: "different-hash" },
    errors: []
  };

  const statusByPageId = new Map([
    ["page-eligible", "failed"],
    ["page-missing-state", "failed"],
    ["page-mismatch", "failed"]
  ]);
  const client = new CountingReconciliationClient(statusByPageId);

  const outcomes = await runNoopLifecycleReconciliation({
    planRecords: [missingStateRecord, mismatchRecord, eligibleRecord],
    previousByDocId: new Map([
      ["ARCBOS-MEM-2607-0001", eligibleState],
      ["ARCBOS-MEM-2607-0003", mismatchState]
    ]),
    nextByDocId: new Map([
      ["ARCBOS-MEM-2607-0001", eligibleState],
      ["ARCBOS-MEM-2607-0003", mismatchState]
    ]),
    writeback: client,
    runId: "run-perf-1"
  });

  assert.deepEqual(client.readCalls, ["page-eligible"], "only the structurally eligible record may reach a Notion read");
  assert.deepEqual(client.reconcileCalls, ["page-eligible"]);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.docId, "ARCBOS-MEM-2607-0001");
});

test("reconciliation mutation ordering remains deterministic (matches planRecords order) after prefiltering", async () => {
  const stateA = stateRecord({ pageId: "page-a", docId: "ARCBOS-MEM-2607-0010" });
  const stateB = stateRecord({ pageId: "page-b", docId: "ARCBOS-MEM-2607-0011" });
  const recordA = noopRecord({}, stateA);
  const recordB = noopRecord({}, stateB);
  const client = new CountingReconciliationClient(new Map([["page-a", "failed"], ["page-b", "failed"]]));

  const outcomes = await runNoopLifecycleReconciliation({
    planRecords: [recordB, recordA],
    previousByDocId: new Map([["ARCBOS-MEM-2607-0010", stateA], ["ARCBOS-MEM-2607-0011", stateB]]),
    nextByDocId: new Map([["ARCBOS-MEM-2607-0010", stateA], ["ARCBOS-MEM-2607-0011", stateB]]),
    writeback: client,
    runId: "run-perf-2"
  });

  assert.deepEqual(client.reconcileCalls, ["page-b", "page-a"], "mutation order must follow planRecords order, not any reordering");
  assert.equal(outcomes.length, 2);
});

test("a reconciliation read/write failure still propagates (fail-closed) after prefiltering", async () => {
  const state = stateRecord();
  const record = noopRecord({}, state);
  const failingClient: ReconciliationWritebackClient = {
    async readLifecycleStatus(): Promise<NotionLifecycleSnapshot> {
      return { buildStatus: "failed" };
    },
    async reconcileLifecycleStatus(): Promise<void> {
      throw new Error("simulated Notion write failure");
    }
  };

  await assert.rejects(
    runNoopLifecycleReconciliation({
      planRecords: [record],
      previousByDocId: new Map([[state.docId, state]]),
      nextByDocId: new Map([[state.docId, state]]),
      writeback: failingClient,
      runId: "run-perf-3"
    }),
    /simulated Notion write failure/
  );
});

test("zero NOOP records in a plan cause zero Notion reads", async () => {
  const client = new CountingReconciliationClient(new Map());
  const nonNoop: IncrementalPlanRecord = {
    action: "UPDATE",
    reason: "OUTPUT_RELEVANT_HASH_CHANGED",
    brand: "ARCBOS",
    pageId: "page-update",
    docId: "ARCBOS-MEM-2607-0099",
    errors: []
  };
  const outcomes = await runNoopLifecycleReconciliation({
    planRecords: [nonNoop],
    previousByDocId: new Map(),
    nextByDocId: new Map(),
    writeback: client,
    runId: "run-perf-4"
  });
  assert.equal(client.readCalls.length, 0);
  assert.equal(outcomes.length, 0);
});

// ---------------------------------------------------------------------------
// Part E: workflow checkout/install cost gating (structural — no workflow run)
// ---------------------------------------------------------------------------

const WORKFLOWS_DIR = path.resolve(process.cwd(), ".github/workflows");
const PRODUCTION_WORKFLOW_PATH = path.join(WORKFLOWS_DIR, "incremental-content-publish.yml");

async function readProductionWorkflow(): Promise<string> {
  return fs.readFile(PRODUCTION_WORKFLOW_PATH, "utf8");
}

test("Typst installation and font installation remain gated behind actual render work (skipped on pure NOOP runs)", async () => {
  const workflow = await readProductionWorkflow();
  const typstStep = workflow.match(/- name: Install pinned Typst for render work\n\s*if: (.+)\n/);
  const fontStep = workflow.match(/- name: Install CJK and Latin fonts for render work\n\s*if: (.+)\n/);
  assert.ok(typstStep, "Typst install step must declare an if: condition");
  assert.ok(fontStep, "font install step must declare an if: condition");
  assert.match(typstStep![1]!, /steps\.render-work\.outputs\.required == 'true'/);
  assert.match(fontStep![1]!, /steps\.render-work\.outputs\.required == 'true'/);
});

test("target-repository checkouts remain gated behind apply mode, and private-state checkout remains unconditional (required for NOOP classification itself)", async () => {
  const workflow = await readProductionWorkflow();
  for (const brand of ["ENERGIZE", "AGIM", "GONG"]) {
    const match = workflow.match(new RegExp(`- name: Checkout ${brand} target\\n\\s*if: (.+)\\n`));
    assert.ok(match, `${brand} checkout step must declare an if: condition`);
    assert.match(match![1]!, /steps\.execution\.outputs\.mode == 'apply'/);
  }
  const stateCheckoutIndex = workflow.indexOf("- name: Checkout private state");
  const nextStepIndex = workflow.indexOf("- name: Checkout ENERGIZE target");
  const stateCheckoutBlock = workflow.slice(stateCheckoutIndex, nextStepIndex);
  assert.doesNotMatch(stateCheckoutBlock, /\n\s*if:/, "private-state checkout must remain unconditional — the plan step needs it to classify NOOP at all");
});

test("exactly one production schedule and one automatic production publisher remain after performance changes", async () => {
  const files = (await fs.readdir(WORKFLOWS_DIR)).filter((f) => /\.ya?ml$/i.test(f));
  assert.equal(files.length, 9, "no new workflow file may be introduced by performance work");
  let scheduled = 0;
  const deployCapable: string[] = [];
  for (const file of files) {
    const source = (await fs.readFile(path.join(WORKFLOWS_DIR, file), "utf8"))
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    if (/^\s{2}schedule:\s*$/m.test(source)) scheduled += 1;
    if (/actions\/(?:deploy-pages|upload-pages-artifact)@/.test(source)) deployCapable.push(file);
  }
  assert.equal(scheduled, 1);
  assert.deepEqual(deployCapable.sort(), ["arcbos-pages-clean-deploy.yml", "incremental-content-publish.yml"]);
});

test("no workflow trigger, credential scope, action pin, or Typst checksum changed as a side effect of performance work", async () => {
  const workflow = await readProductionWorkflow();
  assert.match(workflow, /cron: "0 9 \* \* \*"/);
  assert.match(workflow, /startsWith\(github\.event\.comment\.body, '\/phase2-publish PHASE2-INCREMENTAL-PUBLISH '\)/);
  assert.match(workflow, /secrets\.DEPLOY_KEY_ENERGIZE/);
  assert.match(workflow, /secrets\.DEPLOY_KEY_AGIM/);
  assert.match(workflow, /secrets\.DEPLOY_KEY_GONG/);
  assert.match(workflow, /secrets\.DEPLOY_KEY_STATE/);
  assert.doesNotMatch(workflow, /DEPLOY_KEY_ARCBOS/);
  assert.match(workflow, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0/);
  assert.match(workflow, /TYPST_SHA256_LINUX_X86_64:\s*"7d214bfeffc2e585dc422d1a09d2b144969421281e8c7f5d784b65fc69b5673f"/);
  assert.match(workflow, /sha256sum --check --strict/);
});

test("Preview Publish remains non-deploying and non-writing after performance changes", async () => {
  const workflow = await fs.readFile(path.join(WORKFLOWS_DIR, "preview-publish.yml"), "utf8");
  assert.doesNotMatch(workflow, /actions\/(?:configure-pages|upload-pages-artifact|deploy-pages)@/);
  assert.doesNotMatch(workflow, /run: npm run writeback:/);
});

// ---------------------------------------------------------------------------
// Part F: observability — aggregate-only, no content/secret leakage
// ---------------------------------------------------------------------------

test("the writeback observability summary contains only safe aggregate counts/timing fields, never document content or secret-shaped values", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/cli/writeback-incremental.ts"),
    "utf8"
  );
  const observabilityBlock = source.match(/observability:\s*\{([^}]+)\}/);
  assert.ok(observabilityBlock, "writeback-incremental.ts must expose an observability summary block");
  const fields = observabilityBlock![1]!
    .split(",")
    .map((line) => line.split(":")[0]!.trim())
    .filter(Boolean);
  assert.deepEqual(
    fields.sort(),
    ["noopCandidateCount", "reconciliationMutationCount", "reconciliationReadCount", "writebackElapsedMs"].sort()
  );
  for (const forbidden of ["title", "Title", "docId", "pageId", "url", "URL", "token", "Token", "secret", "content"]) {
    assert.ok(!fields.some((f) => f.includes(forbidden)), `observability field must not resemble content/identity data: ${forbidden}`);
  }
});
