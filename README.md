# notion-doc-publisher-v3

A clean V3 Notion-to-static-document publisher.

Core principle:

- Notion is the only editing source
- `validate` and `build` are read-only with respect to Notion
- `DOC_ID` assignment happens only through `npm run assign-id`
- Output is static HTML first
- Print/PDF quality is a first-class requirement
- Existing V2 systems must not be modified

## Setup

```sh
npm install
cp .env.example .env
```

Fill in `NOTION_TOKEN` and `NOTION_DATABASE_ID` for a development Notion database. Do not use production V2 database IDs for initial development.

Configure `PUBLISHABLE_STATUSES`, `BRAND_TOKENS_JSON`, and `DOCUMENT_TYPE_TOKENS_JSON` for your database. The implementation does not ship with built-in brand or document type token assumptions.

## Local Workflow

```sh
npm install
cp .env.example .env
# Fill in Notion variables and token maps in .env
npm run assign-id:dry
npm run assign-id
npm run validate
npm run build
npm run preview
npm run publish:preview
```

## Commands

```sh
npm run validate
npm run build
npm run assign-id:dry
npm run assign-id
npm run preview
npm run clean
npm run smoke
```

`validate` reads Notion and writes `dist/reports/validation-report.json`.

`build` reads Notion, copies local assets for publishable documents, and writes local static output under `dist/`:

- `dist/docs/{DOC_ID}/index.html`
- `dist/assets/docs/{DOC_ID}/...`
- `dist/reports/build-report.json`
- `dist/reports/validation-report.json`

`assign-id:dry` creates `dist/reports/assign-id-report.json` without writing to Notion.

`assign-id` is the only command that writes `DOC_ID` values to Notion. It re-queries before writing and fails on conflicts.

After `npm run build`, run `npm run preview` and open `http://localhost:4173/`. Override the port with `PORT=5000 npm run preview`. Press `Ctrl+C` to stop the preview server.

`clean` removes local `dist/`.

`publish:preview` is intended for preview/test publishing. It assigns missing IDs, builds `dist/`, and writes preview results back to Notion. It does not deploy by itself; GitHub Actions handles preview deployment when explicitly enabled.

## Preview GitHub Actions Publishing

Preview publishing is test-only. Do not point it at production repositories or production Notion databases.

Workflow:

1. A user edits a document in Notion.
2. The user sets `Status` to a publishable status, `Visibility` to an allowed visibility, and checks `Publish`.
3. The `Preview Publish` GitHub Actions workflow runs manually, on schedule, or after code changes on `main`.
4. The workflow assigns missing `DOC_ID` values, builds `dist/`, optionally deploys to this repository's GitHub Pages preview target, and writes results back to Notion.

Required Notion write-back fields:

| Field | Type |
| --- | --- |
| `PUBLISHED_URL` | `url` |
| `PUBLISHED_AT` | `date` |
| `BUILD_STATUS` | `select`: `pending`, `success`, `failed`, `skipped` |
| `BUILD_MESSAGE` | `rich_text` |
| `LAST_BUILD_RUN` | `rich_text` |

Required GitHub secret:

- `NOTION_TOKEN`

Required GitHub variables or secrets:

- `NOTION_DATABASE_ID`
- `ALLOWED_VISIBILITY`
- `PUBLISHABLE_STATUSES`
- `BRAND_TOKENS_JSON`
- `DOCUMENT_TYPE_TOKENS_JSON`
- `PREVIEW_DEPLOY_ENABLED`
- `PREVIEW_BASE_URL`

Set `PREVIEW_DEPLOY_ENABLED=true` only for a test GitHub Pages target. `PREVIEW_BASE_URL` must be the public base URL, for example:

```text
https://enxpower.github.io/notion-doc-publisher-v3
```

Published URLs are written as:

```text
${PREVIEW_BASE_URL}/docs/{DOC_ID}/
```

If `PREVIEW_DEPLOY_ENABLED` is not `true`, the workflow builds and writes skipped preview messages to Notion but does not deploy.

To run manually, open GitHub Actions, select `Preview Publish`, and choose `Run workflow`.

## Layout and Paper System

The default document format is **US Letter**. Print output is defined by
`@page { size: letter; }` in `styles/print.css` and must not be changed to A4.

The register page (`.site-index`) and individual document pages (`.document`)
share one **shared paper system** defined as CSS variables in
`styles/screen.css`:

| Variable | Purpose |
| --- | --- |
| `--paper-width` | Outer sheet width, shared by the register and documents |
| `--paper-padding-x` / `--paper-padding-y` | Page margins |
| `--document-measure` | Readable prose column, narrower than the sheet |

Page furniture (masthead, title block, metadata, footer, register table) uses
the full paper width. Long-form prose is constrained to `--document-measure`
for a comfortable line length, while tables, figures, and code may break out to
the full content width. The UI/furniture layer uses a system sans-serif; the
document body uses a readable serif suitable for formal documents.

## Branding (brand-neutral)

The system supports documents for multiple companies. Branding is **not**
hardcoded. The masthead brand comes from the Notion `Brand` value; an optional
display name and tagline come from `config/brands.json`:

```json
{
  "ARCBOS": { "displayName": "ARCBOS", "tagline": "ENGINEERED FOR EXTREME CONDITIONS" },
  "ENERGIZE": { "displayName": "ENERGIZE", "tagline": "" },
  "AGIM": { "displayName": "AGI&M", "tagline": "" }
}
```

A brand's tagline is only shown when it is non-empty, so the ARCBOS slogan
appears only for ARCBOS documents. Brands without a profile fall back to the
raw Notion `Brand` label and show no tagline. The file is optional; if it is
missing or malformed the masthead stays cleanly neutral. An alternate path can
be set with `BRAND_PROFILES_PATH`. The file is committed and read at build
time, so CI needs no additional secrets.

## Printing

Each document page includes a **Print / Save as PDF** button that calls
`window.print()`. The print stylesheet (`styles/print.css`) renders a formal
Letter-sized document: web-only chrome (`.document-actions`, `.no-print`) is
hidden, the masthead and footer are preserved, headings avoid being stranded,
and tables, images, and code are kept from clipping.

## Validation severity

Validation keeps publishing disciplined without letting one bad draft block
everything:

- A document **eligible for publishing** (Publish checked, publishable Status,
  allowed Visibility) must pass validation; any error on such a document is
  build-blocking.
- **Cross-document integrity** errors (duplicate `DOC_ID`, output path
  collision) are always build-blocking.
- Quality problems on **drafts or non-publishable** documents are reported but
  never block the valid, publishable documents from building and deploying.

The build prints the exact title, `DOC_ID`, and reason for each blocking
document. Per-document results are written back to Notion as `success`,
`skipped` (with a concrete reason such as `Skipped: Status "Draft" is not
configured for publishing.`), or `failed`.

## Sidecar PDF Export (pdf:doc)

`npm run pdf:doc` is a **sidecar-only** command. It is completely separate from
the existing HTML publishing pipeline.

### Safety boundaries

| Boundary | Guarantee |
| --- | --- |
| Notion access | None — reads only local `dist/` files |
| HTML output | Does not modify `dist/docs/{DOC_ID}/` |
| GitHub Actions | Does not modify `.github/workflows/preview-publish.yml` |
| DOC_ID logic | Does not change assignment or validation |
| Deployment | Does not deploy anything |

### What it does

Reads `dist/reports/build-report.json` (produced by a prior `npm run build`),
re-renders each published document using `templates/pdf-document.html` and
`styles/pdf-document.css`, and writes `dist/pdf/{DOC_ID}.pdf`.

### Prerequisites

```sh
# 1. Build first (requires NOTION_TOKEN)
npm run build

# 2. Install Playwright Chromium (once)
npx playwright install chromium
```

### Usage

```sh
# Export all published documents
npm run pdf:doc

# Export a single document by DOC_ID
npm run pdf:doc -- ARCBOS-CON-2606-0001
```

### Output

```
dist/
  pdf/
    ARCBOS-CON-2606-0001.pdf
    ARCBOS-CON-2606-0002.pdf
    ...
```

### Failure messages

| Situation | Message |
| --- | --- |
| `dist/reports/build-report.json` missing | `PDF export: dist/reports/build-report.json not found. Run "npm run build" first.` |
| Playwright not installed | `PDF export failed: playwright is not installed.` |
| No documents in build report | `PDF export: no documents in build-report.json.` |
| No publishable documents | `PDF export: no publishable documents with DOC_IDs in build-report.json.` |
| Single DOC_ID not found | `PDF export: document "X" not found in build-report.json.` |
| Built HTML missing for a document | `[SKIP] DOC_ID: built HTML not found at dist/...` |

### Filtering by DOC_ID

Single-document filtering is supported:

```sh
npm run pdf:doc -- ARCBOS-CON-2606-0001
```

If the DOC_ID is not found in the build report, the command exits with an
error and lists the available DOC_IDs.

### Limitations

- Requires a prior `npm run build` (reads from `dist/`).
- Image paths in body content must be resolvable from the built `dist/` tree.
- Page numbers via Playwright `displayHeaderFooter` require Chromium.
- This is a local-only developer tool. Output PDFs are not deployed anywhere.

## Boundaries

v0.2.0 adds preview/test deployment only. It does not add PDF automation,
approval workflow, production deployment, or writes to production repositories.

The `pdf:doc` command in `feature/sidecar-pdf-doc-export` is a sidecar
experiment only and is pending owner review before merge.

## AI / Governance Operating Rules

- AI agents must read `AGENTS.md` first before doing any work in this repository.
- AI agents must read governance documents in `docs/` before coding.
- HTML and static publishing work must read `docs/HTML_PUBLISHING_GOVERNANCE.md`.
- No deploy, secret, Notion write, workflow, or publishing behavior changes without explicit owner approval.
