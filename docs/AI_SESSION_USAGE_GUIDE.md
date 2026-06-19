# AI Session Usage Guide

Use this guide when choosing which prompt to send to an AI coding agent working on notion-doc-publisher-v3.

## One-Click New Session

Use:

- `AI_ENGINEERING_OPERATING_PROMPT.md`

This is the universal first message for:

- Claude Code
- Claude Web
- Codex
- ChatGPT
- any future AI coding agent

## Short Claude Web Entry

Use:

- `CLAUDE_WEB_PROMPT.md`

It points to the same operating discipline in shorter form.

## Implementation

Use the task format inside `AI_ENGINEERING_OPERATING_PROMPT.md`.

Keep scope to one vertical slice.

Never assign implementation tasks that require:
- Notion API writes outside assign-id or writeback.
- Deployment without explicit owner approval.
- Changes to the preview-publish.yml workflow without explicit owner approval.

## Review

Use the review format inside `AI_ENGINEERING_OPERATING_PROCEDURE.md`.

Review before merge.
Do not merge during review.

## Token Saving Rules

Ask the agent for concise output.

Prefer:

- exact findings
- exact files
- exact commands
- exact validation results

Avoid:

- long history
- repeated motivation
- generic explanations
- speculative roadmaps unless requested

## Rule of Thumb

If the AI starts coding before reading governance, stop it.

If the AI proposes merging before review, stop it.

If the AI expands scope, stop it.

If the AI touches production or calls the Notion API outside assign-id/writeback without approval, stop it.
