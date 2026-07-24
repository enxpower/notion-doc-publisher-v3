# Project Lifecycle

This document defines how notion-doc-publisher-v3 moves from governance setup to ongoing delivery.

## Numbering Clarification (Phase 3 Prompt 6 note)

This document's "Phase 0" through "Phase 5" below is a **separate, legacy governance-bootstrap
numbering**, distinct from the operational Phase 1 / Phase 2 / Phase 3 numbering used in
`docs/PHASE2_BASELINE.md`, `docs/PHASE2_FINAL_PRODUCTION_SEAL.md`, and the current governed
Phase 3 prompt sequence (`docs/PROJECT_CONTEXT.md`, `docs/SYSTEM_ARCHITECTURE.md`). The two
numbering schemes do not align one-to-one and predate the current governance model; this
document's "Current Phase" section below (written when only Phase 1 was sealed) has not been
updated since. For the authoritative current phase status, read `docs/PHASE2_BASELINE.md` and
`docs/PROJECT_CONTEXT.md` — not the phase numbers in this file. This note is added only to
prevent confusion; the rest of this document is left as historical record and not rewritten.

## Lifecycle Principles

Every phase must preserve:

- Owner intent.
- Product identity.
- Architecture integrity.
- Secret and production-data safety.
- Reviewability through branches and pull requests.
- Validation before confidence.
- Release safety.

## Current Phase

**Phase 1 production release complete (v1.0.0, July 19, 2026)**

Released scope:
- ARCBOS and ENERGIZE routed publishing are live.
- One Notion database remains the source of truth.
- HTML and PDF outputs are brand-isolated.
- Published URL writeback is route-aware and idempotent.
- AGIM is configured but inactive because it has no current publishable output.
- GONG remains blocked pending owner confirmation of its target repository.

Phase 1 is frozen. No additional Phase 1 features are accepted.

## Phase 0: Governance Foundation (Completed)

Goal: Establish the local governance system before implementation begins.

Required artifacts:
- AGENTS.md
- PROJECT_BOOTSTRAP_PROMPT.md
- GOVERNANCE_CHECKLIST.md
- PROJECT_LIFECYCLE.md
- docs/OWNER_INTENT.md
- docs/PROJECT_CONTEXT.md
- docs/PRODUCT_CONSTITUTION.md
- docs/SYSTEM_ARCHITECTURE.md
- docs/ENGINEERING_GOVERNANCE.md
- docs/HTML_PUBLISHING_GOVERNANCE.md
- .github/workflows/preview-publish.yml

Exit criteria:
- Governance files exist locally in the repository.
- Agents can recover context without chat history.
- Initial governance changes are reviewed through a PR.

## Phase 1: Product and Architecture Definition (Completed)

Goal: Convert the project idea into clear product, domain, and architecture decisions.

Completed artifacts:
- docs/SYSTEM_BLUEPRINT.md
- docs/ARCHITECTURE_DECISIONS.md
- docs/ARCHITECTURE_REVIEW.md
- docs/DOCUMENT_MODEL.md
- docs/NOTION_SCHEMA.md
- docs/OUTPUT_SPEC.md

## Phase 2: Minimal Implementation (Current)

Goal: Build the smallest useful version that proves the core project direction.

Allowed work:
- Implement the primary build and publish workflow.
- Add essential validation and regression tests.
- Add preview deployment via GitHub Actions.
- Add lightweight operational documentation.

Not allowed:
- Broad unrelated refactors.
- Production deployment without explicit approval.
- Secret or production-data changes without explicit approval.

Exit criteria:
- Preview publishing works end-to-end.
- Relevant checks pass or exceptions are documented.
- Known limitations are explicit.
- The owner can review the project through PRs.

## Phase 3: Hardening (Upcoming)

Goal: Improve reliability, safety, and maintainability before broader release.

Allowed work:
- Expand automated tests.
- Strengthen governance and architecture guards.
- Improve error handling.
- Clarify documentation.
- Remove risky shortcuts from earlier phases.

Exit criteria:
- Critical paths have test coverage.
- Failure modes are understood.
- Release process is documented.
- Rollback or recovery path is documented.

## Phase 4: Release Readiness (Future)

Goal: Confirm the project is ready for an approved release or deployment to production documentation sites.

Allowed work:
- Final release checks.
- Release notes.
- Deployment plan for production docs sites.
- Rollback plan.
- Owner approval record.

AI coding agents must not tag, release, or deploy unless the owner explicitly requests those actions.

## Phase 5: Ongoing Evolution (Future)

Goal: Continue improving the project without eroding its original intent.

Allowed work:
- Feature additions aligned with the Product Constitution.
- Architecture improvements aligned with the System Architecture.
- Governance updates based on real project lessons.
- Test and guard improvements.

## Stop Conditions

Stop and request owner review if a phase change would:

- Change product identity.
- Change the primary domain object (Document).
- Change source-of-truth ownership.
- Bypass architecture boundaries.
- Reduce required validation.
- Require production data, production secrets, deployment, or release actions without explicit approval.
- Make the project harder for future agents to understand from local repository context.
