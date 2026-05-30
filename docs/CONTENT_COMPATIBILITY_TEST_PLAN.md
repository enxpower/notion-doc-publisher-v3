# Content Compatibility Test Plan

## Purpose

Define one controlled Notion sandbox document that exercises the currently supported V3 MVP block types and verifies rendering, validation, build output, screen presentation, and print preview behavior.

This plan does not add features. It defines a manual compatibility fixture for the current implementation.

## Sandbox Document

Create one Notion page in the development master database with these properties:

| Property | Value |
| --- | --- |
| `Title` | `V3 Content Compatibility Fixture` |
| `DOC_ID` | Assigned by `npm run assign-id` or manually set to a valid sandbox ID |
| `Brand` | A brand with a configured token |
| `Client` | `Internal` or another configured select value |
| `Project` | `V3 Compatibility` |
| `Document Type` | A type with a configured token |
| `Version` | `v0.1` |
| `Status` | A value included in `PUBLISHABLE_STATUSES` |
| `Visibility` | A value included in `ALLOWED_VISIBILITY` |
| `Publish` | `true` |

Use only a non-production Notion database.

## Required Page Body Structure

The page body should contain these blocks in order:

1. `heading_1`: `1. Executive Summary`
2. `paragraph`: Plain paragraph with bold, italic, inline code, and one HTTPS link.
3. `heading_2`: `1.1 Scope`
4. `bulleted_list_item`: Three bullet items.
5. `numbered_list_item`: Three numbered items.
6. `quote`: One short legal-style quote.
7. `callout`: One operational note.
8. `code`: A short code block with preserved whitespace.
9. `divider`
10. `heading_2`: `2. Evidence`
11. `image`: One small image with a caption.
12. `file`: One downloadable file link with a caption or readable file name.
13. `table`: A straightforward table with 3 columns and 3 rows.
14. `heading_3`: `2.1 Closing Notes`
15. `paragraph`: Final paragraph.

## Supported Blocks

The current V3 MVP supports:

- `paragraph`
- `heading_1`
- `heading_2`
- `heading_3`
- `bulleted_list_item`
- `numbered_list_item`
- `quote`
- `callout`
- `code`
- `divider`
- `image`
- `file`
- `table` when table rows are straightforward

## Unsupported Blocks

The compatibility fixture should include a separate draft-only page, not the publishable fixture, with representative unsupported blocks:

- Toggle
- Child page
- Bookmark
- Embed
- Synced block
- Equation
- Column layout
- Database view

Expected behavior:

- If `Publish=false`, unsupported blocks may render as clear draft warnings.
- If `Publish=true` and the document is otherwise publishable, unsupported blocks must produce validation errors and block build output for that document.

## Expected HTML Rendering

Expected document page:

```text
dist/docs/{DOC_ID}/index.html
```

Expected rendering behavior:

- The masthead displays brand on the left and `ENGINEERED FOR EXTREME CONDITIONS` on the right.
- `DOC_ID` appears prominently above or near the title.
- Title renders as the only `h1`.
- Notion `heading_1`, `heading_2`, and `heading_3` render below the title as lower-level HTML headings.
- Paragraph rich text preserves bold, italic, inline code, and links.
- Bullet and numbered lists render as `ul` and `ol`.
- Quote renders as `blockquote`.
- Callout renders as a restrained callout block.
- Code block preserves whitespace inside `pre > code`.
- Divider renders as `hr`.
- Image renders inside `figure` with `img` and optional caption.
- File renders as a link.
- Table renders as a simple HTML table inside a horizontal overflow wrapper.

## Expected Validation Behavior

For the publishable compatibility fixture:

- `validation-report.json` contains zero errors.
- Missing required metadata is an error.
- Malformed `DOC_ID` is an error.
- Duplicate `DOC_ID` is an error.
- Missing brand or document type token is an error.
- Unsupported blocks are errors because the document is publishable.
- Missing or uncopyable local assets are errors for publishable output.

For skipped records:

- `Publish=false` records do not block build.
- `Publish=true` with non-publishable status produces a warning and is skipped.
- `Publish=true` with disallowed visibility produces a warning and is skipped.

## Expected Build Output

After `npm run build`, expected files:

```text
dist/index.html
dist/docs/{DOC_ID}/index.html
dist/assets/css/screen.css
dist/assets/css/print.css
dist/assets/docs/{DOC_ID}/...
dist/reports/build-report.json
dist/reports/validation-report.json
```

Expected report behavior:

- `build-report.json` includes the compatibility fixture in `documents`.
- `build-report.json` has zero errors.
- `validation-report.json` has zero errors for the fixture.
- Warnings are acceptable only for intentionally skipped non-publishable sandbox records.

## Manual Visual QA Checklist

Open `dist/docs/{DOC_ID}/index.html` in a browser and verify:

- Page appears as a centered white paper document on a light gray background.
- Masthead is formal and restrained.
- Document ID is easy to find.
- Title hierarchy is clear and serious.
- Metadata does not look like a spreadsheet.
- Body text is readable and contract-like.
- Lists align cleanly.
- Callout and quote styling is restrained.
- Code block is readable without dominating the page.
- Image scales within the document width.
- File link is visible and understandable.
- Table is readable and does not break the layout.
- Unsupported draft warnings, if viewed on a draft page, are clear and not silent.
- Index page looks like a document register, not a SaaS dashboard.

## Print Preview QA Checklist

Use browser print preview on `dist/docs/{DOC_ID}/index.html` and verify:

- Paper target is A4.
- Margins are 18mm.
- No browser header/footer dependency is required.
- Page card border and shadow are absent.
- Masthead is preserved.
- Title and metadata print cleanly.
- Headings do not appear alone at the bottom of a page.
- Table rows avoid breaking where possible.
- Wide table content uses the configured shrink/overflow behavior acceptably.
- Images are no wider than the printable area.
- Code blocks wrap or fit without clipping important content.
- Links remain readable.

## Pass Criteria

The compatibility pass succeeds when:

- `npm run validate` exits successfully.
- `npm run build` exits successfully.
- The publishable fixture is emitted at `dist/docs/{DOC_ID}/index.html`.
- Reports contain zero errors for the fixture.
- All supported block types render visibly and correctly.
- Unsupported publishable blocks fail validation.
- Unsupported draft blocks produce visible warnings.
- Manual visual QA checklist passes.
- Print preview QA checklist passes.

## Fail Criteria

The compatibility pass fails when:

- A supported block is missing from output.
- A supported block renders as an unsupported warning.
- A publishable unsupported block does not block validation.
- A publishable document depends on remote-only assets.
- Metadata or title hierarchy is unclear.
- Table, image, or code block breaks the document layout.
- Print preview clips content or produces unusable page breaks.
- Build emits the document under any path other than `dist/docs/{DOC_ID}/index.html`.
