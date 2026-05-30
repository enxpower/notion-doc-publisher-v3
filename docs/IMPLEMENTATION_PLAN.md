# Implementation Plan

## Goal

Implement a lightweight V3 Notion-to-static-document publisher without depending on V2 code. The first implementation should produce validated static HTML from a development Notion database and leave a clean path for GitHub Pages deployment and Playwright PDF export.

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

## Phase 0: Architecture And Fixture Setup

Deliverables:

- Finalize architecture documents in `docs/`.
- Create a development Notion master database with the required properties.
- Confirm test brands, document types, and ID token mappings.
- Populate a few development documents that exercise headings, lists, tables, callouts, images, and code blocks.

Exit criteria:

- Development `NOTION_DATABASE_ID` is not a production V2 database ID.
- Required Notion fields are present.
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
- Add minimal test tooling if useful for ID generation and model validation.

Recommended scripts:

```json
{
  "build": "tsx src/build/build-site.ts",
  "validate": "tsx src/build/validate-site.ts",
  "check": "tsc --noEmit"
}
```

Exit criteria:

- Project can type-check.
- Configuration loads safely from environment variables.
- Missing required environment variables fail with clear errors.

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

## Phase 3: DOC_ID Generation

Deliverables:

- Map `Brand` to brand tokens.
- Map `Document Type` to type tokens.
- Scan existing valid `DOC_ID` values.
- Generate `BRAND-TYPE-YYMM-SEQ4` for pages with missing IDs.
- Write generated IDs back to Notion only for missing `DOC_ID` fields.
- Detect malformed IDs and collisions.

Rules:

- Never overwrite an existing valid `DOC_ID`.
- Never silently replace a malformed `DOC_ID`.
- Keep version separate from `DOC_ID`.
- Use global sequence numbers across the master database in V1.

Exit criteria:

- Missing IDs are generated in the required format.
- Existing IDs remain unchanged.
- Malformed IDs fail validation.
- Sequence behavior is deterministic in tests through `DOC_ID_YEAR_MONTH`.

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

Recommended output path:

```text
dist/docs/{brandSlug}/{documentTypeSlug}/{DOC_ID}/index.html
```

Exit criteria:

- Published development documents render to `dist/`.
- The site index links to rendered documents.
- Rendered HTML can be opened locally without a server.
- No client-side JavaScript is required for content.

## Phase 6: Print Quality

Deliverables:

- Improve `styles/print.css` for paper output.
- Add print-specific handling for metadata, headings, tables, images, and page breaks.
- Manually verify browser print preview for representative documents.

Exit criteria:

- Documents print cleanly from browser print preview.
- Content does not depend on screen-only UI.
- Tables and images have acceptable page-break behavior.

## Phase 7: PDF Automation Path

Deliverables:

- Add Playwright only when static HTML and print CSS are stable.
- Generate PDFs from local static HTML.
- Write PDFs to `dist/pdf/{DOC_ID}.pdf`.

Exit criteria:

- PDF output uses the same HTML and CSS as the static site.
- PDF generation is optional and not required for basic static publishing.

## Phase 8: Deployment Preparation

Deliverables:

- Add a deploy command that is disabled unless `TARGET_SITE_REPO` is configured.
- Validate the target is not a protected production repository during development.
- Document manual deployment steps before adding automation.

Exit criteria:

- Static output can be copied to a non-production GitHub Pages target.
- Build and deploy remain separate operations.
- No existing GitHub Actions are changed without explicit later approval.

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

Integration tests can use recorded Notion-like fixtures first. Live Notion API tests should be opt-in because they require credentials and can mutate data when ID generation writes back.

## Operational Commands

Expected eventual commands:

```text
npm run validate
npm run build
npm run pdf
npm run deploy
```

`validate` should be safe and read-only. `build` should write only local `dist/`. ID generation should be explicit or clearly documented if it writes missing `DOC_ID` values back to Notion.

## Release Checklist For V1

Before calling V1 usable:

- Development database is confirmed separate from production V2 data.
- Sample documents cover the supported block types.
- Required metadata validation works.
- `DOC_ID` generation is deterministic and collision-safe.
- Static HTML output is stable and readable.
- Print CSS is acceptable for PDF path.
- Unsupported blocks are visible in logs.
- No V2 repositories or workflows were modified.

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
