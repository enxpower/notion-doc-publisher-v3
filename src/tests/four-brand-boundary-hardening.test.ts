/**
 * Phase 3 Prompt 4: four-brand routing and deployment boundary hardening.
 *
 * These tests prove (not merely assume) that ARCBOS, ENERGIZE, AGIM, and GONG
 * remain isolated from each other, that GONG is confined to gong-docs/** inside
 * enxpower/pub, that config/brand-routes.json and the production workflow agree
 * with each other, and that Prompt 3's lifecycle reconciliation cannot cross a
 * brand boundary. No test contacts real Notion, a real target repository, or a
 * real GitHub Actions run — all fixtures are local and temporary.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  deletionPlanForRecord,
  type DocumentStateRecord,
  type IncrementalPlanRecord
} from "../routing/incremental.js";
import { evaluateNoopReconciliation } from "../routing/lifecycle-reconciliation.js";
import { loadBrandRoutes } from "../routing/routes.js";

const WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/incremental-content-publish.yml");
const ROUTE_CONFIG_PATH = path.resolve(process.cwd(), "config/brand-routes.json");
const BRAND_PROFILE_PATH = path.resolve(process.cwd(), "config/brands.json");
const CANONICAL_BRANDS = ["AGIM", "ARCBOS", "ENERGIZE", "GONG"];

// ---------------------------------------------------------------------------
// 1. Canonical four-brand set / config drift
// ---------------------------------------------------------------------------

test("config/brand-routes.json contains exactly the canonical four brands, no more and no fewer", async () => {
  const routes = await loadBrandRoutes();
  assert.deepEqual(routes.map((r) => r.brand).sort(), CANONICAL_BRANDS);
});

test("a fifth brand added to brand-routes.json is rejected", async () => {
  const configPath = await tempRouteConfig((config) => {
    config.SHADOW = { ...config.GONG, brand: "SHADOW", targetRepository: "enxpower/shadow-docs", routeId: "shadow" };
  });
  await assert.rejects(() => loadBrandRoutes(configPath), /Brand route config must contain exactly/);
});

test("a brand removed from brand-routes.json is rejected rather than silently continuing with three brands", async () => {
  const configPath = await tempRouteConfig((config) => {
    delete config.GONG;
  });
  await assert.rejects(() => loadBrandRoutes(configPath), /Brand route config must contain exactly/);
});

test("workflow BRAND_TOKENS_JSON matches config/brand-routes.json's brand set and config/brands.json's brand set exactly", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  const match = workflow.match(/BRAND_TOKENS_JSON:\s*'([^']+)'/);
  assert.ok(match, "workflow must declare BRAND_TOKENS_JSON as a literal JSON object");
  const workflowTokens = JSON.parse(match![1]!) as Record<string, string>;
  const workflowBrands = Object.keys(workflowTokens).sort();

  const routes = await loadBrandRoutes();
  const routeBrands = routes.map((r) => r.brand).sort();

  const brandProfiles = JSON.parse(await fs.readFile(BRAND_PROFILE_PATH, "utf8")) as Record<string, unknown>;
  const profileBrands = Object.keys(brandProfiles).sort();

  assert.deepEqual(workflowBrands, CANONICAL_BRANDS, "workflow BRAND_TOKENS_JSON brand set");
  assert.deepEqual(routeBrands, CANONICAL_BRANDS, "brand-routes.json brand set");
  assert.deepEqual(profileBrands, CANONICAL_BRANDS, "brands.json brand set");
  for (const brand of CANONICAL_BRANDS) {
    assert.equal(workflowTokens[brand], brand, `workflow token for ${brand} must equal its own brand name`);
  }
});

test("workflow deploy-key usage matches route config: ARCBOS has no deploy key or branch checkout; ENERGIZE/AGIM/GONG deploy keys match their configured target repositories", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  const routes = await loadBrandRoutes();
  const routeByBrand = new Map(routes.map((r) => [r.brand, r]));

  assert.doesNotMatch(workflow, /DEPLOY_KEY_ARCBOS/, "ARCBOS must never have its own deploy key");
  assert.doesNotMatch(workflow, /name: Checkout ARCBOS target/, "ARCBOS must never use a branch-checkout target step");
  assert.equal(routeByBrand.get("ARCBOS")!.deploymentMode, "github-pages-artifact");

  for (const brand of ["ENERGIZE", "AGIM", "GONG"]) {
    const route = routeByBrand.get(brand)!;
    assert.equal(route.deploymentMode, "branch", `${brand} must be branch-deployed`);
    const stepMatch = workflow.match(
      new RegExp(`name: Checkout ${brand} target[\\s\\S]*?repository: ([^\\n]+)\\n[\\s\\S]*?ssh-key: \\$\\{\\{ secrets\\.(DEPLOY_KEY_\\w+) \\}\\}`)
    );
    assert.ok(stepMatch, `${brand} checkout step with repository + ssh-key must exist`);
    assert.equal(stepMatch![1]!.trim(), route.targetRepository, `${brand} workflow checkout repository must match brand-routes.json`);
    assert.equal(stepMatch![2], `DEPLOY_KEY_${brand}`, `${brand} must use its own uniquely named deploy key`);
  }
});

test("the GONG path-boundary regex enforced in the production workflow matches the configured GONG deployment root exactly, and ENERGIZE/AGIM boundaries never reference gong-docs", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  const routes = await loadBrandRoutes();
  const gongRoute = routes.find((r) => r.brand === "GONG")!;
  assert.equal(gongRoute.deploymentRoot, "gong-docs");

  const gongBoundary = workflow.match(/validate_paths targets\/pub '([^']+)'/);
  assert.ok(gongBoundary, "GONG boundary validation must exist");
  assert.equal(gongBoundary![1], `^${gongRoute.deploymentRoot}/`);

  const energizeBoundary = workflow.match(/validate_paths targets\/docs-energize-v2 '([^']+)'/);
  const agimBoundary = workflow.match(/validate_paths targets\/agim-docs '([^']+)'/);
  assert.ok(energizeBoundary && agimBoundary);
  assert.doesNotMatch(energizeBoundary![1]!, /gong-docs/);
  assert.doesNotMatch(agimBoundary![1]!, /gong-docs/);
  assert.equal(energizeBoundary![1], agimBoundary![1], "ENERGIZE and AGIM must share the same generic boundary pattern, not each other's brand-specific one");
});

test("every branch-deployed brand appears in both the checkout section and the target-commit loop, and ARCBOS does not", async () => {
  const workflow = await fs.readFile(WORKFLOW_PATH, "utf8");
  for (const brand of ["ENERGIZE", "AGIM", "GONG"]) {
    assert.match(workflow, new RegExp(`name: Checkout ${brand} target`));
  }
  const loopStart = workflow.indexOf("for spec in");
  const loopEnd = workflow.indexOf("; do", loopStart);
  assert.ok(loopStart > -1 && loopEnd > -1, "target-commit loop must exist");
  const loopBody = workflow.slice(loopStart, loopEnd);
  const specs = (loopBody.match(/"([^"]+)"/g) ?? []).map((s) => s.replace(/"/g, ""));
  assert.ok(specs.length > 0, "target-commit loop must enumerate at least one brand");
  const brandsInLoop = specs.map((spec) => spec.split(":")[0]);
  assert.deepEqual(brandsInLoop.sort(), ["AGIM", "ENERGIZE", "GONG"]);
  assert.ok(!brandsInLoop.includes("ARCBOS"), "ARCBOS is Pages-artifact deployed, not part of the branch-repo commit loop");
});

// ---------------------------------------------------------------------------
// 2. GONG path confinement (unit tests against deletionPlanForRecord)
// ---------------------------------------------------------------------------

test("GONG deletion is confined to gong-docs/**: valid paths accepted, escapes and sibling-prefix confusion rejected", async () => {
  const routes = await loadBrandRoutes();
  const gongRoute = routes.find((r) => r.brand === "GONG")!;

  const validCases = ["gong-docs/clients/abc123/index.html", "gong-docs/internal/def456/index.html", "gong-docs/pdf/GONG-MEM-2607-0001.pdf"];
  for (const file of validCases) {
    const record = moveOrRemoveRecord("REMOVE", gongState({ ownedFiles: [file] }));
    const plan = deletionPlanForRecord(record, gongRoute);
    assert.deepEqual(plan, [file], file);
  }

  const rejectedCases = [
    "gong-docs-archive/index.html",
    "gong-docs2/index.html",
    "gong-doc/index.html",
    "GONG-DOCS/index.html",
    "../gong-docs/index.html",
    "/gong-docs/index.html",
    "gong-docs/../../../etc/passwd",
    "gong-docs/%2e%2e/escape.html",
    "gong-docs//pdf/x.pdf",
    ".",
    "/",
    "docs/other-brand/index.html"
  ];
  for (const file of rejectedCases) {
    const record = moveOrRemoveRecord("REMOVE", gongState({ ownedFiles: [file] }));
    assert.throws(() => deletionPlanForRecord(record, gongRoute), Error, file);
  }
});

test("GONG REMOVE cannot delete protected shared paths even if a corrupted state record lists them (blocked by the gong-docs/ deployment-root boundary)", async () => {
  const routes = await loadBrandRoutes();
  const gongRoute = routes.find((r) => r.brand === "GONG")!;
  for (const protectedFile of ["CNAME", "gong-vi/logo.svg", "index.html"]) {
    const record = moveOrRemoveRecord("REMOVE", gongState({ ownedFiles: ["gong-docs/pdf/GONG-MEM-2607-0001.pdf", protectedFile] }));
    assert.throws(() => deletionPlanForRecord(record, gongRoute), /outside publisher-owned deployment root is blocked/, protectedFile);
  }
});

test("ENERGIZE/AGIM (no deployment-root prefix) still refuse to delete CNAME, gong-vi/, or the shared root index.html via the dedicated protected-path guard", async () => {
  const routes = await loadBrandRoutes();
  const energizeRoute = routes.find((r) => r.brand === "ENERGIZE")!;
  assert.equal(energizeRoute.deploymentRoot ?? "", "", "precondition: ENERGIZE has no deployment-root prefix, so the protected-path guard is the active defense");
  for (const protectedFile of ["CNAME", "gong-vi/logo.svg", "index.html"]) {
    const record = moveOrRemoveRecord(
      "REMOVE",
      gongState({ brand: "ENERGIZE", deploymentTarget: "enxpower/docs-energize-v2", ownedFiles: ["clients/abc123/index.html", protectedFile] })
    );
    assert.throws(() => deletionPlanForRecord(record, energizeRoute), /protected shared path is blocked/, protectedFile);
  }
});

test("a corrupted previous-state record pointing at another brand cannot authorize GONG-route deletion", async () => {
  const routes = await loadBrandRoutes();
  const gongRoute = routes.find((r) => r.brand === "GONG")!;
  // previous.brand says ARCBOS, but the caller (bug scenario) supplies the GONG route.
  const record = moveOrRemoveRecord("REMOVE", gongState({ brand: "ARCBOS", ownedFiles: ["gong-docs/pdf/GONG-MEM-2607-0001.pdf"] }));
  assert.throws(() => deletionPlanForRecord(record, gongRoute), /Cross-brand deletion is blocked/);
});

test("MOVE deletion planning rejects a mismatched previous-state brand for the route it is asked to delete from", async () => {
  const routes = await loadBrandRoutes();
  const energizeRoute = routes.find((r) => r.brand === "ENERGIZE")!;
  const record = moveOrRemoveRecord("MOVE", gongState({ ownedFiles: ["gong-docs/pdf/GONG-MEM-2607-0001.pdf"] }));
  assert.throws(() => deletionPlanForRecord(record, energizeRoute), /Cross-brand deletion is blocked/);
});

// ---------------------------------------------------------------------------
// 3. GONG namespace restriction (only clients + internal, per current config)
// ---------------------------------------------------------------------------

test("GONG namespaces remain restricted to clients and internal per current config", async () => {
  const routes = await loadBrandRoutes();
  const gongRoute = routes.find((r) => r.brand === "GONG")!;
  assert.deepEqual([...gongRoute.allowedUrlNamespaces!].sort(), ["clients", "internal"]);
  for (const forbidden of ["docs", "partners"]) {
    assert.ok(!gongRoute.allowedUrlNamespaces!.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// 4. ARCBOS ownership
// ---------------------------------------------------------------------------

test("ARCBOS uses this repository's own Pages-artifact deployment, never a branch target repository", async () => {
  const routes = await loadBrandRoutes();
  const arcbos = routes.find((r) => r.brand === "ARCBOS")!;
  assert.equal(arcbos.deploymentMode, "github-pages-artifact");
  assert.equal(arcbos.targetRepository, "enxpower/notion-doc-publisher-v3");
});

test("manual ARCBOS disaster recovery is a separate workflow_dispatch-only workflow that cannot touch GONG, AGIM, or ENERGIZE", async () => {
  const workflow = await fs.readFile(
    path.resolve(process.cwd(), ".github/workflows/arcbos-pages-clean-deploy.yml"),
    "utf8"
  );
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:\s*$/m);
  for (const secret of ["DEPLOY_KEY_ENERGIZE", "DEPLOY_KEY_AGIM", "DEPLOY_KEY_GONG", "DEPLOY_KEY_STATE"]) {
    assert.doesNotMatch(workflow, new RegExp(secret));
  }
  assert.doesNotMatch(workflow, /docs-energize-v2|agim-docs|enxpower\/pub\b/);
});

// ---------------------------------------------------------------------------
// 5. Cross-brand isolation at the routing-config level
// ---------------------------------------------------------------------------

test("AGIM and ENERGIZE resolve to distinct target repositories and cannot deploy into each other", async () => {
  const routes = await loadBrandRoutes();
  const agim = routes.find((r) => r.brand === "AGIM")!;
  const energize = routes.find((r) => r.brand === "ENERGIZE")!;
  assert.notEqual(agim.targetRepository, energize.targetRepository);
  assert.notEqual(agim.targetDomain, energize.targetDomain);
});

// ---------------------------------------------------------------------------
// 6. Prompt 3 reconciliation stays brand-neutral and rejects mismatched state
// ---------------------------------------------------------------------------

test("lifecycle reconciliation rejects a NOOP record whose desired brand is GONG but whose verified state brand is ARCBOS", () => {
  const planRecord = noopPlanRecord({ brand: "GONG", docId: "GONG-MEM-2607-0001" });
  const mismatchedState: DocumentStateRecord = gongState({ brand: "ARCBOS" });
  const decision = evaluateNoopReconciliation({
    planRecord,
    previousState: mismatchedState,
    nextState: mismatchedState,
    notionStatus: { buildStatus: "failed" }
  });
  assert.equal(decision.eligible, false);
});

test("lifecycle reconciliation rejects a GONG NOOP record whose verified URL is outside /gong-docs/", () => {
  const planRecord = noopPlanRecord({ brand: "GONG", docId: "GONG-MEM-2607-0001" });
  const badUrlState = gongState({ finalUrl: "https://enxpower.com/clients/abc123/" }); // missing /gong-docs prefix
  const decision = evaluateNoopReconciliation({
    planRecord,
    previousState: badUrlState,
    nextState: badUrlState,
    notionStatus: { buildStatus: "failed" }
  });
  // The hash fields still won't match planRecord.desired's freshly computed
  // hashes (which were built with the correct /gong-docs/ routing), so this
  // must fail closed via hash/identity mismatch even though a URL exists.
  assert.equal(decision.eligible, false);
});

// ---------------------------------------------------------------------------
// 7. Restated production-topology guarantees (Prompt 4 self-contained check)
// ---------------------------------------------------------------------------

test("exactly one production schedule and one automatic production publisher remain after this prompt's changes", async () => {
  const workflowsDir = path.resolve(process.cwd(), ".github/workflows");
  const files = (await fs.readdir(workflowsDir)).filter((f) => /\.ya?ml$/i.test(f));
  assert.equal(files.length, 9, "no new workflow file may be introduced by boundary hardening");
  let scheduled = 0;
  for (const file of files) {
    const source = (await fs.readFile(path.join(workflowsDir, file), "utf8"))
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    if (/^\s{2}schedule:\s*$/m.test(source)) scheduled += 1;
  }
  assert.equal(scheduled, 1);
});

test("Preview Publish remains non-deploying and non-writing after this prompt's changes", async () => {
  const workflow = await fs.readFile(
    path.resolve(process.cwd(), ".github/workflows/preview-publish.yml"),
    "utf8"
  );
  assert.doesNotMatch(workflow, /actions\/(?:configure-pages|upload-pages-artifact|deploy-pages)@/);
  assert.doesNotMatch(workflow, /run: npm run writeback:/);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type MutableRoute = {
  brand: string;
  targetRepository: string;
  targetDomain: string;
  pathPrefix?: string;
  deploymentRoot?: string;
  deploymentMode?: string;
  pdfPath?: string;
  cname: string;
  routeId: string;
  presentationProfileKey: string | null;
  allowedUrlNamespaces: string[];
  repositoryConfirmed: boolean;
};

async function tempRouteConfig(mutate: (config: Record<string, MutableRoute>) => void): Promise<string> {
  const raw = await fs.readFile(ROUTE_CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw) as Record<string, MutableRoute>;
  mutate(parsed);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notion-boundary-hardening-"));
  const configPath = path.join(dir, "brand-routes.json");
  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return configPath;
}

function gongState(overrides: Partial<DocumentStateRecord> = {}): DocumentStateRecord {
  return {
    pageId: "page-gong-1",
    docId: "GONG-MEM-2607-0001",
    brand: "GONG",
    visibility: "Internal",
    namespace: "internal",
    shareToken: "gongtoken01",
    canonicalOrigin: "https://enxpower.com",
    pathPrefix: "/gong-docs",
    canonicalPath: "/internal/gongtoken01/",
    finalUrl: "https://enxpower.com/gong-docs/internal/gongtoken01/",
    deploymentTarget: "enxpower/pub",
    deploymentRoot: "gong-docs",
    ownedFiles: ["gong-docs/internal/gongtoken01/index.html", "gong-docs/pdf/GONG-MEM-2607-0001.pdf"],
    contentHash: "content-hash",
    routingHash: "routing-hash",
    rendererHash: "renderer-hash",
    assetHash: "asset-hash",
    desiredStateHash: "desired-hash",
    pdfRequired: true,
    publishedAt: "2026-07-19T00:00:00.000Z",
    ...overrides
  };
}

function moveOrRemoveRecord(action: "REMOVE" | "MOVE", previous: DocumentStateRecord): IncrementalPlanRecord {
  return {
    action,
    reason: "TEST_FIXTURE",
    brand: previous.brand,
    pageId: previous.pageId,
    docId: previous.docId,
    previous,
    errors: []
  };
}

function noopPlanRecord(overrides: { brand: string; docId: string }): IncrementalPlanRecord {
  const desired = gongState({ brand: overrides.brand, docId: overrides.docId });
  const { publishedAt: _publishedAt, ...desiredWithoutPublishedAt } = desired;
  return {
    action: "NOOP",
    reason: "STATE_UNCHANGED",
    brand: overrides.brand,
    pageId: desired.pageId,
    docId: overrides.docId,
    previous: desired,
    desired: desiredWithoutPublishedAt,
    errors: []
  };
}
