import { strict as assert } from "node:assert";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { runRoutedReadonlyDiagnostics } from "../routing/routed-diagnostics.js";
import { loadBrandRoutes } from "../routing/routes.js";

type BuildInput = {
  documents: DocumentModel[];
  config?: AppConfig;
};

test("diagnostic command is separate and avoids build, deployment, autofill, assign-id, writeback, and PDF queue code", async () => {
  const raw = await fs.readFile(path.resolve("package.json"), "utf8");
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  const source = await fs.readFile(path.resolve("src/cli/diagnose-routed-readonly.ts"), "utf8");
  const engine = await fs.readFile(path.resolve("src/routing/routed-diagnostics.ts"), "utf8");

  assert.equal(pkg.scripts["diagnose:routed:readonly"], "tsc && node .tmp/cli/diagnose-routed-readonly.js");
  assert.ok(source.includes("loadDocuments"), "diagnostic CLI must use the existing document load path outside fixture mode");
  assert.ok(source.includes("loadRoutedReadonlyConfigFromEnvironment"), "diagnostic CLI must use the restricted readonly config loader");
  assert.ok(engine.includes("enableNotionReadOnlyMode"), "diagnostics must enable the mutation guard");
  for (const forbidden of [
    "buildRoutedReadonly",
    "buildRoutedSites",
    "createDryRunDeploymentPlan",
    "autoFillDocuments",
    "createAssignmentPlan",
    "NotionWriteback",
    "writePdfResult",
    "updateDocumentSuccess",
    "updatePageProperties"
  ]) {
    assert.equal(source.includes(forbidden), false, `diagnostic CLI must not reference ${forbidden}`);
  }
});

test("diagnostics detect duplicate DOC_ID within one brand", async () => {
  const documents = twoDocs();
  documents[1]!.meta.docId = documents[0]!.meta.docId;
  documents[1]!.meta.canonicalPath = "/docs/ARCBOS-SPEC-2606-0999/";
  const report = await diagnose({ documents });

  const group = report.collisions.find((collision) => collision.scope === "doc_id");
  assert.ok(group);
  assert.equal(group.collisionType, "identical_doc_id");
  assert.equal(group.recordCount, 2);
});

test("diagnostics detect duplicate DOC_ID across different brands", async () => {
  const documents = routedDryRunDocuments().slice(0, 2);
  documents[1]!.meta.docId = documents[0]!.meta.docId;
  documents[1]!.meta.canonicalPath = "/clients/crossbrandtoken1/";
  const report = await diagnose({ documents });

  const group = report.collisions.find((collision) => collision.scope === "doc_id");
  assert.ok(group);
  assert.equal(group.collisionType, "identical_doc_id");
  assert.deepEqual(group.records.map((record) => record.normalizedBrand).sort(), ["ARCBOS", "ENERGIZE"]);
});

test("diagnostics detect duplicate Share Token within one namespace", async () => {
  const documents = twoDocs();
  for (const document of documents) {
    document.meta.visibility = "Client";
    document.meta.shareToken = "sharedclienttoken";
    document.meta.privateLinkNamespace = "";
    document.meta.canonicalPath = "/clients/sharedclienttoken/";
  }
  documents[1]!.meta.docId = "ARCBOS-SPEC-2606-0999";
  const report = await diagnose({ documents });

  const group = report.collisions.find((collision) => collision.scope === "share_token");
  assert.ok(group);
  assert.equal(group.collisionType, "identical_share_token");
  assert.ok(group.collisionTypes.includes("identical_canonical_path"));
});

test("diagnostics detect same token in different namespaces without treating it as the same output path", async () => {
  const documents = routedDryRunDocuments().slice(1, 3);
  documents[0]!.meta.visibility = "Client";
  documents[0]!.meta.shareToken = "sharednamespacetoken";
  documents[0]!.meta.privateLinkNamespace = "";
  documents[0]!.meta.canonicalPath = "/clients/sharednamespacetoken/";
  documents[1]!.meta.visibility = "Unlisted";
  documents[1]!.meta.shareToken = "sharednamespacetoken";
  documents[1]!.meta.privateLinkNamespace = "partners";
  documents[1]!.meta.canonicalPath = "/partners/sharednamespacetoken/";
  const report = await diagnose({ documents });

  const group = report.collisions.find((collision) => collision.collisionType === "same_token_different_namespaces");
  assert.ok(group);
  assert.equal(report.collisionSummary.outputPathGroups, 0);
});

test("diagnostics detect canonical paths equal after case normalization", async () => {
  const documents = twoDocs();
  documents[0]!.meta.canonicalPath = "/docs/ARCBOS-SPEC-2606-0001/";
  documents[1]!.meta.canonicalPath = "/docs/arcbos-spec-2606-0001/";
  const report = await diagnose({ documents });

  const group = report.collisions.find((collision) => collision.scope === "output_path");
  assert.ok(group);
  assert.ok(group.collisionTypes.includes("case_insensitive_collision"));
});

test("diagnostics detect encoded and unencoded equivalent paths", async () => {
  const documents = twoDocs();
  documents[0]!.meta.canonicalPath = "/clients/token%31/";
  documents[1]!.meta.canonicalPath = "/clients/token1/";
  const report = await diagnose({ documents });

  const group = report.collisions.find((collision) => collision.scope === "output_path");
  assert.ok(group);
  assert.ok(group.collisionTypes.includes("trailing_slash_or_url_normalization_collision"));
});

test("diagnostics detect trailing-slash-equivalent paths", async () => {
  const documents = twoDocs();
  documents[0]!.meta.canonicalPath = "/clients/slashstable";
  documents[1]!.meta.canonicalPath = "/clients/slashstable/";
  const report = await diagnose({ documents });

  const group = report.collisions.find((collision) => collision.scope === "output_path");
  assert.ok(group);
  assert.ok(group.collisionTypes.includes("trailing_slash_or_url_normalization_collision"));
});

test("diagnostics detect public DOC_ID path colliding with a private path", async () => {
  const documents = twoDocs();
  documents[0]!.meta.visibility = "Public";
  documents[0]!.meta.canonicalPath = "/docs/ARCBOS-SPEC-2606-0001/";
  documents[1]!.meta.visibility = "Client";
  documents[1]!.meta.shareToken = "privatetoken1";
  documents[1]!.meta.canonicalPath = "/docs/ARCBOS-SPEC-2606-0001/";
  const report = await diagnose({ documents });

  const group = report.collisions.find((collision) => collision.scope === "output_path");
  assert.ok(group);
  assert.equal(group.collisionType, "public_private_path_collision");
});

test("diagnostics detect duplicate records with different Notion page IDs", async () => {
  const documents = twoDocs();
  documents[1]!.meta.docId = documents[0]!.meta.docId;
  documents[1]!.meta.canonicalPath = documents[0]!.meta.canonicalPath;
  documents[1]!.source.notionPageId = "fixture-duplicate-page";
  const report = await diagnose({ documents });

  assert.ok(report.collisions.some((collision) => collision.collisionTypes.includes("duplicated_record_same_document")));
});

test("collision aliases and fingerprints do not reveal source values", async () => {
  const documents = twoDocs();
  documents[1]!.meta.docId = documents[0]!.meta.docId;
  documents[1]!.meta.canonicalPath = documents[0]!.meta.canonicalPath;
  const result = await diagnoseResult({ documents });
  const raw = JSON.stringify(result.report);

  assert.ok(raw.includes("COLLISION-001-A"));
  assert.equal(raw.includes("ARCBOS-SPEC-2606-0001"), false);
  assert.equal(raw.includes("/docs/ARCBOS-SPEC-2606-0001/"), false);
  assert.equal(raw.includes("fixture-arcbos-page"), false);
});

test("missing Share Token diagnostics classify publishable, draft, false-positive, and blocked records", async () => {
  const documents = routedDryRunDocuments();
  documents[1]!.meta.shareToken = "";
  documents[1]!.meta.canonicalPath = "";
  documents[2]!.meta.shareToken = "";
  documents[2]!.meta.canonicalPath = "";
  documents[2]!.meta.status = "Draft";
  documents[3]!.meta.shareToken = "";
  documents[3]!.meta.canonicalPath = "";
  documents[3]!.meta.docId = "";
  const report = await diagnose({ documents });

  assert.equal(report.missingShareTokens.total, 3);
  assert.equal(report.missingShareTokens.publishableImmediateRemediationCount, 1);
  assert.equal(report.missingShareTokens.nonpublishableDraftOnlyCount, 1);
  assert.equal(report.missingShareTokens.falsePositiveCandidateCount, 1);
  assert.equal(report.missingShareTokens.blockedByAnotherIssueCount, 1);
  assert.equal(report.missingShareTokens.futureOwnerMutationRequiredCount, 1);
});

test("diagnostic public output omits private source data while private correlation remains minimal", async () => {
  const documents = twoDocs();
  documents[0]!.meta.title = "Confidential Diagnostic Title";
  documents[0]!.meta.docId = "ARCBOS-SPEC-2606-0777";
  documents[0]!.meta.shareToken = "secrettoken777";
  documents[0]!.meta.canonicalPath = "/clients/secrettoken777/";
  documents[0]!.meta.visibility = "Client";
  documents[0]!.source.notionPageId = "notion-page-secret-777";
  documents[0]!.source.notionDatabaseId = "database-secret-777";
  documents[0]!.source.url = "https://notion.so/secret";
  documents[0]!.content = [{ type: "paragraph", id: "content-a", richText: [{ text: "Confidential block content" }] }];
  documents[1]!.meta.visibility = "Client";
  documents[1]!.meta.shareToken = "secrettoken777";
  documents[1]!.meta.canonicalPath = "/clients/secrettoken777/";

  const result = await diagnoseResult({ documents });
  const publicRaw = await fs.readFile(result.reportPath, "utf8");
  const privateRaw = await fs.readFile(result.correlationPath, "utf8");

  for (const forbidden of [
    "notion-page-secret-777",
    "database-secret-777",
    "https://notion.so/secret",
    "Confidential Diagnostic Title",
    "ARCBOS-SPEC-2606-0777",
    "secrettoken777",
    "/clients/secrettoken777/",
    "Confidential block content",
    os.homedir(),
    "NOTION_TOKEN",
    "Error:"
  ]) {
    assert.equal(publicRaw.includes(forbidden), false, `public diagnostics leaked ${forbidden}`);
  }
  assert.ok(privateRaw.includes("notion-page-secret-777"), "private correlation may include page ID");
  for (const forbidden of [
    "Confidential Diagnostic Title",
    "ARCBOS-SPEC-2606-0777",
    "secrettoken777",
    "/clients/secrettoken777/",
    "Confidential block content",
    "database-secret-777"
  ]) {
    assert.equal(privateRaw.includes(forbidden), false, `private correlation leaked ${forbidden}`);
  }
});

test("diagnostic tests use mocked document reads and no network", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  globalThis.fetch = async (): Promise<Response> => {
    networkCalled = true;
    throw new Error("Network access is forbidden in diagnostic tests");
  };
  try {
    await diagnose({ documents: routedDryRunDocuments() });
    assert.equal(networkCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function diagnose(input: BuildInput) {
  return (await diagnoseResult(input)).report;
}

async function diagnoseResult(input: BuildInput) {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "notion-routed-diagnostics-"));
  const config = input.config ?? await loadRoutedDryRunConfig();
  return await runRoutedReadonlyDiagnostics({
    config,
    routes: await loadBrandRoutes(),
    outputRoot,
    loadDocuments: async () => input.documents,
    now: () => "2026-07-19T00:00:00.000Z",
    salt: "deterministic-test-salt"
  });
}

function twoDocs(): DocumentModel[] {
  const documents = routedDryRunDocuments().slice(0, 1);
  const first = documents[0]!;
  const second: DocumentModel = structuredClone(first);
  second.meta.docId = "ARCBOS-SPEC-2606-0002";
  second.meta.title = "Second diagnostic fixture";
  second.meta.canonicalPath = "/docs/ARCBOS-SPEC-2606-0002/";
  second.source.notionPageId = "fixture-arcbos-page-2";
  second.content = [{ type: "paragraph", id: "second-p1", richText: [{ text: "Second fixture content." }] }];
  return [first, second];
}
