# Implementation Plan

## Goal

Implement a lightweight V3 Notion-to-static-document publisher without depending on V2 code. The first implementation should produce validated static HTML from a development Notion database and leave a clean future path for GitHub Pages deployment and Playwright PDF export.

No implementation code exists yet in this plan. This document defines the staged work.

## Guardrails

- Do not modify `notion-publisher-v2`.
- Do not modify `docs-arcbos-v2`.
- Do not modify `docs-energize-v2`.
- Use old systems only as read-only references.
- Do not write to production repositories during initial development.
- Do not change existing GitHub Actions.
- Do not reuse production Notion database IDs during initial development.
- Keep Notion as the only editing source.
- Keep V1 small: no CMS framework, workflow engine, database server, or approval module.
- Do not implement deployment in V1.
- Keep `validate` and normal `build` read-only with respect to Notion.

## Phase 0: Architecture And Fixture Setup

Deliverables:

- Finalize architecture documents in `docs/`.
- Create a development Notion master database with the required properties.
- Confirm test brands, document types, and ID token mappings.
- Populate a few development documents that exercise headings, lists, tables, callouts, images, and code blocks.

Exit criteria:

- Development `NOTION_DATABASE_ID` is not a production V2 database ID.
- Required Notion fields are present with the frozen V1 property types.
- Sample documents can safely receive generated `DOC_ID` values.

## Phase 1: Project Skeleton

Deliverables:

- Add TypeScript configuration.
- Add source directories:
  - `src/config`
  - `src/notion`
  - `src/ids`
  - `src/model`
  - `src/validate`
  - `src/render`
  - `src/build`
- Add build, validate, and development scripts.
- Add a separate explicit ID assignment script only after the read-only validation path exists.
- Add minimal test tooling if useful for ID generation and model validation.

Recommended scripts:

```json
{
  "build": "tsx src/build/build-site.ts",
  "validate": "tsx src/build/validate-site.ts",
  "assign-doc-ids": "tsx src/build/assign-doc-ids.ts",
  "check": "tsc --noEmit"
}
```

Exit criteria:

- Project can type-check.
- Configuration loads safely from environment variables.
- Missing required environment variables fail with clear errors.
- `validate` and `build` do not write to Notion.

## Phase 2: Notion Read Layer

Deliverables:

- Query the master Notion database.
- Read required properties from each page.
- Fetch page block children.
- Normalize Notion rich text into plain internal spans.
- Handle pagination for database and block APIs.

Implementation notes:

- Keep raw Notion API code isolated in `src/notion`.
- Do not let raw API response shapes leak into render templates.
- Log page IDs and titles for diagnostics without exposing tokens.

Exit criteria:

- The system can list development documents.
- The system can fetch page body blocks.
- Unsupported or missing properties produce structured validation issues.

## Phase 3: Explicit DOC_ID Assignment

Deliverables:

- Map `Brand` to brand tokens.
- Map `Document Type` to type tokens.
- Scan existing valid `DOC_ID` values.
- Generate `BRAND-TYPE-YYMM-SEQ4` for pages with missing IDs through an explicit command.
- Write generated IDs back to Notion only for missing `DOC_ID` fields.
- Detect malformed IDs and collisions.

Rules:

- Never overwrite an existing valid `DOC_ID`.
- Never silently replace a malformed `DOC_ID`.
- Keep version separate from `DOC_ID`.
- Use sequence numbers scoped by `YYMM` globally across all brands and document types.
- Never reuse `DOC_ID` values.
- Keep brand/type changes from rewriting `DOC_ID`.
- Fail assignment if the next sequence for a `YYMM` would exceed `9999`.
- Keep `validate` and `build` read-only; only `assign-doc-ids` may write IDs.
- Produce a dry-run assignment plan before mutation.
- Use fail-fast writes: any invalid candidate or collision stops the command before any ID is written.
- Re-query the database immediately before writing and fail on concurrent assignment conflicts.

Exit criteria:

- Missing IDs are generated in the required format.
- Existing IDs remain unchanged.
- Malformed IDs fail validation.
- Sequence behavior is deterministic in tests through `DOC_ID_YEAR_MONTH`.
- The assignment command reports a dry run before writing.
- No partial ID assignment occurs when a candidate fails validation or collision checks.

## Phase 4: Document Model And Validation

Deliverables:

- Convert Notion pages into `DocumentModel`.
- Normalize metadata, content blocks, assets, source info, and validation issues.
- Implement validation for schema, model, and output path uniqueness.

Validation must cover:

- Required fields.
- `DOC_ID` format.
- Version format.
- Brand and document type token mappings.
- Publishability rules.
- Empty content.
- Unsupported block handling.
- Output path collisions.
- Duplicate `DOC_ID` values.
- Remote-only assets on publishable documents.
- Unsafe links and unsupported publish-blocking Notion blocks.

Exit criteria:

- Publishable documents are clearly separated from drafts and invalid documents.
- Build logs explain why each invalid document was skipped or failed.
- Validation can run without writing output.

## Phase 5: Static HTML Renderer

Deliverables:

- Render each validated document to static HTML.
- Render a site index.
- Use `templates/` and `styles/` as the starting point.
- Copy CSS into `dist/assets/css/`.
- Escape text and sanitize links.

Required output path:

```text
dist/docs/{DOC_ID}/index.html
```

Exit criteria:

- Published development documents render to `dist/`.
- The site index links to rendered documents.
- Rendered HTML can be opened locally without a server.
- No client-side JavaScript is required for content.
- Publishable documents use local asset copies.

## Phase 6: Print Quality

Deliverables:

- Improve `styles/print.css` for paper output.
- Add print-specific handling for metadata, headings, tables, images, and page breaks.
- Manually verify browser print preview for representative documents.

Exit criteria:

- Documents target A4 paper with 18mm margins.
- Documents do not depend on browser-generated headers or footers.
- Headings avoid page breaks immediately after the heading.
- Tables avoid broken rows where possible.
- Wide tables use a shrink or overflow strategy.
- Images render at `max-width: 100%`.
- Content does not depend on screen-only UI.

## Phase 7: PDF Automation Path

Deliverables:

- Add Playwright only when static HTML and print CSS are stable.
- Generate PDFs from local static HTML.
- Write PDFs to `dist/pdf/{DOC_ID}.pdf`.

Exit criteria:

- PDF output uses the same HTML and CSS as the static site.
- PDF generation is optional and not required for basic static publishing.

## Phase 8: V1 Release Boundary

Deliverables:

- Confirm deployment remains out of V1.
- Document that `dist/` can be manually inspected and later deployed by a separately designed process.
- Do not add deploy scripts, deployment configuration, GitHub Actions changes, or target repository writes.

Exit criteria:

- Static output is ready for manual inspection.
- No deploy command exists.
- No existing GitHub Actions are changed.

## Testing Strategy

Prioritize tests around deterministic logic:

- `DOC_ID` parsing and generation.
- Token mapping.
- Slug generation.
- Version validation.
- Publishability validation.
- Output path derivation.
- Notion property normalization with fixtures.
- HTML escaping and link sanitization.
- Local asset requirement for publishable output.

Integration tests can use recorded Notion-like fixtures first. Live Notion API tests should be opt-in because they require credentials and can mutate data when ID generation writes back.

## Operational Commands

Expected eventual commands:

```text
npm run validate
npm run build
npm run assign-doc-ids
npm run pdf
```

`validate` is safe and read-only. `build` writes only local `dist/` and does not write to Notion. `assign-doc-ids` is the only command that may write missing `DOC_ID` values back to Notion, and it must provide a dry-run report before mutation. Deployment is not a V1 command.

## Release Checklist For V1

Before calling V1 usable:

- Development database is confirmed separate from production V2 data.
- Sample documents cover the supported block types.
- Required metadata validation works.
- `DOC_ID` generation is deterministic and collision-safe.
- `validate` and `build` are read-only with respect to Notion.
- Static HTML output is stable and readable.
- Canonical document paths use `/docs/{DOC_ID}/`.
- Publishable output has local asset copies.
- Print CSS meets the frozen A4/18mm print target.
- Unsupported blocks are visible in logs.
- No V2 repositories or workflows were modified.
- No deployment automation was added.

## Future Work

Later releases may add:

- Brand-specific themes.
- Local asset caching.
- PDF automation.
- Search index.
- Sitemap generation.
- Incremental builds.
- Deployment automation.
- Optional references to external client or project registries.

These are extensions. They should not change the V1 principle that a simple Notion database and static output are the core product.

Future extension points remain documented but must not be scaffolded in V1 unless they are required for the core static HTML publisher.
