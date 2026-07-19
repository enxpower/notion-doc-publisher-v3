import type { AppConfig } from "../config.js";
import type { DocumentBlock, DocumentModel, RichTextSpan, ValidationIssue } from "../model/document.js";
import { emptyValidation, VALID_PRIVATE_LINK_NAMESPACES, VALID_PORTAL_CATEGORIES, normalizeVisibility } from "../model/document.js";
import type { NotionBlock, NotionPage } from "./client.js";

type PropertyValue = Record<string, unknown>;

export function pageToDocument(page: NotionPage, blocks: NotionBlock[], config: AppConfig): DocumentModel {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const title = readTitle(page.properties.Title as PropertyValue | undefined, "Title", errors);
  const docId = readRichTextScalar(page.properties.DOC_ID as PropertyValue | undefined, "DOC_ID", errors, false);
  const brandLabel = readSelect(page.properties.Brand as PropertyValue | undefined, "Brand", errors);
  const clientLabel = readSelect(page.properties.Client as PropertyValue | undefined, "Client", errors);
  const projectLabel = readSelect(page.properties.Project as PropertyValue | undefined, "Project", errors);
  const documentTypeLabel = readSelect(page.properties["Document Type"] as PropertyValue | undefined, "Document Type", errors);
  const version = readSelect(page.properties.Version as PropertyValue | undefined, "Version", errors);
  const status = readSelect(page.properties.Status as PropertyValue | undefined, "Status", errors);
  const visibility = readSelect(page.properties.Visibility as PropertyValue | undefined, "Visibility", errors);
  const publish = readCheckbox(page.properties.Publish as PropertyValue | undefined, "Publish", errors);
  const portalListed = readOptionalCheckbox(page.properties["Portal Listed"] as PropertyValue | undefined);
  const shareToken = readOptionalRichText(page.properties["Share Token"] as PropertyValue | undefined);
  const privateLinkNamespace = readOptionalSelect(page.properties["Private Link Namespace"] as PropertyValue | undefined);
  const category = readOptionalSelect(page.properties.Category as PropertyValue | undefined);
  const portalCategory = readOptionalSelect(page.properties["Portal Category"] as PropertyValue | undefined);
  const publishedUrl = readOptionalUrl(page.properties.PUBLISHED_URL as PropertyValue | undefined);

  const brandToken = brandLabel ? config.brandTokens[brandLabel] : undefined;
  const typeToken = documentTypeLabel ? config.documentTypeTokens[documentTypeLabel] : undefined;
  if (brandLabel && !brandToken) {
    errors.push(issue("UNKNOWN_BRAND_TOKEN", `Brand "${brandLabel}" has no configured token.`, "Brand", page.id));
  }
  if (documentTypeLabel && !typeToken) {
    errors.push(issue("UNKNOWN_DOCUMENT_TYPE_TOKEN", `Document Type "${documentTypeLabel}" has no configured token.`, "Document Type", page.id));
  }

  const content = blocksToDocumentBlocks(blocks, page.id, warnings);
  const assets = content.flatMap((block) => ("asset" in block ? [block.asset] : []));
  const canonicalPath = computeCanonicalPath(visibility, docId, shareToken, privateLinkNamespace);

  const document: DocumentModel = {
    meta: {
      docId,
      title,
      brand: { label: brandLabel, token: brandToken, slug: slugify(brandLabel) },
      client: { label: clientLabel, slug: slugify(clientLabel) },
      project: { label: projectLabel, slug: slugify(projectLabel) },
      documentType: { label: documentTypeLabel, token: typeToken ?? "", slug: slugify(documentTypeLabel) },
      version,
      status,
      visibility,
      publish,
      portalListed,
      shareToken,
      privateLinkNamespace,
      category,
      portalCategory,
      canonicalPath,
      publishedUrl
    },
    content,
    assets,
    source: {
      notionPageId: page.id,
      notionDatabaseId: config.notionDatabaseId,
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
      url: page.url
    },
    validation: emptyValidation()
  };

  document.validation.errors.push(...errors);
  document.validation.warnings.push(...warnings);
  document.validation.ok = document.validation.errors.length === 0;
  return document;
}

export function richTextToPlain(richText: unknown): string {
  return richTextToSpans(richText).map((span) => span.text).join("");
}

export function richTextToSpans(richText: unknown): RichTextSpan[] {
  if (!Array.isArray(richText)) {
    return [];
  }
  return richText.map((item) => {
    const value = item as Record<string, unknown>;
    const annotations = (value.annotations as Record<string, unknown> | undefined) ?? {};
    return {
      text: typeof value.plain_text === "string" ? value.plain_text : "",
      href: typeof value.href === "string" ? value.href : undefined,
      bold: annotations.bold === true,
      italic: annotations.italic === true,
      underline: annotations.underline === true,
      strike: annotations.strikethrough === true,
      code: annotations.code === true
    };
  });
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function readTitle(property: PropertyValue | undefined, name: string, errors: ValidationIssue[]): string {
  if (!property || property.type !== "title") {
    errors.push(issue("INVALID_PROPERTY_TYPE", `${name} must be a Notion title property.`, name));
    return "";
  }
  const value = richTextToPlain(property.title).trim();
  if (!value) {
    errors.push(issue("MISSING_REQUIRED_PROPERTY", `${name} is required.`, name));
  }
  return value;
}

function readRichTextScalar(
  property: PropertyValue | undefined,
  name: string,
  errors: ValidationIssue[],
  required: boolean
): string {
  if (!property || property.type !== "rich_text") {
    errors.push(issue("INVALID_PROPERTY_TYPE", `${name} must be a Notion rich_text property.`, name));
    return "";
  }
  const value = richTextToPlain(property.rich_text).trim();
  if (required && !value) {
    errors.push(issue("MISSING_REQUIRED_PROPERTY", `${name} is required.`, name));
  }
  return value;
}

function readSelect(property: PropertyValue | undefined, name: string, errors: ValidationIssue[]): string {
  if (!property || property.type !== "select") {
    errors.push(issue("INVALID_PROPERTY_TYPE", `${name} must be a Notion select property.`, name));
    return "";
  }
  const select = property.select as { name?: string } | null | undefined;
  const value = select?.name?.trim() ?? "";
  if (!value) {
    errors.push(issue("MISSING_REQUIRED_PROPERTY", `${name} is required.`, name));
  }
  return value;
}

function readCheckbox(property: PropertyValue | undefined, name: string, errors: ValidationIssue[]): boolean {
  if (!property || property.type !== "checkbox") {
    errors.push(issue("INVALID_PROPERTY_TYPE", `${name} must be a Notion checkbox property.`, name));
    return false;
  }
  return property.checkbox === true;
}

function readOptionalCheckbox(property: PropertyValue | undefined): boolean {
  return property?.type === "checkbox" && property.checkbox === true;
}

function readOptionalRichText(property: PropertyValue | undefined): string {
  if (!property || property.type !== "rich_text") return "";
  return richTextToPlain(property.rich_text).trim();
}

function readOptionalSelect(property: PropertyValue | undefined): string {
  if (!property || property.type !== "select") return "";
  const select = property.select as { name?: string } | null | undefined;
  return select?.name?.trim() ?? "";
}

function readOptionalUrl(property: PropertyValue | undefined): string {
  if (!property || property.type !== "url") return "";
  return typeof property.url === "string" ? property.url.trim() : "";
}

// Backward-compat alias — prefer VALID_PRIVATE_LINK_NAMESPACES from model/document.ts
export { VALID_PRIVATE_LINK_NAMESPACES as VALID_NAMESPACES } from "../model/document.js";

export function computeCanonicalPath(
  visibility: string,
  docId: string,
  shareToken: string,
  privateLinkNamespace: string
): string {
  if (!docId) return "";
  const v = normalizeVisibility(visibility);
  if (v === "client") {
    return shareToken ? `/clients/${shareToken}/` : "";
  }
  if (v === "internal") {
    return shareToken ? `/internal/${shareToken}/` : "";
  }
  if (v === "unlisted") {
    if (!shareToken) return "";
    const ns = VALID_PRIVATE_LINK_NAMESPACES.has(privateLinkNamespace) ? privateLinkNamespace : "clients";
    return `/${ns}/${shareToken}/`;
  }
  return `/docs/${docId}/`;
}

export function inferPrivateLinkNamespace(clientLabel: string, category: string, documentTypeLabel: string): string {
  const cl = clientLabel.trim().toLowerCase();
  const cat = category.trim().toLowerCase();
  const dt = documentTypeLabel.trim().toLowerCase();
  if (cl === "internal" || cl.includes("内部")) return "internal";
  if (cat.includes("内部管理") || cat.includes("internal") || cat.includes("admin")) return "internal";
  if (dt.includes("agreement") && cl !== "internal") return "partners";
  if (cat.includes("合作") || cat.includes("渠道") || cat.includes("供应商") || cat.includes("partner")) return "partners";
  return "clients";
}

export function inferPortalCategory(documentTypeLabel: string, category: string, brand: string, project: string): string {
  const dt = documentTypeLabel.trim().toLowerCase();
  const cat = category.trim().toLowerCase();
  const bp = `${brand} ${project}`.toLowerCase();
  if (dt.includes("report")) return "Reports";
  if (dt.includes("specification") || dt.includes("spec") || dt.includes("guide")) return "Technical";
  if (dt.includes("agreement")) return "Partners";
  if (dt.includes("proposal")) return "Investor";
  if (dt.includes("memo")) return "Other";
  if (cat.includes("投资") || cat.includes("融资") || cat.includes("investor")) return "Investor";
  if (cat.includes("法务") || cat.includes("合同")) return "Partners";
  if (cat.includes("ems") || cat.includes("snowbot 工程") || cat.includes("snowbot 各模块")) return "Technical";
  if (cat.includes("bess")) return "Products";
  if (cat.includes("内部") || cat.includes("归档") || cat.includes("暂停")) return "Other";
  if (bp.includes("bess") || bp.includes("product")) return "Products";
  if (bp.includes("spec") || bp.includes("technical") || bp.includes("工程")) return "Technical";
  return "Other";
}

export { VALID_PORTAL_CATEGORIES } from "../model/document.js";

function blocksToDocumentBlocks(blocks: NotionBlock[], pageId: string, warnings: ValidationIssue[]): DocumentBlock[] {
  const result: DocumentBlock[] = [];
  for (const block of blocks) {
    const data = block[block.type] as Record<string, unknown> | undefined;
    switch (block.type) {
      case "paragraph":
      case "heading_1":
      case "heading_2":
      case "heading_3":
      case "heading_4":
      case "bulleted_list_item":
      case "numbered_list_item":
      case "quote":
      case "callout":
        result.push({ type: block.type, id: block.id, richText: richTextToSpans(data?.rich_text) } as DocumentBlock);
        break;
      case "code":
        result.push({ type: "code", id: block.id, richText: richTextToSpans(data?.rich_text), language: stringValue(data?.language) });
        break;
      case "divider":
        result.push({ type: "divider", id: block.id });
        break;
      case "image":
      case "file": {
        const source = assetUrl(data);
        if (!source) {
          warnings.push(issue("MISSING_ASSET_URL", `${block.type} block has no usable URL.`, "content", pageId, block.id));
          result.push({ type: "unsupported", id: block.id, notionType: block.type, message: `${block.type} block has no usable URL.` });
          break;
        }
        const caption = richTextToSpans(data?.caption);
        const name = assetName(source, block.id);
        result.push({
          type: block.type,
          id: block.id,
          asset: {
            sourceUrl: source,
            outputPath: name,
            kind: block.type,
            notionBlockId: block.id,
            alt: caption.map((span) => span.text).join("") || undefined,
            caption,
            local: false
          }
        });
        break;
      }
      case "table":
        result.push({ type: "table", id: block.id, rows: tableRows(block) });
        break;
      default:
        result.push({
          type: "unsupported",
          id: block.id,
          notionType: block.type,
          message: `Unsupported Notion block type: ${block.type}`
        });
        warnings.push(issue("UNSUPPORTED_BLOCK", `Unsupported Notion block type: ${block.type}`, "content", pageId, block.id));
    }
  }
  return result;
}

function tableRows(block: NotionBlock): RichTextSpan[][][] {
  const children = block.children;
  if (!Array.isArray(children)) {
    return [];
  }
  return children
    .filter((child): child is NotionBlock => typeof child === "object" && child !== null && (child as NotionBlock).type === "table_row")
    .map((child) => {
      const data = child.table_row as Record<string, unknown> | undefined;
      const cells = Array.isArray(data?.cells) ? data.cells : [];
      return cells.map((cell) => richTextToSpans(cell));
    });
}

function assetUrl(data: Record<string, unknown> | undefined): string | undefined {
  const type = stringValue(data?.type);
  if (type === "external") {
    return stringValue((data?.external as Record<string, unknown> | undefined)?.url);
  }
  if (type === "file") {
    return stringValue((data?.file as Record<string, unknown> | undefined)?.url);
  }
  return undefined;
}

function assetName(sourceUrl: string, blockId: string): string {
  try {
    const url = new URL(sourceUrl);
    const name = url.pathname.split("/").filter(Boolean).pop();
    if (name) {
      return name.replace(/[^A-Za-z0-9._-]/g, "-");
    }
  } catch {
    // fall through
  }
  return `${blockId.replace(/[^A-Za-z0-9_-]/g, "")}.bin`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function issue(code: string, message: string, path?: string, pageId?: string, notionBlockId?: string): ValidationIssue {
  return { code, message, path, pageId, notionBlockId };
}
