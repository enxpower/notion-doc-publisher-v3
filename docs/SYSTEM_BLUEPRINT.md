# System Blueprint

## Purpose

`notion-doc-publisher-v3` is a clean V3 Notion-to-static-document publisher. It turns one master Notion database and each page body into professional static documents that can be hosted on GitHub Pages and printed to PDF.

The product is intentionally small:

```text
Notion -> Document Model -> Static HTML -> GitHub Pages -> Print-ready PDF path
```

This is a new system. It must not modify, import, or depend on V2 production systems. Existing V2 repositories may be used only as read-only references for content patterns, visual expectations, or operational lessons.

## System Boundary

### In Scope

- Read document metadata and content from one master Notion database.
- Generate missing document IDs in the required `BRAND-TYPE-YYMM-SEQ4` format.
- Convert Notion page content into a normalized internal document model.
- Render static HTML documents with shared screen and print CSS.
- Emit deterministic output suitable for GitHub Pages.
- Validate required metadata, document ID format, publishability, and render readiness.
- Keep a future path open for Playwright-based PDF generation.

### Out of Scope

- Editing content outside Notion.
- Multiple source databases for V1.
- User-facing CMS screens.
- Approval workflow.
- CRM, pipeline, account, or contact management.
- Runtime web application server.
- Database server.
- Complex permissions or document-level ACLs.
- Production publishing into existing V2 repositories during initial development.

## Repository Structure

The intended repository layout is boring and explicit:

```text
notion-doc-publisher-v3/
  docs/
    SYSTEM_BLUEPRINT.md
    NOTION_SCHEMA.md
    DOCUMENT_MODEL.md
    OUTPUT_SPEC.md
    IMPLEMENTATION_PLAN.md
  prompts/
    00_SYSTEM_BLUEPRINT.md
    01_ARCHITECTURE_REVIEW.md
    02_IMPLEMENT_V3.md
    03_RELEASE_CHECKLIST.md
  src/
    config/
    notion/
    ids/
    model/
    render/
    validate/
    build/
  templates/
    enterprise.html
    pdf.html
  styles/
    screen.css
    print.css
  public/
  dist/
```

`src/` does not need to exist until implementation starts. The architecture assumes a TypeScript implementation with small modules and no framework.

## Recommended Stack

- Node.js
- TypeScript
- Notion API
- Static HTML
- CSS
- GitHub Pages
- Playwright later for PDF generation

Avoid:

- Next.js
- CMS frameworks
- Database servers
- Workflow engines
- Complex user permissions
- Approval modules

## Core Data Flow

1. Load configuration from environment variables.
2. Query the master Notion database for candidate pages.
3. For each page:
   - Read required properties.
   - Generate and write `DOC_ID` only when missing.
   - Fetch the Notion page blocks.
   - Normalize metadata and blocks into the document model.
   - Validate the document model.
   - Render static HTML.
4. Copy static assets and CSS.
5. Write a static output tree.
6. Optionally deploy the output to a target GitHub Pages repository in a later release step.

## Source of Truth

Notion is the only editing source. Document content lives in the Notion page body. Metadata lives in the master Notion database properties.

Generated files are build artifacts. Manual edits to rendered HTML or PDFs are not source edits and must not be treated as authoritative.

## Master Database Principle

V1 uses one master database for all brands, clients, projects, and document types. This keeps the product universal without building a project-specific publisher or a heavy CMS.

The database contains simple document properties only. It should not model CRM entities, approval stages, tasks, billing, contacts, or project management workflows.

## DOC_ID Policy

The system owns `DOC_ID` generation.

Format:

```text
BRAND-TYPE-YYMM-SEQ4
```

Examples:

```text
ARCBOS-AGR-2605-0039
ENERGIZE-SPEC-2605-0040
AGIM-MEM-2605-0041
```

Version is not part of `DOC_ID`. Version is stored separately as values such as `v0.1`, `v1.0`, `v1.1`, and `v2.0`.

## Rendering Pipeline

The renderer should be deterministic and static-first:

```text
Notion page
  -> raw Notion properties and blocks
  -> normalized document model
  -> validated render context
  -> HTML template
  -> screen and print CSS
  -> dist output
```

Rendering should not require a web server, client-side routing, or browser JavaScript for normal reading. Any future JavaScript must be optional enhancement only.

## Static Output

The output should be directly hostable on GitHub Pages. It should include:

- One HTML file per published document.
- Shared CSS and assets.
- A simple index for browsing published documents.
- Stable paths derived from document metadata and `DOC_ID`.

The detailed output contract is defined in `docs/OUTPUT_SPEC.md`.

## Print and PDF Strategy

HTML is the canonical rendered artifact. Print-quality CSS is part of V1. PDF generation is a later automation layer over the same static HTML.

The PDF path should use Playwright later:

1. Build static HTML.
2. Open the local HTML file in Chromium.
3. Apply print media.
4. Export PDF with deterministic paper size, margins, headers, and footers.

V1 should design CSS and HTML so this path works cleanly, even if automated PDF export is implemented after the first static HTML build.

## Validation Rules

Validation protects publishing quality without creating workflow complexity. V1 validation should check:

- Required Notion properties are present.
- `DOC_ID` matches the required format when present.
- `Version` matches the supported version pattern.
- `Status`, `Visibility`, and `Publish` form a valid publishable state.
- Required title and content are not empty.
- Brand and document type can produce valid ID tokens and paths.
- Output paths do not collide.
- Unsupported Notion blocks fail clearly or degrade through documented fallbacks.

Validation details are defined in `docs/NOTION_SCHEMA.md` and `docs/DOCUMENT_MODEL.md`.

## Future Extension Points

The architecture leaves room for:

- Additional render themes.
- Brand-specific CSS variables.
- More document types.
- PDF automation with Playwright.
- Search index generation.
- Sitemap generation.
- Asset downloading and caching.
- Incremental builds.
- Optional deploy automation.
- Optional external references to client or project registries.

These must remain extensions around the simple master database model, not reasons to turn V1 into a CMS.

## V1 Will Not Do

V1 will not:

- Depend on V2 code.
- Publish to existing production repositories by default.
- Reuse production Notion database IDs during initial development.
- Provide approval workflow.
- Provide user accounts or permissions.
- Provide a runtime editing interface.
- Store document content outside Notion.
- Manage CRM data.
- Require a database server.
- Require Next.js or another application framework.
- Generate versioned `DOC_ID` values.
