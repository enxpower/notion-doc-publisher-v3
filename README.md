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

## Boundaries

v0.2.0 adds preview/test deployment only. It does not add PDF automation, approval workflow, production deployment, or writes to production repositories.
