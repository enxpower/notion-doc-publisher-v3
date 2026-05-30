# Output Spec

## Purpose

The output is a static website that can be hosted directly on GitHub Pages. Static HTML is the primary artifact. PDF output is a later automation path built from the same HTML and print CSS.

No runtime server, framework, database, or client-side router should be required to read published documents.

## Output Directory

Build output should be written to `dist/`.

Recommended structure:

```text
dist/
  index.html
  docs/
    arcbos/
      agreement/
        ARCBOS-AGR-2605-0039/
          index.html
    energize/
      specification/
        ENERGIZE-SPEC-2605-0040/
          index.html
  assets/
    css/
      screen.css
      print.css
    docs/
      ARCBOS-AGR-2605-0039/
        image-001.png
  manifest.json
  sitemap.xml
```

`manifest.json` and `sitemap.xml` can be added after the first renderer if needed, but the directory design should leave room for them.

## Canonical Paths

Recommended document URL path:

```text
/docs/{brandSlug}/{documentTypeSlug}/{DOC_ID}/
```

Example:

```text
/docs/arcbos/agreement/ARCBOS-AGR-2605-0039/
```

This path is stable across versions because version is not part of `DOC_ID`. The rendered document should display `Version`, but version should not alter the canonical path in V1.

## Required Pages

### Site Index

`dist/index.html` should list published documents with:

- Title
- `DOC_ID`
- Brand
- Client
- Project
- Document Type
- Version
- Last build date or source last edited date when available

The index should link only to documents emitted by the current build target.

### Document Page

Each document page should include:

- Document title
- `DOC_ID`
- Version
- Brand
- Client
- Project
- Document Type
- Status where appropriate
- Main content rendered from the Notion page body
- Print-friendly layout

The document page should be useful with CSS and still readable without JavaScript.

## HTML Requirements

Rendered HTML should:

- Use semantic HTML elements.
- Include one `h1` for the document title.
- Preserve heading hierarchy from Notion content.
- Use stable CSS classes rather than inline style-heavy markup.
- Escape all text by default.
- Sanitize links and asset URLs.
- Include print CSS.
- Avoid client-side rendering for document content.

Recommended document shell:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{Title} - {DOC_ID}</title>
    <link rel="stylesheet" href="/assets/css/screen.css">
    <link rel="stylesheet" href="/assets/css/print.css" media="print">
  </head>
  <body>
    <main class="document">
      ...
    </main>
  </body>
</html>
```

## CSS Requirements

`screen.css` should optimize reading in a browser:

- Comfortable measure for body text.
- Clear metadata block.
- Distinct headings and tables.
- Responsive layout.
- Brand-neutral default styling with extension points.

`print.css` should optimize paper/PDF output:

- Deterministic page margins.
- Good typography at print sizes.
- Page-break handling for headings, tables, images, and callouts.
- Hidden navigation or screen-only controls.
- Visible links where useful.

Brand-specific styling should be handled through CSS variables or small theme classes later, not separate renderers.

## Asset Strategy

V1 should support a path to local assets:

```text
dist/assets/docs/{DOC_ID}/{assetName}
```

Rules:

- Asset filenames should be deterministic.
- Asset references in HTML should be relative or site-root absolute.
- Missing required assets should fail validation.
- Remote Notion assets may be allowed as an early fallback, but should produce a warning because signed URLs may expire.

## Static Index Data

A later build may emit `manifest.json` for search, QA, or integration:

```json
{
  "generatedAt": "2026-05-30T00:00:00.000Z",
  "documents": [
    {
      "docId": "ARCBOS-AGR-2605-0039",
      "title": "Example Agreement",
      "brand": "ARCBOS",
      "client": "Example Client",
      "project": "Example Project",
      "documentType": "Agreement",
      "version": "v1.0",
      "path": "/docs/arcbos/agreement/ARCBOS-AGR-2605-0039/"
    }
  ]
}
```

This file is generated output only. It is not a source database.

## GitHub Pages Strategy

The `dist/` tree should be deployable to a separate static site repository or branch. Initial development must not write to production repositories.

Recommended later deployment approach:

1. Build into local `dist/`.
2. Validate output.
3. Optionally copy or push `dist/` to a configured target repository.
4. Let GitHub Pages serve the static files.

The build must not assume deployment is always enabled.

## Print And PDF Strategy

Print support is part of V1. Automated PDF export can arrive later.

The future PDF command should:

1. Build the static site.
2. Open each document HTML file with Playwright.
3. Emulate print media.
4. Export to a deterministic path.

Recommended PDF output path:

```text
dist/pdf/{DOC_ID}.pdf
```

PDF generation should use the same rendered HTML and CSS. It should not create a separate document layout model.

## Validation Rules

Output validation should fail when:

- Two documents resolve to the same output path.
- A publishable document cannot render.
- A required CSS file is missing.
- A required asset cannot be copied or referenced.
- Generated HTML is empty or missing the main document content.
- A generated link points outside allowed schemes unexpectedly.

Output validation should warn when:

- A document uses remote assets.
- A block was rendered with a fallback.
- A document has unusually deep heading jumps.
- A table may overflow narrow screens or printed pages.

## V1 Output Will Not Include

V1 output will not include:

- Authenticated pages.
- Per-user permissions.
- Runtime search backed by a server.
- Client-side CMS editing.
- Approval screens.
- CRM dashboards.
- Dynamic preview APIs.
- Production deploy automation enabled by default.
