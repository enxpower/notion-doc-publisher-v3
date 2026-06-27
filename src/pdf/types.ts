export type BrandInfo = {
  displayName: string;
  tagline: string;
};

// ── Queue types ───────────────────────────────────────────────────────────────

export type PdfResultStatus = "generated" | "failed" | "skipped";

export type PdfDocResult = {
  docId: string;
  pageId: string;
  status: PdfResultStatus;
  typPath: string | null;
  pdfPath: string | null;
  url: string | null;
  error: string | null;
};

export type QueueReport = {
  mode: "single" | "all";
  writeback: boolean;
  results: PdfDocResult[];
};

export type QueueOptions = {
  writeback: boolean;
  outDir: string;
  runUrl: string | null;
};

// ── Writeback payload ─────────────────────────────────────────────────────────

export type PdfWritebackPayload = {
  generatePdf?: boolean;
  pdfStatus?: "Queued" | "Generating" | "Generated" | "Failed";
  pdfUrl?: string | null;
  pdfGeneratedAt?: string | null;
  pdfError?: string | null;
};
