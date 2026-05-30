# Notion Schema

## Overview

V1 uses one master Notion database as the source of truth for all publishable documents. Each database row is one document. The Notion page body is the document content.

The database should stay small and easy for authors to understand. It should capture document identity and publishing metadata only.

## Required Properties

| Property | Type | Required | Owner | Notes |
| --- | --- | --- | --- | --- |
| `Title` | `title` | Yes | User | Human-readable document title and the single Notion title property. |
| `DOC_ID` | `rich_text` scalar | Yes after assignment | System | Assigned only by the explicit ID assignment command. |
| `Brand` | `select` | Yes | User | Brand or company namespace for ID and presentation. |
| `Client` | `select` | Yes | User | Client name; may be `Internal` for internal documents. |
| `Project` | `select` | Yes | User | Project, program, or workstream name. |
| `Document Type` | `select` | Yes | User | Type token used in `DOC_ID`. |
| `Version` | `select` | Yes | User | Semantic document version, stored separately from `DOC_ID`. |
| `Status` | `select` | Yes | User | Draft/publishing lifecycle state. |
| `Visibility` | `select` | Yes | User | Intended audience or hosting scope. |
| `Publish` | `checkbox` | Yes | User | Explicit publish flag. |

These property types are frozen for V1. The implementation should not support alternate property types unless the architecture is revised first.

`DOC_ID` is a scalar rich text value. It must contain exactly one plain text ID value after trimming. Multiple rich text spans are acceptable only if their concatenated plain text is exactly one valid `DOC_ID`; links, mentions, and formatting in `DOC_ID` have no semantic meaning and should be rejected if they prevent scalar extraction.

## Recommended Select Values

### Brand

Brand values should be short, stable labels. Each value must map to an uppercase ID token.

Examples:

| Display | ID token |
| --- | --- |
| `ARCBOS` | `ARCBOS` |
| `ENERGIZE` | `ENERGIZE` |
| `AGIM` | `AGIM` |

### Document Type

Document type values should map to short uppercase type tokens.

Examples:

| Display | ID token | Use |
| --- | --- | --- |
| `Agreement` | `AGR` | Contracts, agreements, statements of work. |
| `Specification` | `SPEC` | Product, technical, or delivery specs. |
| `Memo` | `MEM` | Internal or client-facing memos. |
| `Proposal` | `PROP` | Commercial or project proposals. |
| `Report` | `RPT` | Status, research, or delivery reports. |
| `Guide` | `GUIDE` | Operating guides or instructions. |

The allowed list may grow, but each document type must have one stable token.

### Version

Supported format:

```text
vMAJOR.MINOR
```

Examples:

```text
v0.1
v1.0
v1.1
v2.0
```

Version is not part of `DOC_ID`.

### Status

Recommended V1 values:

| Value | Publishable | Meaning |
| --- | --- | --- |
| `Draft` | No | Work in progress. |
| `Review` | No | Ready for human review outside the system. |
| `Final` | Yes | Approved by the authoring process. |
| `Archived` | No | Retained but not published. |

V1 does not implement approval workflow. `Status` is metadata and validation input only.

### Visibility

Recommended V1 values:

| Value | Meaning |
| --- | --- |
| `Public` | Safe for public static hosting. |
| `Client` | Intended for a client-facing but controlled site. |
| `Internal` | Internal document; should not be emitted to public output by default. |

V1 should be conservative: only `Public` and explicitly configured client output should be published.

### Publish

`Publish` is a checkbox. A document is publishable only when:

- `Publish` is checked.
- `Status` is `Final`.
- `Visibility` is allowed by the current build target.
- Validation passes.

## DOC_ID Generation

Format:

```text
BRAND-TYPE-YYMM-SEQ4
```

Where:

- `BRAND` comes from the mapped `Brand` token.
- `TYPE` comes from the mapped `Document Type` token.
- `YYMM` is the generation year and month.
- `SEQ4` is a zero-padded four-digit sequence.

Examples:

```text
ARCBOS-AGR-2605-0039
ENERGIZE-SPEC-2605-0040
AGIM-MEM-2605-0041
```

Generation rules:

- Assign `DOC_ID` only through an explicit command, separate from `validate` and `build`.
- `validate` and normal `build` are read-only by default and must not write `DOC_ID` values.
- Assign `DOC_ID` only when the field is empty.
- Never regenerate an existing valid `DOC_ID` automatically.
- Reject an existing malformed `DOC_ID` instead of overwriting it.
- Malformed `DOC_ID` values block publishable output.
- Sequence numbers are scoped by `YYMM` globally across all brands and document types.
- For a given `YYMM`, the sequence is the next number after the highest existing valid `SEQ4` in that `YYMM`.
- `YYMM` should default to the current build month, with an optional environment override such as `DOC_ID_YEAR_MONTH` for deterministic testing.
- The generator must detect collisions before writing.
- `DOC_ID` values are never reused, including after archive or deletion.
- Deleted pages are not a source for new assignments, so operators must keep an ID ledger or avoid deletion if strict deletion history is required.
- Existing valid `DOC_ID` values are never overwritten.
- Brand or document type changes after assignment do not change `DOC_ID`.
- A valid `DOC_ID` whose brand/type tokens no longer match current metadata should warn but should not be rewritten automatically.
- If the next scoped sequence would exceed `9999`, assignment must fail for that `YYMM`.
- The assignment command must show a dry-run assignment plan before writing.
- Assignment is fail-fast. If any candidate has a malformed existing ID, missing token mapping, sequence overflow, or collision, no IDs should be written.
- The assignment command must re-query the database immediately before writing and fail if the planned IDs are no longer available.
- Concurrent assignment conflicts are resolved by failing the later command, not by overwriting or automatically choosing a new sequence after partial writes.

## Page Body Content

The Notion page body is the document content. V1 should support a practical subset first:

- Paragraphs
- Headings 1-3
- Bulleted lists
- Numbered lists
- To-do blocks as read-only checklist rows
- Quotes
- Callouts
- Dividers
- Tables where the Notion API exposes stable table blocks
- Images and files where download and static asset handling are configured
- Code blocks as preformatted text

Unsupported blocks should produce a clear validation warning or a documented fallback. They should not silently disappear.

## Validation Rules

V1 schema validation should fail a document when:

- A required property is missing or empty.
- `DOC_ID` exists but does not match `^[A-Z0-9]+-[A-Z0-9]+-[0-9]{4}-[0-9]{4}$`.
- A publishable document has a missing `DOC_ID`.
- Duplicate `DOC_ID` values exist in the database snapshot.
- `Version` does not match `^v[0-9]+\\.[0-9]+$`.
- `Brand` has no configured ID token.
- `Document Type` has no configured ID token.
- `Publish` is checked but `Status` is not `Final`.
- `Publish` is checked but `Visibility` is not allowed for the active target.
- The page body has no meaningful content.
- The generated output path would collide with another document.
- A publishable document references a required remote Notion asset that has not been copied locally.

Validation may warn, rather than fail, for:

- Missing optional description or summary fields if added later.
- Unsupported visual styling on rich text.
- Blocks that can be rendered as plain text fallbacks.
- A valid `DOC_ID` brand/type token no longer matches current `Brand` or `Document Type` metadata.

## Environment Configuration

Initial development should use non-production Notion resources.

Expected environment variables:

| Variable | Purpose |
| --- | --- |
| `NOTION_TOKEN` | Notion integration token for the development database. |
| `NOTION_DATABASE_ID` | Master development database ID. Do not use production V2 database IDs initially. |
| `TARGET_SITE_DOMAIN` | Optional canonical domain for output metadata. |
| `DOC_ID_YEAR_MONTH` | Optional deterministic `YYMM` override for ID generation. |

Deployment variables are intentionally out of V1. A deploy target should not be part of the initial schema or command contract.

## What The Schema Must Not Become

The master database should not add CRM-like structures in V1:

- No account ownership model.
- No contact database relation.
- No deal or opportunity fields.
- No approval assignment fields.
- No task management fields.
- No workflow automation fields.

If those needs appear later, they should be external references or optional integrations, not the core document schema.
