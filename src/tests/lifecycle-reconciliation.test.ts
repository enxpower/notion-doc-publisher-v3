import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import type { DocumentModel } from "../model/document.js";
import type { BrandRoute } from "../routing/brand-routing.js";
import {
  committedStateAfterSuccessfulPlan,
  createIncrementalPlan,
  type DocumentStateRecord,
  type IncrementalPlan,
  type IncrementalPlanRecord
} from "../routing/incremental.js";
import {
  buildReconciliationPayload,
  evaluateNoopReconciliation,
  runNoopLifecycleReconciliation,
  type NotionLifecycleSnapshot,
  type ReconciliationWritebackClient
} from "../routing/lifecycle-reconciliation.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";

const FIXED_NOW = "2026-07-19T00:00:00.000Z";
const ALL_BRANDS = ["ARCBOS", "ENERGIZE", "AGIM", "GONG"];

// ---------------------------------------------------------------------------
// Fixture helpers (mirrors src/tests/incremental.test.ts conventions)
// ---------------------------------------------------------------------------

async function makeFixture(): Promise<{ documents: DocumentModel[]; routes: BrandRoute[]; config: AppConfig }> {
  const outputBaseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "notion-reconciliation-"));
  return {
    documents: routedDryRunDocuments().map((document) => structuredClone(document)),
    routes: routesWithOutputBase(await loadBrandRoutes(), outputBaseRoot),
    config: await loadRoutedDryRunConfig()
  };
}

/** Builds a plan where every document is NOOP (all four brands), plus the
 * verified previous/next state maps a real production run would have. */
async function makeAllNoopFixture(): Promise<{
  plan: IncrementalPlan;
  previousByDocId: Map<string, DocumentStateRecord>;
  nextByDocId: Map<string, DocumentStateRecord>;
}> {
  const fixture = await makeFixture();
  const firstPlan = createIncrementalPlan({ documents: fixture.documents, routes: fixture.routes, config: fixture.config, now: FIXED_NOW });
  const successfulState = committedStateAfterSuccessfulPlan({ plan: firstPlan, deployedAt: FIXED_NOW });
  const plan = createIncrementalPlan({
    documents: fixture.documents,
    routes: fixture.routes,
    config: fixture.config,
    previousState: successfulState,
    now: FIXED_NOW
  });
  assert.equal(plan.counts.NOOP, 4, "fixture must produce a true NOOP for all four brands");
  const previousByDocId = new Map(successfulState.records.map((record) => [record.docId, record]));
  const nextByDocId = new Map(successfulState.records.map((record) => [record.docId, record]));
  return { plan, previousByDocId, nextByDocId };
}

function noopRecordFor(plan: IncrementalPlan, brand: string): IncrementalPlanRecord {
  const record = plan.records.find((candidate) => candidate.brand === brand && candidate.action === "NOOP");
  assert.ok(record, `expected a NOOP record for ${brand}`);
  return record;
}

class RecordingReconciliationClient implements ReconciliationWritebackClient {
  readonly statusByPageId: Map<string, string>;
  readonly readCalls: string[] = [];
  readonly reconcileCalls: Array<{ pageId: string; publishedUrl: string; publishedAt: string; runId: string; message: string }> = [];
  private readonly failReconcile: boolean;

  constructor(statusByPageId: Map<string, string>, options: { failReconcile?: boolean } = {}) {
    this.statusByPageId = statusByPageId;
    this.failReconcile = options.failReconcile ?? false;
  }

  async readLifecycleStatus(pageId: string): Promise<NotionLifecycleSnapshot> {
    this.readCalls.push(pageId);
    return { buildStatus: this.statusByPageId.get(pageId) ?? "" };
  }

  async reconcileLifecycleStatus(update: {
    pageId: string;
    publishedUrl: string;
    publishedAt: string;
    runId: string;
    message: string;
  }): Promise<void> {
    if (this.failReconcile) {
      throw new Error(`simulated Notion write failure for ${update.pageId}`);
    }
    this.reconcileCalls.push(update);
  }
}

// ---------------------------------------------------------------------------
// 1 + 13: eligible reconciliation, identical rule across all four brands
// ---------------------------------------------------------------------------

test("NOOP records with a verified matching state and a stale failed BUILD_STATUS are reconciled identically for all four brands", async () => {
  const { plan, previousByDocId, nextByDocId } = await makeAllNoopFixture();
  const statusByPageId = new Map(plan.records.map((record) => [record.pageId, "failed"]));
  const client = new RecordingReconciliationClient(statusByPageId);

  const outcomes = await runNoopLifecycleReconciliation({
    planRecords: plan.records,
    previousByDocId,
    nextByDocId,
    writeback: client,
    runId: "run-123"
  });

  assert.equal(outcomes.length, 4, "exactly one reconciliation per brand, no more");
  assert.deepEqual(outcomes.map((o) => o.brand).sort(), [...ALL_BRANDS].sort());
  assert.equal(client.reconcileCalls.length, 4);
  for (const brand of ALL_BRANDS) {
    const record = noopRecordFor(plan, brand);
    const state = nextByDocId.get(record.docId)!;
    const call = client.reconcileCalls.find((c) => c.pageId === record.pageId);
    assert.ok(call, `expected a reconciliation write for ${brand}`);
    assert.equal(call!.publishedUrl, state.finalUrl, `${brand} publishedUrl must come from verified private state`);
    assert.equal(call!.publishedAt, state.publishedAt, `${brand} publishedAt must be preserved, not regenerated`);
    assert.equal(call!.runId, "run-123");
    assert.match(call!.message, /reconciled from an already verified known-good deployment state/i);
    assert.doesNotMatch(call!.message, /rendered|deployed|created/i, "message must not claim new render/deploy work occurred");
  }
});

// ---------------------------------------------------------------------------
// 2 + 14: already-success status yields zero mutation (also proves idempotency)
// ---------------------------------------------------------------------------

test("NOOP records already showing a successful BUILD_STATUS receive zero reconciliation mutation", async () => {
  const { plan, previousByDocId, nextByDocId } = await makeAllNoopFixture();
  const statusByPageId = new Map(plan.records.map((record) => [record.pageId, "success"]));
  const client = new RecordingReconciliationClient(statusByPageId);

  const outcomes = await runNoopLifecycleReconciliation({
    planRecords: plan.records,
    previousByDocId,
    nextByDocId,
    writeback: client,
    runId: "run-124"
  });

  assert.equal(outcomes.length, 0);
  assert.equal(client.reconcileCalls.length, 0);
});

test("a second unchanged run performs zero additional mutation once Notion already reflects the reconciled success state", async () => {
  const { plan, previousByDocId, nextByDocId } = await makeAllNoopFixture();
  const failedStatus = new Map(plan.records.map((record) => [record.pageId, "failed"]));
  const firstRun = new RecordingReconciliationClient(failedStatus);
  const firstOutcomes = await runNoopLifecycleReconciliation({
    planRecords: plan.records,
    previousByDocId,
    nextByDocId,
    writeback: firstRun,
    runId: "run-125"
  });
  assert.equal(firstOutcomes.length, 4);

  // Simulate the next run: Notion now reflects "success" written by the prior run.
  const nowSuccessStatus = new Map(plan.records.map((record) => [record.pageId, "success"]));
  const secondRun = new RecordingReconciliationClient(nowSuccessStatus);
  const secondOutcomes = await runNoopLifecycleReconciliation({
    planRecords: plan.records,
    previousByDocId,
    nextByDocId,
    writeback: secondRun,
    runId: "run-126"
  });

  assert.equal(secondOutcomes.length, 0, "idempotent run must not re-reconcile or rewrite timestamps/messages");
  assert.equal(secondRun.reconcileCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 3: missing verified private state fails closed
// ---------------------------------------------------------------------------

test("a NOOP record with no matching verified private state fails closed with zero mutation", async () => {
  const { plan, previousByDocId } = await makeAllNoopFixture();
  const record = noopRecordFor(plan, "ARCBOS");
  const decision = evaluateNoopReconciliation({
    planRecord: record,
    previousState: previousByDocId.get(record.docId),
    nextState: undefined,
    notionStatus: { buildStatus: "failed" }
  });
  assert.deepEqual(decision, { eligible: false, reason: "MISSING_VERIFIED_STATE" });
});

// ---------------------------------------------------------------------------
// 4: mismatched hash/routing state fails closed
// ---------------------------------------------------------------------------

test("a NOOP record whose verified state hash disagrees with the freshly computed desired state fails closed", async () => {
  const { plan, previousByDocId, nextByDocId } = await makeAllNoopFixture();
  const record = noopRecordFor(plan, "ARCBOS");
  // Tamper both sides of the run's state identically so the two verified
  // snapshots still agree with each other, isolating the check that compares
  // verified state against the freshly recomputed desired-state hashes.
  const tamperedPrevious: DocumentStateRecord = { ...previousByDocId.get(record.docId)!, contentHash: "different-content-hash" };
  const tamperedNext: DocumentStateRecord = { ...nextByDocId.get(record.docId)!, contentHash: "different-content-hash" };
  const decision = evaluateNoopReconciliation({
    planRecord: record,
    previousState: tamperedPrevious,
    nextState: tamperedNext,
    notionStatus: { buildStatus: "failed" }
  });
  assert.deepEqual(decision, { eligible: false, reason: "IDENTITY_OR_HASH_MISMATCH" });
});

test("a NOOP record whose previous and next verified state disagree with each other fails closed", async () => {
  const { plan, previousByDocId, nextByDocId } = await makeAllNoopFixture();
  const record = noopRecordFor(plan, "ARCBOS");
  const tamperedPrevious: DocumentStateRecord = { ...previousByDocId.get(record.docId)!, routingHash: "different-routing-hash" };
  const decision = evaluateNoopReconciliation({
    planRecord: record,
    previousState: tamperedPrevious,
    nextState: nextByDocId.get(record.docId),
    notionStatus: { buildStatus: "failed" }
  });
  assert.deepEqual(decision, { eligible: false, reason: "STATE_MISMATCH_BETWEEN_RUNS" });
});

// ---------------------------------------------------------------------------
// 5: missing public URL fails closed
// ---------------------------------------------------------------------------

test("a NOOP record whose verified state has no public URL fails closed", async () => {
  const { plan, previousByDocId, nextByDocId } = await makeAllNoopFixture();
  const record = noopRecordFor(plan, "ARCBOS");
  const previous = previousByDocId.get(record.docId)!;
  const next = nextByDocId.get(record.docId)!;
  const emptyUrlPrevious: DocumentStateRecord = { ...previous, finalUrl: "" };
  const emptyUrlNext: DocumentStateRecord = { ...next, finalUrl: "" };
  const decision = evaluateNoopReconciliation({
    planRecord: record,
    previousState: emptyUrlPrevious,
    nextState: emptyUrlNext,
    notionStatus: { buildStatus: "failed" }
  });
  assert.deepEqual(decision, { eligible: false, reason: "MISSING_PUBLIC_URL" });
});

// ---------------------------------------------------------------------------
// 6: PUBLISHED_AT is preserved, never invented
// ---------------------------------------------------------------------------

test("reconciliation preserves the verified state's existing PUBLISHED_AT instead of the current time", async () => {
  const { plan, nextByDocId } = await makeAllNoopFixture();
  const record = noopRecordFor(plan, "ARCBOS");
  const state = nextByDocId.get(record.docId)!;
  assert.equal(state.publishedAt, FIXED_NOW, "fixture precondition: verified state carries a known historical timestamp");

  const payload = buildReconciliationPayload(state, "run-127");
  assert.equal(payload.publishedAt, FIXED_NOW);
  assert.notEqual(payload.publishedAt, new Date().toISOString().slice(0, 10), "must not stamp the current date");
});

// ---------------------------------------------------------------------------
// 7: a rejected write is surfaced, never swallowed
// ---------------------------------------------------------------------------

test("a reconciliation write failure propagates and is not silently swallowed", async () => {
  const { plan, previousByDocId, nextByDocId } = await makeAllNoopFixture();
  const statusByPageId = new Map(plan.records.map((record) => [record.pageId, "failed"]));
  const client = new RecordingReconciliationClient(statusByPageId, { failReconcile: true });

  await assert.rejects(
    runNoopLifecycleReconciliation({
      planRecords: plan.records,
      previousByDocId,
      nextByDocId,
      writeback: client,
      runId: "run-128"
    }),
    /simulated Notion write failure/
  );
});

// ---------------------------------------------------------------------------
// 8 + 9 + 10 + 11: only NOOP is eligible; all other actions are untouched
// ---------------------------------------------------------------------------

test("FILTERED, INVALID, CREATE, UPDATE, MOVE, and REMOVE records are never reconciled, even with a failed Notion status", async () => {
  const { plan, previousByDocId, nextByDocId } = await makeAllNoopFixture();
  const trueNoop = noopRecordFor(plan, "ARCBOS");

  const otherActionRecords: IncrementalPlanRecord[] = (
    ["FILTERED", "INVALID", "CREATE", "UPDATE", "MOVE", "REMOVE"] as const
  ).map((action, index) => ({
    action,
    reason: "TEST_FIXTURE",
    brand: "ENERGIZE",
    pageId: `other-action-page-${index}`,
    docId: `OTHER-${action}-${index}`,
    errors: []
  }));

  const mixedRecords = [...otherActionRecords, trueNoop];
  const statusByPageId = new Map(mixedRecords.map((record) => [record.pageId, "failed"]));
  const client = new RecordingReconciliationClient(statusByPageId);

  const outcomes = await runNoopLifecycleReconciliation({
    planRecords: mixedRecords,
    previousByDocId,
    nextByDocId,
    writeback: client,
    runId: "run-129"
  });

  assert.equal(outcomes.length, 1, "only the true NOOP record may be reconciled");
  assert.equal(outcomes[0]!.docId, trueNoop.docId);
  assert.deepEqual(client.readCalls, [trueNoop.pageId], "Notion status must only be read for NOOP records");
});

// ---------------------------------------------------------------------------
// 12: Preview / read-only paths cannot reach reconciliation
// ---------------------------------------------------------------------------

test("Preview Publish cannot invoke lifecycle reconciliation", async () => {
  const workflow = await fs.readFile(
    path.resolve(process.cwd(), ".github/workflows/preview-publish.yml"),
    "utf8"
  );
  assert.doesNotMatch(workflow, /writeback:incremental/);
  assert.doesNotMatch(workflow, /reconcileLifecycleStatus/);
  assert.doesNotMatch(workflow, /runNoopLifecycleReconciliation/);
});

test("runNoopLifecycleReconciliation is only imported by the production incremental writeback CLI", async () => {
  const roots = ["src/cli", "src/routing", "src/notion"];
  const importers: string[] = [];
  for (const root of roots) {
    for (const file of await walk(path.resolve(process.cwd(), root))) {
      if (!file.endsWith(".ts") || file.includes("/tests/")) continue;
      const source = await fs.readFile(file, "utf8");
      if (source.includes("runNoopLifecycleReconciliation(") && !file.endsWith("lifecycle-reconciliation.ts")) {
        importers.push(path.relative(process.cwd(), file));
      }
    }
  }
  assert.deepEqual(importers, ["src/cli/writeback-incremental.ts"]);
});

// ---------------------------------------------------------------------------
// 15 + 17: identity fields are never touched; only the approved allow-list is used
// ---------------------------------------------------------------------------

test("the reconciliation write path never references DOC_ID or Share Token and uses only the approved mutation allow-list", async () => {
  const writebackSource = await fs.readFile(path.resolve(process.cwd(), "src/notion/writeback.ts"), "utf8");
  const methodStart = writebackSource.indexOf("async reconcileLifecycleStatus(");
  assert.ok(methodStart > -1, "reconcileLifecycleStatus method must exist");
  const methodEnd = writebackSource.indexOf("\n  }\n", methodStart);
  const methodBody = writebackSource.slice(methodStart, methodEnd);
  assert.match(methodBody, /assertNotionMutationAllowed\("reconcileLifecycleStatus"\)/);
  assert.doesNotMatch(methodBody, /DOC_ID/);
  assert.doesNotMatch(methodBody, /Share Token/);
  assert.doesNotMatch(methodBody, /Brand:/);
  assert.doesNotMatch(methodBody, /Visibility:/);
  assert.doesNotMatch(methodBody, /Portal Category/);
  assert.doesNotMatch(methodBody, /Document Type/);

  const cliSource = await fs.readFile(path.resolve(process.cwd(), "src/cli/writeback-incremental.ts"), "utf8");
  assert.match(
    cliSource,
    /enableNotionMutationAllowList\(\s*"incremental-post-deployment-writeback",\s*\["updateLifecycleResult", "reconcileLifecycleStatus"\]\s*\)/
  );
});

// ---------------------------------------------------------------------------
// 16: reconciliation stays inside the existing production writeback boundary
// ---------------------------------------------------------------------------

test("reconciliation adds no new workflow, no new schedule, and no new step outside the existing Notion writeback boundary", async () => {
  const workflowsDir = path.resolve(process.cwd(), ".github/workflows");
  const files = (await fs.readdir(workflowsDir)).filter((file) => /\.ya?ml$/i.test(file));
  assert.deepEqual(
    files.filter((file) => /reconcil/i.test(file)),
    [],
    "no dedicated reconciliation workflow file may exist"
  );

  let scheduledCount = 0;
  for (const file of files) {
    const source = (await fs.readFile(path.join(workflowsDir, file), "utf8"))
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    if (/^\s{2}schedule:\s*$/m.test(source)) {
      scheduledCount += 1;
    }
  }
  assert.equal(scheduledCount, 1, "reconciliation must not introduce a second scheduled workflow");

  const productionWorkflow = await fs.readFile(
    path.join(workflowsDir, "incremental-content-publish.yml"),
    "utf8"
  );
  const writebackStepMatches = productionWorkflow.match(/name: Write verified lifecycle results to Notion/g) ?? [];
  assert.equal(writebackStepMatches.length, 1, "reconciliation must run inside the single existing writeback step");
  const npmCommandMatches = productionWorkflow.match(/run: npm run writeback:incremental/g) ?? [];
  assert.equal(npmCommandMatches.length, 1);

  const persistIndex = productionWorkflow.indexOf("name: Persist verified private state");
  const writebackIndex = productionWorkflow.indexOf("name: Write verified lifecycle results to Notion");
  assert.ok(persistIndex > -1 && writebackIndex > -1 && persistIndex < writebackIndex, "writeback (including reconciliation) must remain after private state persistence");
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}
