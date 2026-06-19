# Project Context

This document helps a new AI coding session understand notion-doc-publisher-v3 without relying on chat history.

## Origin

This is V3 of the Notion document publisher. V2 is a production system in separate repositories (docs-arcbos-v2, docs-energize-v2, agim-docs). V3 is a clean rewrite with preview-only deployment, improving architecture, testability, and print quality while leaving V2 untouched.

## Why This Project Exists

Enterprise document publishing from Notion is the primary content workflow for enxpower brands. V2 was tightly coupled and hard to test. V3 provides a clean, testable, multi-brand static publishing pipeline that can eventually replace V2.

## What This Project Is

- A TypeScript CLI that reads from a Notion database and produces static HTML documents.
- A multi-brand publisher supporting ARCBOS, ENERGIZE, and AGIM visual identities.
- A preview/test publishing system using GitHub Actions + GitHub Pages on this repository only.
- A DOC_ID assignment and tracking system that writes stable IDs back to Notion.

## What This Project Is Not

- A production publishing system for live company documentation sites (that is V2).
- A Notion CMS editor — Notion is the only editing interface.
- A general-purpose static site generator.
- A PDF automation system (deferred to a future phase).

## Core Product Philosophy

- Notion is the only editing source.
- `validate` and `build` are read-only with respect to Notion.
- `assign-id` is the only command that writes DOC_ID values to Notion.
- `writeback-preview` is the only command that writes build results back to Notion.
- Output is static HTML first; print/PDF is a first-class requirement.
- Existing V2 systems must not be modified.

## Key Historical Decisions

- US Letter paper format is canonical; do not switch to A4.
- DOC_IDs are permanent once assigned; collisions are always build-blocking.
- Brand tokens come from the Notion `Brand` property + `config/brands.json`, not hardcoded HTML.
- Preview deployment uses GitHub Pages of this repository only; production deployment is a separate future workflow.
- The preview-publish.yml safety guard blocks deployment from production V2 repository names.

## Long-Term Destination

Replace V2 production publishers once V3 is hardened and owner-approved for production use.

## Current Phase

Phase 2: Minimal Implementation / Preview Deploy (v0.2.0-preview-deploy).

Current allowed scope:
- Preview/test publishing via GitHub Actions.
- Improvements to validation, build, and write-back logic.
- Governance adoption (this PR).
- Documentation and test improvements.

Current out-of-scope items:
- Production deployment to docs-arcbos-v2, docs-energize-v2, or agim-docs.
- PDF automation.
- Approval workflow.
- Writes to production repositories.

## Repository Context

Repository: `enxpower/notion-doc-publisher-v3`

## How Future Agents Should Use This Document

Read this after AGENTS.md and before implementation. Use it to understand why the rules exist.
