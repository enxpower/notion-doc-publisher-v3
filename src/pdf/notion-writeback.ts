/**
 * Isolated PDF field writeback — touches ONLY these 5 Notion properties:
 *   Generate PDF, PDF Status, PDF URL, PDF Generated At, PDF Error
 *
 * No other Notion fields are read or written by this module.
 * Does NOT reuse or call the existing preview writeback path.
 */
import { NotionClient } from "../notion/client.js";
import { UserFacingError } from "../config.js";
import type { AppConfig } from "../config.js";
import type { PdfWritebackPayload } from "./types.js";

export const REQUIRED_PDF_PROPERTIES = [
  "Generate PDF",
  "PDF Status",
  "PDF URL",
  "PDF Generated At",
  "PDF Error",
] as const;

export type RequiredPdfProperty = (typeof REQUIRED_PDF_PROPERTIES)[number];

/**
 * Queries the Notion database schema and throws a UserFacingError listing any
 * missing required PDF properties.  Call once at queue startup.
 */
export async function validatePdfSchema(config: AppConfig): Promise<void> {
  const client = new NotionClient(config);
  let db;
  try {
    db = await client.retrieveDatabase();
  } catch (err) {
    throw new UserFacingError(
      `Could not retrieve Notion database schema to validate PDF fields: ${String(err)}\n` +
      `Check that NOTION_TOKEN has access to database ${config.notionDatabaseId}.`
    );
  }
  const missing = REQUIRED_PDF_PROPERTIES.filter((p) => !(p in db.properties));
  if (missing.length > 0) {
    throw new UserFacingError(
      `PDF Publisher 2.0 requires these Notion properties that are missing from the database:\n` +
      missing.map((p) => `  • "${p}"`).join("\n") +
      `\n\nAdd them to your Notion database and try again.\n` +
      `See docs/PDF_PUBLISHER_2.md for the required schema.`
    );
  }
}

/**
 * Builds the Notion properties patch object from a PdfWritebackPayload.
 * Exported for unit testing — does not touch Notion.
 * Only keys present in the payload are included.
 */
export function buildPdfProperties(payload: PdfWritebackPayload): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  if (payload.generatePdf !== undefined) {
    properties["Generate PDF"] = { checkbox: payload.generatePdf };
  }
  if (payload.pdfStatus !== undefined) {
    properties["PDF Status"] = { select: { name: payload.pdfStatus } };
  }
  if (payload.pdfUrl !== undefined) {
    properties["PDF URL"] = payload.pdfUrl !== null ? { url: payload.pdfUrl } : { url: null };
  }
  if (payload.pdfGeneratedAt !== undefined) {
    properties["PDF Generated At"] = payload.pdfGeneratedAt !== null
      ? { date: { start: payload.pdfGeneratedAt } }
      : { date: null };
  }
  if (payload.pdfError !== undefined) {
    properties["PDF Error"] = {
      rich_text: payload.pdfError !== null
        ? [{ type: "text", text: { content: payload.pdfError.slice(0, 2000) } }]
        : [],
    };
  }

  return properties;
}

/**
 * Updates ONLY the PDF-specific fields for one Notion page.
 * Keys not present in the payload are left untouched.
 */
export async function writePdfResult(
  pageId: string,
  payload: PdfWritebackPayload,
  config: AppConfig,
): Promise<void> {
  const properties = buildPdfProperties(payload);
  if (Object.keys(properties).length === 0) return;
  const client = new NotionClient(config);
  await client.updatePageProperties(pageId, properties);
}
