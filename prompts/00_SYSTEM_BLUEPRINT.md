# 00_SYSTEM_BLUEPRINT

You are the lead architect for a brand new system:

notion-doc-publisher-v3

## Goal

Design a clean V3 Notion-to-static-document publisher.

This is a new system. Do not modify or depend on existing V2 code.

## Hard Safety Rules

Do not modify:
- notion-publisher-v2
- docs-arcbos-v2
- docs-energize-v2

Use old systems only as read-only reference.

Do not write to production repositories.
Do not change existing GitHub Actions.
Do not reuse production Notion database IDs during initial development.

## Core Product Positioning

This is not a large enterprise platform.

This is a lightweight, professional document publisher:

Notion
→ Document Model
→ Static HTML
→ GitHub Pages
→ Print-ready PDF path

## Required Principles

- Notion is the only editing source.
- One master Notion database is the source of truth.
- Document IDs are generated automatically by the system.
- User should only fill simple document properties.
- The system must be universal across brand, client, project, and company.
- Do not build a project-specific publisher.
- Do not build a heavy CMS.
- Do not build approval workflow in V1.
- Do not build CRM-like structures.

## DOC_ID Format

Use this format:

BRAND-TYPE-YYMM-SEQ4

Examples:

ARCBOS-AGR-2605-0039
ENERGIZE-SPEC-2605-0040
AGIM-MEM-2605-0041

Version is not part of DOC_ID.

Version is stored separately:

v0.1
v1.0
v1.1
v2.0

## Minimal Document Fields

The Notion database should require only:

- DOC_ID
- Title
- Brand
- Client
- Project
- Document Type
- Version
- Status
- Visibility
- Publish

The Notion page body is the document content.

## Required Output

Create or update the following documents:

- docs/SYSTEM_BLUEPRINT.md
- docs/NOTION_SCHEMA.md
- docs/DOCUMENT_MODEL.md
- docs/OUTPUT_SPEC.md
- docs/IMPLEMENTATION_PLAN.md

Do not write implementation code yet.

## Architecture Must Cover

Explain:

1. System boundary
2. Repository structure
3. Notion schema
4. DOC_ID generation
5. Document model
6. Rendering pipeline
7. Static output structure
8. Print/PDF strategy
9. Validation rules
10. Future extension points
11. What V1 will not do

## Keep It Simple

Prefer boring technology.

Recommended stack:

- Node.js
- TypeScript
- Notion API
- Static HTML
- CSS
- GitHub Pages
- Playwright later for PDF

Avoid:

- Next.js
- CMS frameworks
- database servers
- workflow engines
- complex user permissions
- approval modules
