# Governance Checklist

Use this checklist before, during, and after AI-assisted work in notion-doc-publisher-v3.

## Purpose

This checklist helps owners, reviewers, and AI coding agents confirm that a change follows the project governance system before it is merged or released.

For each item, mark one of:

- `Done`: completed and verified.
- `N/A`: not applicable, with a short reason.
- `Blocked`: cannot complete without owner input or external access.

## Pre-Work Checklist

- [ ] AGENTS.md was read.
- [ ] PROJECT_BOOTSTRAP_PROMPT.md was used or consciously skipped with a reason.
- [ ] Owner Intent was read.
- [ ] Project Context was read.
- [ ] Product Constitution was read.
- [ ] System Architecture was read.
- [ ] Engineering Governance was read.
- [ ] Current branch context was inspected.
- [ ] Open PRs were inspected.
- [ ] Task scope is small and clearly bounded.
- [ ] The task does not require production deployment.
- [ ] The task does not require production secrets.
- [ ] The task does not conflict with project stop conditions.
- [ ] The task does not write to Notion except via assign-id or writeback.

## Planning Checklist

- [ ] Governance alignment was explained before editing.
- [ ] The expected files or modules were identified.
- [ ] Architecture impact was considered.
- [ ] Rollback path is straightforward.
- [ ] Out-of-scope work was intentionally left out.

## Implementation Checklist

- [ ] Work was done on a feature, fix, docs, or governance branch.
- [ ] Changes are scoped to the requested task.
- [ ] No unrelated refactors were included.
- [ ] No checks were removed to make work pass.
- [ ] No sensitive configuration was added to source control.
- [ ] No secrets or API keys were added to source files.
- [ ] Existing source files were not moved or renamed.
- [ ] Existing CLI commands and output paths were not changed.
- [ ] Documentation was updated where relevant.
- [ ] Tests were added or updated where relevant.

## Validation Checklist

- [ ] `npm run check` passed (TypeScript type check).
- [ ] `npm test` passed (regression tests, no Notion access).
- [ ] `npm run lint:security` passed.
- [ ] Any skipped check is documented with a reason.
- [ ] Any failing check is documented and not hidden.

## Pull Request Checklist

- [ ] Draft PR was opened or updated.
- [ ] PR explains purpose.
- [ ] PR explains scope.
- [ ] PR lists changed files.
- [ ] PR explains governance alignment.
- [ ] PR explains architecture impact.
- [ ] PR lists checks run and results.
- [ ] PR lists known limitations.
- [ ] PR does not request merge before review.

## Final Safety Checklist

- [ ] No merge was performed.
- [ ] No release tag was created.
- [ ] No production deployment was performed.
- [ ] No production Notion database was written to.
- [ ] No production secrets were modified.
- [ ] Remaining risks are documented.
- [ ] The final report includes files changed, summary, checks, and PR URL.
