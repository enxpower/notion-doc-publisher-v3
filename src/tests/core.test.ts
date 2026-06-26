/**
 * Regression tests for the frozen business core.
 *
 * These tests protect the rules that must never silently change:
 *   - DOC_ID parsing, assignment sequencing, and collision refusal
 *   - publishability (Publish + Status + Visibility) decisions
 *   - public index listing (Public + Portal Listed only)
 *   - Share Token validation severity
 *   - security configuration lint combinations
 *
 * They run entirely in memory: no Notion access, no file output.
 * Run with:  npm test
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AppConfig } from "../config.js";
import { createAssignmentPlan, parseDocId } from "../doc-id/generator.js";
import { emptyValidation, type DocumentModel } from "../model/document.js";
import { isPublicIndexListed, isPublishableCandidate, validateDocuments } from "../validate/validate.js";
import { publishableDocuments, skippedDueToErrors } from "../cli/shared.js";
import { lintSecurityConfig } from "../cli/security-lint.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    publishableStatuses: new Set(["Approved", "Published"]),
    allowedVisibility: new Set(["Public"]),
    docIdYearMonth: "2606",
    autoGenerateShareToken: true,
    allowMissingShareToken: false,
    autoFillPrivateNamespace: true,
    ...overrides
  } as AppConfig;
}

function makeDoc(meta: Partial<DocumentModel["meta"]>, pageId = "page-1"): DocumentModel {
  return {
    meta: {
      docId: "ARCBOS-SPEC-2606-0001",
      title: "Test Document",
      brand: { label: "ARCBOS", token: "ARCBOS", slug: "arcbos" },
      client: { label: "", slug: "" },
      project: { label: "", slug: "" },
      documentType: { label: "Specification", token: "SPEC", slug: "spec" },
      version: "v1.0",
      status: "Approved",
      visibility: "Public",
      publish: true,
      portalListed: true,
      shareToken: "",
      privateLinkNamespace: "",
      category: "",
      portalCategory: "",
      canonicalPath: "/docs/arcbos-spec-2606-0001/",
      ...meta
    },
    content: [{ type: "paragraph", id: "b1", richText: [{ text: "Body." }] }],
    assets: [],
    source: { notionPageId: pageId, notionDatabaseId: "db-1" },
    validation: emptyValidation()
  };
}

/* ---------------- DOC_ID ---------------- */

test("parseDocId accepts canonical format and rejects malformed ids", () => {
  const parsed = parseDocId("ARCBOS-SPEC-2606-0042");
  assert.deepEqual(parsed, { brandToken: "ARCBOS", typeToken: "SPEC", yearMonth: "2606", sequence: 42 });
  assert.equal(parseDocId("arcbos-spec-2606-0042"), undefined);
  assert.equal(parseDocId("ARCBOS-SPEC-26060-042"), undefined);
  assert.equal(parseDocId("ARCBOS-SPEC-2606"), undefined);
});

test("assignment plan continues the month sequence and never reuses ids", () => {
  const existing = makeDoc({ docId: "ARCBOS-SPEC-2606-0007" }, "page-existing");
  const fresh = makeDoc({ docId: "" }, "page-fresh");
  const plan = createAssignmentPlan([existing, fresh], makeConfig());
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0]!.docId, "ARCBOS-SPEC-2606-0008");
});

test("assignment plan blocks on duplicate existing DOC_IDs", () => {
  const a = makeDoc({ docId: "ARCBOS-SPEC-2606-0001" }, "page-a");
  const b = makeDoc({ docId: "ARCBOS-SPEC-2606-0001" }, "page-b");
  const plan = createAssignmentPlan([a, b], makeConfig());
  assert.ok(plan.errors.some((e) => e.code === "DUPLICATE_DOC_ID"));
});

test("assignment plan skips (not blocks) when brand or type token is missing", () => {
  const doc = makeDoc({ docId: "", brand: { label: "X", token: "", slug: "x" } }, "page-x");
  const plan = createAssignmentPlan([doc], makeConfig());
  // MISSING_DOC_ID_TOKEN is a per-document skip, not a global integrity error.
  // It must NOT appear in errors (which would block ALL assignments).
  assert.equal(plan.errors.length, 0, "must not be a blocking integrity error");
  assert.ok(plan.skipped.some((e) => e.code === "MISSING_DOC_ID_TOKEN"), "must appear in skipped");
  assert.equal(plan.assignments.length, 0, "affected document must not receive an assignment");
});

/* ---------------- Publishability ---------------- */

test("publishable requires Publish checked AND a publishable Status", () => {
  const config = makeConfig();
  assert.equal(isPublishableCandidate(makeDoc({}), config), true);
  assert.equal(isPublishableCandidate(makeDoc({ publish: false }), config), false);
  assert.equal(isPublishableCandidate(makeDoc({ status: "Draft" }), config), false);
});

test("private-link visibilities build regardless of allowedVisibility", () => {
  const config = makeConfig({ allowedVisibility: new Set(["Public"]) } as Partial<AppConfig>);
  for (const visibility of ["Client", "Internal", "Unlisted"]) {
    assert.equal(isPublishableCandidate(makeDoc({ visibility }), config), true, visibility);
  }
});

test("public index lists ONLY Public + Portal Listed documents", () => {
  assert.equal(isPublicIndexListed(makeDoc({})), true);
  assert.equal(isPublicIndexListed(makeDoc({ portalListed: false })), false);
  assert.equal(isPublicIndexListed(makeDoc({ visibility: "Client" })), false);
  assert.equal(isPublicIndexListed(makeDoc({ visibility: "Unlisted", portalListed: true })), false);
});

/* ---------------- Validation rules ---------------- */

test("duplicate DOC_ID: only the later document gets the error, first still publishes", () => {
  const config = makeConfig();
  const a = makeDoc({}, "page-a");
  const b = makeDoc({}, "page-b");
  validateDocuments([a, b], config);
  // First occurrence: no error, still publishable
  assert.equal(a.validation.errors.length, 0);
  assert.equal(publishableDocuments([a, b], config)[0]!.source.notionPageId, "page-a");
  // Second (duplicate): gets the error and is skipped
  assert.ok(b.validation.errors.some((e) => e.code === "DUPLICATE_DOC_ID"));
  assert.equal(skippedDueToErrors([a, b], config).length, 1);
  assert.equal(skippedDueToErrors([a, b], config)[0]!.source.notionPageId, "page-b");
});

test("invalid Share Token is a blocking error; short-but-valid is a warning", () => {
  const bad = makeDoc({ visibility: "Client", shareToken: "UPPERCASE!" }, "page-bad");
  const short = makeDoc({ visibility: "Client", shareToken: "abcde12345", docId: "ARCBOS-SPEC-2606-0002", canonicalPath: "/clients/x/" }, "page-short");
  validateDocuments([bad, short], makeConfig());
  assert.ok(bad.validation.errors.some((e) => e.code === "INVALID_SHARE_TOKEN"));
  assert.ok(short.validation.warnings.some((e) => e.code === "SHORT_SHARE_TOKEN"));
  assert.equal(short.validation.errors.length, 0);
});

test("unsafe link protocols are blocked", () => {
  const doc = makeDoc({});
  doc.content.push({ type: "paragraph", id: "b2", richText: [{ text: "x", href: "javascript:alert(1)" }] });
  validateDocuments([doc], makeConfig());
  assert.ok(doc.validation.errors.some((e) => e.code === "UNSAFE_LINK"));
});

test("output path collision: only the later document is skipped, first still publishes", () => {
  const config = makeConfig();
  const a = makeDoc({}, "page-a");
  // page-b shares the same canonicalPath as page-a
  const b = makeDoc({ docId: "ARCBOS-SPEC-2606-0002" }, "page-b");
  validateDocuments([a, b], config);
  // First document: no error
  assert.equal(a.validation.errors.length, 0);
  // Second document: gets the collision error and is excluded from published output
  assert.ok(b.validation.errors.some((e) => e.code === "OUTPUT_PATH_COLLISION"));
  assert.equal(publishableDocuments([a, b], config).length, 1);
  assert.equal(publishableDocuments([a, b], config)[0]!.source.notionPageId, "page-a");
});

/* ---------------- Security lint ---------------- */

test("security lint flags legacy unlisted paths as dangerous", () => {
  const findings = lintSecurityConfig({ LEGACY_UNLISTED_DOCS_PATH: "true" } as NodeJS.ProcessEnv);
  assert.ok(findings.some((f) => f.level === "DANGER"));
});

test("security lint flags DOC_ID exposure in private URLs", () => {
  const findings = lintSecurityConfig({ LEGACY_PRIVATE_DOC_ID_URLS: "true" } as NodeJS.ProcessEnv);
  assert.ok(findings.some((f) => f.level === "DANGER" && f.message.includes("DOC_ID")));
});

test("security lint flags missing-token allowance", () => {
  const findings = lintSecurityConfig({
    AUTO_GENERATE_SHARE_TOKEN: "false",
    ALLOW_MISSING_SHARE_TOKEN: "true"
  } as NodeJS.ProcessEnv);
  assert.ok(findings.some((f) => f.level === "DANGER"));
});

test("security lint passes a clean default configuration", () => {
  const findings = lintSecurityConfig({} as NodeJS.ProcessEnv);
  assert.equal(findings.filter((f) => f.level === "DANGER").length, 0);
});
