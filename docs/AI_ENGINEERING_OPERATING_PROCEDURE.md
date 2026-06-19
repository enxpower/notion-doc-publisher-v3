# AI Engineering Operating Procedure

Use this document to teach Claude Code, Claude Web, Codex, ChatGPT, and future AI coding agents how to work in notion-doc-publisher-v3.

For the copy/paste first-message prompt, use `AI_ENGINEERING_OPERATING_PROMPT.md`.

## Mandatory Principle

Your first responsibility is not coding.

Your first responsibility is understanding owner intent, project context, constitution, architecture, and governance.

## Mandatory Review

Before coding, reviewing, commenting, creating PRs, merging PRs, or proposing architecture changes, read:

1. `AGENTS.md`
2. `docs/OWNER_INTENT.md`
3. `docs/PROJECT_CONTEXT.md`
4. `docs/PRODUCT_CONSTITUTION.md`
5. `docs/SYSTEM_ARCHITECTURE.md`
6. `docs/ENGINEERING_GOVERNANCE.md`
7. `docs/AI_ENGINEERING_OPERATING_PROCEDURE.md`

If the task involves HTML output or publishing:
8. `docs/HTML_PUBLISHING_GOVERNANCE.md`

If any required file is missing:

STOP. Report the missing file. Do not implement.

## Authority Order

1. OWNER_INTENT
2. PROJECT_CONTEXT
3. PRODUCT_CONSTITUTION
4. SYSTEM_ARCHITECTURE
5. ENGINEERING_GOVERNANCE
6. HTML_PUBLISHING_GOVERNANCE for publishing/HTML tasks
7. Existing code

Code never overrides governance.

## Development Rule

Never start coding immediately.

Always:

1. Understand objective.
2. Check architecture impact.
3. Check governance impact.
4. Identify affected layers.
5. Propose implementation.
6. Implement only after alignment.

## PR Workflow

Every feature follows:

Draft PR
-> Review
-> Fix findings
-> Ready for review
-> Merge after explicit owner approval

No direct main commits.
No implementation without governance review.
No merge during review.
No deploy unless explicitly authorized.

## Notion API Rule

Notion writes are restricted:

- `assign-id` (`src/cli/assign-id.ts`) — the only command that writes DOC_ID to Notion.
- `writeback-preview` (`src/cli/writeback-preview.ts`) — writes build results back to Notion.
- All other commands (`validate`, `build`, `preview`, `clean`) are read-only with respect to Notion.

Do not add Notion writes outside these two commands without explicit owner approval.

## Safety Rule

Default deny.

Explicit approval required for:

- deployment
- publishing to production documentation sites
- Notion API writes outside assign-id and writeback
- production secrets
- live database mutation
- destructive commands
- workflow changes

## Scope Rule

Implement only the requested layer or vertical slice.

Do not:

- move or rename existing source files
- change CLI command names or npm script names
- change output paths under `dist/docs/{DOC_ID}/`
- refactor unrelated systems
- expand scope

## Required Outputs

Implementation PR:

- Draft PR URL
- Architecture summary
- Files changed
- Behavior summary
- Validation results (npm run check, npm test, npm run lint:security)
- Governance compliance
- Risks / limitations
- Confirmation no merge/deploy

Review:

- Findings
- Risks
- Required fixes
- Human merge recommendation
- Confirmation no merge/deploy

## Success Metric

Success is not "code was written."

Success is:

Owner intent
-> Project context
-> Constitution
-> Architecture
-> Governance
-> Implementation
-> Review
-> Merge

all remain aligned.

Default final line:

No production deployment was performed.
