import fs from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config.js";
import type { DocumentModel } from "../model/document.js";
import { exportDocumentTypst } from "../pdf/export-pdf.js";
import type { BrandRoute } from "./brand-routing.js";

export const MIN_ROUTED_PDF_BYTES = 256;

export type RoutedPdfRendererInput = {
  document: DocumentModel;
  config: AppConfig;
  route: BrandRoute;
  outputPdfPath: string;
  workDir: string;
};

export type RoutedPdfRenderer = (input: RoutedPdfRendererInput) => Promise<void>;

export type PdfInspectionResult = {
  ok: boolean;
  byteSize: number;
  pageCount: number;
  errorCode?: string;
  errorMessage?: string;
};

export async function renderRoutedDocumentPdf(input: RoutedPdfRendererInput): Promise<void> {
  await fs.mkdir(input.workDir, { recursive: true });
  const result = await exportDocumentTypst(input.document, input.config, input.workDir, {
    onAssetError: () => undefined,
    logCompileOutput: false
  });
  if (!result.pdfPath) {
    throw new Error("Typst is not available for PDF rendering.");
  }

  await fs.mkdir(path.dirname(input.outputPdfPath), { recursive: true });
  await fs.copyFile(result.pdfPath, input.outputPdfPath);
}

export async function inspectPdfFile(pdfPath: string): Promise<PdfInspectionResult> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(pdfPath);
  } catch {
    return {
      ok: false,
      byteSize: 0,
      pageCount: 0,
      errorCode: "PDF_MISSING",
      errorMessage: "Expected PDF file was not generated.",
    };
  }

  if (buffer.length < MIN_ROUTED_PDF_BYTES) {
    return {
      ok: false,
      byteSize: buffer.length,
      pageCount: 0,
      errorCode: "PDF_TOO_SMALL",
      errorMessage: "Generated PDF is below the minimum byte-size threshold.",
    };
  }

  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return {
      ok: false,
      byteSize: buffer.length,
      pageCount: 0,
      errorCode: "PDF_INVALID_HEADER",
      errorMessage: "Generated PDF does not have a valid PDF header.",
    };
  }

  const text = buffer.toString("latin1");
  const pageCount = Array.from(text.matchAll(/\/Type\s*\/Page\b/g)).length;
  if (pageCount < 1) {
    return {
      ok: false,
      byteSize: buffer.length,
      pageCount,
      errorCode: "PDF_NO_PAGES",
      errorMessage: "Generated PDF does not contain a detectable page.",
    };
  }

  return {
    ok: true,
    byteSize: buffer.length,
    pageCount,
  };
}

export type FixturePdfRendererOptions = {
  failDocIds?: Set<string>;
  zeroByteDocIds?: Set<string>;
  corruptDocIds?: Set<string>;
  crossBrandDocIds?: Set<string>;
  unsupportedProfileKeys?: Set<string>;
  onRender?: (input: RoutedPdfRendererInput) => void;
};

export function createFixtureRoutedPdfRenderer(options: FixturePdfRendererOptions = {}): RoutedPdfRenderer {
  return async (input) => {
    options.onRender?.(input);

    if (
      input.route.presentationProfileKey &&
      options.unsupportedProfileKeys?.has(input.route.presentationProfileKey)
    ) {
      throw new Error("Unsupported presentation profile for routed PDF rendering.");
    }

    const docId = input.document.meta.docId;
    if (options.failDocIds?.has(docId)) {
      throw new Error("Fixture PDF render failure.");
    }

    if (options.crossBrandDocIds?.has(docId)) {
      const siblingRoot = path.resolve(input.route.outputRoot, "..", "..", "CROSS_BRAND", "site", "pdf");
      await fs.mkdir(siblingRoot, { recursive: true });
      await fs.writeFile(path.join(siblingRoot, `${docId}.pdf`), createFixturePdfBytes());
      return;
    }

    await fs.mkdir(path.dirname(input.outputPdfPath), { recursive: true });
    if (options.zeroByteDocIds?.has(docId)) {
      await fs.writeFile(input.outputPdfPath, Buffer.alloc(0));
      return;
    }

    if (options.corruptDocIds?.has(docId)) {
      await fs.writeFile(input.outputPdfPath, Buffer.from(`not a pdf\n${"x".repeat(MIN_ROUTED_PDF_BYTES + 16)}`));
      return;
    }

    await fs.writeFile(input.outputPdfPath, createFixturePdfBytes());
  };
}

function createFixturePdfBytes(): Buffer {
  const body = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj",
    "4 0 obj << /Length 44 >> stream",
    "BT /F1 12 Tf 72 720 Td (Routed PDF fixture) Tj ET",
    "endstream endobj",
    "xref",
    "0 5",
    "0000000000 65535 f ",
    "0000000010 00000 n ",
    "0000000060 00000 n ",
    "0000000120 00000 n ",
    "0000000210 00000 n ",
    "trailer << /Root 1 0 R /Size 5 >>",
    "startxref",
    "320",
    "%%EOF",
  ].join("\n");

  return Buffer.from(`${body}\n${"0".repeat(Math.max(0, MIN_ROUTED_PDF_BYTES - body.length + 16))}`, "latin1");
}
