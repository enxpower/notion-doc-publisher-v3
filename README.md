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

## Commands

```sh
npm run validate
npm run build
npm run assign-id:dry
npm run assign-id
npm run preview
npm run clean
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

## V1 Boundaries

V1 does not implement deployment, GitHub Actions, PDF automation, or any writes to target site repositories.
