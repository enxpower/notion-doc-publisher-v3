# Project Brief

## Repository

enxpower/notion-doc-publisher-v3

## Purpose

This repository provides an enterprise Notion-to-static-document publisher that turns selected Notion database records into polished static HTML documents and generated PDF downloads.

## Public / Private Status

The repository is public, while `package.json` marks the package as private. Treat source visibility and secret handling carefully.

## Current Known Structure

- `README.md` — production model, output paths, required Notion fields, setup, commands, workflows, PDF Publisher 2.0, and layout notes.
- `package.json` — TypeScript / Node scripts and dev dependencies.
- `.env.example` — environment variable names and safe defaults.
- `src/cli/build.ts` — main static build flow for loading documents, validating, copying assets, rendering HTML, and writing reports.
- `dist/` — generated static output location.
- `dist/reports/` — generated build and validation report location.

## Runtime / Commands

Primary scripts from `package.json`:

- `npm run check`
- `npm test`
- `npm run lint:security`
- `npm run validate`
- `npm run build`
- `npm run preview`
- `npm run assign-id:dry`
- `npm run assign-id`
- `npm run publish:preview`
- `npm run pdf:export -- <DOC_ID>`
- `npm run pdf:queue -- <DOC_ID>`
- `npm run pdf:queue -- ALL`
- `npm run pdf:site`

## Environment Variables

`.env.example` documents names only. Do not commit actual values.

Key names include:

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `TARGET_SITE_DOMAIN`
- `DOC_ID_YEAR_MONTH`
- `ALLOWED_VISIBILITY`
- `PUBLISHABLE_STATUSES`
- `BRAND_TOKENS_JSON`
- `DOCUMENT_TYPE_TOKENS_JSON`
- `PREVIEW_DEPLOY_ENABLED`
- `PREVIEW_BASE_URL`
- `DOCUMENT_REGISTER_PUBLIC`
- `ROBOTS_DISALLOW_DOCS`
- `AUTO_GENERATE_SHARE_TOKEN`
- `AUTO_FILL_PRIVATE_NAMESPACE`
- `AUTO_FILL_PORTAL_CATEGORY`
- `LEGACY_PRIVATE_DOC_ID_URLS`
- `LEGACY_UNLISTED_DOCS_PATH`

## Important Constraints

- Notion is the only editing source.
- `validate` and `build` must not write to Notion.
- `DOC_ID` assignment must happen only through `npm run assign-id` or the approved publish workflow.
- Static HTML is the primary artifact.
- PDF output must be generated from the same document model.
- PDF download links must use relative paths.
- V2 systems must not be modified.
- Production workflow changes require explicit owner approval.
- Secrets must never be committed.
- Private, draft, confidential, unsigned, or unapproved records must not be published.

## What Future AI Agents Must Understand

- This is production publishing infrastructure, not a demo script.
- Write-back to Notion is a high-risk action and must remain controlled.
- Visibility, share token, namespace, and legacy URL behavior are safety-critical.
- Security lint and tests are part of the baseline workflow.
- Any build, route, or PDF behavior change can affect downstream public document sites.
