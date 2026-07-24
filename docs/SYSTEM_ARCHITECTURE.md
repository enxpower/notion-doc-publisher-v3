# System Architecture

Project: notion-doc-publisher-v3

## Authority Note

This document previously described a pre-production, "v0.2.0-preview-deploy" architecture.
Phase 2 production release and final sealing (`docs/PHASE2_BASELINE.md`,
`docs/PHASE2_FINAL_PRODUCTION_SEAL.md`) superseded that description. This document now
describes the current sealed production architecture. The sealed incremental publishing
architecture (`src/routing/incremental.ts`, `src/routing/incremental-apply.ts`, the
lifecycle state machine, the manifest model, and the hashing strategy) must not be
redesigned or replaced except through explicit owner-approved governance.

## Architecture Goal

A clean, layered, multi-brand Notion-to-static-HTML publisher with read-only Notion access
for validate/build, and controlled write access limited to expressly authorized, allow-listed
production paths.

## Canonical Production Flow

```text
Notion Database (read-only)
  -> Production identity initialization (fills only missing DOC_ID / Share Token values)
  -> Incremental lifecycle plan (read-only classification: CREATE / UPDATE / MOVE / REMOVE / NOOP / INVALID / FILTERED)
  -> Render (CREATE / UPDATE / MOVE only; skipped entirely on a pure NOOP / REMOVE run)
  -> PDF generation (same scope as render)
  -> Deploy changed brand outputs (ARCBOS: this repository's own GitHub Pages artifact; ENERGIZE / AGIM / GONG: branch commits to their target repositories, within fixed path boundaries)
  -> Live deployment verification
  -> Private state persistence (only after live verification succeeds)
  -> Notion lifecycle writeback (only after private state persistence succeeds)
```

This order — **live verification -> private state persistence -> Notion lifecycle
writeback** — is a fixed, fail-closed production invariant. A successful lifecycle result is
never written to Notion before the corresponding deployment has been verified live, and
private state is never committed before that same live verification succeeds. If any step
fails, GitHub Actions' step-skip behavior means every subsequent step is skipped, not
force-run; a partially-failed run cannot silently proceed to claim success.

The separate preview/QA path (`preview-publish.yml`) never enters this flow: it runs
read-only validation and build steps only, never deploys, and never calls a production
writeback command.

## Layers

1. **Notion Client** (`src/notion/client.ts`) — reads pages and properties; writes DOC_ID and writeback fields only, gated by an explicit mutation allow-list.
2. **Model** (`src/model/document.ts`) — TypeScript types for Documents.
3. **Config** (`src/config.ts`, `config/brands.json`, `config/brand-routes.json`) — environment variable parsing; brand, document-type, and per-brand deployment-route configuration.
4. **Validation** (`src/validate/validate.ts`) — validates publishable documents; writes `dist/reports/validation-report.json`.
5. **Doc ID** (`src/doc-id/generator.ts`) — ID assignment and collision detection.
6. **Production identity initialization** (`src/routing/publishing-identity-initialization.ts`) — before lifecycle planning on a production apply run only, fills missing DOC_ID and Share Token values; never rotates or reassigns an existing identifier.
7. **Incremental lifecycle planning** (`src/routing/incremental.ts`) — classifies every known document into exactly one action (`CREATE` / `UPDATE` / `MOVE` / `REMOVE` / `NOOP` / `INVALID` / `FILTERED`) by comparing deterministic content/routing/renderer/asset hashes against the private state manifest.
8. **Render** (`src/render/`) — HTML block rendering (`render-blocks.ts`) and full document rendering (`render-html.ts`), scoped to `CREATE`/`UPDATE`/`MOVE` records only.
9. **Assets** (`src/assets/copy-assets.ts`) — copies brand assets to `dist/assets/docs/{DOC_ID}/`.
10. **Incremental apply** (`src/routing/incremental-apply.ts`) — applies routed filesystem changes to target repositories/artifact within each brand's deployment boundary.
11. **Live verification** (`src/cli/verify-incremental-deployment.ts`) — confirms expected live route presence or removal before state/Notion mutation is allowed.
12. **Write-back** (`src/notion/writeback.ts`, `src/cli/writeback-preview.ts`, `src/cli/writeback-incremental.ts`) — posts build/lifecycle results back to Notion, only after live verification and private-state persistence succeed for production runs.

## Data Ownership

Source of truth:
- Notion: document metadata, DOC_ID, Share Token, status, visibility, write-back fields.
- `config/brands.json` / `config/brand-routes.json`: brand display and deployment-route configuration.
- The private state repository (`enxpower/notion-doc-publisher-state`): the last successful deployed state per document, independent of current Notion state.
- `.env` / GitHub secrets: tokens and runtime configuration.

Derived data:
- `dist/`: all output is derived and gitignored; never committed to the repository.

## Integration Boundaries

External systems:
- Notion API (read for validate/build/planning; write limited to assign-id, writeback commands, and the production identity-initialization step).
- GitHub Pages: ARCBOS production target, served from this repository's own Pages artifact via `incremental-content-publish.yml`. A separate `workflow_dispatch`-only workflow, `arcbos-pages-clean-deploy.yml`, exists for manual disaster recovery from a pinned historical artifact; it is not a second automatic publisher.
- Downstream target repositories `enxpower/docs-energize-v2`, `enxpower/agim-docs`, and `enxpower/pub` (GONG, strictly scoped to `gong-docs/**`), committed to only by the production workflow via brand-specific deploy keys.
- The private state repository `enxpower/notion-doc-publisher-state`.
- GitHub Actions: `incremental-content-publish.yml` is the sole automatic production publisher (exactly one `schedule:` trigger, `0 9 * * *` UTC, plus a one-click `workflow_dispatch` and a restricted Issue #44 owner-command path); `preview-publish.yml` orchestrates read-only preview/QA only, with no deploy steps in the workflow at all.

## Per-Brand Deployment Boundaries

| Brand | Deployment target | Boundary |
|---|---|---|
| ARCBOS | This repository's own GitHub Pages artifact | Sanitized artifact excludes reports, diagnostics, backups, private state, and Typst intermediates. |
| ENERGIZE | `enxpower/docs-energize-v2` (branch) | Changes restricted to `clients/`, `internal/`, `pdf/`, `assets/`. |
| AGIM | `enxpower/agim-docs` (branch) | Same path restriction; existing portal, VI, and unrelated root files are preserved. |
| GONG | `enxpower/pub` (branch) | Changes restricted to `gong-docs/**` only; `gong-vi/**`, repository root pages, `CNAME`, and unrelated project folders must never be modified. |

A brand being structurally configured never grants deployment outside its own boundary; the
workflow's path-boundary validation step fails closed if a change outside the allowed pattern
is detected for any target repository.

## Known Phase 3 Reliability Gap (Not Corrected In This Prompt)

Lifecycle classification (`src/routing/incremental.ts`) compares only content/routing/
renderer/asset hashes against the private state manifest; it does not read Notion's current
`BUILD_STATUS` (or other displayed lifecycle fields). Both the incremental-apply writeback
path and the `writeback:incremental` CLI unconditionally skip Notion mutation whenever a
record classifies as `NOOP` or `FILTERED`. Consequence: a document that is live, verified,
and correctly persisted in private state can continue to display a stale Notion lifecycle
status (for example, a transient prior failure, or a status written by a manually dispatched
Preview Publish run) indefinitely, because a NOOP classification never re-touches Notion and
nothing else currently reconciles the two.

This is recorded here as a **known, not-yet-corrected** reliability gap:
- It does not violate the live-verification -> private-state-persistence -> Notion-writeback
  ordering above; it is a separate gap in what NOOP does *not* do.
- It is scheduled for explicit design/containment treatment in a later Phase 3 prompt.
- Recording it here is not authorization to alter NOOP's render/deploy/writeback-skip
  behavior, the hash-based classifier, or any other runtime behavior in this documentation
  prompt.

## Architecture Drift Risks

Watch for:
- Notion writes outside the expressly authorized, allow-listed commands and the production
  identity-initialization step.
- DOC_ID or Share Token logic moved, duplicated, or given rotation capability outside its
  owning module.
- Brand or VI assets hardcoded in HTML templates instead of driven by Notion/config.
- Output paths changing without migration of existing published URLs.
- The safety guard in `preview-publish.yml` being weakened, removed, or given any deploy
  capability.
- A second automatic `schedule:` trigger, a second Pages/branch deployer, or any workflow
  that indirectly dispatches the production publisher.

## Success Standard

The architecture succeeds if it can support:
- Multiple brand identities from a single publisher codebase, each within its own
  deployment boundary.
- Safe preview/QA publishing with no ability to touch production deployment or production
  Notion lifecycle state.
- Stable DOC_IDs and Share Tokens across rebuilds and republishes.
- Fail-closed production behavior under partial failure at any step.
- Full context recovery by a new agent from local repository files alone.
