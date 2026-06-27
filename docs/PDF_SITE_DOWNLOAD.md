# PDF Site Download

PDFs are a first-class production output of the document publisher. Every
publishable document is automatically compiled to PDF during the normal
preview/production publish run and served at a stable URL on the site.

## Normal product flow

1. A push to `main` (or a scheduled run) triggers the **Preview Publish** workflow.
2. The HTML build runs first: `npm run build` → `dist/`.
3. Immediately after a successful HTML build, site PDF generation runs:
   `npm run pdf:site` → `dist/pdf/{DOC_ID}.pdf` for every publishable document.
4. The entire `dist/` tree (HTML + PDFs) is uploaded to GitHub Pages as one artifact.
5. Each published document HTML page shows a **Download PDF** button that links to
   `/pdf/{DOC_ID}.pdf` — served from the same site with no external dependencies.

## Print vs Download PDF

| Action | Trigger | Output |
|--------|---------|--------|
| **Print** | Click Print → browser print dialog | Browser-rendered HTML → printer/PDF |
| **Download PDF** | Click Download PDF → browser download | Pre-generated Typst PDF artifact |

Both buttons appear in the document action bar.
The Print button is unchanged from its original behavior.
The Download PDF button does not appear on documents without a DOC_ID.

## URL structure

```
/pdf/{DOC_ID}.pdf      — compiled PDF
/pdf/{DOC_ID}.typ      — Typst source (for reference)
```

All PDF links use site-relative paths. No domain is hardcoded.

## Generate PDF checkbox (PDF Publisher 2.0)

The `Generate PDF` Notion checkbox is **only** used by the manual
[PDF Publisher 2.0](./PDF_PUBLISHER_2.md) queue (`npm run pdf:queue`).

It is **not** required for normal site PDF generation — all publishable
documents receive a PDF automatically on every publish run.

Use `Generate PDF` when you need to:
- Manually re-generate a single document's PDF outside the publish cycle.
- Get the PDF artifact and URL written back to Notion fields.

## PDF_REQUIRED failure policy

| Setting | Effect |
|---------|--------|
| `PDF_REQUIRED` unset or `false` (default) | PDF generation failures are warnings. The HTML publish and deployment continue normally. Download PDF buttons may 404 for documents whose PDF failed. |
| `PDF_REQUIRED=true` | The workflow fails if any document's PDF generation fails. The HTML build and deploy are still attempted but the run exits non-zero. |

Set `PDF_REQUIRED` in GitHub repository Variables (`vars.PDF_REQUIRED`).

## Rollback instructions

Site PDF generation is fully sidecar — it does not modify any HTML output or
the existing build logic.

To disable PDF generation without touching the HTML publisher:

1. Remove or comment out the **Generate site PDFs** step in
   `.github/workflows/preview-publish.yml`.
2. Remove the `pdf:site` script call if it was added elsewhere.
3. Optionally remove `src/cli/export-site-pdf.ts` and the `pdf:site` entry
   in `package.json`.

The HTML publisher will continue to function identically.
The Download PDF button will remain in the HTML but the linked files will 404
until PDF generation is re-enabled or the files are removed manually.

To also remove the Download PDF button from HTML pages:
- Revert the change to `renderActions()` in `src/render/render-html.ts`.
