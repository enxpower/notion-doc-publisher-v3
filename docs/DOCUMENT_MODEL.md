# Document Model

## Purpose

The document model is the internal normalized representation between Notion and rendered output. It isolates the renderer from raw Notion API shapes and keeps validation independent of HTML templates.

Raw Notion data should not leak into templates. Templates receive a validated render context built from this model.

## Model Shape

```ts
type DocumentModel = {
  meta: DocumentMeta;
  content: DocumentBlock[];
  assets: DocumentAsset[];
  source: SourceInfo;
  validation: ValidationResult;
};
```

This is an architectural shape, not an implementation commitment to exact TypeScript names.

## Metadata

```ts
type DocumentMeta = {
  docId: string;
  title: string;
  brand: EntityRef;
  client: EntityRef;
  project: EntityRef;
  documentType: DocumentTypeRef;
  version: string;
  status: "Draft" | "Review" | "Final" | "Archived";
  visibility: "Public" | "Client" | "Internal";
  publish: boolean;
  canonicalPath: string;
};
```

### Entity References

Brands, clients, and projects should be normalized into small references:

```ts
type EntityRef = {
  label: string;
  token?: string;
  slug: string;
};
```

`token` is required for `Brand` and `Document Type` because they participate in `DOC_ID`. Client and project do not need ID tokens in V1. Their slugs are useful for indexes and display grouping, but not for canonical document paths.

### Document Type Reference

```ts
type DocumentTypeRef = {
  label: string;
  token: string;
  slug: string;
};
```

Examples:

- `Agreement` -> `AGR` -> `agreement`
- `Specification` -> `SPEC` -> `specification`
- `Memo` -> `MEM` -> `memo`

## Content Blocks

V1 should support a focused block set that maps cleanly from Notion to static HTML.

```ts
type DocumentBlock =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | TodoBlock
  | QuoteBlock
  | CalloutBlock
  | DividerBlock
  | TableBlock
  | ImageBlock
  | FileBlock
  | CodeBlock
  | UnsupportedBlock;
```

Each block should carry:

- A stable local block ID.
- The original Notion block ID for traceability.
- Normalized children where the block type supports nesting.
- Rich text spans where inline formatting exists.

## Rich Text

Rich text should normalize Notion annotations into renderer-neutral spans:

```ts
type TextSpan = {
  text: string;
  href?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
};
```

V1 should support bold, italic, underline, strikethrough, inline code, and links. Notion color annotations may be ignored or mapped conservatively to CSS classes later.

## Assets

Assets are files required by the rendered document:

```ts
type DocumentAsset = {
  sourceUrl: string;
  outputPath: string;
  kind: "image" | "file";
  alt?: string;
  caption?: TextSpan[];
  contentType?: string;
};
```

Publishable V1 output requires local asset copying. Remote Notion file URLs are allowed only for draft preview output because Notion signed URLs can expire and are not reliable for static hosting or PDF generation.

## Source Info

```ts
type SourceInfo = {
  notionPageId: string;
  notionDatabaseId: string;
  lastEditedTime?: string;
  createdTime?: string;
  url?: string;
};
```

Source info is for diagnostics, traceability, and build logs. It should not be exposed in public output unless explicitly rendered as metadata.

## Validation Result

```ts
type ValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

type ValidationIssue = {
  code: string;
  message: string;
  path?: string;
  notionBlockId?: string;
};
```

Validation should run before rendering. A document with errors should not produce publishable output. Warnings may be shown in build logs while still rendering.

## DOC_ID In The Model

`docId` is immutable once assigned. The model should treat it as the stable document identity.

Format:

```text
BRAND-TYPE-YYMM-SEQ4
```

Version is separate and should never be concatenated into `docId`.

The renderer may display version near the title or metadata table, but it must not change links, output identity, or ID generation.

Brand or document type changes after assignment do not change `docId`. If current metadata no longer matches the brand/type tokens embedded in a valid `docId`, the model should carry a validation warning rather than rewriting the ID.

## Output Path Derivation

The canonical document path should be deterministic. Recommended V1 pattern:

```text
/docs/{docId}/
```

Example:

```text
/docs/ARCBOS-AGR-2605-0039/
```

The exact static file path is defined in `docs/OUTPUT_SPEC.md`. The document model should expose the canonical path so index generation and rendering use the same value. Brand, client, project, and document type labels may be used for index grouping, but they must not affect canonical URLs in V1.

## Rendering Context

Templates should receive a render context derived from `DocumentModel`:

```ts
type RenderContext = {
  meta: DocumentMeta;
  blocks: DocumentBlock[];
  assets: DocumentAsset[];
  site: SiteConfig;
};
```

The render context should contain only validated, display-ready values. It should not require templates to know about Notion property names.

## Normalization Rules

Normalization should:

- Trim leading and trailing whitespace in metadata.
- Preserve meaningful whitespace in code blocks.
- Convert labels to slugs using a single slug function.
- Convert configured brands and document types to tokens.
- Flatten or nest Notion list blocks into predictable list structures.
- Preserve heading levels 1-3.
- Preserve link targets.
- Capture unsupported blocks as `UnsupportedBlock` with enough detail for a validation message.

## Validation Rules

Document model validation should fail when:

- `meta.docId` is missing or malformed.
- Another document in the same database snapshot has the same `meta.docId`.
- `meta.title` is empty.
- `meta.brand.token` is missing.
- `meta.documentType.token` is missing.
- `meta.version` is malformed.
- `meta.publish` is true but `meta.status` is not `Final`.
- `meta.publish` is true but visibility is not allowed for the target.
- `content` has no renderable blocks.
- Required assets cannot be resolved.
- The canonical path collides with another document.
- A publishable document depends on remote-only Notion assets.

It should warn when:

- Unsupported blocks have plain text fallbacks.
- Rich text annotations are not fully represented.
- Remote assets are used in draft preview output.
- A valid `DOC_ID` token no longer matches current brand or document type metadata.

## Future Extensions

The model can later support:

- Document summaries.
- Tags.
- Related documents.
- Revision history metadata.
- Multiple render themes.
- Brand design tokens.
- Search index fields.
- PDF-specific render hints.

These should be additive fields. They should not change the core rule that Notion remains the only editing source.

Future extension points must not be scaffolded in V1 unless the implementation needs them for the static HTML publisher. V1 should implement only the minimal model required for Notion normalization, validation, rendering, local assets, and stable output paths.
