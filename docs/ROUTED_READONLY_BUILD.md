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
dist/routes-readonly/{BRAND}/site/pdf/{DOC_ID}.pdf
dist/routes-readonly/{BRAND}/manifest.json
dist/routes-readonly/_audit/read-only-audit.json
dist/routes-readonly/routed-build-summary.json
```

Each command run resets only its selected local readonly staging root before
building so stale fixture or previous-run files cannot enter a release artifact.

For mocked local verification without Notion:

```bash
ROUTED_READONLY_TEST_MODE=fixture npm run build:routed:readonly
```

Fixture mode writes to `dist/routes-readonly-fixture` so mandatory local safety
checks cannot leave stale fixture files in the production readonly staging root.

## Architecture

```text
NOTION_DATABASE_ID single database
  -> existing loadDocuments() / pageToDocument()
  -> readonly mutation guard
  -> existing validation
  -> readonly persisted-field requirements
  -> Brand route grouping
  -> isolated per-brand local site roots
  -> routed PDF rendering from the accepted per-brand document objects
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
traces, credentials, secrets, private Share Tokens, and private canonical URLs.
Private route paths are represented only as redacted placeholders.

The private audit report is written to
`dist/routes-readonly/_audit/read-only-audit.json`, outside every deployable
site root. It may include page IDs for local operator correlation. `dist/` is
gitignored.

## PDF Handling

Stage 9 renders routed PDFs locally from the exact accepted per-brand document
objects used for HTML. The command does not reload Notion for PDFs and does not
use the PDF queue or PDF writeback path.

The routed path reuses the existing Typst PDF engine. Intermediate Typst files
are written to an internal work directory outside deployable `site` roots. Only
compiled PDFs are copied into each brand site root:

```text
dist/routes-readonly/{BRAND}/site/pdf/{DOC_ID}.pdf
```

Each generated PDF is checked before it is marked successful:

- file exists
- byte size is above the routed minimum
- header starts with `%PDF-`
- at least one page marker is detectable
- path remains inside the same brand site root
- the rendered HTML download link resolves to the same relative PDF path

Failure policy is brand-local. A PDF failure for one document marks that brand
manifest as failed or blocked, blocks that brand's deployment dry-run plan, and
does not delete, overwrite, or mutate another brand's successful output. Notion
remains read-only for the entire command.

## Routed URL Writeback

Stage 10 adds a separate route-aware Published URL writeback path:

```sh
npm run writeback:routed:dry-run
npm run writeback:routed
```

The dry-run command loads the same single `NOTION_DATABASE_ID`, performs the
guarded routed readonly HTML/PDF build, and writes a sanitized local plan under
`dist/routed-url-writeback/`. It does not mutate Notion.

The write command performs the same plan first, creates a private gitignored
backup of previous Published URL values, and then permits exactly one mutation
operation through the Notion mutation guard: `updatePublishedUrlOnly`. That
operation writes only the `PUBLISHED_URL` property. It does not write DOC_ID,
Share Token, namespace, portal category, status, timestamp, PDF properties, or
any build-status fields.

A record is eligible only when it is accepted in the routed build, belongs to a
confirmed deployment-valid route, has a valid routed canonical URL, generated
HTML, successful routed PDF output, and same-brand HTML-to-PDF link integrity.
Rejected, draft, filtered, collision-affected, failed-PDF, missing-HTML,
unknown-brand, and unconfirmed-route records are skipped.

The public writeback plan contains only counts, sanitized aliases, safe reason
codes, idempotency status, and URL fingerprints. The private backup contains the
minimum page correlation and previous Published URL values required for a future
owner-approved rollback; it is written only under gitignored `dist/` paths and
is never part of a deployable site root.

## Disabled

The routed readonly build command does not deploy, clone or push production
repositories, dispatch workflows, update GitHub Pages settings, write Notion
fields, assign DOC_IDs, or autofill Share Token, namespace, portal category,
URL, status, or PDF fields.
