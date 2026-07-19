import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, BrandProfile } from "../config.js";
import { emptyValidation, type DocumentModel } from "../model/document.js";

type BrandKey = "ARCBOS" | "ENERGIZE" | "AGIM" | "GONG";

export async function loadRoutedDryRunConfig(): Promise<AppConfig> {
  const brandProfiles = await loadBrandProfiles();
  return {
    notionToken: "dry-run-notion-token-not-used",
    notionDatabaseId: "dry-run-database-id-not-used",
    targetSiteDomain: undefined,
    docIdYearMonth: "2606",
    allowedVisibility: new Set(["Public"]),
    publishableStatuses: new Set(["Approved", "Published"]),
    allowedBrands: null,
    brandTokens: {
      ARCBOS: "ARCBOS",
      ENERGIZE: "ENERGIZE",
      AGIM: "AGIM",
      GONG: "GONG"
    },
    documentTypeTokens: {
      Specification: "SPEC",
      Agreement: "AGR",
      Memo: "MEM",
      Report: "RPT"
    },
    brandProfiles,
    registerPublic: false,
    robotsDisallowDocs: false,
    allowMissingShareToken: false,
    legacyUnlistedDocsPath: false,
    autoGenerateShareToken: true,
    autoFillPrivateNamespace: true,
    autoFillPortalCategory: true,
    legacyPrivateDocIdUrls: false
  };
}

export function routedDryRunDocuments(): DocumentModel[] {
  return [
    makeDoc("ARCBOS", {
      docId: "ARCBOS-SPEC-2606-0001",
      documentType: { label: "Specification", token: "SPEC", slug: "specification" },
      title: "ARCBOS Routed Dry Run Specification",
      visibility: "Public",
      canonicalPath: "/docs/ARCBOS-SPEC-2606-0001/"
    }),
    makeDoc("ENERGIZE", {
      docId: "ENERGIZE-AGR-2606-0002",
      documentType: { label: "Agreement", token: "AGR", slug: "agreement" },
      title: "ENERGIZE Routed Dry Run Agreement",
      visibility: "Client",
      shareToken: "energizeclient01",
      canonicalPath: "/clients/energizeclient01/"
    }),
    makeDoc("AGIM", {
      docId: "AGIM-MEM-2606-0003",
      documentType: { label: "Memo", token: "MEM", slug: "memo" },
      title: "AGIM Routed Dry Run Memo",
      visibility: "Unlisted",
      shareToken: "agimpartner01",
      privateLinkNamespace: "partners",
      canonicalPath: "/partners/agimpartner01/"
    }),
    makeDoc("GONG", {
      docId: "GONG-RPT-2606-0004",
      documentType: { label: "Report", token: "RPT", slug: "report" },
      title: "GONG Routed Dry Run Report",
      visibility: "Internal",
      shareToken: "gonginternal01",
      privateLinkNamespace: "internal",
      canonicalPath: "/internal/gonginternal01/"
    })
  ];
}

function makeDoc(
  brand: BrandKey,
  overrides: Partial<DocumentModel["meta"]> & Pick<DocumentModel["meta"], "docId" | "documentType" | "title" | "visibility" | "canonicalPath">
): DocumentModel {
  return {
    meta: {
      docId: overrides.docId,
      title: overrides.title,
      brand: { label: brand, token: brand, slug: brand.toLowerCase() },
      client: { label: brand === "GONG" ? "Internal" : "Dry Run Client", slug: brand === "GONG" ? "internal" : "dry-run-client" },
      project: { label: "Routed Dry Run", slug: "routed-dry-run" },
      documentType: overrides.documentType,
      version: "v1.0",
      status: "Approved",
      visibility: overrides.visibility,
      publish: true,
      portalListed: overrides.visibility === "Public",
      shareToken: overrides.shareToken ?? "",
      privateLinkNamespace: overrides.privateLinkNamespace ?? "",
      category: "",
      portalCategory: "",
      canonicalPath: overrides.canonicalPath
    },
    content: [
      {
        type: "paragraph",
        id: `${brand.toLowerCase()}-p1`,
        richText: [{ text: `${brand} deterministic routed dry-run fixture content.` }]
      }
    ],
    assets: [],
    source: {
      notionPageId: `fixture-${brand.toLowerCase()}-page`,
      notionDatabaseId: "dry-run-database-id-not-used",
      lastEditedTime: "2026-06-15T12:00:00.000Z"
    },
    validation: emptyValidation()
  };
}

async function loadBrandProfiles(): Promise<Record<string, BrandProfile>> {
  const raw = await fs.readFile(path.resolve("config/brands.json"), "utf8");
  return JSON.parse(raw) as Record<string, BrandProfile>;
}
