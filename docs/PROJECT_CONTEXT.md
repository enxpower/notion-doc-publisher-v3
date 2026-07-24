# Project Context

This document helps a new AI coding session understand notion-doc-publisher-v3 without relying on chat history.

## Authority Note

Phase 2 production release and final sealing (`docs/PHASE2_BASELINE.md`,
`docs/PHASE2_FINAL_PRODUCTION_SEAL.md`) are complete and supersede the Phase 1-era
operational status this document previously described. The corrections below reflect
verified repository state (code, configuration, and tests) as of the sealed baseline.

## Origin

This is V3 of the Notion document publisher. V2 is a production system in separate repositories (docs-energize-v2, agim-docs; the legacy docs-arcbos-v2 is no longer the ARCBOS production target). V3 is a clean rewrite that now powers the sealed Phase 2 production release: ARCBOS is served directly from this repository's own GitHub Pages artifact, and ENERGIZE, AGIM, and GONG are routed to their respective downstream repositories, while preserving reviewable, brand-isolated publishing behavior.

## Why This Project Exists

Enterprise document publishing from Notion is the primary content workflow for enxpower brands. V2 was tightly coupled and hard to test. V3 provides a clean, testable, multi-brand static publishing pipeline that has replaced V2 for ARCBOS and is the routed production publisher for ENERGIZE, AGIM, and GONG.

## What This Project Is

- A TypeScript CLI that reads from a Notion database and produces static HTML documents.
- A multi-brand publisher supporting ARCBOS, ENERGIZE, AGIM, and GONG visual identities.
- A read-only-with-respect-to-production preview/QA pipeline (`preview-publish.yml`) using GitHub Actions on this repository only, structurally incapable of deploying or writing production Notion lifecycle fields.
- The sole automatic production publisher (`incremental-content-publish.yml`, "Incremental Content Publish") for all four configured brands, deploying ARCBOS via this repository's own GitHub Pages artifact and ENERGIZE/AGIM/GONG via branch commits to their target repositories under fixed path boundaries.
- A DOC_ID and Share Token assignment and tracking system that writes stable identifiers back to Notion, including an automatic identity-initialization step that fills only missing values (never rotates existing ones) immediately before a production apply run.

## What This Project Is Not

- A Notion CMS editor — Notion is the only editing interface.
- A general-purpose static site generator.

## Core Product Philosophy

- Notion is the only editing source.
- `validate` and `build` are read-only with respect to Notion.
- Notion writes are restricted to expressly authorized, allow-listed paths: `assign-id`
  (manual DOC_ID assignment), the writeback commands (`writeback-preview`,
  `writeback:incremental`, and the routed URL writeback), and the automatic production
  identity-initialization step that fills only missing DOC_ID/Share Token values
  immediately before a production apply run. No other code path may write to Notion.
- Output is static HTML first; print/PDF is a first-class requirement.
- Existing V2 downstream repositories (docs-energize-v2, agim-docs) must not be modified
  by anything other than this publisher's own approved deployment paths.

## Key Historical Decisions

- US Letter paper format is canonical; do not switch to A4.
- DOC_IDs are permanent once assigned; collisions are always build-blocking.
- Brand tokens come from the Notion `Brand` property + `config/brands.json`, not hardcoded HTML.
- Preview publishing (`preview-publish.yml`) is manual, `workflow_dispatch`-only, and
  structurally read-only with respect to production: it has no deploy steps and never
  calls a production writeback command. Production publishing (`incremental-content-publish.yml`,
  the sole automatic production publisher) deploys ARCBOS via this repository's own GitHub
  Pages artifact, and ENERGIZE, AGIM, and GONG through their confirmed downstream target
  repositories.
- The preview-publish.yml safety guard blocks deployment from production V2 repository names.
- A separate, `workflow_dispatch`-only disaster-recovery workflow
  (`arcbos-pages-clean-deploy.yml`) exists for manual ARCBOS Pages recovery from a pinned
  historical artifact. It is not a second automatic publisher.

## Long-Term Destination

V3 has replaced the legacy V2 ARCBOS production publisher (ARCBOS is now served from this
repository's own GitHub Pages artifact). ENERGIZE, AGIM, and GONG continue to route to their
existing downstream repositories. Phase 3 hardens and, where owner-approved, further
consolidates this production posture.

## Current Phase

Phase 2 production release and final production seal are complete
(`docs/PHASE2_BASELINE.md`, `docs/PHASE2_FINAL_PRODUCTION_SEAL.md`). Phase 3 is the current
hardening and global-sealing phase: it strengthens reliability, governance accuracy, and
supply-chain posture on top of the sealed Phase 2 architecture. Phase 3 is not a rewrite and
must not redesign the sealed incremental publishing architecture.

This section distinguishes three levels of evidence for each brand:

1. **Structurally configured** — present and wired in `config/brand-routes.json`,
   `config/brands.json`, and the production workflow, with no code-level exclusion.
2. **Test-verified** — covered by passing regression tests asserting the brand is treated
   like the others (routing, boundary, and workflow-inclusion tests).
3. **Production-proven by cited evidence** — a specific, cited production run ID or live
   verification exists showing the brand's document content was actually deployed.

Released and production-proven scope:
- ARCBOS and ENERGIZE routed publishing are structurally configured, test-verified, and
  production-proven by cited run evidence in `docs/PHASE2_BASELINE.md`.
- GONG routed publishing is structurally configured, test-verified, and **production-proven
  by cited run, commit, and live-URL evidence** (verified in Phase 3 Prompt 4; see below).
- One Notion database is retained.
- HTML and PDF outputs are brand-isolated.
- Published URL writeback is route-aware and idempotent.

Structurally configured and test-verified, not yet production-proven for document content:
- AGIM is structurally active: fully wired in `config/brand-routes.json`
  (`repositoryConfirmed: true`) and the production workflow, and covered by passing
  regression tests. No cited production run currently shows AGIM document content deployed
  to `enxpower/agim-docs`; this is an open evidence gap, not a code-level block.

### GONG production evidence (verified Phase 3 Prompt 4, evidence level: FULL PRODUCTION URL VERIFIED)

Independently re-verified from repository- and GitHub-hosted evidence, not assumed from prior
chat history:

- Production run `29705771289` ("Incremental Content Publish", triggered via the Issue #44
  owner-command channel, conclusion `success`) reported, via its own posted Issue #44 comment
  (`issuecomment-5017591905`): lifecycle counts `{"FILTERED":37,"NOOP":18,"UPDATE":1}`, one
  document rendered and one PDF generated, one brand deployed, six files copied, one live
  lifecycle record verified, one Notion mutation, and target commit
  `GONG 1775af058704d5ce90e85632574ef13f6b601d4e`.
- That exact commit is independently confirmed in `enxpower/pub`'s real commit history,
  authored and committed by `github-actions[bot]` (the same identity the production workflow
  configures for target-repository commits), touching exactly two files, both under
  `gong-docs/**`: `gong-docs/clients/175e8db08a67f7d8/index.html` and
  `gong-docs/pdf/GONG-MEM-2607-0032.pdf`.
- `enxpower/pub`'s repository root (`CNAME`, `index.html`, `gong-vi/**`) has never been
  modified by any `github-actions[bot]` "chore: publish incremental document updates" commit —
  only by earlier manual setup commits — confirming the GONG deployment boundary held in
  real production history, not only in local tests.
- Live HTTP verification (read-only, performed during this audit): the deployed document page
  at `https://enxpower.com/gong-docs/clients/175e8db08a67f7d8/` returns HTTP 200 with title
  "SYSTEM TEST — GONG Client — GONG-MEM-2607-0032" and a correct relative GONG favicon
  reference; its PDF at `https://enxpower.com/gong-docs/pdf/GONG-MEM-2607-0032.pdf` returns
  HTTP 200, `application/pdf`. A second document, `https://enxpower.com/gong-docs/internal/512717050a45997b/`
  (title "SYSTEM TEST — GONG Internal", DOC_ID `GONG-MEM-2607-0033`) and its PDF at
  `https://enxpower.com/gong-docs/pdf/GONG-MEM-2607-0033.pdf` also both return live HTTP 200.
  This resolves the DOC_ID `GONG-MEM-2607-0033` referenced in earlier historical notes: it is
  now live, correctly GONG-branded, and confined to `/gong-docs/`.
- This supersedes the earlier conservative "configured, test-verified, and production-enabled"
  language for GONG. GONG document-content production deployment is no longer merely
  structural — it is cited, commit-verified, and live-URL-verified.
- A prior context note characterized workflow run `29701392671` as "an old failed run." Direct
  inspection shows this run is actually a **`Preview Publish` run with conclusion `success`**,
  unrelated to GONG's deployment history. That characterization is not corroborated by
  repository evidence and should not be relied upon.

No additional Phase 2 scope is accepted; new work belongs to Phase 3.

## Repository Context

Repository: `enxpower/notion-doc-publisher-v3`

## How Future Agents Should Use This Document

Read this after AGENTS.md and before implementation. Use it to understand why the rules exist.
