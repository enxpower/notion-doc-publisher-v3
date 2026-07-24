# Phase 3 Final Seal

This document seals the governed, seven-prompt Phase 3 hardening sequence for
`enxpower/notion-doc-publisher-v3`. It is a review/merge-readiness record, not a production
event record. **No production workflow has been triggered, no real Notion write has occurred,
and no target repository has been modified at any point during Phase 3.** This document does
not claim that any Phase 3 code has run in production — only that it is ready for the owner's
merge decision, after which a separate, explicit, owner-authorized post-merge validation (§11
below) is the first time any of this code touches production.

## 1. Scope

Seven governed prompts, all accumulated on a single branch and a single draft PR, covering:
governance-authority alignment, lifecycle-status reconciliation, four-brand deployment
boundary hardening, supply-chain/secret-boundary hardening, performance baselining and bounded
concurrency, and this final cumulative audit and seal.

## 2. Baseline Commit

`b96cade565f3cb0fbcd706827b09838c347eb30d` (`origin/main`, unchanged throughout Phase 3).

## 3. Prompt 2–7 Commit Registry

| Prompt | Commit | Message |
|---|---|---|
| 2 | `433da49` | docs: align governance with sealed production architecture |
| 3 | `036ebdc` | fix: reconcile stale lifecycle status from verified state |
| 4 | `e97ef63` | test: harden four-brand deployment boundaries |
| 5 | `d2cdfd3` | security: harden workflow supply chain and secret boundaries |
| 6 | `2750d23` | perf: add bounded publishing pipeline concurrency |
| 7 | *(this commit)* | release: seal phase 3 publishing hardening |

## 4. Governance Alignment

`docs/PRODUCT_CONSTITUTION.md`, `docs/PROJECT_CONTEXT.md`, `docs/SYSTEM_ARCHITECTURE.md`, and
`docs/HTML_PUBLISHING_GOVERNANCE.md` no longer describe this repository as preview-only; all
four now agree it is the sealed Phase 2 production publisher, with Phase 3 changes explicitly
labeled additive and not rewritten into Phase 2's historical evidence. `PROJECT_LIFECYCLE.md`'s
legacy Phase 0–5 numbering is now explicitly disambiguated from the operational Phase 1/2/3
numbering. `README.md`'s "Phase 2 is sealed" / "Phase 2 is temporarily frozen" language is
accurate and not contradicted by Phase 3 additive work. GONG evidence is stated at exactly one
precise level: **FULL PRODUCTION URL VERIFIED**. AGIM is stated as structurally active and
test-verified, explicitly *not* claiming document-content production proof it doesn't have.

## 5. Lifecycle Reconciliation Contract

Final, re-verified contract (`src/routing/lifecycle-reconciliation.ts`):

- Eligible only when: action is `NOOP`; both previous and post-persistence next private state
  exist and agree with each other; identity (DOC_ID) and brand match; the freshly recomputed
  desired-state hashes (content/routing/renderer/asset/aggregate) match the verified state;
  the verified public URL is non-empty and structurally falls inside that brand's own origin +
  path-prefix boundary; and Notion's current `BUILD_STATUS` is exactly `"failed"`.
- Mutation writes exactly: `BUILD_STATUS` → `"success"`; `BUILD_MESSAGE` → an explicit
  reconciliation message ("reconciled from an already verified known-good deployment state...
  No rendering or deployment occurred in this run"), never a deployment-claiming message;
  `LAST_BUILD_RUN` → the current reconciliation run's ID (intentional — it records which run
  last touched the record, consistent with every other writeback path in this codebase, not
  the original deployment run); `PUBLISHED_URL` → only from verified state; `PUBLISHED_AT` →
  the verified state's preserved value, never the current time.
- No identity field (DOC_ID, Share Token, Brand, Visibility, Namespace, Portal Category,
  Document Type, title, content) is ever referenced by this code path.
- Zero mutation for: already-successful status, missing status, URL/boundary mismatch,
  `FILTERED`/`INVALID`/`CREATE`/`UPDATE`/`MOVE`/`REMOVE` records.
- A write failure propagates uncaught (fail-closed), matching the primary writeback loop.
- A second unchanged run is idempotent: zero additional reads (Prompt 6 prefiltering) once
  Notion reflects the reconciled `"success"` status.
- The new aggregate observability fields (`noopCandidateCount`, `reconciliationReadCount`,
  `reconciliationMutationCount`, `writebackElapsedMs`) contain only counts and elapsed
  milliseconds — no page ID, title, URL, or secret value — confirmed by a dedicated structural
  test reading the field names themselves.

## 6. Four-Brand Routing Matrix

| Brand | Domain | Deployment | Target repository | Namespaces | Path confinement |
|---|---|---|---|---|---|
| ARCBOS | docs.arcbos.com | GitHub Pages artifact (self) | `enxpower/notion-doc-publisher-v3` | docs, clients, partners, internal | n/a — sanitized artifact |
| ENERGIZE | docs.energizeos.com | branch | `enxpower/docs-energize-v2` | docs, clients, partners, internal | `clients/`, `internal/`, `pdf/`, `assets/` |
| AGIM | docs.agim.ca | branch | `enxpower/agim-docs` | docs, clients, partners, internal | same, portal/VI preserved |
| GONG | enxpower.com/gong-docs | branch | `enxpower/pub` | **clients, internal only** | `gong-docs/**` only |

Re-confirmed exactly four brands in `config/brand-routes.json` (no fifth, no omission — the
loader itself throws on any deviation). No `DEPLOY_KEY_ARCBOS` exists anywhere. GONG deletion
planning rejects sibling-prefix confusion, traversal, absolute paths, and corrupted
cross-brand state (`src/tests/four-brand-boundary-hardening.test.ts`, 20 tests, re-verified
passing). Lifecycle reconciliation cannot cross a brand boundary (`URL_ROUTE_BOUNDARY_MISMATCH`
check, re-verified).

## 7. GONG Production Evidence

**FULL PRODUCTION URL VERIFIED** (established Prompt 4, re-confirmed unchanged this prompt):
production run `29705771289` → cited target commit `1775af058704d5ce90e85632574ef13f6b601d4e`
in `enxpower/pub`, independently confirmed in that repository's real history, touching only
`gong-docs/**`; live HTTP fetch of the resulting URLs and PDFs returns 200 with correct
DOC_IDs and brand. No claim is made beyond this — AGIM's equivalent proof does not yet exist
and is not claimed here.

## 8. Supply-Chain Pin Registry

All 8 external actions independently re-verified this prompt against their upstream
repositories (`gh api repos/<owner>/<repo>/git/refs/tags/<version>`) — every SHA matches
exactly:

| Action | SHA | Version |
|---|---|---|
| actions/checkout | `11d5960a326750d5838078e36cf38b85af677262` | v4.4.0 |
| actions/setup-node | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0 |
| actions/upload-artifact | `ea165f8d65b6e75b540449e92b4886f43607fa02` | v4.6.2 |
| actions/download-artifact | `d3f86a106a0bac45b974a628896c90dbdf5c8093` | v4.3.0 |
| actions/upload-pages-artifact | `56afc609e74202658d3ffba0e8f6dda462b719fa` | v3.0.1 |
| actions/configure-pages | `983d7736d9b0ae728b81ab479565c72886d7745b` | v5.0.0 |
| actions/deploy-pages | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` | v4.0.5 |
| typst-community/setup-typst | `48aeee7543d37f01afd1ffb27307dc277387ba13` | v4.3.1 |

No mutable action reference remains anywhere in `.github/workflows/`.

## 9. Typst Checksum

Version `0.13.1`, linux x86_64 musl artifact, official
`https://github.com/typst/typst/releases/download/v0.13.1/...` source. Expected SHA-256
`7d214bfeffc2e585dc422d1a09d2b144969421281e8c7f5d784b65fc69b5673f` (no official checksums
file exists for this release; reproducibly computed from the official asset itself, twice,
byte-identical). `sha256sum --check --strict` runs strictly before `tar -xJf`; a mismatch
calls `exit 1` immediately inside the curl-succeeded branch and cannot fall through to the
cargo fallback, which remains version-pinned with `--locked` and is reached only by a genuine
network/download failure.

## 10. Secret/Trust-Boundary Decision

**Outcome: FIXED**, with one residual risk explicitly accepted as documented P2.

- **Fixed now**: `pdf-publisher.yml` — live Notion writeback (`writeback: true`) is now refused
  (fail-closed, `exit 1`) whenever `inputs.branch != 'main'`, closing the one concrete
  arbitrary-branch + secret-bearing-**write** combination this workflow could reach. Read-only
  dispatch on any branch (the workflow's actual intended QA purpose) is unaffected.
- **Accepted as documented P2 residual risk**: all four QA/export workflows
  (`pdf-export.yml`, `pdf-publisher.yml`, `docx-pdf-export-qa.yml`, `typst-pdf-export-qa.yml`)
  still accept an unconstrained `inputs.branch` and execute that branch's code with
  `NOTION_TOKEN` available to the specific step(s) that read Notion (narrowed to those steps
  only since Prompt 5). This requires a collaborator who **already has repository write
  access** to dispatch a workflow against a branch they control — it cannot be reached by an
  external/untrusted actor (the only `pull_request`-triggered workflow, `phase2-ci.yml`, has
  zero secrets), it exposes no deploy key, and no automatic trigger reaches this path.
  Constraining these workflows to `main`-only would defeat their stated purpose: three of the
  four exist specifically to test **unmerged** sidecar rendering/export code before it merges.
  This exposure is bounded to an insider abusing already-granted trust, is unchanged in kind
  (only narrowed in blast radius) since Prompt 5, and does not violate any constitutional rule
  in `docs/PRODUCT_CONSTITUTION.md` (it is a Notion **read** capability in three of four
  workflows; the one write path is now `main`-only).

## 11. Performance Changes and Limitations

Bounded concurrency (default 4, range [1,8], validated) in `loadDocuments()`'s per-document
Notion block fetch, and Notion-read prefiltering in lifecycle reconciliation, both re-verified
this prompt as behavior-preserving (ordering, exactly-once delivery, fail-fast on error,
retry/rate-limit delegation to the unchanged `NotionClient.request()`). The invalid-override
default-reversion behavior is explicitly documented (this prompt) as a deliberate performance-
knob convention, distinct from this repository's correctness/security fail-closed convention
used elsewhere. **Not yet production-proven** — locally benchmarked
(`scripts/benchmark-fetch-concurrency.mjs`) and structurally tested only. The duplicate
plan-step/apply-step full Notion re-fetch (identified in Prompt 6) remains deferred — see §16.

## 12. Workflow Topology

Exactly one schedule (`0 9 * * *`, `incremental-content-publish.yml`), exactly one automatic
production publisher, no `workflow_call`/`repository_dispatch`/`pull_request_target` anywhere,
Preview Publish structurally cannot deploy or write production lifecycle properties, disaster
recovery remains `workflow_dispatch`-only. Transaction ordering (live verification → private-
state persistence → Notion lifecycle writeback) is unchanged and re-confirmed via step-index
comparison. **Concurrency-group mismatch: FIXED** —
`arcbos-pages-clean-deploy.yml` now shares `incremental-content-publish.yml`'s concurrency
group, so the two ARCBOS Pages-deploying workflows can never run concurrently.

## 13. Test Totals

**341/341 passing** cumulative (`npm test`), 0 failures. Every individual test file re-run in
isolation confirms the same pass/fail split. Focused Phase 3 totals: Prompt 3 — 14; Prompt 4 —
20; Prompt 5 — 28; Prompt 6 — 24; Prompt 7 (this prompt's own new regression file) — 5.
`npm run check` clean; `npm run lint:security` — "Security lint: configuration is safe.";
`git diff --check` clean.

## 14. Production Safety Evidence

No production workflow was triggered at any point across all seven prompts. No real Notion
API call occurred (all Notion-touching tests use mocked `fetch` or mocked writeback clients).
No target repository (`docs-energize-v2`, `agim-docs`, `pub`, or the private state repository)
was modified. No secret value was retrieved or exposed. Only read-only GitHub metadata
(`gh api`) and public HTTP fetches of already-published pages were used for evidence-gathering.

## 15. Accepted Residual Risks

- QA/export read-only Notion token exposure to a dispatcher-supplied branch (§10) — insider-
  only, no deploy key, no automatic trigger, narrowed but not eliminated.
- AGIM lacks cited production-run evidence for document content (structurally/test-proven
  only).
- Live deployment verification (up to ~634s observed on the heaviest historical run) is
  CDN-propagation-bound and intentionally not optimized.

## 16. Deferred Improvements

- The duplicate full-Notion-fetch between the `plan:incremental` and `publish:incremental`
  steps (highest measured performance value; deferred because a safe fix requires
  restructuring the sealed plan→apply CLI/workflow boundary — **non-blocking**: it is a
  performance inefficiency, not a correctness, security, or recoverability defect; no evidence
  of rate-limit or timeout failure exists at current document-count scale).
  This is judged **non-blocking for merge**.
- Skipping ENERGIZE/AGIM/GONG target-repo checkout on pure-NOOP runs (rejected — measured
  savings ~6s, not material).
- Raising bounded-concurrency above the conservative default of 4 (requires re-measurement
  per `docs/PHASE3_PERFORMANCE_BASELINE.md` §9 before any change).

## 17. Exact Merge Recommendation

**SAFE TO MERGE**, at the owner's discretion and timing. This seal does not merge PR #58,
does not deploy anything, and does not authorize automatic production execution. Merging
`main` should be followed by the controlled post-merge validation in §18, not by an
unattended production run.

## 18. Post-Merge Production Validation Plan (Documented, Not Executed)

1. Confirm the merged `main` SHA matches this PR's final commit.
2. Confirm all required GitHub checks passed on `main` post-merge.
3. Owner explicitly authorizes one manual production publish
   (`workflow_dispatch` on `incremental-content-publish.yml`, or the Issue #44 owner-command
   path).
4. Use a real, currently-pending publishable record, or a deliberately staged controlled test
   record — never a fabricated identity.
5. Confirm, from the real run's evidence: planning completed; bounded Notion fetch behavior
   ran without unexpected 429s; render/deploy behavior matched the plan; live verification
   passed; private state persisted only after verification; Notion lifecycle writeback
   occurred only after state persistence; if a genuinely stale-failed NOOP candidate exists,
   confirm reconciliation fires exactly once and is idempotent on the next run.
6. Verify all four brands remained confined to their own deployment boundaries (no
   cross-brand file appears in any target repository's diff).
7. Confirm no unexpected file changed in any target repository beyond the plan's own scope.
8. Compare the run's actual step timings against `docs/PHASE3_PERFORMANCE_BASELINE.md` §1 —
   this is the first point at which any performance claim may be upgraded from "locally
   benchmarked" to "production-confirmed."
9. Confirm Notion lifecycle properties (`BUILD_STATUS`, `PUBLISHED_URL`, `PUBLISHED_AT`,
   `LAST_BUILD_RUN`) match the run's own reported result for every touched record.
10. Record the run ID, target-repository commit SHAs, live URLs checked, and this evidence in
    a follow-up note (not by editing this sealed document).
11. If a material regression appears, roll back per §19.

## 19. Rollback Guidance

If a material regression is discovered after merge: revert the merge commit on `main` (a
normal, reviewable `git revert`, not a force-push or history rewrite); the sealed Phase 2
architecture and its own historical evidence in `docs/PHASE2_BASELINE.md` are unaffected and
remain the fallback baseline. No DOC_ID, Share Token, or private-state manifest is touched by
a revert — the private state repository's own last-known-good manifest remains authoritative
regardless of which code version is deployed. No production secret or deploy key needs to
change as part of a rollback.

## 20. Explicit Production Statement

No production workflow was triggered during Phase 3 (Prompts 1 through 7). No real Notion
write occurred. No target repository was modified. All evidence in this document was gathered
read-only (GitHub API metadata, public HTTP fetches of already-published pages, and local
test/benchmark execution). This document does not constitute production validation of any
Phase 3 code — that occurs only via the plan in §18, after an explicit owner-authorized merge.
