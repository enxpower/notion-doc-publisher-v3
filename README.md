# Notion Doc Publisher V3

Enterprise Notion-to-static-document publisher for serious company documents.

This repository turns selected Notion database records into polished static HTML documents and generated PDF downloads. Notion remains the editing source; GitHub Actions handles validation, build, static publishing, PDF generation, and controlled write-back.

## Production model

Core rules:

- Notion is the only editing source.
- `validate` and `build` do not write to Notion.
- `DOC_ID` assignment happens only through `npm run assign-id` or the approved publish workflow.
- Static HTML is the primary published artifact.
- PDF export is generated from the same document model and published beside HTML.
- PDF download links are relative paths, not hardcoded domains.
- Existing V2 systems are not modified.
- Production workflow changes require explicit owner approval.

## What gets published

For each eligible document, the publisher writes:

```text
dist/docs/{DOC_ID}/index.html
dist/pdf/{DOC_ID}.pdf
dist/assets/docs/{DOC_ID}/...
dist/reports/build-report.json
dist/reports/validation-report.json
```

The document page includes:

- enterprise masthead and title block;
- 2-row metadata grid for document attributes;
- Print button using browser print;
- Download PDF button linking to `/pdf/{DOC_ID}.pdf`;
- responsive static HTML body;
- formal print stylesheet for browser print;
- generated Typst PDF for direct download.

## Required Notion fields

The exact database property names are environment/config dependent, but the production database must support these concepts:

### Publishing fields

| Field purpose | Typical property |
| --- | --- |
| Publish toggle | `Publish` |
| Document ID | `DOC_ID` |
| Status | `Status` |
| Visibility / access | `Visibility` or equivalent |
| Brand | `Brand` |
| Document type | document type select |
| Client | client property |
| Project | project property |

### HTML write-back fields

| Field | Type |
| --- | --- |
| `PUBLISHED_URL` | `url` |
| `PUBLISHED_AT` | `date` |
| `BUILD_STATUS` | `select`: `pending`, `success`, `failed`, `skipped` |
| `BUILD_MESSAGE` | `rich_text` |
| `LAST_BUILD_RUN` | `rich_text` |

### PDF Publisher 2.0 write-back fields

| Field | Type |
| --- | --- |
| `Generate PDF` | `checkbox` |
| `PDF Status` | `select` |
| `PDF URL` | `url` |
| `PDF Generated At` | `date` |
| `PDF Error` | `rich_text` |

## Setup

```sh
npm install
cp .env.example .env
```

Fill in the required Notion and publishing configuration:

```text
NOTION_TOKEN=
NOTION_DATABASE_ID=
ALLOWED_VISIBILITY=
PUBLISHABLE_STATUSES=
BRAND_TOKENS_JSON=
DOCUMENT_TYPE_TOKENS_JSON=
PREVIEW_DEPLOY_ENABLED=
PREVIEW_BASE_URL=
```

Brand profiles are optional and read from `config/brands.json` unless `BRAND_PROFILES_PATH` is set.

## Commands

```sh
npm run check
npm test
npm run lint:security
npm run validate
npm run build
npm run preview
npm run assign-id:dry
npm run assign-id
npm run publish:preview
npm run pdf:export -- <DOC_ID>
npm run pdf:queue -- <DOC_ID>
npm run pdf:queue -- ALL
npm run pdf:site
npm run clean
```

### Main commands

| Command | Purpose |
| --- | --- |
| `npm run check` | TypeScript check only |
| `npm test` | Run regression tests |
| `npm run lint:security` | Static safety checks |
| `npm run validate` | Read Notion and write validation report locally |
| `npm run build` | Build static HTML under `dist/` |
| `npm run preview` | Serve local preview after build |
| `npm run assign-id:dry` | Report missing IDs without writing to Notion |
| `npm run assign-id` | Assign missing `DOC_ID` values to Notion |
| `npm run publish:preview` | Assign IDs, build, and write preview result fields |
| `npm run pdf:export -- <DOC_ID>` | Generate one Typst/PDF export sidecar output |
| `npm run pdf:queue -- <DOC_ID>` | Run PDF Publisher 2.0 for one document |
| `npm run pdf:queue -- ALL` | Run PDF Publisher 2.0 for queued documents |
| `npm run pdf:site` | Generate PDFs for all built site documents |

`npm run preview` opens the local build at `http://localhost:4173/` by default. Override with `PORT=5000 npm run preview`.

## GitHub Actions workflows

### Preview Publish

Primary production publishing path.

Flow:

1. User edits a document in Notion.
2. User sets publishable status, allowed visibility, and checks the publish toggle.
3. `Preview Publish` runs manually, on schedule, or after code changes on `main`.
4. The workflow assigns missing `DOC_ID` values where approved.
5. It validates and builds static HTML.
6. It generates site PDFs with `npm run pdf:site`.
7. It deploys static output when deployment is enabled.
8. It writes build status and published URLs back to Notion.

PDF generation in this workflow is site-side and automatic. Published document pages include a Download PDF button after the workflow completes successfully.

### PDF Publisher 2.0

Queue/write-back workflow for explicit Notion PDF generation fields.

Typical use:

- Set `Generate PDF` to checked in Notion.
- Run `PDF Publisher 2.0` manually for one `DOC_ID` or `ALL`.
- If write-back is enabled, the workflow updates `PDF Status`, `PDF URL`, `PDF Generated At`, and `PDF Error`.
- Already generated documents are skipped by the queue guard.

This workflow is isolated from HTML publishing and does not deploy the site.

### PDF Export Sidecar / QA workflows

Manual QA workflows are retained for safe PDF testing and artifact inspection. They are not the primary production publishing path.

## Layout system

The document page uses one consistent full paper content width.

- Masthead and title define the master width.
- Metadata grid, action buttons, TOC, headings, paragraphs, tables, code, and figures align to that same content width.
- The old narrow `--document-measure` prose constraint is not used for document pages.
- The header metadata is a clean 2-row × 4-column grid:
  - Row 1: Document ID, Type, Version, Status.
  - Row 2: Client, Project, Updated, Access.
- Extra horizontal divider lines around the metadata/actions/TOC area are intentionally removed.
- Tables, code blocks, and figures remain full-width and responsive.
- Mobile layout collapses metadata to 2 columns and then 1 column, with no horizontal scrolling.

## Branding

Branding is brand-neutral and driven by Notion/configuration.

The masthead brand comes from the Notion `Brand` value. Optional display name and tagline come from `config/brands.json`:

```json
{
  "ARCBOS": { "displayName": "ARCBOS", "tagline": "ENGINEERED FOR EXTREME CONDITIONS" },
  "ENERGIZE": { "displayName": "ENERGIZE", "tagline": "" },
  "AGIM": { "displayName": "AGI&M", "tagline": "" }
}
```

If a brand has no profile, the publisher falls back to the raw Notion brand label and shows no tagline. CI does not need extra secrets for committed brand profiles.

## PDF system

There are two PDF paths:

1. **Site PDF**: `npm run pdf:site` generates `/pdf/{DOC_ID}.pdf` for published site documents. This is the product path used by the Download PDF button.
2. **Queue PDF**: `npm run pdf:queue` reads Notion queue fields and optionally writes PDF status/link fields back to Notion.

PDF output uses Typst. In GitHub Actions, Typst and CJK/Latin fonts are installed by the workflow. Locally, install Typst before compiling PDFs:

```sh
brew install typst
```

If Typst is missing locally, the exporter may still write `.typ` source and skip final PDF compilation depending on the command and mode.

## Printing

Each document page includes a Print button that calls `window.print()`.

The print stylesheet renders a formal Letter-sized document:

- `@page { size: letter; }`;
- web-only chrome hidden;
- masthead and footer preserved;
- headings protected from being stranded;
- tables, images, and code protected from clipping.

Do not switch the default print format to A4 without explicit owner approval.

## Validation and blocking rules

Validation keeps publishing disciplined without allowing bad drafts to block good publishable documents.

- A publishable document must pass validation.
- Errors on publishable documents block that document.
- Cross-document integrity errors, such as duplicate `DOC_ID` or output path collision, are always build-blocking.
- Draft or non-publishable document quality problems are reported but do not block valid publishable documents.

Build and validation reports identify title, `DOC_ID`, and concrete failure/skipped reasons.

## Safety boundaries

Do not bypass these boundaries:

- Do not hardcode current or temporary domains in generated HTML, PDF links, manifests, tests, or docs.
- Use relative paths for site assets and PDF links unless a canonical domain is explicitly approved.
- Do not modify Notion except through approved write-back commands/workflows.
- Do not change deployment workflows without explicit owner approval.
- Do not touch V2 systems from this repository.
- Do not change PDF/write-back behavior as part of layout-only fixes.
- Do not change layout/body rendering as part of PDF-only fixes.
- Do not merge unreviewed workflow changes into `main`.

## AI / governance operating rules

- AI agents must read `AGENTS.md` before doing any work in this repository.
- AI agents must read governance documents in `docs/` before coding.
- HTML/static publishing work must read `docs/HTML_PUBLISHING_GOVERNANCE.md`.
- PDF work must keep site publishing, queue write-back, and sidecar QA paths clearly separated.
- Any deploy, secret, Notion write, workflow, or publishing behavior change requires explicit owner approval.
