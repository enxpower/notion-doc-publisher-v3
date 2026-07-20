# Phase 2 Final Production Seal

## Status and authority

This document records the final production operating state after the Phase 2 baseline, PR #55, the one-click production changes, and the July 20, 2026 scheduler incident.

It is subordinate to `OWNER_INTENT`, `PROJECT_CONTEXT`, `PRODUCT_CONSTITUTION`, `SYSTEM_ARCHITECTURE`, and `ENGINEERING_GOVERNANCE`, but it supersedes conflicting operational descriptions in `docs/PHASE2_BASELINE.md` for the items explicitly covered here.

## Sole production publisher

The only automatic production publisher is:

- File: `.github/workflows/incremental-content-publish.yml`
- Display name: `Incremental Content Publish`
- Concurrency group: `incremental-content-publish`
- `cancel-in-progress: false`

No other workflow may:

- contain an automatic `schedule:` trigger for production publishing;
- invoke `gh workflow run incremental-content-publish.yml`;
- deploy an automatic competing GitHub Pages artifact;
- write production lifecycle success fields to Notion.

The regression suite structurally scans every workflow file to enforce these rules. Filename-based detection alone is not an acceptable safety control.

## Trigger model

The production workflow has exactly three approved triggers:

| Trigger | Behavior |
|---|---|
| `workflow_dispatch` | One-click production `apply`; no inputs and no confirmation phrase. |
| `schedule` | Daily production `apply` at `0 9 * * *` UTC. |
| Owner command on Issue #44 | Production `apply`, restricted to issue 44, actor `enxpower`, and the exact command prefix. |

Manual dispatch is intentionally one click. Any future reintroduction of `mode`, `confirm_production`, or other dispatch inputs is a production behavior change requiring explicit owner approval.

## Automatic identity initialization

Before the read-only lifecycle plan begins, a production apply run automatically initializes missing system-owned identities:

1. Load current Notion documents.
2. Create and reconfirm the collision-safe DOC_ID assignment plan.
3. Write only missing DOC_ID values.
4. Reload from Notion.
5. Generate and persist stable Share Tokens for private-link documents.
6. Reload and fail closed if any publishable document still lacks a required DOC_ID or Share Token.
7. Enter read-only lifecycle planning.

Existing DOC_IDs and Share Tokens are never rotated or reassigned by this process.

The narrowly authorized Notion mutation boundary is limited to the existing identity operations required for this initialization. Standalone planning and non-production execution remain non-mutating.

## Preview Publish isolation

`.github/workflows/preview-publish.yml` is manual QA only and is strictly read-only with respect to production state.

It must:

- use `npm run build:readonly-validation`;
- never run `npm run assign-id`;
- never run `npm run ci:writeback` or any other Notion writeback command;
- never deploy GitHub Pages;
- never commit to production target repositories.

Preview output may exist only in the workflow workspace and short-lived diagnostics. Preview failure must not change production Notion fields.

## Fixed production transaction order

The production apply path remains fail closed in this order:

1. Initialize missing system-owned identities.
2. Create the incremental lifecycle plan.
3. Render only CREATE, UPDATE, and MOVE records.
4. Generate required PDFs.
5. Deploy changed brand outputs.
6. Verify the live deployment.
7. Persist verified private state.
8. Write verified lifecycle results to Notion.

Notion lifecycle success must never be written before live verification and private-state persistence.

## July 20, 2026 scheduler incident

A temporary workflow named `_run-production-once.yml` was added with a `*/5 * * * *` schedule. Despite its name, it was an unlimited five-minute dispatcher and therefore violated the sole-publisher architecture.

The workflow was removed from `main` in commit `a9062b7a3b2cdb61966ded660c0239ff3f82732c`.

Root control failure:

- the previous regression test guessed suspicious workflow filenames;
- it did not structurally count schedules or detect indirect dispatch commands;
- `_run-production-once.yml` therefore bypassed the test.

Permanent correction:

- tests now scan every YAML workflow;
- exactly one scheduled workflow is permitted: `incremental-content-publish.yml`;
- no workflow may indirectly dispatch the production publisher;
- suspicious temporary workflow names are also rejected as a secondary control.

## Break-glass production repair

Normal development remains branch-first and PR-first.

A direct production repair is permitted only when all of the following are true:

1. The owner explicitly authorizes immediate production action in the current conversation or issue.
2. A concrete active production defect or security risk is identified.
3. The change is the smallest safe correction.
4. The action and resulting commit are recorded.
5. A follow-up branch and PR restore tests, documentation, and governance evidence before final sealing.

Break-glass authority does not permit secret exposure, destructive Notion edits, identity rotation, output-path redesign, or creation of a second publisher.

## Final production acceptance gate

The system may be declared production-ready only after a post-seal production run provides all of the following evidence:

- workflow conclusion is `success`;
- required DOC_ID and Share Token values are non-empty;
- target repository or Pages deployment evidence exists for changed records;
- live URL verification succeeds;
- private state is persisted after live verification;
- Notion writeback occurs after private-state persistence;
- `PUBLISHED_URL` and published lifecycle fields are correct;
- a second run completes successfully as NOOP for unchanged content;
- repository checks pass: `npm run check`, `npm test`, and `npm run lint:security`.

Until this evidence exists for the final branch/merge state, code review and CI alone are not sufficient to claim production sealing.

## Final sealing change record

PR #56 is the governed consolidation PR for workflow-topology regression protection, Preview Publish isolation, final operational documentation, and the post-incident acceptance cycle.
