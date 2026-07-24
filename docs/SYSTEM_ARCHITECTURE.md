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

**Phase 3 Prompt 4 boundary hardening** (`src/tests/four-brand-boundary-hardening.test.ts`)
independently proves, rather than assumes, these boundaries: the canonical four-brand set
fails closed against a fifth or missing brand at config-load time; the production workflow's
`BRAND_TOKENS_JSON`, per-brand deploy-key usage, and GONG's `^gong-docs/` path-boundary regex
are cross-checked against `config/brand-routes.json` so the two cannot silently drift; ARCBOS
has no deploy key and no branch-checkout step; GONG deletion planning
(`deletionPlanForRecord`) rejects sibling-prefix confusion (`gong-docs-archive/`,
`gong-docs2/`, `gong-doc/`), traversal, absolute paths, and a corrupted previous-state record
pointing at another brand; and ENERGIZE/AGIM's protected-path guard (no deployment-root
prefix) independently blocks deletion of `CNAME`, `gong-vi/**`, and the shared root
`index.html`. No production-code defect was found in this boundary logic; the hardening in
this pass was tests only, except for one additive check in the Prompt 3 reconciliation path
described immediately below.

## Phase 3 Lifecycle Reconciliation (Implemented, Not Yet Production-Proven)

Lifecycle classification (`src/routing/incremental.ts`) compares only content/routing/
renderer/asset hashes against the private state manifest; it does not read Notion's current
`BUILD_STATUS` as part of classification, and a record still classifies as `NOOP` purely by
hash agreement. Historically, this meant a document that was live, verified, and correctly
persisted in private state could continue to display a stale Notion lifecycle status (for
example, a transient prior failure, or a status written by a manually dispatched Preview
Publish run) indefinitely, because a `NOOP` classification never re-touched Notion.

Phase 3 adds a narrow, additive reconciliation step for this specific gap, implemented in
`src/routing/lifecycle-reconciliation.ts` and wired into the existing
`npm run writeback:incremental` step (`src/cli/writeback-incremental.ts`) — no new workflow
step, schedule, or production trigger was added. For each `NOOP` record only:

1. The current Notion `BUILD_STATUS` is read (a new read-only lookup,
   `NotionWriteback.readLifecycleStatus`).
2. Reconciliation proceeds only when the private state on both sides of the run (pre-run and
   post-persistence) agrees with itself and with the freshly recomputed desired-state hashes
   for that document, a known deployed URL exists, and that URL structurally falls within the
   document's own recorded origin and path prefix (`URL_ROUTE_BOUNDARY_MISMATCH`, added in
   Phase 3 Prompt 4 as an independent, non-hash-based check — defense against a private-state
   record whose URL field drifted out of sync with its own hash fields, including across a
   brand boundary such as a GONG record whose URL fell outside `/gong-docs/`). Any missing or
   inconsistent evidence fails closed with zero mutation.
3. Reconciliation triggers only when Notion's `BUILD_STATUS` is exactly `"failed"` — the
   narrowest, primary defect case. Deliberately **not** implemented: reconciling a missing
   status or a `PUBLISHED_URL` mismatch; these were considered and intentionally deferred
   pending explicit owner/governance decision, per the instruction not to expand eligibility
   beyond what is currently governed and tested.
4. The corrective write (`NotionWriteback.reconcileLifecycleStatus`, gated by the same
   allow-list mechanism as all other lifecycle writes) sets `BUILD_STATUS` to `success` with
   an explicit message stating the metadata was reconciled from already-verified state, sets
   `PUBLISHED_URL` from the verified private state, and preserves the verified state's
   existing `publishedAt` — it never stamps the current time as a new publication event.
5. `CREATE`/`UPDATE`/`MOVE`/`REMOVE`/`INVALID`/`FILTERED` records are entirely unaffected;
   only `NOOP` is eligible. No render, deployment, DOC_ID, or Share Token mutation occurs as
   part of reconciliation, and Preview Publish cannot reach this code path (it never calls
   `writeback:incremental`).

This addition does not violate the live-verification -> private-state-persistence ->
Notion-writeback ordering above; reconciliation runs inside the same post-persistence
writeback step, after that ordering has already been satisfied for the run.

**Status**: implemented and covered by local regression tests (see
`src/tests/lifecycle-reconciliation.test.ts`) on an unmerged Phase 3 branch. It has not yet
been exercised against real production Notion data or a real production run, and must not be
described as production-proven until such evidence exists.

## Phase 3 Prompt 5: Supply-Chain and Secret-Boundary Hardening (Additive)

This is additive Phase 3 hardening layered on top of the sealed Phase 2 architecture. It did
not exist during Phase 2 and must not be read back into Phase 2's historical evidence.

**Immutable action pinning.** Every external GitHub Action referenced anywhere under
`.github/workflows/` is pinned to a full 40-character commit SHA, with an inline comment
recording the human-readable version it corresponds to (for example,
`uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0`). Each SHA was
resolved directly from the action's own official upstream repository (`actions/*` or
`typst-community/setup-typst`), not guessed. `src/tests/supply-chain-hardening.test.ts`
enforces this structurally: every external `uses:` entry must resolve to a 40-hex-character
SHA with a version comment, must match an approved owner/repository + SHA registry, and no
`@v1`–`@v9`/`@main`/`@master` mutable reference may remain. **Update procedure:** when an
action needs a newer version, resolve the new tag's commit SHA from the action's own upstream
repository, update both the workflow file and the approved-registry map in the test file
together, and validate through the normal PR/review process — never pin to an unverified fork,
an arbitrary latest commit, or a commit unrelated to the intended release.

**Typst binary checksum verification.** The production workflow's custom Typst install step
(`incremental-content-publish.yml`) downloads the official `typst/typst` GitHub release
tarball for the pinned version (`0.13.1`, linux x86_64 musl target) and now verifies its
SHA-256 (`sha256sum --check --strict`) before extracting or executing it. No official
checksums file is published for this release; the expected hash was obtained by
reproducibly downloading the official release asset directly and computing its SHA-256 (not
invented) — re-verify and update it alongside `TYPST_VERSION` whenever the pinned version
changes. A checksum mismatch fails the step immediately (`exit 1`) and does not fall through
to the cargo fallback; only a genuine network/download failure reaches that fallback, which
remains version-pinned with `--locked`.

**Secret/ref trust-boundary policy.** `NOTION_TOKEN` in the four manual QA/export workflows
(`pdf-export.yml`, `pdf-publisher.yml`, `docx-pdf-export-qa.yml`, `typst-pdf-export-qa.yml`)
is now scoped only to the specific step(s) that actually read Notion, not the job as a whole
— checkout, `npm ci`, font/Typst installation, type-check/test/lint, and artifact-upload steps
never receive it. This narrows exposure if a dispatcher-supplied branch's dependency lifecycle
scripts were ever compromised, without removing the token from where it is still genuinely
needed (none of these workflows write to Notion by default; QA remains fully functional). None
of these workflows hold a brand deploy key, `pages: write`, or `id-token: write`. Production
deploy keys (`DEPLOY_KEY_ENERGIZE`/`DEPLOY_KEY_AGIM`/`DEPLOY_KEY_GONG`/`DEPLOY_KEY_STATE`)
remain exclusive to `incremental-content-publish.yml`, and no deploy-key-bearing checkout step
takes a user- or event-controlled ref (only a fixed target-repository reference).

**Permissions.** Every workflow's `permissions:` block was reviewed and found already minimal;
no further reduction was possible without risking breakage (see the PR's Prompt 5 section for
the full per-workflow registry). No workflow was given a broader permission than it already
had.

**Signed-APT trust model.** `apt-get install fonts-noto-cjk fonts-noto-cjk-extra
fonts-liberation` relies on the GitHub-hosted Ubuntu runner's pre-configured, signed APT
repositories — this is signed-repository trust, not immutable package pinning, and is not
realistically improvable without vendoring fonts or building a custom runner image, which is
out of scope here. No custom or unsigned APT source is added anywhere.

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
