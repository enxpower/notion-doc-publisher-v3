# PDF Export — Sidecar Publisher

The PDF publisher is a **sidecar system** that runs alongside the HTML publisher without touching it.

## Architecture

```
Notion database
      │
      ▼
 loadDocuments()         ← read-only, same Notion config as HTML publisher
      │
      ▼
 renderDocumentTypst()   ← Typst source renderer (src/pdf/render-typst.ts)
      │
      ▼
 pdf-output/{DOC_ID}.typ
 pdf-output/{DOC_ID}.pdf  ← compiled by typst binary
 pdf-output/assets/       ← downloaded document images
```

**Hard boundaries:**
- Never modifies `render-html.ts`, `render-blocks.ts`, `build.ts`, `validate.ts`, `assign-id.ts`, writeback, or `preview-publish.yml`
- Never writes to `dist/`
- Never writes back to Notion
- Never deploys to GitHub Pages

---

## Local usage

### Prerequisites

```bash
# Install Typst
brew install typst          # macOS
# or: https://github.com/typst/typst/releases

# CJK fonts (for correct Chinese rendering)
# macOS: Noto Serif/Sans CJK SC (install via Noto Fonts package or Font Book)
# Ubuntu: sudo apt-get install fonts-noto-cjk fonts-noto-cjk-extra fonts-liberation
```

### Run

```bash
npm run pdf:export -- ARCBOS-AGR-2606-0008
```

Output:
```
pdf-output/
  ARCBOS-AGR-2606-0008.typ   ← Typst source (always written)
  ARCBOS-AGR-2606-0008.pdf   ← compiled PDF (only when typst is installed)
  assets/docs/ARCBOS-AGR-2606-0008/
    image-xxx.png             ← downloaded document assets
```

If Typst is not installed, the `.typ` file is still written. A warning shows the install command and the `typst compile` command to run manually.

### Environment variables

Same as the HTML publisher. Requires at minimum:

```env
NOTION_TOKEN=secret_...
NOTION_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PUBLISHABLE_STATUSES=Approved,Published
BRAND_TOKENS_JSON={"ARCBOS":"ARCBOS"}
DOCUMENT_TYPE_TOKENS_JSON={"Agreement":"AGR"}
```

A `.env` file in the project root is loaded automatically.

---

## GitHub Actions

The workflow **PDF Export (Sidecar)** is in `.github/workflows/pdf-export.yml`.

It is **manual only** (`workflow_dispatch`) — no schedule, no push trigger.

### Run from GitHub UI

1. Go to **Actions → PDF Export (Sidecar)**
2. Click **Run workflow**
3. Enter the `DOC_ID` (e.g. `ARCBOS-AGR-2606-0008`)
4. Optionally change the branch (default: `main`)
5. Click **Run workflow**

### Artifact

After the workflow completes, download the artifact named `pdf-{DOC_ID}` from the run summary. It contains the `.typ` source, the compiled `.pdf`, and any image assets.

**Retention:** 30 days.

---

## Theme

The PDF theme is derived from the production HTML styles:

| HTML source | PDF decision |
|---|---|
| `styles/screen.css` palette | Typst palette `C` (text, muted, accent, line…) |
| `styles/print.css` body `10.5pt/1.5` | `11pt, 0.85em leading` |
| `styles/print.css` heading margins | Heading `v()` spacing (26pt/20pt/16pt/12pt before) |
| `styles/print.css` heading `border-top` | Typst `stroke: (top: 0.5pt)` above H1 |
| `styles/screen.css` `pre` border+bg | Code block `stroke: 0.5pt` all-around, `#f6f7f8` fill |
| `styles/screen.css` `th` transparent | Table header: `#text()` only, no `fill:` |
| `styles/print.css` masthead sizes | Cover `9pt/6.8pt`, `1pt` rule |

**Intentional PDF-only features:**
- Running page header (BRAND / DOC_ID) + footer (DOC_ID · version · page N of M)
- Signature page: `#pagebreak()` before `签署页` heading, structured party/stamp grid
- PDF bookmarks (`bookmarked: true` on headings)
- No TOC — not appropriate for contract PDFs

---

## Current limitations

- **Typst must be installed locally** to produce the `.pdf` file. The `.typ` source is always written.
- **CJK font availability** — the PDF requires `Noto Serif CJK SC` (body) and `Noto Sans CJK SC` (headings/captions). If these are absent, Typst falls back to system fonts (output may differ).
- **Images** — Notion image URLs expire. Asset download happens at export time; the `.pdf` embeds them.
- **DOC_ID only** — the exporter selects documents by `DOC_ID`. There is no batch export yet.
- **No Notion writeback** — the PDF download link is not written back to the Notion record. This is planned as a future phase.

---

## Future: Notion writeback (Phase 2)

After a PDF is generated and uploaded (via GitHub Actions artifact or an S3/CDN upload step), the download URL can be written back to a Notion property. This is not implemented in the current phase.

Planned property: `PDF Download URL` (URL type) on the Notion database page.
