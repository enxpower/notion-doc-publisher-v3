# Routed Readonly Build

Stage 6 adds a route-aware local build that reads the existing single Notion
database and writes isolated local artifacts only.

Command:

```bash
npm run build:routed:readonly
```

In normal production-readonly mode, the command reads only these runtime
values, from the process environment or from `.env` without importing any other
`.env` keys:

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `ALLOWED_BRANDS`, if already configured
- committed route and presentation configuration

It does not read deployment, writeback, autofill, legacy URL, per-brand database,
or token-map environment variables.

Default output:

```text
dist/routes-readonly/ARCBOS/site
dist/routes-readonly/ENERGIZE/site
dist/routes-readonly/AGIM/site
dist/routes-readonly/GONG/site
dist/routes-readonly/{BRAND}/manifest.json
dist/routes-readonly/_audit/read-only-audit.json
dist/routes-readonly/routed-build-summary.json
```

For mocked local verification without Notion:

```bash
ROUTED_READONLY_TEST_MODE=fixture npm run build:routed:readonly
```

## Architecture

```text
NOTION_DATABASE_ID single database
  -> existing loadDocuments() / pageToDocument()
  -> readonly mutation guard
  -> existing validation
  -> readonly persisted-field requirements
  -> Brand route grouping
  -> isolated per-brand local site roots
  -> public-safe manifests
  -> private local audit report
```

Brand routing happens after documents are loaded from `NOTION_DATABASE_ID`.
There are no per-brand database IDs.

## Readonly Safety

The command enables a code-level Notion readonly guard before loading documents.
While the guard is active, these mutation paths throw:

- `NotionClient.updateDocId`
- `NotionClient.updatePageProperties`
- preview writeback success, failed, skipped, and pending status methods
- Share Token, namespace, and portal-category autofill writeback
- PDF field writeback

The command does not call `autoFillDocuments`, `assign-id`, preview writeback,
or PDF queue writeback.

## Required Persisted Fields

Routed readonly publishing rejects records instead of filling missing values.
Publishable records must already have:

- `Brand`
- `DOC_ID`
- `Visibility`
- `Share Token` for `Client`, `Internal`, and `Unlisted` visibility
- `Private Link Namespace` for `Unlisted` visibility

Existing validation still applies for title, document type, version, status,
publish eligibility, content, duplicate DOC_IDs, path collisions, unsafe links,
and asset publishability.

Readonly status/type defaults are intentionally non-secret and local to this
command: statuses `Approved`, `Published`, and `Final`; document types
`Agreement`, `Specification`, `Memo`, `Proposal`, `Report`, and `Guide`.

## Reports

Public manifests are written outside each `site` root at
`dist/routes-readonly/{BRAND}/manifest.json`. They omit Notion page IDs,
database IDs, Notion URLs, local absolute paths, environment values, stack
traces, credentials, and secrets.

The private audit report is written to
`dist/routes-readonly/_audit/read-only-audit.json`, outside every deployable
site root. It may include page IDs for local operator correlation. `dist/` is
gitignored.

## PDF Handling

Stage 6 does not independently reload Notion for PDFs. Public manifests include
the per-brand PDF plan derived from the same document set used for HTML.
Full routed PDF rendering remains deferred.

## Disabled

This command does not deploy, clone or push production repositories, dispatch
workflows, update GitHub Pages settings, write Notion fields, assign DOC_IDs,
or autofill Share Token, namespace, portal category, URL, status, or PDF fields.
