# HTML Publishing Governance

Use this document for all HTML output, static publishing, document pages, and the preview publishing pipeline in notion-doc-publisher-v3.

This is a governance layer. Project-specific changes must preserve the core rules unless the owner explicitly approves an exception.

## Authority Note

Phase 2 final production sealing (`docs/PHASE2_FINAL_PRODUCTION_SEAL.md`) superseded this
document's earlier description of this repository as preview/test only for ARCBOS, and
superseded the earlier `docs-arcbos-v2` production reference below. The corrected routing
table reflects verified current production ownership.

## Repository Routing Rule

This repository (`notion-doc-publisher-v3`) is the **sole automatic production publisher**
for ARCBOS, ENERGIZE, AGIM, and GONG, through the single expressly authorized workflow
(`incremental-content-publish.yml`). It is also, separately, its own preview/QA target via
`preview-publish.yml`, which is structurally read-only with respect to production: it has no
deploy steps and never calls a production Notion writeback command.

Do not deploy to a production destination through any path other than the single expressly
authorized production workflow. A brand being configured never permits deployment outside
its own route boundary (see per-brand boundaries below) — deployment boundaries are
per-brand and enforced by a fail-closed path check.

Current verified production routing:

| Brand | Domain / Root | Production deployment | Target repository | Path boundary |
|---|---|---|---|---|
| ARCBOS | `docs.arcbos.com` | GitHub Pages artifact owned by this repository | `enxpower/notion-doc-publisher-v3` (self) | n/a — artifact is sanitized before upload |
| ENERGIZE | `docs.energizeos.com` | Branch deployment | `enxpower/docs-energize-v2` | `clients/`, `internal/`, `pdf/`, `assets/` |
| AGIM | `docs.agim.ca` | Branch deployment | `enxpower/agim-docs` | `clients/`, `internal/`, `pdf/`, `assets/`; existing portal/VI/root files preserved |
| GONG | `enxpower.com/gong-docs/` | Branch deployment | `enxpower/pub` | `gong-docs/**` only; `gong-vi/**`, repository root pages, `CNAME`, and unrelated project folders must never be modified |

Preview/QA target for this repository (never a production destination):

| Scope | Repository | Publish URL |
|---|---|---|
| Preview/QA | `enxpower/notion-doc-publisher-v3` | `https://enxpower.github.io/notion-doc-publisher-v3` |

Never deploy preview/QA output to any production destination above, and never let a
preview/QA run mutate production Notion lifecycle fields.

## Publication Structure Rule

Each published document lives in its own folder under `dist/docs/{DOC_ID}/`.

Each folder must contain an `index.html` file.

Output structure:

```text
dist/
  docs/
    {DOC_ID}/
      index.html
  assets/
    docs/
      {DOC_ID}/
        ...
  reports/
    build-report.json
    validation-report.json
```

Do not change the output path structure without explicit owner approval.

DOC_IDs are permanent once assigned. Never change a DOC_ID after it has been published.

## Branding Rule

Before making any HTML or template changes:

1. Identify the correct brand (from the Notion `Brand` value).
2. Read `config/brands.json` for display names and taglines.
3. Inspect existing rendered pages for that brand.
4. Reuse exact brand values, spacing, and typography from existing pages and `styles/`.

Do not hardcode brand tokens, colors, or taglines in HTML templates.

Do not mix brand VI between companies.

## Layout and Paper Rule

- Default paper format is **US Letter**. Do not change to A4.
- The paper system is defined in `styles/screen.css` and `styles/print.css`.
- Do not change CSS variables (`--paper-width`, `--paper-padding-x`, `--paper-padding-y`, `--document-measure`) without explicit owner approval.
- Print/PDF quality is a first-class requirement.

## HTML Product Checklist

Before merge or launch:

1. Responsive desktop, tablet, and mobile layouts.
2. No horizontal scrolling.
3. Correct brand VI applied.
4. No brand mixing.
5. Print stylesheet renders correctly for US Letter.
6. Open Graph metadata present where required.
7. Images are optimized.
8. No secrets, private URLs, or API keys in built output.
9. DOC_ID output path is correct and stable.

## Security and Source Exposure Rule

Do not expose secrets, private URLs, API keys, internal tokens, or private data in static HTML output.

Do not publish source code views or development-only artifacts as user-facing pages.

Static pages must not depend on private credentials.

## Stop Rule

Stop and ask for owner confirmation if:

- the output would go to a production documentation repository
- the DOC_ID or output path would change for an existing document
- the page needs production secrets
- the brand assignment is unclear
- the change affects the root portal or navigation structure in a risky way

No production deployment was performed.
