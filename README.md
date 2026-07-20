# Notion Doc Publisher V3

Enterprise Notion-to-static-document publishing system for multi-brand company and personal documents.

Notion remains the only editing source. The publisher validates eligible records, generates brand-aware HTML and PDF output, deploys only changed documents, verifies live routes, persists the last successful state, and writes lifecycle results back to Notion.

## Current release status

**Phase 2 is sealed.**

Production lifecycle verification has been completed for:

- `CREATE`
- `UPDATE`
- `MOVE`
- `REMOVE`
- `REPUBLISH`
- `INVALID` fail-closed preservation
- `NOOP`

The final production NOOP proof confirmed zero rendering, zero PDF generation, zero target deployment, zero file mutations, and zero Notion mutations for unchanged records.

## Production principles

- Notion is the only editing source.
- One shared publisher engine serves all brands.
- Brand differences are configuration-driven, not implemented as separate renderers.
- `DOC_ID` and `Share Token` are stable document identities.
- HTML is the primary published artifact.
- PDF is generated from the same normalized document model.
- Only changed documents and changed brands are processed.
- Previous successful production output is preserved when validation, rendering, deployment, or verification fails.
- Private deployment state is stored outside public site roots.
- Notion success write-back occurs only after live deployment verification.

## Supported brands

| Brand | Production origin | Path prefix | VI source | Deployment model |
| --- | --- | --- | --- | --- |
| ARCBOS | `https://docs.arcbos.com` | none | `https://ref.arcbos.com/vi/` | GitHub Pages artifact |
| ENERGIZE | `https://docs.energizeos.com` | none | `https://docs.energizeos.com/vi/` | Branch target |
| AGIM | `https://docs.agim.ca` | none | `https://docs.agim.ca/vi/` | Branch target |
| GONG | `https://enxpower.com` | `/gong-docs` | `https://enxpower.com/gong-vi/` | Branch target limited to `gong-docs/**` |

Each brand has its own:

- display name and masthead treatment;
- canonical origin and path prefix;
- social share image;
- authoritative favicon;
- VI assets and presentation profile;
- deployment boundary.

Current favicon mapping:

```text
ARCBOS   -> arcbos-favicon.svg
ENERGIZE -> energizeos-favicon.svg
AGIM     -> agim-favicon.svg
GONG     -> gong-favicon.svg
```

Social preview images remain separate from browser-tab favicons.

## Route model

Private-link routes are deterministic and based on the existing Share Token.

### ARCBOS, ENERGIZE, and AGIM

```text
/clients/<ShareToken>/
/internal/<ShareToken>/
```

### GONG

```text
/gong-docs/clients/<ShareToken>/
/gong-docs/internal/<ShareToken>/
```

PDF routes use stable document IDs:

```text
/pdf/<DOC_ID>.pdf
```

GONG PDFs are published under:

```text
/gong-docs/pdf/<DOC_ID>.pdf
```

## Incremental lifecycle engine

Every known record is classified before rendering or deployment.

| Action | Meaning |
| --- | --- |
| `CREATE` | Publishable document has no previous successful deployed state. |
| `UPDATE` | Content, renderer, template, assets, or output metadata changed without a route change. |
| `MOVE` | Brand, visibility, namespace, origin, path prefix, or deployment target changed. |
| `REMOVE` | `Publish=false` and a previous successful deployment exists. |
| `REPUBLISH` | A previously removed document is published again using its existing identity. |
| `NOOP` | Desired state exactly matches the previous successful deployed state. |
| `INVALID` | Publishing is requested, but validation fails. Previous production output is preserved. |
| `FILTERED` | Record is outside the active publishing filter and requires no removal action. |

### NOOP behavior

A true NOOP performs:

- zero HTML rendering;
- zero PDF generation;
- zero brand deployment;
- zero copied or deleted files;
- zero Notion mutations;
- no meaningless private-state rewrite.

### REMOVE behavior

Unchecking `Publish` is an explicit removal instruction. The publisher deletes only files owned by that document in the previous successful manifest:

- document HTML;
- document PDF;
- document-exclusive assets.

Shared assets, VI files, portal pages, repository roots, and unrelated content are preserved.

### REPUBLISH behavior

Republishing reuses the existing:

- `DOC_ID`;
- `Share Token`;
- namespace, unless the owner changed routing fields;
- canonical route, unless routing changed.

## Deterministic state and hashing

The planner compares the current desired document state with the last verified production state using deterministic SHA-256 hashes:

- `contentHash`
- `routingHash`
- `rendererHash`
- `assetHash`
- `desiredStateHash`

The private state repository is:

```text
enxpower/notion-doc-publisher-state
```

The state manifest records the last successful deployment for each document, including:

- Notion page ID for private correlation;
- `DOC_ID`;
- Brand and Visibility;
- namespace and Share Token;
- canonical URL and deployment target;
- document-owned file list;
- deterministic hashes;
- PDF requirement;
- successful publication timestamp.

This state is the deletion and recovery authority. Broad repository scans are never used as deletion authority.

## Transactional publish sequence

Production publishing follows this order:

1. Read Notion and private prior state.
2. Validate publishable documents.
3. Create the lifecycle plan.
4. Re-read and compare plan/apply state to detect drift.
5. Render only `CREATE`, `UPDATE`, and render-requiring `MOVE` records.
6. Generate only required PDFs.
7. Apply document-owned file changes inside approved target boundaries.
8. Push changed target repositories or deploy the Pages artifact.
9. Verify live HTML/PDF presence or removal.
10. Persist the verified private state.
11. Write lifecycle status and URLs back to Notion.

If plan drift, validation failure, build failure, deployment failure, or live verification failure occurs, the transaction fails closed.

## Deployment boundaries

### ARCBOS

ARCBOS is served from the publisher GitHub Pages artifact. The artifact is sanitized and excludes local reports, diagnostics, backups, private state, Typst intermediates, and unrelated brand output.

### ENERGIZE

Publisher changes are restricted to approved document/runtime paths such as:

```text
clients/**
internal/**
pdf/**
assets/**
```

### AGIM

The publisher preserves the existing portal, VI, root pages, and unrelated files. Only approved document/runtime paths may change.

### GONG

The publisher may modify only:

```text
gong-docs/**
```

It must never modify:

```text
gong-vi/**
repository root pages
CNAME
unrelated project folders
```

## Failure safety

- Invalid current data cannot delete a previous successful public copy.
- A failed update preserves the previous successful HTML and PDF.
- A failed move preserves the old route until the new route is verified.
- A failed first publish does not write a success URL.
- State is committed only after successful live verification.
- Notion success fields are written only after state persistence.
- Temporary Notion 429, 5xx, and network failures use bounded retries.

## Required Notion concepts

Exact property names are configuration-dependent, but the production database supports these concepts:

| Purpose | Typical property |
| --- | --- |
| Publish toggle | `Publish` |
| Stable document ID | `DOC_ID` |
| Stable private token | `Share Token` |
| Brand | `Brand` |
| Status | `Status` |
| Visibility | `Visibility` |
| Document type | document type select |
| Client | client property |
| Project | project property |
| Version | `Version` |

Lifecycle write-back fields include:

| Field | Purpose |
| --- | --- |
| `PUBLISHED_URL` | Verified canonical HTML URL |
| `PUBLISHED_AT` | Successful publication timestamp |
| `BUILD_STATUS` | `pending`, `success`, `failed`, or legacy-compatible status |
| `BUILD_MESSAGE` | Sanitized lifecycle result or error |
| `LAST_BUILD_RUN` | GitHub Actions run reference |
| `PDF URL` | Verified PDF URL where configured |
| `PDF Status` | PDF lifecycle status |

## Commands

```sh
npm ci
npm run check
npm test
npm run lint:security
npm run validate
npm run build
npm run preview
npm run plan:incremental
npm run publish:incremental:dry-run
npm run publish:incremental
npm run verify:incremental-deploy
npm run writeback:incremental
npm run migrate:phase1-state
npm run pdf:site
npm run clean
```

| Command | Purpose |
| --- | --- |
| `npm run check` | TypeScript checks |
| `npm test` | Regression suite |
| `npm run lint:security` | Static security and privacy checks |
| `npm run validate` | Read Notion and create local validation output |
| `npm run build` | Build static HTML output |
| `npm run preview` | Serve the local build |
| `npm run plan:incremental` | Classify lifecycle actions without deployment |
| `npm run publish:incremental:dry-run` | Execute a non-mutating incremental apply simulation |
| `npm run publish:incremental` | Apply the governed incremental filesystem transaction |
| `npm run verify:incremental-deploy` | Verify expected live route presence/removal |
| `npm run writeback:incremental` | Write verified lifecycle results to Notion |
| `npm run migrate:phase1-state` | Reconstruct Phase 2 state from verified Phase 1 output |
| `npm run pdf:site` | Generate site PDFs for built documents |

## Production workflow

The primary Phase 2 production path is the GitHub Actions workflow:

```text
Incremental Content Publish
```

It supports guarded manual execution and the owner-only issue command:

```text
/phase2-publish PHASE2-INCREMENTAL-PUBLISH <operation> <nonce>
```

The command surface is fail-closed, concurrency-protected, and reports sanitized lifecycle counts, work counts, target commits, live verification counts, and Notion mutation counts.

Legacy preview and PDF QA workflows may remain for recovery or diagnostics, but they are not the authoritative Phase 2 lifecycle path.

## Phase 1 migration

Phase 1 production identities were preserved during migration:

- `DOC_ID` changes: 0
- Share Token changes: 0
- namespace changes: 0

The migration reconstructed verified document ownership and classified unchanged healthy records as NOOP. Ambiguous legacy files remain unmanaged and are never automatically deleted.

## HTML and PDF presentation

Published pages include:

- brand masthead and optional tagline;
- title and formal metadata grid;
- Print button;
- Download PDF button;
- responsive document body;
- canonical and social metadata;
- brand-specific favicon;
- print stylesheet;
- generated Typst PDF.

The layout uses a single formal paper width. Metadata, headings, paragraphs, tables, figures, code, and action controls align to the same content system. Mobile layouts collapse cleanly without horizontal scrolling.

PDF output uses Typst. GitHub Actions installs Typst and required CJK/Latin fonts only when the incremental plan requires rendering.

## Security and privacy

Publishing output is checked for:

- private state or manifest leakage;
- `.typ` source leakage;
- diagnostics and backup files;
- local filesystem paths;
- secret-shaped strings;
- wrong-domain canonical links;
- cross-brand asset references;
- incorrect brand favicon or social metadata;
- target-boundary violations.

Known architecture consideration: branch-based public Pages repositories expose generated path names in Git history. A future architecture phase may migrate ENERGIZE, AGIM, and GONG to artifact-based or private-build deployment where stronger path confidentiality is required.

## Governance

- Read `AGENTS.md` before any implementation work.
- Read the governing documents under `docs/` before coding, reviewing, deploying, or changing architecture.
- HTML/static publishing work must follow `docs/HTML_PUBLISHING_GOVERNANCE.md`.
- Owner intent and product governance override implementation convenience.
- Do not modify Notion, deployment workflows, credentials, routes, identity fields, or production output without explicit authorization.
- Never bypass document ownership, route validation, live verification, or private-state transaction rules.

## Phase 2 seal

Phase 2 is temporarily frozen at the current production baseline.

Further work should be treated as a new governed phase or a narrowly scoped production defect repair. Normal owner operation remains:

1. Edit the document in Notion.
2. Set valid publishing metadata.
3. Check `Publish` to create or update.
4. Uncheck `Publish` to remove.
5. Run the approved Incremental Content Publish workflow.
6. Review the lifecycle result and verified production URL.

### Post-seal defect repair (2026-07-20)

Narrowly scoped production defect repair, applied without reopening Phase 2 design:

- The inline ARCBOS Pages artifact sanitation step had an unterminated
  shell quote, blocking every step downstream of it (Pages deploy,
  live verification, private state persistence, Notion writeback).
  Moved to `scripts/prepare-arcbos-pages-artifact.sh`, a syntax-checked
  and unit-tested script (PR #49).
- `typst-community/setup-typst@v4` resolves versions through the
  GitHub releases API, which is a single point of failure during
  GitHub API incidents. Replaced with a pinned direct-download install
  with a crates.io fallback (PR #50).
- The artifact script's favicon-reference check originally covered
  every HTML file, including the brand-agnostic portal pages
  (`index.html`, `register/index.html`, namespace roots) that
  `render-html.ts` renders without a per-brand favicon `<link>` for
  any brand. Scoped the check to actual document pages (PR #51).

Verified in production: ARCBOS Pages artifact deploy, live favicon for
all four brands, private state persistence, and Notion writeback all
succeeded end to end, followed by a verified zero-work NOOP run.
