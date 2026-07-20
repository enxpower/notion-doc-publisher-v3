# Release Notes

Concise production release history for `notion-doc-publisher-v3`. This is a record of what shipped and why — for the current authoritative operating state, see `docs/PHASE2_BASELINE.md`.

Dates and merge commits below are taken directly from GitHub PR metadata (`mergedAt`, merge commit SHA) at the time this document was written. Run IDs are cited only where independently observed; nothing here is inferred.

## 2026-07-20 — Phase 2 Production Baseline Sealed

Sealing sequence for the day: an ARCBOS Pages artifact production defect was found, root-caused, and repaired (PR #49–#52), followed by a separate production scheduling-ownership defect (PR #53). Full current state: `docs/PHASE2_BASELINE.md`.

### PR #49 — ARCBOS artifact inline Bash quote repair

- Merge commit: `480b1b7`
- Merged: 2026-07-20T01:04:08Z

**Problem:** The "Prepare sanitized ARCBOS Pages artifact" step in `.github/workflows/incremental-content-publish.yml` contained an inline Bash `find` clause with an unterminated quote (`-iname '*audit*` missing its closing `'`), producing `unexpected EOF while looking for matching `'`` and blocking every downstream step (Pages deploy, live verification, private state persistence, Notion writeback).

**Resolution:** Extracted the sanitation logic into `scripts/prepare-arcbos-pages-artifact.sh` — a standalone, `set -euo pipefail` script with the quote bug fixed, plus explicit verification of required artifact content (`CNAME`, `.nojekyll`, at least one HTML file, `assets/arcbos-favicon.svg`) and a fail-closed credential-shaped content scan. The workflow now calls it as a single step.

**Validation:** `npm run check`, `npm test`, `npm run lint:security`, `git diff --check`, `bash -n scripts/prepare-arcbos-pages-artifact.sh` — all passing locally and in CI before merge.

**Operational impact:** Unblocked the ARCBOS Pages deploy step; no behavior change to the four-brand routing, DOC_IDs, or Share Tokens.

### PR #50 — Resilient pinned Typst installation

- Merge commit: `d29a093`
- Merged: 2026-07-20T01:43:09Z

**Problem:** After PR #49 merged, the next production run (`29710382031`) failed at "Install Typst for render work" during a GitHub-wide API partial outage (confirmed via `githubstatus.com`: API Requests `partial_outage`, Issues `degraded_performance` at the time). `typst-community/setup-typst@v4` resolves the requested Typst version through the GitHub releases API — exactly the degraded surface.

**Resolution:** Replaced the action with a pinned (`v0.13.1`), retrying (`curl --retry 8 --retry-all-errors`) direct download from the tagged GitHub release asset URL (not the releases API), with a `cargo install --locked` fallback to crates.io if the direct download fails.

**Validation:** `git diff --check`, workflow YAML parse check, `bash -n` on the extracted install block, confirmed no `api.github.com` / releases-list / releases-latest call was introduced. CI (`Publisher CI`, run `29711318038`) passed before merge.

**Operational impact:** Removed a single point of failure tied to GitHub API availability during scheduled/production render work. No change to PDF rendering behavior itself.

### PR #51 — Favicon validation scope correction

- Merge commit: `524d961`
- Merged: 2026-07-20T02:14:24Z

**Problem:** The next production run (`29711374297`) failed the new `prepare-arcbos-pages-artifact.sh` script's favicon-reference check with `6` missing references. Investigation found the 6 files are brand-agnostic portal pages (site root `index.html`, `register/index.html`, `docs/index.html`, and one `index.html` per namespace root) rendered by `src/render/render-html.ts`'s `renderIndexHtml` / `renderNamespaceRootHtml` / `renderDocsRootHtml` — none of which emit a brand favicon `<link>` for any brand. This is pre-existing, shared rendering behavior across all four brands, not something introduced by PR #49.

**Resolution:** Scoped the favicon-reference requirement in `scripts/prepare-arcbos-pages-artifact.sh` to actual document pages (HTML files at path depth ≥ 2 under the artifact root, e.g. `docs/<DOC_ID>/index.html`) instead of every HTML file. A follow-up commit in the same PR fixed a GNU/BSD `xargs` empty-input divergence discovered when CI (Linux/GNU coreutils) failed a fixture test that had passed locally on macOS/BSD coreutils — replaced the `find | xargs` pipeline with a plain Bash array, removing the ambiguity entirely.

**Validation:** `npm run check`, `npm test` (243 → 245 as later tests were added; 243 at this PR), `npm run lint:security`, `git diff --check`, manual fixture verification against a directory shape mirroring real production output. CI passed on the second commit (run `29712191424`) after the first commit's CI failure (run `29712063809`) was fixed.

**Operational impact:** Unblocked the ARCBOS Pages deploy step for real. The shared portal-page favicon gap itself was left unfixed as out of scope (see `docs/PHASE2_BASELINE.md`, "Known Limitations").

### PR #52 — Documentation update

- Merge commit: `5ad7c83`
- Merged: 2026-07-20T02:59:55Z

**Problem:** README.md's "Phase 2 seal" section did not record the PR #49–#51 defect repair.

**Resolution:** Added a "Post-seal defect repair (2026-07-20)" note under the existing "Phase 2 seal" section, summarizing PR #49–#51 and the production verification that followed (ARCBOS Pages deploy, live favicon for all four brands, private state persistence, Notion writeback, and a verified zero-work NOOP run).

**Validation:** `git diff --check`. No `Publisher CI` run — README-only changes are outside that workflow's trigger paths (`src/**`, `tests/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `.github/workflows/**`).

**Operational impact:** Documentation only.

### PR #53 — Single scheduled production publisher and Preview Publish isolation

- Merge commit: `b95380e`
- Merged: 2026-07-20T03:30:25Z

**Problem:** A separate, previously-unaddressed production scheduling conflict: `.github/workflows/preview-publish.yml` ran on a twice-daily cron (`0 6,18 * * *`) and on every push to `main`, and was capable of deploying to the same GitHub Pages site (`docs.arcbos.com`, confirmed `build_type: "workflow"` via the GitHub Pages API) as `.github/workflows/incremental-content-publish.yml`. Two automatic, differently-triggered workflows could both deploy the ARCBOS production Pages artifact.

**Resolution:**
- `incremental-content-publish.yml`: added exactly one daily cron (`0 9 * * *` UTC), extended the job-level guard to permit `schedule` events, and added an explicit branch forcing scheduled runs onto the real `apply` path. `workflow_dispatch` confirmation and the Issue #44 owner-command restriction are unchanged.
- `preview-publish.yml`: removed its `schedule:` and `push:` triggers (now `workflow_dispatch`-only); removed the entire Pages prepare/configure/upload/deploy step chain along with the `pages`/`id-token` permissions and `github-pages` deployment environment that made it possible — structurally, not just conditionally, incapable of deploying to Pages; hardcoded `PREVIEW_DEPLOY_ENABLED: "false"` in the workflow itself so a stale repository variable cannot silently re-enable it.
- Added `src/tests/pages-deployment-ownership.test.ts` to audit every workflow file for Pages-deploy actions and enforce that only the designated owner may use them automatically.
- Updated two existing tests (`src/tests/incremental.test.ts`, `src/tests/pdf-site.test.ts`) that encoded the old "no schedule" / "Preview Publish deploys Pages" invariants, which the owner's decision deliberately reversed.

**Validation:** `npm run check`, `npm test` (245/245, confirmed both locally and directly from the CI job log for run `29714723789`), `npm run lint:security`, `git diff --check`, YAML syntax validation for both changed workflow files. CI (`Publisher CI`, run `29714723789`) passed before merge.

**Production verification after merge:**
- Manual `workflow_dispatch` apply run (`29714820961`, `confirm_production=PHASE2-INCREMENTAL-PUBLISH`) completed successfully with zero work (state already current) — confirming the confirmation-phrase path still works and independently reconfirming NOOP idempotency. Private state repository commit hash unchanged.
- Manual Preview Publish run (`29715096766`) completed successfully with zero Pages-related steps present in its step list at all. Live ARCBOS favicon and a live ARCBOS document page were SHA-256 hashed before and after; both hashes were identical.
- Daily schedule confirmed present in the merged workflow file on `origin/main`.

**Operational impact:** Closes a real production-collision risk. No change to render/PDF/deploy/verify/state/writeback logic or ordering.

## Related Documents

- `docs/PHASE2_BASELINE.md` — current authoritative production baseline.
- `docs/PHASE_2_INCREMENTAL_PUBLISHING.md` — full Phase 2 lifecycle, manifest, and hashing design.
- `docs/PHASE2_SEALING_CHECKLIST.md` — production lifecycle-action proof checklist (predates this baseline; see `docs/PHASE2_BASELINE.md` "Known Limitations" for its current status).
