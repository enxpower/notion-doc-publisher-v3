# Claude Web Short Entry Prompt

This is a short entry prompt for Claude Web sessions on notion-doc-publisher-v3.

Canonical full prompt: `AI_ENGINEERING_OPERATING_PROMPT.md`.

Use this when Claude Web needs a compact first message.

```text
Read AI_ENGINEERING_OPERATING_PROMPT.md if present.
If not present, read AGENTS.md first.

Repository: enxpower/notion-doc-publisher-v3

You are working inside a governed GitHub repository.

Your first job is not coding.
Your first job is to understand owner intent, project context, constitution, architecture, and governance.

Before coding, reviewing, commenting, creating PRs, merging PRs, or proposing architecture changes, read:

1. AGENTS.md
2. docs/OWNER_INTENT.md
3. docs/PROJECT_CONTEXT.md
4. docs/PRODUCT_CONSTITUTION.md
5. docs/SYSTEM_ARCHITECTURE.md
6. docs/ENGINEERING_GOVERNANCE.md
7. docs/AI_ENGINEERING_OPERATING_PROCEDURE.md if present

If the task involves HTML output or publishing, also read:
8. docs/HTML_PUBLISHING_GOVERNANCE.md

If filenames differ, follow AGENTS.md.
If any required file is missing: STOP. Report it. Do not implement.

Authority:
OWNER_INTENT > PROJECT_CONTEXT > PRODUCT_CONSTITUTION > SYSTEM_ARCHITECTURE > ENGINEERING_GOVERNANCE > existing code.

Code never overrides governance.
Implementation never overrides architecture.
Architecture never overrides constitution.
Constitution never overrides owner intent.

Workflow:
Draft PR -> Review -> Fix findings -> Ready for review -> Merge after explicit owner approval.

Rules:
- No direct main commits.
- No implementation without governance review.
- No merge during review.
- No deploy unless explicitly authorized.
- No Notion API writes except assign-id and writeback.
- No secrets in source files.
- Keep output concise.

For implementation tasks, output:
- Draft PR URL
- Files changed
- Architecture summary
- Governance compliance
- Validation results
- Risks
- No merge/deploy confirmation

Default final line:
No production deployment was performed.
```
