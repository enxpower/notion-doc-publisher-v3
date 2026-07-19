# Routed Dry-Run Build

Stage 4 adds a local, dry-run-only routed build path for Brand -> target repository planning.

This path does not replace the existing single-site build. `npm run build` remains the current preview publisher.

## Architecture

```text
committed route config
  -> committed dry-run fixture documents
  -> existing validation rules
  -> pure Brand routing contract
  -> per-brand isolated site output
  -> per-brand manifest
  -> dry-run deployment plan
```

The routed dry-run command is:

```bash
npm run build:routed:dry-run
```

Default output:

```text
dist/routes/ARCBOS/site
dist/routes/ENERGIZE/site
dist/routes/AGIM/site
dist/routes/GONG/site
dist/routes/{BRAND}/manifest.json
dist/routes/routed-build-summary.json
```

For temporary local inspection, set:

```bash
ROUTED_DRY_RUN_OUTPUT_ROOT=/tmp/notion-routes npm run build:routed:dry-run
```

## Route Configuration

Routes live in `config/brand-routes.json`. The file is committed and contains no credentials, tokens, deploy keys, or secrets.

The configured normalized brands are exactly:

- `ARCBOS`
- `ENERGIZE`
- `AGIM`
- `GONG`

Each route defines:

- normalized brand key
- route identifier
- target repository, when confirmed
- target base URL/domain
- CNAME value for planning only
- presentation profile key for confirmed brands; GONG remains null until separately confirmed
- allowed URL namespaces

Confirmed target repositories come from `docs/HTML_PUBLISHING_GOVERNANCE.md`:

| Brand | Target Repository | Target Base URL |
|---|---|---|
| ARCBOS | `enxpower/docs-arcbos-v2` | `https://ref.arcbos.com` |
| ENERGIZE | `enxpower/docs-energize-v2` | `https://docs.energizeos.com` |
| AGIM | `enxpower/agim-docs` | `https://docs.agim.ca` |
| GONG | unconfirmed, deployment blocked | `https://enxpower.com` |

Because no GONG target repository or presentation profile is confirmed in committed governance/config, the GONG route is renderable for local dry-run inspection with generic brand fallback behavior, but its deployment plan is blocked.

## Safety Model

The routed dry-run path fails closed when:

- a route is missing
- Brand is missing or unknown
- output is empty
- manifest is missing
- manifest brand, output root, target repository, or target domain does not match the route
- source path escapes the staging root
- generated or deletion paths escape the brand source directory
- deletion exceeds the tested threshold
- generated HTML lacks the expected print/PDF actions
- generated output attempts to use another brand route root
- a target repository is unconfirmed

The manifest intentionally omits Notion page IDs and internal credentials. It includes only route metadata, public canonical paths, planned final URLs, planned PDF paths, sanitized errors/warnings, and dry-run deployment validation results.

## What Remains Disabled

The routed dry-run build does not:

- load documents from production Notion
- write `DOC_ID`
- write `PUBLISHED_URL`, build status, or any other Notion field
- generate or upload production artifacts
- clone target repositories
- push to GitHub
- call GitHub APIs
- dispatch or edit GitHub Actions workflows
- update Pages settings, CNAME files, domains, or DNS
- execute production deployment

PDFs are planned from the same per-brand document set used for HTML. Full routed PDF generation remains deliberately deferred to a later approved stage.

## Rollback

Rollback is local and non-destructive:

1. Stop using `npm run build:routed:dry-run`.
2. Remove local generated output under `dist/routes/` if desired.
3. Revert the Stage 4 files if the routed dry-run contract is not accepted.

No production repository, production Notion database, GitHub Pages setting, domain, DNS record, or workflow is changed by this stage.
