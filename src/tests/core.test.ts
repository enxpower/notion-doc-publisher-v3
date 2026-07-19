/**
 * Regression tests for the frozen business core.
 *
 * These tests protect the rules that must never silently change:
 *   - DOC_ID parsing, assignment sequencing, and collision refusal
 *   - publishability (Publish + Status + Visibility) decisions
 *   - brand filter (ALLOWED_BRANDS) behaviour
 *   - public index listing (Public + Portal Listed only)
 *   - Share Token validation severity
 *   - PDF download button path (relative, not absolute)
 *   - security configuration lint combinations
 *
 * They run entirely in memory: no Notion access, no file output.
 * Run with:  npm test
 */
import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import { test } from "node:test";
import type { AppConfig } from "../config.js";
import { createAssignmentPlan, parseDocId } from "../doc-id/generator.js";
import { emptyValidation, type DocumentModel } from "../model/document.js";
import { computeCanonicalPath } from "../notion/properties.js";
import { NotionWriteback } from "../notion/writeback.js";
import { isPublicIndexListed, isPublishableCandidate, validateDocuments } from "../validate/validate.js";
import { autoFillDocuments, publishableDocuments, skippedDueToErrors } from "../cli/shared.js";
import { lintSecurityConfig } from "../cli/security-lint.js";
import { renderActions } from "../render/render-html.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    notionToken: "test-notion-token",
    notionDatabaseId: "test-database-id",
    targetSiteDomain: "https://docs.example.test",
    publishableStatuses: new Set(["Approved", "Published"]),
    allowedVisibility: new Set(["Public"]),
    allowedBrands: null,
    docIdYearMonth: "2606",
    brandTokens: { ARCBOS: "ARCBOS", ENERGIZE: "ENERGIZE", AGIM: "AGIM", GONG: "GONG" },
    documentTypeTokens: { Specification: "SPEC", Agreement: "AGR", Memo: "MEM", Report: "RPT" },
    brandProfiles: {
      ARCBOS: { displayName: "ARCBOS", tagline: "Engineered for extreme conditions", shareImage: "arcbos-share-preview.png" },
      ENERGIZE: { displayName: "ENERGIZE", tagline: "Clean power systems", shareImage: "energize-share-preview.png" },
      AGIM: { displayName: "AGIM", tagline: "Industrial mobility", shareImage: "agim-share-preview.png" },
      GONG: { displayName: "GONG", tagline: "Operating documents", shareImage: "gong-share-preview.png" }
    },
    registerPublic: false,
    robotsDisallowDocs: false,
    allowMissingShareToken: false,
    legacyUnlistedDocsPath: false,
    autoGenerateShareToken: true,
    autoFillPrivateNamespace: true,
    autoFillPortalCategory: true,
    legacyPrivateDocIdUrls: false,
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
  assert.match(plan.assignments[0]!.docId, /^ARCBOS-SPEC-2606-\d{4}$/);
  assert.equal(plan.assignments[0]!.pageId, "page-fresh");
});

test("assignment plan never reassigns an existing DOC_ID", () => {
  const existing = makeDoc({ docId: "ARCBOS-SPEC-2606-0007" }, "page-existing");
  const plan = createAssignmentPlan([existing], makeConfig());

  assert.equal(plan.errors.length, 0);
  assert.equal(plan.assignments.length, 0);
  assert.equal(existing.meta.docId, "ARCBOS-SPEC-2606-0007");
});

test("assignment sequence remains globally unique across brands and document types", () => {
  const arcbos = makeDoc({ docId: "ARCBOS-SPEC-2606-0007" }, "page-arcbos");
  const energize = makeDoc(
    {
      docId: "ENERGIZE-AGR-2606-0011",
      brand: { label: "ENERGIZE", token: "ENERGIZE", slug: "energize" },
      documentType: { label: "Agreement", token: "AGR", slug: "agreement" }
    },
    "page-energize"
  );
  const agimFresh = makeDoc(
    {
      docId: "",
      brand: { label: "AGIM", token: "AGIM", slug: "agim" },
      documentType: { label: "Memo", token: "MEM", slug: "memo" }
    },
    "page-agim"
  );
  const plan = createAssignmentPlan([arcbos, energize, agimFresh], makeConfig());

  assert.equal(plan.errors.length, 0);
  assert.deepEqual(plan.assignments, [
    { pageId: "page-agim", title: "Test Document", docId: "AGIM-MEM-2606-0012" }
  ]);
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

/* ---------------- Brand filter (ALLOWED_BRANDS) ---------------- */

test("allowedBrands=null passes all brands \u2014 zero production impact on existing deployments", () => {
  const config = makeConfig({ allowedBrands: null });
  assert.equal(isPublishableCandidate(makeDoc({ brand: { label: "ARCBOS", token: "ARCBOS", slug: "arcbos" } }), config), true);
  assert.equal(isPublishableCandidate(makeDoc({ brand: { label: "ENERGIZE", token: "ENERGIZE", slug: "energize" } }), config), true);
  assert.equal(isPublishableCandidate(makeDoc({ brand: { label: "AGIM", token: "AGIM", slug: "agim" } }), config), true);
});

test("allowedBrands whitelist passes matching brand and excludes others", () => {
  const config = makeConfig({ allowedBrands: new Set(["ENERGIZE"]) });
  assert.equal(
    isPublishableCandidate(makeDoc({ brand: { label: "ENERGIZE", token: "ENERGIZE", slug: "energize" } }), config),
    true,
    "ENERGIZE should pass"
  );
  assert.equal(
    isPublishableCandidate(makeDoc({ brand: { label: "ARCBOS", token: "ARCBOS", slug: "arcbos" } }), config),
    false,
    "ARCBOS should be excluded"
  );
  assert.equal(
    isPublishableCandidate(makeDoc({ brand: { label: "AGIM", token: "AGIM", slug: "agim" } }), config),
    false,
    "AGIM should be excluded"
  );
});

test("allowedBrands is case-insensitive: Energize / energize / ENERGIZE all pass", () => {
  const config = makeConfig({ allowedBrands: new Set(["ENERGIZE"]) });
  for (const label of ["ENERGIZE", "Energize", "energize", " energize "] as string[]) {
    assert.equal(
      isPublishableCandidate(makeDoc({ brand: { label, token: "ENERGIZE", slug: "energize" } }), config),
      true,
      `label "${label}" should pass`
    );
  }
});

test("allowedBrands fail-closed: empty brand label is excluded when whitelist is active", () => {
  const config = makeConfig({ allowedBrands: new Set(["ENERGIZE"]) });
  assert.equal(
    isPublishableCandidate(makeDoc({ brand: { label: "", token: "", slug: "" } }), config),
    false,
    "empty brand must be excluded when whitelist is active"
  );
});

test("allowedBrands: BRAND_NOT_ALLOWED warning appears in validation report for excluded documents", () => {
  const config = makeConfig({ allowedBrands: new Set(["ENERGIZE"]) });
  const arcbosDoc = makeDoc({ brand: { label: "ARCBOS", token: "ARCBOS", slug: "arcbos" } }, "page-arcbos");
  const energizeDoc = makeDoc(
    { docId: "ENERGIZE-SPEC-2606-0001", brand: { label: "ENERGIZE", token: "ENERGIZE", slug: "energize" }, canonicalPath: "/docs/energize-spec-2606-0001/" },
    "page-energize"
  );
  validateDocuments([arcbosDoc, energizeDoc], config);
  assert.ok(
    arcbosDoc.validation.warnings.some((w) => w.code === "BRAND_NOT_ALLOWED"),
    "excluded document must have BRAND_NOT_ALLOWED warning"
  );
  assert.equal(
    energizeDoc.validation.warnings.filter((w) => w.code === "BRAND_NOT_ALLOWED").length,
    0,
    "included document must not have BRAND_NOT_ALLOWED warning"
  );
  const published = publishableDocuments([arcbosDoc, energizeDoc], config);
  assert.equal(published.length, 1);
  assert.equal(published[0]!.source.notionPageId, "page-energize");
});

test("allowedBrands: multiple brands in whitelist all pass", () => {
  const config = makeConfig({ allowedBrands: new Set(["ENERGIZE", "AGIM"]) });
  assert.equal(
    isPublishableCandidate(makeDoc({ brand: { label: "ENERGIZE", token: "ENERGIZE", slug: "energize" } }), config),
    true
  );
  assert.equal(
    isPublishableCandidate(makeDoc({ brand: { label: "AGIM", token: "AGIM", slug: "agim" } }), config),
    true
  );
  assert.equal(
    isPublishableCandidate(makeDoc({ brand: { label: "ARCBOS", token: "ARCBOS", slug: "arcbos" } }), config),
    false
  );
});

/* ---------------- PDF download button path ---------------- */

test("renderActions: PDF href uses relative path with default rootRelative", () => {
  // Default rootRelative="../../" matches ROOT_RELATIVE_FROM_DOC used in document pages.
  // Documents live at /{namespace}/{token}/index.html so ../../pdf/ resolves to /pdf/
  // on root deployments (docs.arcbos.com) — same as the old absolute path, no regression.
  const html = renderActions("ENERGIZE-MEM-2607-0003");
  assert.ok(
    html.includes('href="../../pdf/ENERGIZE-MEM-2607-0003.pdf"'),
    `Expected relative PDF href in: ${html}`
  );
  assert.ok(!html.includes('href="/pdf/'), "Must not use absolute /pdf/ path");
});

test("renderActions: PDF href uses caller-supplied rootRelative for sub-path deployments", () => {
  // Sub-path deployment: rootRelative would still be "../../" since document depth
  // relative to site root is always /{namespace}/{token}/ = 2 levels deep.
  // This test validates that a custom rootRelative is honoured end-to-end.
  const html = renderActions("ENERGIZE-MEM-2607-0003", "../../");
  assert.ok(
    html.includes('href="../../pdf/ENERGIZE-MEM-2607-0003.pdf"'),
    `Expected relative PDF href in: ${html}`
  );
  assert.ok(!html.includes('href="/pdf/'), "Must not use absolute /pdf/ path");
});

test("renderActions: no PDF button when docId is absent", () => {
  const html = renderActions(null);
  assert.ok(html.includes("Print"), "Print button must still be present");
  assert.ok(!html.includes("Download PDF"), "No PDF button without docId");
  assert.ok(!html.includes(".pdf"), "No .pdf reference without docId");
});

/* ---------------- Validation rules ---------------- */

test("duplicate DOC_ID: only the later document gets the error, first still publishes", () => {
  const config = makeConfig();
  const a = makeDoc({}, "page-a");
  const b = makeDoc({}, "page-b");
  validateDocuments([a, b], config);
  assert.equal(a.validation.errors.length, 0);
  assert.equal(publishableDocuments([a, b], config)[0]!.source.notionPageId, "page-a");
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

/* ---------------- Randomized URL behaviour ---------------- */

test("missing Share Token is generated from deterministic mocked randomness and written only to the matching page", async () => {
  const originalRandomBytes = crypto.randomBytes;
  const originalWriteAutoFillProperties = NotionWriteback.prototype.writeAutoFillProperties;
  const writes: Array<{
    pageId: string;
    props: Parameters<NotionWriteback["writeAutoFillProperties"]>[1];
  }> = [];
  const expectedToken = "1a".repeat(8);
  (crypto as unknown as { randomBytes: (size: number) => Buffer }).randomBytes = (size: number): Buffer => {
    return Buffer.alloc(size, 0x1a);
  };
  NotionWriteback.prototype.writeAutoFillProperties = async function (
    pageId: string,
    props: Parameters<NotionWriteback["writeAutoFillProperties"]>[1]
  ): Promise<void> {
    writes.push({ pageId, props });
  };

  try {
    const document = makeDoc(
      {
        visibility: "Client",
        shareToken: "",
        privateLinkNamespace: "",
        canonicalPath: ""
      },
      "page-private"
    );

    await autoFillDocuments([document], makeConfig());

    assert.equal(document.meta.shareToken, expectedToken);
    assert.equal(document.meta.privateLinkNamespace, "clients");
    assert.equal(document.meta.canonicalPath, `/clients/${expectedToken}/`);
    assert.deepEqual(writes, [
      { pageId: "page-private", props: { shareToken: expectedToken, namespace: "clients" } }
    ]);
  } finally {
    (crypto as unknown as { randomBytes: typeof originalRandomBytes }).randomBytes = originalRandomBytes;
    NotionWriteback.prototype.writeAutoFillProperties = originalWriteAutoFillProperties;
  }
});

test("existing Share Token and canonical URL remain stable across repeated builds", async () => {
  const originalRandomBytes = crypto.randomBytes;
  const originalWriteAutoFillProperties = NotionWriteback.prototype.writeAutoFillProperties;
  const writes: Array<{
    pageId: string;
    props: Parameters<NotionWriteback["writeAutoFillProperties"]>[1];
  }> = [];
  (crypto as unknown as { randomBytes: (size: number) => Buffer }).randomBytes = (): Buffer => {
    throw new Error("randomBytes must not be called for an existing Share Token");
  };
  NotionWriteback.prototype.writeAutoFillProperties = async function (
    pageId: string,
    props: Parameters<NotionWriteback["writeAutoFillProperties"]>[1]
  ): Promise<void> {
    writes.push({ pageId, props });
  };

  try {
    const document = makeDoc(
      {
        visibility: "Unlisted",
        shareToken: "stabletoken123",
        privateLinkNamespace: "partners",
        canonicalPath: "/partners/stabletoken123/"
      },
      "page-stable"
    );
    const canonicalUrl = `${makeConfig().targetSiteDomain}${document.meta.canonicalPath}`;

    await autoFillDocuments([document], makeConfig());
    await autoFillDocuments([document], makeConfig());

    assert.equal(document.meta.shareToken, "stabletoken123");
    assert.equal(document.meta.canonicalPath, "/partners/stabletoken123/");
    assert.equal(`${makeConfig().targetSiteDomain}${document.meta.canonicalPath}`, canonicalUrl);
    assert.deepEqual(writes, []);
  } finally {
    (crypto as unknown as { randomBytes: typeof originalRandomBytes }).randomBytes = originalRandomBytes;
    NotionWriteback.prototype.writeAutoFillProperties = originalWriteAutoFillProperties;
  }
});

test("private canonical paths stay token-based and do not expose guessable DOC_IDs", () => {
  const docId = "ARCBOS-SPEC-2606-0008";
  const pathValue = computeCanonicalPath("Client", docId, "clienttoken123", "");

  assert.equal(pathValue, "/clients/clienttoken123/");
  assert.ok(!pathValue.includes(docId), "private canonical path must not include the sequential DOC_ID");
});

test("private namespace canonical path behaviour remains unchanged", () => {
  const docId = "ARCBOS-SPEC-2606-0008";

  assert.equal(computeCanonicalPath("Client", docId, "clienttoken123", "partners"), "/clients/clienttoken123/");
  assert.equal(computeCanonicalPath("Internal", docId, "internaltoken123", "clients"), "/internal/internaltoken123/");
  assert.equal(computeCanonicalPath("Unlisted", docId, "partnertoken123", "partners"), "/partners/partnertoken123/");
  assert.equal(computeCanonicalPath("Unlisted", docId, "fallbacktoken123", ""), "/clients/fallbacktoken123/");
  assert.equal(computeCanonicalPath("Unlisted", docId, "fallbacktoken123", "bad-namespace"), "/clients/fallbacktoken123/");
  assert.equal(computeCanonicalPath("Public", docId, "ignoredtoken123", "partners"), "/docs/ARCBOS-SPEC-2606-0008/");
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
  const b = makeDoc({ docId: "ARCBOS-SPEC-2606-0002" }, "page-b");
  validateDocuments([a, b], config);
  assert.equal(a.validation.errors.length, 0);
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
