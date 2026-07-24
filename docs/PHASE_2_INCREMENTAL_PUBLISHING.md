# Phase 2 Incremental Publishing

Phase 2 keeps `notion-doc-publisher-v3` as one shared publisher engine. Brand
differences are configuration-driven through `config/brand-routes.json` and
`config/brands.json`; rendering logic is not forked by brand.

## Lifecycle State Machine

Every known document is classified into one action before any build or
writeback step:

| Action | Meaning |
|---|---|
| `CREATE` | `Publish=true` and no previous successful deployment state exists. |
| `UPDATE` | `Publish=true`, previous state exists, and content, assets, renderer, template, or routing-independent output metadata changed. |
| `MOVE` | `Publish=true`, previous state exists, and canonical routing changed. This includes Brand, Visibility, namespace, origin, path prefix, or deployment target changes. |
| `REMOVE` | `Publish=false` and previous successful deployed state exists. |
| `NOOP` | Desired state exactly matches the previous successful deployed state. |
| `INVALID` | The document is intended for publishing but fails validation. |
| `FILTERED` | The document is outside the current workflow filter and has no required removal action. |

`NOOP` records are not render candidates, do not regenerate PDFs, do not deploy
their brand, and do not mutate Notion during the primary lifecycle writeback pass.

> **Phase 3 addendum (does not alter this Phase 2 record):** a separate, narrow,
> additive reconciliation pass (`src/routing/lifecycle-reconciliation.ts`) may issue
> exactly one corrective Notion write for a `NOOP` record whose private state is
> verified known-good but whose Notion `BUILD_STATUS` is stale (`"failed"`). This is
> not part of `NOOP` classification and does not add rendering, deployment, or any
> other mutation to `NOOP`. See `docs/SYSTEM_ARCHITECTURE.md` for full detail. This
> addendum is implemented and locally tested on an unmerged Phase 3 branch; it does
> not change any Phase 2 sealed production evidence recorded elsewhere in this file
> or in `docs/PHASE2_BASELINE.md`.

## Manifest Model

The private incremental state manifest is independent of the current Notion
state. It records the last successful deployed state per document:

- Notion page ID for private correlation
- `DOC_ID`
- Brand, Visibility, namespace, and Share Token
- canonical origin, path prefix, canonical path, and final URL
- deployment target and publisher-owned deployment root
- manifest-owned file list
- `contentHash`
- `routingHash`
- `rendererHash`
- `assetHash`
- aggregate desired-state hash
- PDF-required flag
- successful publication timestamp

Public site manifests must remain privacy-safe. Private deployment state belongs
outside deployable site roots and must stay gitignored when generated locally.

Production authoritative state is stored in the private repository
`enxpower/notion-doc-publisher-state`. The publisher repository references it
through the `PHASE2_STATE_REPOSITORY` Actions variable. Cross-repository access
uses target-specific write deploy keys:

- `DEPLOY_KEY_ENERGIZE` for `enxpower/docs-energize-v2`
- `DEPLOY_KEY_AGIM` for `enxpower/agim-docs`
- `DEPLOY_KEY_GONG` for `enxpower/pub`
- `DEPLOY_KEY_STATE` for `enxpower/notion-doc-publisher-state`

The content publish workflow uses GitHub's published SSH host keys from the
GitHub metadata API and does not require a broad shared publisher PAT.

## Phase 1 State Migration

Phase 1 downstream repositories contain older `.publisher_state.json` files
whose page maps may be string values and do not enumerate document-owned files.
Phase 2 does not treat those files as deletion authority.

The migration command is:

```bash
npm run migrate:phase1-state
```

It is read-only with respect to Notion and downstream repositories. It requires
`PHASE2_DEPLOYED_REPO_ROOTS_JSON`, a JSON object mapping Brand to a checked-out
deployed repository tree. Example shape:

```json
{
  "ARCBOS": "/tmp/extracted-active-arcbos-pages-artifact",
  "ENERGIZE": "/tmp/docs-energize-v2"
}
```

Fixture mode is available for tests:

```bash
PHASE2_MIGRATION_TEST_MODE=fixture npm run migrate:phase1-state
```

The migration reconstructs private Phase 2 state only when ownership is proven
from reliable sources:

- exact canonical token path for the document HTML
- exact `DOC_ID` PDF path
- generated HTML metadata or same-brand PDF link
- legacy page map correlation when present
- deterministic document-specific asset paths

Ambiguous files are never assigned to a document and never scheduled for
deletion. They are recorded as unmanaged legacy files for owner review.

If a current `Publish=true` document is valid but its expected deployed HTML or
PDF is absent or unproven, migration does not invent a prior successful state and
does not block unrelated healthy documents. The document is recorded privately as
a repair candidate and the post-migration plan classifies it as `CREATE` so it
can be republished through the normal safe apply path.

When a legacy hash cannot be reconstructed from old state, the migration writes
a documented baseline hash from the current desired Notion state and verified
deployed output. The required post-migration idempotency check must classify
unchanged healthy ARCBOS and ENERGIZE documents as `NOOP`, not `UPDATE` or
`MOVE`.

Local migration outputs are written under ignored `dist/phase2-state/private/`.
Those files can contain private Notion page IDs and must not be copied into
GitHub Pages artifacts.

## Hashing Strategy

Hashes are deterministic SHA-256 values over stable JSON:

- `contentHash`: title, Brand, Document Type, Client, Project, Category, portal
  category, Version, Status, Visibility, and normalized document blocks.
- `routingHash`: Brand, origin, path prefix, Visibility, namespace, Share Token,
  canonical path, deployment target, and deployment root.
- `rendererHash`: renderer/template/CSS version markers, route presentation
  key, path prefix, PDF path, and brand presentation profile.
- `assetHash`: document asset identities, output paths, kind, captions, content
  type, and source URL.

Any relevant change produces `CREATE`, `UPDATE`, `MOVE`, or `REMOVE` rather
than `NOOP`.

## Unpublish And Republish

Unchecking `Publish` is an explicit owner instruction to remove the online
copy. `REMOVE` deletes only files enumerated by the previous successful
manifest: document HTML, document PDF, and document-exclusive assets. Shared
assets remain.

Republishing uses the same `DOC_ID`, Share Token, and namespace unless the owner
changed routing fields. If routing did not change, the original route is
restored. If routing changed, the action is `MOVE`.

## Move Sequence

The safe MOVE sequence is:

1. Validate desired new route.
2. Build new HTML/PDF output.
3. Verify output integrity.
4. Deploy the new output.
5. Confirm the new URL is live where the workflow supports live checks.
6. Remove old manifest-owned files.
7. Confirm the old URL is absent.
8. Commit the new successful private state.
9. Write route-aware Notion result fields.

The previous successful public copy is preserved if validation, build, PDF, or
deployment fails before the replacement is verified.

## Four-Brand Routing

| Brand | Origin | Path Prefix | Client Route | Internal Route | Deployment Boundary |
|---|---|---:|---|---|---|
| ARCBOS | `https://docs.arcbos.com` | none | `/clients/<ShareToken>/` | `/internal/<ShareToken>/` | `notion-doc-publisher-v3` workflow Pages artifact |
| ENERGIZE | `https://docs.energizeos.com` | none | `/clients/<ShareToken>/` | `/internal/<ShareToken>/` | repository root |
| AGIM | `https://docs.agim.ca` | none | `/clients/<ShareToken>/` | `/internal/<ShareToken>/` | repository root, preserving `vi/` and unrelated portal files |
| GONG | `https://enxpower.com` | `/gong-docs` | `/gong-docs/clients/<ShareToken>/` | `/gong-docs/internal/<ShareToken>/` | `gong-docs/**` only |

GONG PDFs are under `/gong-docs/pdf/{DOC_ID}.pdf`. GONG deployment must never
modify repository root content, `gong-vi/**`, CNAME, or unrelated project
folders in `enxpower/pub`.

## Workflow Separation

Code CI remains separate from content publishing:

- Code CI runs `npm ci`, `npm run check`, `npm test`, `npm run lint:security`,
  build validation, routing tests, renderer tests, and deployment-safety tests.
- Content publishing loads Notion, classifies lifecycle actions, builds only
  `CREATE`/`UPDATE`/`MOVE`, removes only manifest-owned `REMOVE` files, skips
  `NOOP`, deploys only changed brands, and writes only necessary Notion results.
- Full rebuild/recovery is explicit and reserved for renderer, template, global
  CSS, migration, or disaster-recovery work.

The local incremental planner command is:

```bash
npm run plan:incremental
```

Fixture mode:

```bash
INCREMENTAL_TEST_MODE=fixture npm run plan:incremental
```

The planner prints counts for `CREATE`, `UPDATE`, `MOVE`, `REMOVE`, `NOOP`,
`INVALID`, and `FILTERED`.

The GitHub Actions workflow `Incremental Content Plan` is manual-only and
non-mutating. It runs the same planner against the configured Notion database
using repository secrets/variables and committed route config. It does not run
`assign-id`, writeback commands, deployment actions, or the full test suite.
It is intended as the fast planning primitive for the later governed content
publish workflow.

The GitHub Actions workflow `Incremental Content Publish` is also manual-only.
Its first governed implementation can generate and apply routed incremental
filesystem changes to checked-out branch-based target repositories. ARCBOS is
explicitly configured as a workflow Pages artifact target because
`docs.arcbos.com` is served by this repository's Pages artifact, not by
`docs-arcbos-v2` (`ref.arcbos.com`). Until a dedicated transactional artifact
apply handler is added, ARCBOS non-`NOOP` actions fail closed rather than being
written to the wrong branch repository.

The workflow explicitly keeps `INCREMENTAL_LIFECYCLE_WRITEBACK` disabled in
workflow execution. Production Notion lifecycle writeback requires a later
verified post-deployment step so a successful lifecycle result cannot be written
before target repository commits, Pages deployment, and live route checks have
passed.

## Failure Safety

If a publish/update/move fails and previous successful state exists, previous
production files remain live and the successful state manifest is not replaced.
If no previous state exists, no success URL is written and no public output is
published. `REMOVE` may proceed from a prior manifest even when the current
document body is invalid.

Successful state updates occur only after deployment succeeds.

## Rollback And Recovery

Rollback uses the private prior-state manifest:

1. Identify the last successful state artifact.
2. Reconstruct owned file lists by document.
3. Redeploy only files owned by affected documents or brand roots.
4. Re-run readonly verification.
5. Write Notion result fields only through the approved writeback command.

Manifest recovery must never infer deletions by broad repository scans or by
brand-prefix guesses alone.

## Owner Operation

Normal publishing remains Notion-first:

1. Edit the Notion document.
2. Check `Publish` to publish or update.
3. Uncheck `Publish` to remove the online copy.
4. Run the approved content publish workflow.
5. Read the lifecycle result: created, updated, moved, unpublished, unchanged,
   filtered, or failed.

## Current Implementation Status

The repository currently contains the deterministic lifecycle planner, four-brand
route configuration including AGIM and GONG, path-prefixed URL support, GONG
favicon/share assets, route-aware HTML metadata, manifest-owned deletion guards,
and automated regression coverage.

Production lifecycle writeback, deployment credential provisioning, private
state storage, and live Phase 2 sealing still require governed production
configuration and execution. Phase 2 must not be declared sealed until AGIM and
GONG are live and CREATE, UPDATE, MOVE, REMOVE, REPUBLISH, NOOP, and INVALID
preservation are verified in production.
