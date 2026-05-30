export type RichTextSpan = {
  text: string;
  href?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
};

export type EntityRef = {
  label: string;
  token?: string;
  slug: string;
};

export type DocumentTypeRef = {
  label: string;
  token: string;
  slug: string;
};

export type DocumentMeta = {
  docId: string;
  title: string;
  brand: EntityRef;
  client: EntityRef;
  project: EntityRef;
  documentType: DocumentTypeRef;
  version: string;
  status: string;
  visibility: string;
  publish: boolean;
  canonicalPath: string;
};

export type DocumentAsset = {
  sourceUrl: string;
  outputPath: string;
  kind: "image" | "file";
  notionBlockId?: string;
  alt?: string;
  caption?: RichTextSpan[];
  contentType?: string;
  local: boolean;
};

export type DocumentBlock =
  | { type: "paragraph"; id: string; richText: RichTextSpan[] }
  | { type: "heading_1" | "heading_2" | "heading_3"; id: string; richText: RichTextSpan[] }
  | { type: "bulleted_list_item" | "numbered_list_item"; id: string; richText: RichTextSpan[] }
  | { type: "quote" | "callout"; id: string; richText: RichTextSpan[] }
  | { type: "code"; id: string; richText: RichTextSpan[]; language?: string }
  | { type: "divider"; id: string }
  | { type: "image" | "file"; id: string; asset: DocumentAsset }
  | { type: "table"; id: string; rows: RichTextSpan[][][] }
  | { type: "unsupported"; id: string; notionType: string; message: string };

export type SourceInfo = {
  notionPageId: string;
  notionDatabaseId: string;
  lastEditedTime?: string;
  createdTime?: string;
  url?: string;
};

export type ValidationIssue = {
  code: string;
  message: string;
  path?: string;
  notionBlockId?: string;
  docId?: string;
  pageId?: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type DocumentModel = {
  meta: DocumentMeta;
  content: DocumentBlock[];
  assets: DocumentAsset[];
  source: SourceInfo;
  validation: ValidationResult;
};

export type BuildReport = {
  generatedAt: string;
  documents: Array<{
    docId: string;
    title: string;
    path: string;
    status: string;
    visibility: string;
    publish: boolean;
  }>;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export function emptyValidation(): ValidationResult {
  return { ok: true, errors: [], warnings: [] };
}
