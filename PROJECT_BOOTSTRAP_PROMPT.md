# Project Bootstrap Prompt

Use this prompt to start a new AI coding-agent session for notion-doc-publisher-v3.

## Purpose

This prompt gives an AI coding agent the minimum context and operating rules it needs before making changes in this repository.

It is designed to:

- Force local project context recovery.
- Keep work GitHub-first.
- Require governance documents before implementation.
- Prevent undocumented production, deployment, or secret changes.
- Make the agent explain governance alignment before editing.

## How to Use

Copy the prompt below into the first message of a new AI coding-agent session.

Replace `[DESCRIBE_THE_REQUESTED_CHANGE]` with the specific task.

## Bootstrap Prompt

```text
Read AGENTS.md first.

Repository:
enxpower/notion-doc-publisher-v3

Task:

[DESCRIBE_THE_REQUESTED_CHANGE]

Mandatory governance review:

1. Read AGENTS.md.
2. Read docs/OWNER_INTENT.md.
3. Read docs/PROJECT_CONTEXT.md.
4. Read docs/PRODUCT_CONSTITUTION.md.
5. Read docs/SYSTEM_ARCHITECTURE.md.
6. Read docs/ENGINEERING_GOVERNANCE.md.
7. Read docs/AI_ENGINEERING_OPERATING_PROCEDURE.md.

If this task involves HTML or publishing output, also read:
8. docs/HTML_PUBLISHING_GOVERNANCE.md.

If any required file is missing:
STOP.
Report it.
Do not implement.

If this task conflicts with governance:
STOP.
Explain conflict.
Do not implement.

Required workflow:

- Inspect current branch context.
- Inspect open PRs.
- Define scope.
- Identify affected layers.
- Create or use a scoped branch.
- Make one auditable vertical-slice change.
- Add or update tests where relevant.
- Run: npm run check && npm test && npm run lint:security
- Open or update a Draft PR.
- Do not merge.
- Do not deploy.
- Do not modify production secrets.
- Do not call Notion API except via assign-id or writeback scripts.
- Use concise output.

Output:

- Draft PR URL
- Files changed
- Architecture summary
- Governance compliance
- Checks run and results
- Risks / limitations
- Confirmation no merge/deploy

No production deployment was performed.
```

## Non-negotiable rules (do not remove)

- Required reading of local governance documents.
- Branch and pull request workflow.
- Draft PR requirement.
- Review-before-merge discipline.
- No-merge and no-deploy boundaries.
- Secret and production-data protections.
- No Notion API writes except via assign-id and writeback.
