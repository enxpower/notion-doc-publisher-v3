# System Architecture

Project: notion-doc-publisher-v3

## Architecture Goal

A clean, layered, multi-brand Notion-to-static-HTML publisher with read-only Notion access for validate/build, and controlled write access only for assign-id and writeback.

## Canonical Flow

```text
Notion Database
  -> validate (read-only, writes validation-report.json)
  -> assign-id (writes DOC_ID to Notion only)
  -> build (read-only: renders static HTML to dist/)
  -> GitHub Pages (preview deploy only, via preview-publish.yml)
  -> writeback (writes PUBLISHED_URL, BUILD_STATUS, PUBLISHED_AT back to Notion)
```

## Layers

1. **Notion Client** (`src/notion/client.ts`) — reads pages and properties; writes DOC_ID and writeback fields only.
2. **Model** (`src/model/document.ts`) — TypeScript types for Documents.
3. **Config** (`src/config.ts`) — environment variable parsing; brand and document-type token mapping.
4. **Validation** (`src/validate/validate.ts`) — validates publishable documents; writes `dist/reports/validation-report.json`.
5. **Doc ID** (`src/doc-id/generator.ts`) — ID assignment and collision detection.
6. **Render** (`src/render/`) — HTML block rendering (`render-blocks.ts`) and full document rendering (`render-html.ts`).
7. **Assets** (`src/assets/copy-assets.ts`) — copies brand assets to `dist/assets/docs/{DOC_ID}/`.
8. **Build CLI** (`src/cli/build.ts`) — orchestrates validate, render, and asset copy; writes `dist/docs/{DOC_ID}/index.html`.
9. **Write-back** (`src/notion/writeback.ts`, `src/cli/writeback-preview.ts`) — posts build results back to Notion.

## Data Ownership

Source of truth:
- Notion: document metadata, DOC_ID, status, visibility, write-back fields.
- `config/brands.json`: brand display configuration.
- `.env` / GitHub secrets: tokens and runtime configuration.

Derived data:
- `dist/`: all output is derived and gitignored; never committed to the repository.

## Integration Boundaries

External systems:
- Notion API (read for validate/build; write for assign-id and writeback only).
- GitHub Pages (preview target for this repository only; not production docs sites).
- GitHub Actions (`preview-publish.yml`): orchestrates preview publishing.

## Current Phase Architecture (v0.2.0-preview-deploy)

Current phase implements only:
- Preview/test publishing to this repository's GitHub Pages.
- Regression tests with no Notion access.
- Assign-id with write-back of DOC_ID.
- Build-result write-back to Notion.

Deferred:
- Production deployment to docs-arcbos-v2, docs-energize-v2, or agim-docs.
- PDF automation.
- Approval workflows.
- Writes to production repositories.

## Architecture Drift Risks

Watch for:
- Notion writes outside assign-id and writeback commands.
- DOC_ID logic moved or duplicated outside `src/doc-id/`.
- Brand or VI assets hardcoded in HTML templates instead of driven by Notion/config.
- Output paths changing without migration of existing published URLs.
- The safety guard in `preview-publish.yml` being weakened or removed.

## Success Standard

The architecture succeeds if it can support:
- Multiple brand identities from a single publisher codebase.
- Safe preview publishing without risk to production documentation sites.
- Stable DOC_IDs across rebuilds.
- Full context recovery by a new agent from local repository files alone.
