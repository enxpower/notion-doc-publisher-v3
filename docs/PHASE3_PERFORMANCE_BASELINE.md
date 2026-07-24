# Phase 3 Performance Baseline

This is additive Phase 3 (Prompt 6) hardening. It does not rewrite or reinterpret Phase 2's
sealed historical evidence in `docs/PHASE2_BASELINE.md`; it adds a performance dimension on
top of it. Nothing in this document is production-proven — the code described here has not
yet run in production. All claims are labeled as **locally benchmarked**, **structurally
validated**, or **expected production impact**, never as a proven production result.

## 1. Historical Workflow Measurements

Measured directly from GitHub's own run/job/step timestamps (read-only, via `gh api`) for
runs already cited as evidence in `docs/PHASE2_BASELINE.md`. All timestamps are UTC; durations
are `completed_at - started_at` for each step, and `updated_at - created_at` for whole-run
wall-clock.

| Run | Trigger | Conclusion | Total wall-clock | Notes |
|---|---|---|---|---|
| `29705771289` | issue_comment | success | 7m47s | UPDATE:1, GONG deployed (see `docs/PROJECT_CONTEXT.md` GONG evidence) |
| `29712218993` | issue_comment | success | 17m28s | UPDATE:13, REMOVE:4, NOOP:2, FILTERED:37 (56 total records) — heaviest render/deploy run cited in Phase 2 evidence |
| `29712842368` | issue_comment | success | 4m49s | Pure NOOP: FILTERED:41, NOOP:15 (56 total records), zero render/deploy/mutation |
| `29714820961` | workflow_dispatch | success | 5m20s | Post-scheduling-fix verification, zero work |

Per-step breakdown for the two most informative runs (`29712218993`, heavy apply; `29712842368`,
pure NOOP), both operating on **56 total Notion records**:

| Step | `29712218993` (heavy apply) | `29712842368` (pure NOOP) |
|---|---|---|
| Checkout publisher | 1s | 1s |
| Checkout private state | 1s | 2s |
| Checkout ENERGIZE/AGIM/GONG (3 steps combined) | 7s | 6s |
| Setup Node + `npm ci` | 6s | 3s |
| **Create incremental lifecycle plan** (`plan:incremental` — full Notion fetch of all 56 records + classification) | **166s** | **128s** |
| Typst + font install | 22s (render work required) | 0s (correctly skipped — see §8) |
| **Apply incremental output locally** (`publish:incremental` — a *second, independent* full Notion fetch of all 56 records, then render/PDF/copy) | **158s** | **130s** |
| ARCBOS Pages artifact prep/deploy | 8s | 0s |
| Commit target repositories | 3s | 0s |
| **Verify live deployment transaction** | **634s (61% of total run)** | 3s |
| Persist state + Notion writeback | 20s | 3s |

## 2. Measurement Limitations

- GitHub's job/step API exposes only step-level start/complete timestamps, not sub-step
  timing (e.g., it cannot separately show "Notion query" vs. "block fetch" vs. "classification"
  time within the single "Create incremental lifecycle plan" step). Those sub-costs are
  **inferred**, not measured, from the local synthetic benchmark in §3 and the fact that this
  step is read-only Notion I/O dominated.
- No historical run recorded document count separately from lifecycle-action counts; "56 total
  records" is **derived** from the cited lifecycle count breakdowns (FILTERED+NOOP+UPDATE+REMOVE),
  not a directly logged document count.
- Render/PDF sub-durations within "Apply incremental output locally" are **unavailable** —
  GitHub does not expose them as separate steps.
- "Verify live deployment transaction" duration (634s in the heavy-apply run) reflects live CDN
  propagation polling with retries, not CPU/network efficiency of this codebase — it is
  correctness-critical (fail-closed live verification) and explicitly out of scope for
  optimization in this prompt.

## 3. Local Synthetic Benchmark

Reproducible, offline, no network access: `scripts/benchmark-fetch-concurrency.mjs`. Simulates
independent per-document latency with `setTimeout` through the same `mapWithConcurrency` helper
used in production code (`src/util/concurrency.ts`). Re-run this script (`node
scripts/benchmark-fetch-concurrency.mjs`) before considering any change to the default
concurrency.

Measured results (elapsed ms, mean of a single run; relative speedup vs. serial is the
meaningful number, not the absolute ms, which varies by machine):

| Documents | Latency/doc | Serial (conc=1) | conc=4 | conc=8 | Speedup @ conc=4 |
|---|---|---|---|---|---|
| 1 | 10-100ms | ~= latency | ~= latency | ~= latency | 1.0x (no parallel work exists) |
| 10 | 10-100ms | 111-1010ms | 34-304ms | 22-202ms | ~3.3x |
| 50 | 10-100ms | 547-5051ms | 142-1313ms | 77-707ms | ~3.85x |
| 100 | 10-100ms | 1101-10101ms | 271-2527ms | 141-1313ms | ~4.0x |

At document counts consistent with this repository's actual scale (56 records per the historical
runs above), the expected speedup at the default concurrency (4) is **structurally validated**
at roughly 3.8-4x for the per-document block-fetch portion of `loadDocuments()` — applying that
ratio to the measured 128-166s plan-step duration suggests (not proven in production) a reduction
to roughly 33-43s for that step alone, once merged and run in production.

Local unit/integration tests (`src/tests/publishing-pipeline-concurrency.test.ts`) additionally
prove, with mocked Notion responses and controllable delays (never real wall-clock thresholds):
bounded concurrency never exceeds the configured maximum, output order matches input order
regardless of completion order, every document is returned exactly once, a single failure fails
the whole load and identifies the failing page, concurrency=1 reproduces strictly serial
ordering, invalid concurrency overrides fail closed to the default, and zero write (`PATCH`)
requests are ever issued from this path.

## 4. Optimization Decision Table

| Candidate | Measured baseline | Expected benefit | Correctness risk | Rate-limit risk | Complexity | Testability | Decision |
|---|---|---|---|---|---|---|---|
| Bounded concurrency in `loadDocuments()` per-page block fetch | 128-166s serial for 56 records (historical); 100 docs @ 50ms: 5103ms serial vs 1277ms @ conc=4 (local benchmark) | Material — recurring cost on every run, changed or not | Low — retry/backoff untouched, ordering preserved, first failure still fails the whole load | Low-moderate — conc=4 is the prompt's own recommended default; existing per-request 429/Retry-After handling is untouched and reused | Low — small dependency-free helper | High — 13 dedicated tests | **Implemented** |
| Notion-read prefiltering before NOOP reconciliation reads | Previously: 1 Notion read per NOOP record regardless of eligibility | Eliminates reads entirely for structurally ineligible NOOP records (the common case) | Very low — pure reordering; combined behavior is provably identical to the prior single-pass check | None — strictly fewer reads | Low | High — 5 new tests plus all 14 pre-existing Prompt 3 tests still pass unchanged | **Implemented** |
| Bounded concurrency for reconciliation Notion reads specifically | Typically few records reach the read stage after prefiltering | Small remaining win | Low but non-zero — would need the same ordering guarantees extended to writes | Low | Moderate | Medium | **Deferred** — prefiltering already removes most of the cost; the remaining serial loop is small and mutation-order determinism is prioritized over shaving it further |
| Eliminate the duplicate full-Notion-fetch between the plan step and the apply step | Measured: ~166s + ~158s (heavy run) / ~128s + ~130s (NOOP run) — both steps independently re-fetch all 56 records because they are separate OS processes and only `plan.json` (not full document content) is passed between them | High potential (~50% reduction of the combined ~260-320s) | **High** — requires restructuring the CLI/workflow boundary between two currently-separate `npm run` steps; risks altering the plan→apply transactional separation Prompt 2-4 explicitly protect from redesign | N/A | High | Would need new integration tests plus a workflow-structure change | **Deferred to a future dedicated prompt** — real, measured, highest-value finding, but not "bounded, low-risk" within this prompt's scope |
| Skip ENERGIZE/AGIM/GONG target-repo checkout on pure-NOOP runs | Measured: ~6s combined out of a 289s-1048s run (0.6-2%) | Negligible | Moderate — would need a per-brand "has changes" signal computed before checkout, which the workflow's current control-flow order does not provide | N/A | Moderate | Would need workflow restructuring | **Rejected** — not material given the measured cost, and not worth the restructuring risk |
| Skip private-state checkout on any run | N/A | N/A | N/A — required, since NOOP classification itself depends on reading previous state | N/A | N/A | N/A | **Rejected** — not redundant; required by design |
| Typst/font installation gating on render work | Already 0s on pure-NOOP runs (measured) | N/A — already achieved | N/A | N/A | N/A | **Newly added** a structural regression test proving this gating remains intact | **No change needed; verified with new test** |
| Aggregate-only observability (counts + elapsed ms in the writeback summary) | N/A | Improves future measurability, no behavior change | None — read-only counters wrapping existing calls | None | Low | 1 new dedicated test | **Implemented** |

## 5. Bounded Concurrency Design

- Helper: `src/util/concurrency.ts` — `mapWithConcurrency(items, concurrency, worker)`,
  dependency-free, ~50 lines.
- Default concurrency: **4** (`DEFAULT_CONCURRENCY`), bounded to `[MIN_CONCURRENCY=1,
  MAX_CONCURRENCY=8]`.
- Override: `NOTION_FETCH_CONCURRENCY` environment variable, validated by
  `resolveConcurrency()`. Any missing, non-integer, or out-of-[1,8]-range value fails closed to
  the default of 4 — invalid input never blocks a run and never silently exceeds the safe
  maximum.
- **The production workflow does not set this variable.** The code default (4) applies
  automatically; no workflow YAML change was made or is required to get this behavior once the
  branch is merged.
- Ordering: results are returned in the same order `items` (Notion's own page-query order) was
  given, regardless of which fetch completes first.
- Failure semantics: the first rejection stops new work from starting; already-in-flight workers
  finish, then the operation rejects with that first error, wrapped with the failing page's ID
  (`Failed to load Notion page <id>: <reason>`) — behavior is "first fatal failure fails the
  operation," matching the prior serial code, never a silent partial result.
- Nested traversal (e.g. table row children within one page) remains serial within that page —
  only fetches *across different pages* run concurrently.

## 6. Rate-Limit Posture

No change to retry/backoff logic. All Notion HTTP calls still go through the single
`NotionClient.request()` method (`src/notion/client.ts`), which already retries up to 5 attempts
on `429` or `5xx`, honoring the `Retry-After` header with exponential backoff otherwise
(`src/tests/notion-client-transient-retry.test.ts`, unchanged, still passing). Running up to 4
of these requests concurrently increases the instantaneous request rate but does not change
per-request retry behavior, does not remove any backoff, and does not introduce a second retry
path. 4 is the conservative default explicitly recommended for this kind of workload; raising it
should only be done after re-running `scripts/benchmark-fetch-concurrency.mjs` and confirming
via a real (non-production-credentialed) measurement that Notion's actual rate limit tolerates
it — this repository does not currently have evidence for a higher default.

## 7. Lifecycle Reconciliation Read-Cost Analysis

Before this prompt: `runNoopLifecycleReconciliation` called `readLifecycleStatus` for every
`NOOP` record unconditionally, then evaluated eligibility. After this prompt: eligibility is
split into `evaluateNoopReconciliationPreconditions` (no Notion access — checks NOOP-ness,
private-state presence/agreement, hash agreement, URL/boundary agreement) followed by the
Notion-status check only for records that pass every precondition. The combination is provably
equivalent to the prior single-pass `evaluateNoopReconciliation` (it now delegates to the split
functions internally) — eligibility, mutation content, and mutation ordering are unchanged; only
the number of Notion reads for structurally-ineligible records drops to zero. No batching, no
cross-run caching of lifecycle status, and no speculative writes were introduced.

## 8. Remaining Performance Risks

- The duplicate plan-step/apply-step Notion fetch (§4) remains the single largest recurring,
  fixable cost and was deliberately deferred — see the decision table for why.
- Live deployment verification (§1, 634s on the heaviest measured run) is CDN-propagation-bound,
  not addressed here, and should not be "optimized" by weakening verification.
- The bounded-concurrency benefit is **not yet production-proven** — it is locally benchmarked
  and structurally tested only. The first real production run after this branch merges should be
  compared against the historical baseline in §1 using the same `gh api ... /jobs` method.
- Test-suite runtime itself remains small (336 tests, ~0.6s total as of this prompt) and is not a
  bottleneck; no changes were made there.

## 9. Re-Measurement Guidance for Future Maintainers

Before raising `NOTION_FETCH_CONCURRENCY` above 4, or introducing it into the production
workflow:

1. Re-run `node scripts/benchmark-fetch-concurrency.mjs` locally and confirm the expected
   speedup still holds at the current document-count scale.
2. Confirm Notion's actual observed rate-limit behavior (429 frequency) at the higher
   concurrency using a non-production, low-risk credential/environment — never assume.
3. Re-run the full test suite (`npm test`) including
   `src/tests/publishing-pipeline-concurrency.test.ts`.
4. After merge, pull the next real production run's job/step timings via `gh api
   repos/enxpower/notion-doc-publisher-v3/actions/runs/<id>/jobs` and compare against §1 before
   claiming any production improvement.
