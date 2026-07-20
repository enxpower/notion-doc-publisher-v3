import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { emptyValidation, type DocumentModel } from "../model/document.js";
import { normalizeBrand, type BrandRoute } from "../routing/brand-routing.js";
import {
  committedStateAfterSuccessfulPlan,
  createDesiredDocumentState,
  createIncrementalPlan,
  deletionPlanForRecord,
  documentsToRemove,
  documentsToRender,
  removeManifestOwnedFiles,
  type DocumentStateRecord,
  type IncrementalStateManifest
} from "../routing/incremental.js";
import { loadBrandRoutes, routesWithOutputBase } from "../routing/routes.js";

test("incremental planner classifies new checked documents as CREATE for all four brands", async () => {
  const fixture = await makeFixture();
  const plan = createIncrementalPlan({
    documents: fixture.documents,
    routes: fixture.routes,
    config: fixture.config,
    now: FIXED_NOW
  });

  assert.equal(plan.counts.CREATE, 4);
  assert.equal(plan.counts.UPDATE, 0);
  assert.equal(plan.counts.MOVE, 0);
  assert.equal(plan.counts.REMOVE, 0);
  assert.equal(plan.counts.NOOP, 0);
  assert.equal(plan.counts.INVALID, 0);
  assert.deepEqual(documentsToRender(plan).map((record) => record.brand).sort(), ["AGIM", "ARCBOS", "ENERGIZE", "GONG"]);
  assert.equal(recordFor(plan, "ARCBOS").desired!.finalUrl, "https://docs.arcbos.com/docs/ARCBOS-SPEC-2606-0001/");
  assert.equal(recordFor(plan, "ENERGIZE").desired!.finalUrl, "https://docs.energizeos.com/clients/energizeclient01/");
  assert.equal(recordFor(plan, "GONG").desired!.finalUrl, "https://enxpower.com/gong-docs/internal/gonginternal01/");
});

test("unchanged successful state is NOOP and does not enter render or remove sets", async () => {
  const fixture = await makeFixture();
  const previousState = successfulState(fixture.documents, fixture.routes, fixture.config);
  const plan = createIncrementalPlan({
    documents: fixture.documents,
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: FIXED_NOW
  });

  assert.equal(plan.counts.NOOP, 4);
  assert.equal(plan.counts.CREATE, 0);
  assert.equal(plan.counts.UPDATE, 0);
  assert.equal(plan.counts.MOVE, 0);
  assert.equal(plan.counts.REMOVE, 0);
  assert.deepEqual(documentsToRender(plan), []);
  assert.deepEqual(documentsToRemove(plan), []);
});

test("content and output-relevant metadata changes are UPDATE", async () => {
  const fixture = await makeFixture();
  const previousState = successfulState(fixture.documents, fixture.routes, fixture.config);
  const changed = fixture.documents.map((document) => structuredClone(document));
  changed[0]!.content = [{ type: "paragraph", id: "changed", richText: [{ text: "Changed content." }] }];
  changed[1]!.meta.version = "v2.0";

  const plan = createIncrementalPlan({
    documents: changed,
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: FIXED_NOW
  });

  assert.equal(recordFor(plan, "ARCBOS").action, "UPDATE");
  assert.equal(recordFor(plan, "ENERGIZE").action, "UPDATE");
  assert.equal(plan.counts.UPDATE, 2);
  assert.equal(plan.counts.NOOP, 2);
});

test("routing changes are MOVE while identity fields are preserved", async () => {
  const fixture = await makeFixture();
  const base = makePrivateDoc("ARCBOS", "page-move", "ARCBOS-MEM-2606-0901", "clients", "movetoken901");
  const previousState = successfulState([base], fixture.routes, fixture.config);
  const movedBrand = structuredClone(base);
  movedBrand.meta.brand = { label: "ENERGIZE", token: "ENERGIZE", slug: "energize" };
  movedBrand.meta.canonicalPath = "/clients/movetoken901/";
  const movedVisibility = structuredClone(base);
  movedVisibility.meta.visibility = "Internal";
  movedVisibility.meta.privateLinkNamespace = "internal";
  movedVisibility.meta.canonicalPath = "/internal/movetoken901/";

  const brandMove = createIncrementalPlan({
    documents: [movedBrand],
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: FIXED_NOW
  });
  const visibilityMove = createIncrementalPlan({
    documents: [movedVisibility],
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: FIXED_NOW
  });

  assert.equal(brandMove.records[0]!.action, "MOVE");
  assert.equal(brandMove.records[0]!.desired!.docId, "ARCBOS-MEM-2606-0901");
  assert.equal(brandMove.records[0]!.desired!.shareToken, "movetoken901");
  assert.equal(brandMove.records[0]!.desired!.finalUrl, "https://docs.energizeos.com/clients/movetoken901/");
  assert.equal(visibilityMove.records[0]!.action, "MOVE");
  assert.equal(visibilityMove.records[0]!.desired!.namespace, "internal");
  assert.equal(visibilityMove.records[0]!.desired!.finalUrl, "https://docs.arcbos.com/internal/movetoken901/");
});

test("cross-brand MOVE routing is supported across ENERGIZE, AGIM, GONG, and ARCBOS", async () => {
  const fixture = await makeFixture();
  const moves: Array<[string, string, string]> = [
    ["ENERGIZE", "AGIM", "https://docs.agim.ca/clients/sharedmove901/"],
    ["AGIM", "GONG", "https://enxpower.com/gong-docs/clients/sharedmove901/"],
    ["GONG", "ARCBOS", "https://docs.arcbos.com/clients/sharedmove901/"]
  ];

  for (const [fromBrand, toBrand, expectedUrl] of moves) {
    const base = makePrivateDoc(fromBrand, `page-${fromBrand}-move`, `${fromBrand}-MEM-2606-0902`, "clients", "sharedmove901");
    const previousState = successfulState([base], fixture.routes, fixture.config);
    const moved = structuredClone(base);
    moved.meta.brand = { label: toBrand, token: toBrand, slug: toBrand.toLowerCase() };
    const plan = createIncrementalPlan({
      documents: [moved],
      routes: fixture.routes,
      config: fixture.config,
      previousState,
      now: FIXED_NOW
    });

    assert.equal(plan.records[0]!.action, "MOVE", `${fromBrand} -> ${toBrand}`);
    assert.equal(plan.records[0]!.desired!.finalUrl, expectedUrl, `${fromBrand} -> ${toBrand}`);
    assert.equal(plan.records[0]!.desired!.docId, `${fromBrand}-MEM-2606-0902`);
    assert.equal(plan.records[0]!.desired!.shareToken, "sharedmove901");
  }
});

test("unchecked previously live documents become REMOVE while unchecked never-published documents are FILTERED", async () => {
  const fixture = await makeFixture();
  const previousState = successfulState([fixture.documents[0]!], fixture.routes, fixture.config);
  const uncheckedLive = structuredClone(fixture.documents[0]!);
  uncheckedLive.meta.publish = false;
  const uncheckedNeverLive = structuredClone(fixture.documents[1]!);
  uncheckedNeverLive.meta.publish = false;

  const plan = createIncrementalPlan({
    documents: [uncheckedLive, uncheckedNeverLive],
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: FIXED_NOW
  });

  assert.equal(plan.counts.REMOVE, 1);
  assert.equal(plan.counts.FILTERED, 1);
  assert.equal(plan.records.find((record) => record.action === "REMOVE")!.reason, "PUBLISH_UNCHECKED_PREVIOUSLY_LIVE");
  assert.equal(plan.records.find((record) => record.action === "FILTERED")!.reason, "PUBLISH_UNCHECKED_NEVER_PUBLISHED");
});

test("invalid checked documents fail closed and preserve previous live state", async () => {
  const fixture = await makeFixture();
  const previousState = successfulState([fixture.documents[0]!], fixture.routes, fixture.config);
  const invalidExisting = structuredClone(fixture.documents[0]!);
  invalidExisting.validation = {
    ok: false,
    errors: [{ code: "EMPTY_CONTENT", message: "no content" }],
    warnings: []
  };
  const missingBrand = structuredClone(fixture.documents[1]!);
  missingBrand.meta.brand = { label: " ", token: "", slug: "" };
  const unknownBrand = structuredClone(fixture.documents[2]!);
  unknownBrand.meta.brand = { label: "NOT-A-BRAND", token: "NOT-A-BRAND", slug: "not-a-brand" };

  const plan = createIncrementalPlan({
    documents: [invalidExisting, missingBrand, unknownBrand],
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: FIXED_NOW
  });
  const nextState = committedStateAfterSuccessfulPlan({ previousState, plan, deployedAt: FIXED_NOW });

  assert.equal(plan.counts.INVALID, 3);
  assert.equal(plan.records[0]!.reason, "VALIDATION_FAILED");
  assert.equal(plan.records[1]!.reason, "MISSING_BRAND");
  assert.equal(plan.records[2]!.reason, "UNKNOWN_BRAND");
  assert.deepEqual(documentsToRender(plan), []);
  assert.equal(nextState.records.length, 1);
  assert.equal(nextState.records[0]!.desiredStateHash, previousState.records[0]!.desiredStateHash);
});

test("hashes are deterministic and isolate content, routing, renderer, and asset changes", async () => {
  const fixture = await makeFixture();
  const document = fixture.documents[0]!;
  const route = routeFor(fixture.routes, "ARCBOS");
  const unchangedA = createDesiredDocumentState({ document, route, config: fixture.config });
  const unchangedB = createDesiredDocumentState({ document: structuredClone(document), route, config: fixture.config });
  const contentChanged = structuredClone(document);
  contentChanged.content = [{ type: "paragraph", id: "p2", richText: [{ text: "Changed body." }] }];
  const routeChanged = { ...route, targetDomain: "https://docs.arcbos.example.test" };
  const assetChanged = structuredClone(document);
  assetChanged.assets = [{
    kind: "image",
    sourceUrl: "https://assets.example.test/image.png",
    outputPath: "assets/doc/image.png",
    local: false,
    alt: "Image"
  }];
  const rendererA = createDesiredDocumentState({
    document,
    route,
    config: fixture.config,
    rendererHash: () => "renderer-a"
  });
  const rendererB = createDesiredDocumentState({
    document,
    route,
    config: fixture.config,
    rendererHash: () => "renderer-b"
  });

  assert.equal(unchangedA.contentHash, unchangedB.contentHash);
  assert.equal(unchangedA.routingHash, unchangedB.routingHash);
  assert.equal(unchangedA.rendererHash, unchangedB.rendererHash);
  assert.equal(unchangedA.assetHash, unchangedB.assetHash);
  assert.notEqual(createDesiredDocumentState({ document: contentChanged, route, config: fixture.config }).contentHash, unchangedA.contentHash);
  assert.notEqual(createDesiredDocumentState({ document, route: routeChanged, config: fixture.config }).routingHash, unchangedA.routingHash);
  assert.notEqual(createDesiredDocumentState({ document: assetChanged, route, config: fixture.config }).assetHash, unchangedA.assetHash);
  assert.notEqual(rendererA.rendererHash, rendererB.rendererHash);
});

test("renderer hash changes rebuild all previously unchanged published documents", async () => {
  const fixture = await makeFixture();
  const previousPlan = createIncrementalPlan({
    documents: fixture.documents,
    routes: fixture.routes,
    config: fixture.config,
    now: FIXED_NOW,
    rendererHash: () => "renderer-v1"
  });
  const previousState = committedStateAfterSuccessfulPlan({ plan: previousPlan, deployedAt: FIXED_NOW });
  const plan = createIncrementalPlan({
    documents: fixture.documents,
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: FIXED_NOW,
    rendererHash: () => "renderer-v2"
  });

  assert.equal(plan.counts.UPDATE, 4);
  assert.equal(plan.counts.NOOP, 0);
});

test("REMOVE deletes only manifest-owned files and preserves shared assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "notion-incremental-remove-"));
  await fs.mkdir(path.join(root, "docs", "doc-a"), { recursive: true });
  await fs.mkdir(path.join(root, "pdf"), { recursive: true });
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  await fs.writeFile(path.join(root, "docs", "doc-a", "index.html"), "html", "utf8");
  await fs.writeFile(path.join(root, "pdf", "doc-a.pdf"), "pdf", "utf8");
  await fs.writeFile(path.join(root, "assets", "shared.css"), "css", "utf8");

  const removed = await removeManifestOwnedFiles({
    repositoryRoot: root,
    files: ["docs/doc-a/index.html", "pdf/doc-a.pdf"],
    protectedPrefixes: ["assets"]
  });

  assert.deepEqual(removed.sort(), ["docs/doc-a/index.html", "pdf/doc-a.pdf"]);
  assert.equal(await exists(path.join(root, "docs", "doc-a", "index.html")), false);
  assert.equal(await exists(path.join(root, "pdf", "doc-a.pdf")), false);
  assert.equal(await exists(path.join(root, "assets", "shared.css")), true);
});

test("manifest deletion is bounded by brand and GONG deployment root", async () => {
  const fixture = await makeFixture();
  const gong = routeFor(fixture.routes, "GONG");
  const arcbos = routeFor(fixture.routes, "ARCBOS");
  const gongRecord = makePreviousRecord({
    brand: "GONG",
    deploymentRoot: "gong-docs",
    ownedFiles: ["gong-docs/clients/token/index.html", "gong-docs/pdf/GONG-MEM-2606-0001.pdf"]
  });
  const arcbosProtected = makePreviousRecord({
    brand: "ARCBOS",
    ownedFiles: ["CNAME"]
  });
  const crossBrand = makePreviousRecord({
    brand: "ENERGIZE",
    ownedFiles: ["clients/token/index.html"]
  });
  const outsideGongRoot = makePreviousRecord({
    brand: "GONG",
    deploymentRoot: "gong-docs",
    ownedFiles: ["index.html"]
  });

  assert.deepEqual(
    deletionPlanForRecord({ action: "REMOVE", reason: "test", brand: "GONG", pageId: "page-gong", docId: "GONG-MEM-2606-0001", previous: gongRecord, errors: [] }, gong),
    ["gong-docs/clients/token/index.html", "gong-docs/pdf/GONG-MEM-2606-0001.pdf"]
  );
  assert.throws(
    () => deletionPlanForRecord({ action: "REMOVE", reason: "test", brand: "ARCBOS", pageId: "page-a", docId: "ARCBOS-MEM-2606-0001", previous: arcbosProtected, errors: [] }, arcbos),
    /protected shared path/
  );
  assert.throws(
    () => deletionPlanForRecord({ action: "REMOVE", reason: "test", brand: "ARCBOS", pageId: "page-a", docId: "ARCBOS-MEM-2606-0001", previous: crossBrand, errors: [] }, arcbos),
    /Cross-brand deletion/
  );
  assert.throws(
    () => deletionPlanForRecord({ action: "REMOVE", reason: "test", brand: "GONG", pageId: "page-gong", docId: "GONG-MEM-2606-0001", previous: outsideGongRoot, errors: [] }, gong),
    /outside publisher-owned deployment root/
  );
});

test("GONG desired owned files stay under gong-docs and private URLs do not expose DOC_ID", async () => {
  const fixture = await makeFixture();
  const gongDocument = fixture.documents.find((document) => normalizeBrand(document.meta.brand.label) === "GONG")!;
  const desired = createDesiredDocumentState({
    document: gongDocument,
    route: routeFor(fixture.routes, "GONG"),
    config: fixture.config
  });

  assert.equal(desired.finalUrl, "https://enxpower.com/gong-docs/internal/gonginternal01/");
  assert.ok(desired.ownedFiles.every((file) => file.startsWith("gong-docs/")));
  assert.ok(desired.ownedFiles.includes("gong-docs/pdf/GONG-RPT-2606-0004.pdf"));
  assert.equal(desired.finalUrl.includes(gongDocument.meta.docId), false);
});

test("filtered records and NOOP records are not treated as Notion mutation candidates", async () => {
  const fixture = await makeFixture();
  const previousState = successfulState([fixture.documents[0]!], fixture.routes, fixture.config);
  const filtered = structuredClone(fixture.documents[1]!);
  filtered.meta.status = "Draft";
  const noop = structuredClone(fixture.documents[0]!);
  const plan = createIncrementalPlan({
    documents: [noop, filtered],
    routes: fixture.routes,
    config: fixture.config,
    previousState,
    now: FIXED_NOW
  });

  assert.equal(plan.records.find((record) => record.action === "NOOP")!.reason, "STATE_UNCHANGED");
  assert.equal(plan.records.find((record) => record.action === "FILTERED")!.reason, "PUBLISHABLE_FILTER_EXCLUDED");
  assert.deepEqual(documentsToRender(plan), []);
  assert.deepEqual(documentsToRemove(plan), []);
});

test("incremental content plan workflow is manual, fast, and non-mutating", async () => {
  const workflow = await fs.readFile(path.resolve(".github/workflows/incremental-content-plan.yml"), "utf8");
  const plannerSource = await fs.readFile(path.resolve("src/cli/plan-incremental.ts"), "utf8");
  const operationalWorkflow = workflow.replace(
    /      - name: Validate workflow safety[\s\S]*?(?=      - name: Plan lifecycle actions)/,
    ""
  );

  assert.ok(plannerSource.includes("process.env.PHASE2_STATE_PATH"));
  assert.ok(plannerSource.includes("process.env.INCREMENTAL_STATE_PATH"));
  assert.ok(workflow.includes("workflow_dispatch:"));
  assert.ok(!workflow.includes("push:"));
  assert.ok(!workflow.includes("pull_request:"));
  assert.ok(!workflow.includes("schedule:"));
  assert.ok(workflow.includes("contents: read"));
  assert.ok(operationalWorkflow.includes("npm run plan:incremental"));
  assert.ok(workflow.includes('"GONG":"GONG"'));
  assert.ok(!operationalWorkflow.includes("npm test"));
  assert.ok(!operationalWorkflow.includes("npm run build:routed:readonly"));
  assert.ok(!operationalWorkflow.includes("npm run assign-id"));
  assert.ok(!operationalWorkflow.includes("npm run ci:writeback"));
  assert.ok(!operationalWorkflow.includes("npm run writeback:routed"));
  assert.ok(!operationalWorkflow.includes("actions/deploy-pages"));
  assert.ok(!operationalWorkflow.includes("actions/upload-pages-artifact"));
});

test("incremental content publish workflow is scheduled exactly once daily, guarded, and route-bounded", async () => {
  const workflow = await fs.readFile(path.resolve(".github/workflows/incremental-content-publish.yml"), "utf8");
  const operationalWorkflow = workflow.replace(
    /      - name: Validate workflow safety[\s\S]*?(?=      - name: Dry-run incremental publish)/,
    ""
  );

  assert.ok(workflow.includes("workflow_dispatch:"));
  assert.ok(!workflow.includes("push:"));
  assert.ok(!workflow.includes("pull_request:"));
  assert.ok(workflow.includes("schedule:"));
  const cronLines = [...workflow.matchAll(/- cron: "([^"]+)"/g)];
  assert.equal(cronLines.length, 1, "exactly one cron schedule is permitted");
  assert.equal(cronLines[0]![1], "0 9 * * *", "the single daily production schedule must run at the documented UTC time");
  assert.ok(workflow.includes("github.event_name == 'schedule'"), "the job guard must explicitly permit schedule events");
  assert.ok(
    /elif \[ "\$GITHUB_EVENT_NAME" = "schedule" \];\s*then\s*[\s\S]*?mode="apply"/.test(workflow),
    "scheduled runs must resolve to the real apply path, not dry-run"
  );
  assert.ok(workflow.includes("confirm_production"));
  assert.ok(workflow.includes("PHASE2-INCREMENTAL-PUBLISH"));
  assert.ok(
    workflow.includes('[ "$mode" = "apply" ] && [ "$DISPATCH_CONFIRMATION" != "PHASE2-INCREMENTAL-PUBLISH" ]'),
    "manual workflow_dispatch apply must still require the exact confirmation phrase"
  );
  assert.ok(
    workflow.includes("github.event.issue.number == 44") &&
      workflow.includes("github.actor == 'enxpower'") &&
      workflow.includes("startsWith(github.event.comment.body, '/phase2-publish PHASE2-INCREMENTAL-PUBLISH ')"),
    "issue-comment apply must stay restricted to Issue #44, actor enxpower, and the exact command prefix"
  );
  assert.ok(!workflow.includes("DEPLOY_KEY_ARCBOS"));
  assert.ok(workflow.includes("DEPLOY_KEY_ENERGIZE"));
  assert.ok(workflow.includes("DEPLOY_KEY_AGIM"));
  assert.ok(workflow.includes("DEPLOY_KEY_GONG"));
  assert.ok(workflow.includes("DEPLOY_KEY_STATE"));
  assert.ok(workflow.includes("gh api meta --jq '.ssh_keys[]'"));
  assert.ok(workflow.includes("PUBLISHER_DEPLOY_TOKEN|PUBLISHER_STATE_TOKEN"));
  assert.ok(!operationalWorkflow.includes("PUBLISHER_DEPLOY_TOKEN"));
  assert.ok(!operationalWorkflow.includes("PUBLISHER_STATE_TOKEN"));
  assert.ok(workflow.includes("PHASE2_STATE_PATH: state/incremental-state.json"));
  assert.ok(workflow.includes('"GONG":"targets/pub"'));
  assert.ok(!workflow.includes("docs-arcbos-v2"));
  assert.ok(!workflow.includes("lifecycle_writeback"));
  assert.ok(workflow.includes('INCREMENTAL_LIFECYCLE_WRITEBACK: "false"'));
  assert.ok(workflow.includes("npm run publish:incremental:dry-run"));
  assert.ok(workflow.includes("npm run publish:incremental"));
  assert.ok(!operationalWorkflow.includes("npm run assign-id"));
  assert.ok(!operationalWorkflow.includes("npm run ci:writeback"));
  assert.ok(!operationalWorkflow.includes("npm run writeback:routed"));
  assert.ok(!operationalWorkflow.includes("preview-publish"));
  assert.ok(operationalWorkflow.includes("actions/deploy-pages"));
  assert.ok(operationalWorkflow.includes("actions/upload-pages-artifact"));
});

test("legacy build has an explicit no-autofill validation mode without changing default build script", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")) as { scripts: Record<string, string> };
  const buildSource = await fs.readFile(path.resolve("src/cli/build.ts"), "utf8");

  assert.equal(packageJson.scripts.build, "tsc && node .tmp/cli/security-lint.js && node .tmp/cli/build.js");
  assert.equal(
    packageJson.scripts["build:readonly-validation"],
    "tsc && node .tmp/cli/security-lint.js && BUILD_NO_AUTOFILL=true node .tmp/cli/build.js"
  );
  assert.ok(buildSource.includes('process.env.BUILD_NO_AUTOFILL === "true"'));
  assert.ok(buildSource.includes("await autoFillDocuments(documents, config);"));
});

const FIXED_NOW = "2026-07-19T00:00:00.000Z";

async function makeFixture(): Promise<{
  documents: DocumentModel[];
  routes: BrandRoute[];
  config: AppConfig;
}> {
  const outputBaseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "notion-incremental-"));
  return {
    documents: routedDryRunDocuments().map((document) => structuredClone(document)),
    routes: routesWithOutputBase(await loadBrandRoutes(), outputBaseRoot),
    config: await loadRoutedDryRunConfig()
  };
}

function successfulState(
  documents: DocumentModel[],
  routes: BrandRoute[],
  config: AppConfig
): IncrementalStateManifest {
  const plan = createIncrementalPlan({ documents, routes, config, now: FIXED_NOW });
  return committedStateAfterSuccessfulPlan({ plan, deployedAt: FIXED_NOW });
}

function recordFor(plan: ReturnType<typeof createIncrementalPlan>, brand: string) {
  const record = plan.records.find((candidate) => candidate.brand === brand);
  assert.ok(record, `expected ${brand} record`);
  return record;
}

function routeFor(routes: BrandRoute[], brand: string): BrandRoute {
  const route = routes.find((candidate) => normalizeBrand(candidate.brand) === brand);
  assert.ok(route, `expected ${brand} route`);
  return route;
}

function makePrivateDoc(
  brand: string,
  pageId: string,
  docId: string,
  namespace: "clients" | "internal",
  shareToken: string
): DocumentModel {
  const base = routedDryRunDocuments()[0]!;
  return {
    ...structuredClone(base),
    meta: {
      ...structuredClone(base.meta),
      docId,
      title: `${brand} private move fixture`,
      brand: { label: brand, token: brand, slug: brand.toLowerCase() },
      documentType: { label: "Memo", token: "MEM", slug: "memo" },
      visibility: namespace === "clients" ? "Client" : "Internal",
      shareToken,
      privateLinkNamespace: namespace,
      canonicalPath: `/${namespace}/${shareToken}/`,
      publish: true,
      status: "Approved"
    },
    source: {
      ...structuredClone(base.source),
      notionPageId: pageId
    },
    validation: emptyValidation()
  };
}

function makePreviousRecord(overrides: Partial<DocumentStateRecord>): DocumentStateRecord {
  return {
    pageId: "page-previous",
    docId: "ARCBOS-MEM-2606-0001",
    brand: "ARCBOS",
    visibility: "Client",
    namespace: "clients",
    shareToken: "previoustoken01",
    canonicalOrigin: "https://docs.arcbos.com",
    pathPrefix: "",
    canonicalPath: "/clients/previoustoken01/",
    finalUrl: "https://docs.arcbos.com/clients/previoustoken01/",
    deploymentTarget: "enxpower/notion-doc-publisher-v3",
    deploymentRoot: "",
    ownedFiles: ["clients/previoustoken01/index.html", "pdf/ARCBOS-MEM-2606-0001.pdf"],
    contentHash: "content",
    routingHash: "routing",
    rendererHash: "renderer",
    assetHash: "asset",
    desiredStateHash: "desired",
    pdfRequired: true,
    publishedAt: FIXED_NOW,
    ...overrides
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
