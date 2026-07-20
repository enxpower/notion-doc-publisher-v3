# Phase 2 Production Baseline

## Baseline Status

- Phase 1: sealed.
- Phase 2: sealed.
- Phase 2 hotfix: sealed.
- Phase 2 scheduling conflict: resolved.
- Future feature development starts from **Phase 3**, unless the work is fixing a concrete, currently-observed production defect in the sealed Phase 2 baseline.

This document is the current authoritative production baseline. It is the **first document** any future AI coding agent (ChatGPT, Claude Code, Codex, or otherwise) must read when starting a new session in this repository, before any other file — including before re-deriving context from chat history, which this repository does not treat as a source of truth.

## Repository Identity

- Repository: `enxpower/notion-doc-publisher-v3`
- Owner: Andy Gong / enxpower
- Production ARCBOS site: `https://docs.arcbos.com`

## Owner Intent Summary

(Full detail: `docs/OWNER_INTENT.md`, which remains authoritative over this summary.)

- Notion is the only content editing source. This publisher renders and deploys; it never becomes a second editing surface.
- DOC_IDs, Share Tokens, canonical URLs, and namespaces are stable identifiers that must never be rotated or reassigned as a side effect of unrelated work.
- Secret and production-data safety outranks every other concern, including delivery speed.
- Production deployment and Notion writeback require explicit, verifiable production evidence before anything is declared "sealed" — a passing local build or passing CI is not, by itself, production evidence.

## Architecture Freeze

Phase 2 is a **frozen, sealed architecture**. Future agents must:

- Continue from the current `main` branch and this sealed baseline.
- **Not** redesign or replace the existing incremental publishing architecture (`src/routing/incremental.ts`, `src/routing/incremental-apply.ts`, the lifecycle state machine, the manifest model, or the hashing strategy).
- **Not** introduce a second production publisher, a second scheduled workflow, or a second automatic GitHub Pages deployer.
- Treat any change to publishing behavior, deployment ownership, or the production schedule as requiring explicit owner approval, exactly as `AGENTS.md` and `docs/ENGINEERING_GOVERNANCE.md` already require for Notion API and workflow changes.

The full Phase 2 lifecycle model, manifest model, hashing strategy, four-brand routing table, and rollback procedure are documented in `docs/PHASE_2_INCREMENTAL_PUBLISHING.md`, which this baseline does not duplicate in full — only the parts needed to operate the sealed system are restated below.

## Current Production Workflow

- File: `.github/workflows/incremental-content-publish.yml`
- Display name (as shown in the GitHub Actions UI): **Incremental Content Publish**
- This is the **sole scheduled production publisher** for this repository.

## Automatic Schedule

- Cron: `0 9 * * *` (verified present in `.github/workflows/incremental-content-publish.yml` on `main` as of commit `b95380e`, PR #53).
- UTC: `09:00` daily.
- Vancouver local time (`America/Vancouver`):
  - **02:00** during PDT (Pacific Daylight Time, UTC-7, roughly March–November).
  - **01:00** during PST (Pacific Standard Time, UTC-8, the rest of the year).
- Exactly one cron entry exists under this workflow's `schedule:` trigger. `src/tests/incremental.test.ts` asserts this count is exactly one, and that the cron string matches `0 9 * * *`, as a regression guard.
- Scheduled runs execute the real, guarded `apply` path — never `dry-run`. The workflow's "Resolve execution mode" step contains an explicit `elif [ "$GITHUB_EVENT_NAME" = "schedule" ]` branch that sets `mode="apply"` directly, the same treatment already given to the Issue #44 owner-command path.

## Trigger Model

`incremental-content-publish.yml` accepts exactly three trigger paths, each independently guarded:

| Trigger | Mode | Guard |
|---|---|---|
| `schedule` (`0 9 * * *` UTC) | Forced `apply` | Job-level `if:` permits `github.event_name == 'schedule'`; no confirmation phrase required (the schedule itself is the pre-authorized production trigger). |
| `workflow_dispatch` | `dry-run` (default) or `apply` | `apply` requires the `confirm_production` input to exactly equal `PHASE2-INCREMENTAL-PUBLISH`. |
| `issue_comment` on Issue #44 | Forced `apply` | Job-level `if:` requires all three: `github.event.issue.number == 44`, `github.actor == 'enxpower'`, and the comment body starting with the exact prefix `/phase2-publish PHASE2-INCREMENTAL-PUBLISH `. |

No other trigger (`push`, `pull_request`, or any other event) is registered on this workflow. `src/tests/incremental.test.ts` asserts the absence of `push:` and `pull_request:` triggers as a regression guard.

Concurrency protection is unchanged: `concurrency: { group: incremental-content-publish, cancel-in-progress: false }`. Overlapping triggers (for example, the daily schedule firing while an Issue #44 command is still running) queue rather than cancel or race.

## Production Deployment Ownership

**Incremental Content Publish is the only production owner for ARCBOS GitHub Pages.** `docs.arcbos.com` is served from this repository's own GitHub Actions Pages artifact (`deploymentMode: "github-pages-artifact"` in `config/brand-routes.json`), confirmed live via the GitHub Pages API: `build_type: "workflow"` (GitHub Actions-based Pages, not the legacy branch-based Pages type).

Audited every `.github/workflows/*.yml` file for `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`. Exactly two files reference them:

- `.github/workflows/incremental-content-publish.yml` — the designated production owner (see Trigger Model above).
- `.github/workflows/arcbos-pages-clean-deploy.yml` — **manual disaster recovery only** (see the dedicated section below). It is `workflow_dispatch`-only and pinned to a specific historical run/artifact ID; it is not an automatic competing deployer.

`src/tests/pages-deployment-ownership.test.ts` enforces this as a standing regression guard: it scans every workflow file, and any file other than `incremental-content-publish.yml` that references a Pages-deploy action must be `workflow_dispatch`-only.

GitHub's own automatically generated `pages-build-deployment` workflow is platform infrastructure associated with the legacy "deploy from a branch" Pages source type. Since this repository's Pages `build_type` is confirmed `"workflow"` (GitHub Actions-based), that legacy path is not active for this repository and is not a second business publisher. It must not be disabled — it is not a source workflow this repository controls, and disabling it is outside the scope of anything documented here.

No other automatic workflow may deploy a competing Pages artifact. Any new workflow that adds `actions/deploy-pages` must either be the designated owner or be `workflow_dispatch`-only, or it will fail the regression guard above.

## Four-Brand Routing

Four brands, each configured — not forked — through `config/brand-routes.json` and `config/brands.json`:

| Brand | Production Domain | Deployment Mode | Target Repository |
|---|---|---|---|
| ARCBOS | `https://docs.arcbos.com` | `github-pages-artifact` (this repository's own Pages artifact) | `enxpower/notion-doc-publisher-v3` |
| ENERGIZE | `https://docs.energizeos.com` | `branch` | `enxpower/docs-energize-v2` |
| AGIM | `https://docs.agim.ca` | `branch` | `enxpower/agim-docs` |
| GONG | `https://enxpower.com/gong-docs` | `branch`, scoped to `gong-docs/**` only | `enxpower/pub` |

Brand routing remains isolated: rendering logic is shared, but output roots, deployment boundaries, and target repositories never cross between brands. Private-link routes (`/clients/<ShareToken>/`, `/internal/<ShareToken>/`) remain token-based; DOC_ID and Share Token identity are preserved across `MOVE`/republish per the manifest model in `docs/PHASE_2_INCREMENTAL_PUBLISHING.md`.

Favicon mapping — verified live in production for all four brands (see Production Validation Evidence below):

| Brand | Favicon asset |
|---|---|
| ARCBOS | `assets/arcbos-favicon.svg` |
| ENERGIZE | `assets/energizeos-favicon.svg` |
| AGIM | `assets/agim-favicon.svg` |
| GONG | `assets/gong-favicon.svg` |

## Phase 2 Lifecycle

Every known document is classified into exactly one of the following actions before any build or writeback step (full definitions: `docs/PHASE_2_INCREMENTAL_PUBLISHING.md`):

`CREATE` · `UPDATE` · `MOVE` · `REMOVE` · `NOOP` · `INVALID` · `FILTERED`

`NOOP` records are not render candidates, do not regenerate PDFs, do not deploy their brand, and do not mutate Notion. `INVALID` documents preserve their previous live state rather than being taken down. `FILTERED` documents are outside the current workflow's scope and require no action.

## Production Execution Order

Fixed, fail-closed order inside `incremental-content-publish.yml`'s `apply` path — unchanged by every PR in the Sealed PR and Commit Record below:

1. Create incremental lifecycle plan (read-only against Notion).
2. Render (`CREATE`/`UPDATE`/`MOVE` documents only; skipped entirely on a pure `NOOP`/`REMOVE` run).
3. PDF generation (same scope as render; Typst/CJK font installation is itself conditional on render work existing).
4. Deploy: copy/delete files into branch-based target repositories (ENERGIZE, AGIM, GONG) and/or prepare and deploy the ARCBOS Pages artifact.
5. Live deployment verification (`npm run verify:incremental-deploy`) against the actually-deployed output.
6. Private state persistence — commits `state/incremental-state.json` to the private state repository, **only after** step 5 succeeds.
7. Notion writeback (`npm run writeback:incremental`) — **only after** step 6 succeeds.

## Security And Fail-Closed Invariants

- Notion is the only content editing source; `validate` and `build`-family commands remain read-only with respect to Notion.
- Production behavior is fail-closed throughout: if any step in the Production Execution Order fails, GitHub Actions' default step-skip behavior means every subsequent step (target repo commits, live verification, state persistence, Notion writeback) is skipped, not force-run. A partially-failed run cannot silently proceed to claim success.
- The workflow's own "Validate workflow safety" step greps its own operational region for blocked legacy patterns (`npm run assign-id`, `npm run ci:writeback`, `npm run writeback:routed`, `preview-publish`, `PUBLISHER_DEPLOY_TOKEN`, `PUBLISHER_STATE_TOKEN`, Share Token generation/rotation, and direct Notion API `PATCH`/`POST` calls) and fails the run if any are present.
- No second production publisher may be introduced (see Production Deployment Ownership above; enforced by `src/tests/pages-deployment-ownership.test.ts`).
- `scripts/prepare-arcbos-pages-artifact.sh` fails closed on credential-shaped content (`github_pat_`, `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `ntn_`, `Bearer <token>`) and on any blocked file pattern (`*.typ`, `.env*`, `*backup*`, `*audit*`, `*diagnostic*`, `reports/`, `diagnostics/`) before an ARCBOS Pages artifact is ever uploaded.

## State Persistence And Notion Writeback Ordering

This ordering is a hard production invariant, not an implementation detail:

**Live verification → private state persistence → Notion writeback.**

A successful lifecycle result is never written to Notion before the corresponding target repository commits and (where applicable) Pages deployment have been verified live. Private state is never committed before that same live verification succeeds. This ordering is unchanged by PR #49–#53 and is covered by the existing Phase 2 regression suite (`src/tests/incremental-apply.test.ts`, `src/tests/incremental-content-publish-workflow.test.ts`) plus the step-ordering assertions added in `src/tests/incremental-content-publish-workflow.test.ts` (verify → persist → writeback).

## Pages Deployment Ownership

See "Production Deployment Ownership" above — restated here per the required section list for completeness. Summary: `incremental-content-publish.yml` is the sole automatic Pages deployer; `arcbos-pages-clean-deploy.yml` is manual-only disaster recovery; GitHub's `pages-build-deployment` is inactive platform infrastructure for this repository's Pages `build_type`.

## Preview Publish Status

- File: `.github/workflows/preview-publish.yml`
- Display name: **Preview Publish**
- Triggers: `workflow_dispatch` only. No `schedule:`. No `push:` to `main` or any branch.
- Permissions: `contents: read` only — no `pages: write`, no `id-token: write`.
- No `actions/configure-pages`, no `actions/upload-pages-artifact`, no `actions/deploy-pages` steps exist in this workflow at all (not merely skipped by a condition — the steps do not exist).
- `PREVIEW_DEPLOY_ENABLED` is hardcoded to `"false"` directly in the workflow file, not sourced from a repository variable or secret. It cannot be silently re-enabled by a stale repository-level toggle.
- **It cannot overwrite production Pages.** Verified structurally (the deploy steps do not exist in the workflow) and empirically: a manual run (`workflow_dispatch`) was executed after PR #53 merged, and the live ARCBOS favicon and a live ARCBOS document page were hashed before and after — both hashes were byte-identical, confirming zero production impact.
- The owner may manually disable this workflow in the GitHub Actions UI at any time; that is an operational choice, not a requirement for safety, since the workflow is already structurally incapable of touching production Pages.

### Known Limitation (Preview Publish) — Not An Active Production Blocker

When Preview Publish is manually enabled and run, its Notion writeback (`npm run ci:writeback`, via `src/cli/writeback-preview.ts`) shares the same underlying Notion fields (`BUILD_STATUS`, `BUILD_MESSAGE`, `LAST_BUILD_RUN`) as Incremental Content Publish's writeback (`npm run writeback:incremental`), through the shared `NotionWriteback` class in `src/notion/writeback.ts`. Because `PREVIEW_DEPLOY_ENABLED` is hardcoded false, a manual Preview Publish run can still write `BUILD_STATUS: "skipped"` (with an accurate "Preview deployment skipped" message) onto a document that Incremental Content Publish had already marked `"success"`.

This is clearly labeled a **known limitation**, not an active production blocker:

- It requires a human to manually dispatch Preview Publish — it cannot happen automatically.
- It never writes a false production success URL, and it never overwrites production Pages (see above).
- It only affects a status/message field in Notion, not the actual published site or PDF.

Resolving this fully would mean either changing `writeback-preview.ts` (shared Notion writeback code, out of scope for a workflow-trigger-surface fix) or having Preview Publish stop calling `ci:writeback` altogether (a behavior change beyond "remove Pages deployment"). Neither was done, per "do not redesign the Phase 2 incremental publisher." A future Phase 3 (or a scoped defect-repair PR, if this becomes an actual operational problem) should address it explicitly.

## Disaster Recovery Workflow Status

- File: `.github/workflows/arcbos-pages-clean-deploy.yml`
- Display name: **ARCBOS Pages Clean Deploy**
- Trigger: `workflow_dispatch` only.
- Purpose: downloads a specific, hardcoded historical Pages artifact (a fixed `run-id`/`artifact-ids` pair baked into the workflow file at the time it was last used) via `actions/download-artifact@v4`, runs it through `scripts/clean-arcbos-pages-artifact.mjs`, and redeploys the cleaned result via `actions/configure-pages` + `actions/deploy-pages`.
- This is a **manual disaster-recovery tool**, not a live/automatic publisher. Because its source artifact reference is pinned to one specific historical run, it is not useful for routine operations and requires manual editing (updating the `run-id`/`artifact-ids`) before each recovery use.
- It is preserved (not deleted) per the instruction not to delete historical workflows merely to hide them from the Actions sidebar. It is excluded from the single-owner regression guard in `src/tests/pages-deployment-ownership.test.ts` specifically because it is `workflow_dispatch`-only.

## Known Limitations

1. **Preview Publish Notion status field collision** — see the dedicated subsection above under "Preview Publish Status."
2. **`arcbos-pages-clean-deploy.yml` requires manual editing before reuse** — its pinned `run-id`/`artifact-ids` reference a specific historical recovery event and must be updated by a human before the workflow is dispatched again for a different recovery scenario.
3. **MOVE, REPUBLISH, and INVALID-preservation production proofs** — `docs/PHASE2_SEALING_CHECKLIST.md` (pre-dating this baseline) records `CREATE` and `NOOP` as production-proven, with `UPDATE`, `MOVE`, `REMOVE`, `REPUBLISH`, and `INVALID` unchecked at the time it was written. This baseline's own Production Validation Evidence section below independently confirms `UPDATE`, `REMOVE`, and `NOOP` with specific run IDs from PR #49–#53 verification. `MOVE`, `REPUBLISH`, and `INVALID`-preservation were **not** independently re-verified in production during this documentation pass — they are covered by the regression test suite (`src/tests/incremental.test.ts`, `src/tests/incremental-apply.test.ts`) but not by a cited live production run ID in this document. Treat this as an open item, not a sealed fact, until a future session cites specific run evidence.

## Sealed PR And Commit Record

All five PRs below are merged to `main`, confirmed via GitHub PR metadata at the time this document was written.

| PR | Merge Commit | Merged At (UTC) | Title |
|---|---|---|---|
| #49 | `480b1b7` | 2026-07-20T01:04:08Z | fix: replace fragile inline ARCBOS Pages sanitation with a script |
| #50 | `d29a093` | 2026-07-20T01:43:09Z | fix: install pinned Typst without release API lookup |
| #51 | `524d961` | 2026-07-20T02:14:24Z | fix: scope ARCBOS favicon check to document pages, not portal pages |
| #52 | `5ad7c83` | 2026-07-20T02:59:55Z | docs: record ARCBOS artifact hotfix in README |
| #53 | `b95380e` | 2026-07-20T03:30:25Z | fix: make Incremental Content Publish the sole scheduled production publisher |

Publisher CI (`Publisher CI` workflow, job `quality`: `npm run check`, `npm test`, `npm run lint:security`, `git diff --check`) passed on the final PR (#53, run `29714723789`) with **245/245** tests passing, confirmed directly from the CI job log.

## Production Validation Evidence

All run IDs below are cited exactly as observed; none are inferred or assumed.

- **ARCBOS artifact hotfix, real production apply** — run `29712218993` (triggered via the Issue #44 owner-command channel), result: success. Lifecycle counts: `UPDATE: 13`, `REMOVE: 4`, `NOOP: 2`, `FILTERED: 37`. Work: 13 documents rendered, 13 PDFs generated, 3 brands deployed, 45 files copied, 4 files deleted, 17 live lifecycle records verified, 17 Notion mutations written back. Target commits: ARCBOS Pages artifact deployed, ENERGIZE and AGIM target repositories committed, GONG unchanged.
- **Final NOOP after the ARCBOS artifact hotfix** — run `29712842368`, result: success. Zero rendering, zero PDF generation, zero deployments, zero copied files, zero deleted files, zero Notion mutations. All four brand target commits reported "unchanged." Private state repository (`enxpower/notion-doc-publisher-state`) commit hash (`7faad5a...`) was identical before and after this run, confirmed via the GitHub Commits API.
- **Post-scheduling-fix manual verification apply** — run `29714820961` (`workflow_dispatch`, `mode=apply`, `confirm_production=PHASE2-INCREMENTAL-PUBLISH`, triggered after PR #53 merged), result: success. Zero work (state was already current), functioning as a second independent NOOP proof and confirming the `workflow_dispatch` confirmation-phrase path still works after the trigger-surface change. Private state commit hash unchanged from the prior evidence point.
- **Preview Publish isolation verification** — run `29715096766` (`workflow_dispatch`, triggered after PR #53 merged), result: success. The run's step list contained **zero** Pages-related steps (not skipped — absent from the workflow definition). Live ARCBOS favicon (`https://docs.arcbos.com/assets/arcbos-favicon.svg`) and a live ARCBOS document page (`https://docs.arcbos.com/clients/1b37ee1ab723aa95/`) were SHA-256 hashed immediately before and immediately after this run; both hashes were identical, confirming no production Pages impact.
- **Four-brand favicon live verification** — all four production favicon URLs returned HTTP 200 with valid, non-empty SVG content, and a live document page for each brand was confirmed to reference the correct brand-specific favicon filename (`arcbos-favicon.svg`, `energizeos-favicon.svg`, `agim-favicon.svg`, `gong-favicon.svg` respectively), none of them a social-preview PNG.
- **Issue #44 status** — closed (reason: completed) after the ARCBOS artifact hotfix was sealed, with the closing comment recording the production evidence above. It remains available to be reopened for a future controlled production publishing command, per its own operating convention (`/phase2-publish PHASE2-INCREMENTAL-PUBLISH <operation> <nonce>`).

## Rules For Future Development

1. Read this document first, then the governance documents in Authority Order below, before making any change.
2. Do not redesign or replace the Phase 2 incremental publishing architecture.
3. Do not introduce a second production publisher, a second scheduled workflow, or a second automatic Pages deployer.
4. Do not weaken the fail-closed execution order (live verification → private state persistence → Notion writeback).
5. Do not rotate DOC_IDs, Share Tokens, namespaces, or canonical URLs as a side effect of unrelated work.
6. Treat any change to `.github/workflows/incremental-content-publish.yml`, `.github/workflows/preview-publish.yml`, the Notion API integration, or production secrets as requiring explicit owner approval, per `AGENTS.md` and `docs/ENGINEERING_GOVERNANCE.md`.
7. New feature work belongs to **Phase 3** unless it is a concrete, currently-observed production defect repair against this sealed baseline.
8. Before claiming any fix "sealed" or "complete," produce cited production evidence (specific run IDs, commit hashes, or live HTTP verification) — not just a passing local build or passing CI.

## Authority Order

This document does **not** override higher-authority governance documents. If this baseline ever conflicts with one of them, the higher-authority document wins, and this document should be corrected to match — not the other way around.

1. `docs/OWNER_INTENT.md`
2. `docs/PROJECT_CONTEXT.md`
3. `docs/PRODUCT_CONSTITUTION.md`
4. `docs/SYSTEM_ARCHITECTURE.md`
5. `docs/ENGINEERING_GOVERNANCE.md`
6. **`docs/PHASE2_BASELINE.md`** (this document)
7. Existing code

Existing code does not override this sealed baseline or any governance document above it. Where code and this baseline disagree, treat the disagreement as a bug to investigate and report — not as silent authority for either side.

Note the distinction between this **authority order** and the **reading order** used in the New Thread Bootstrap Prompt below: for fast orientation, a new session should read this baseline *first*, then the governance documents. Reading order is about what gets you oriented fastest; authority order is about which document wins in a conflict. They are not the same list.

## New Thread Bootstrap Prompt

Copy-ready. Paste this as the first message in a new AI coding session (ChatGPT, Claude Code, Codex, or otherwise) working in this repository.

```text
Repository: enxpower/notion-doc-publisher-v3

Read first: docs/PHASE2_BASELINE.md

Then read, in order:
1. AGENTS.md
2. docs/OWNER_INTENT.md
3. docs/PROJECT_CONTEXT.md
4. docs/PRODUCT_CONSTITUTION.md
5. docs/SYSTEM_ARCHITECTURE.md
6. docs/ENGINEERING_GOVERNANCE.md
7. docs/AI_ENGINEERING_OPERATING_PROCEDURE.md, if present

Treat Phase 1 and Phase 2 as sealed.
Do not redesign or replace the existing incremental publishing architecture.
Do not introduce a second production publisher.
Continue from the current main branch and the sealed production baseline
described in docs/PHASE2_BASELINE.md.
Future feature work belongs to Phase 3 unless it is fixing a concrete,
currently-observed production defect.
Verify repository reality (current workflow files, merged PRs, actual
production run evidence) before making any change or claiming any fact —
do not treat this prompt, prior chat history, or this baseline document
itself as a substitute for checking the live repository state.
```
