# PDF Publisher 2.0

Full sidecar automation: Notion checkbox → generate PDF → upload artifact → write status back to Notion.

## Required Notion Database Schema

Add these five properties to the Notion database **before** using PDF Publisher 2.0:

| Property Name      | Type      | Notes                                   |
|--------------------|-----------|---------------------------------------- |
| `Generate PDF`     | Checkbox  | Check to queue a document for PDF gen  |
| `PDF Status`       | Select    | Values: Queued, Generating, Generated, Failed |
| `PDF URL`          | URL       | Link to the PDF artifact or run        |
| `PDF Generated At` | Date      | Timestamp of last successful generation |
| `PDF Error`        | Rich Text | Last error message; cleared on success  |

The workflow validates this schema before processing any documents and fails with a clear message if any property is missing.

## Modes

### Single document
```
npm run pdf:queue -- ARCBOS-AGR-2606-0008
```
Processes exactly one document by DOC_ID regardless of whether `Generate PDF` is checked.

### All queued documents
```
npm run pdf:queue -- ALL
```
Scans the Notion database for every page where `Generate PDF = true` and processes them all.

### No argument → usage error
```
npm run pdf:queue
# Error: Usage: npm run pdf:queue -- <DOC_ID> | ALL
```

## Writeback Behavior

By default the queue runs in **dry-run mode** — it logs what it would write but makes no Notion changes.

| Environment variable  | Effect                                              |
|-----------------------|-----------------------------------------------------|
| `PDF_WRITEBACK=false` | Dry-run (default): logs intended changes, no writes |
| `PDF_WRITEBACK=true`  | Live mode: writes all 5 PDF fields to Notion        |

Only these five fields are ever written:
- `Generate PDF` (unchecked after success)
- `PDF Status`
- `PDF URL`
- `PDF Generated At`
- `PDF Error`

No other Notion fields are modified. The existing preview writeback path is not used.

## GitHub Actions Workflow

**File:** `.github/workflows/pdf-publisher.yml`  
**Name:** PDF Publisher 2.0  
**Trigger:** Manual (`workflow_dispatch`) only — no push or schedule trigger.

### Inputs

| Input        | Default                  | Description                              |
|--------------|--------------------------|------------------------------------------|
| `doc_id`     | `ARCBOS-AGR-2606-0008`   | DOC_ID to export, or `ALL`              |
| `branch`     | `main`                   | Branch to check out                      |
| `writeback`  | `false`                  | Enable Notion writeback (dry-run default)|

### How to run manually

1. Go to **Actions → PDF Publisher 2.0 → Run workflow**
2. Enter the DOC_ID (or `ALL`)
3. Leave `writeback` unchecked for a dry-run, check it to write back to Notion
4. After completion, download the `pdf-output/` artifact — it contains `.typ` source, the compiled `.pdf`, and `report.json`

## PDF URL Limitation

GitHub Actions artifact download URLs are not knowable during a run. The `PDF URL` field in Notion is set to the **workflow run URL** (e.g. `https://github.com/enxpower/notion-doc-publisher-v3/actions/runs/12345678`), from which the artifact can be downloaded.

### Future storage options
To write a direct PDF download URL, route the compiled PDF through:
- **GitHub Releases** — attach as a release asset
- **Cloudflare R2 / S3** — upload and write the public object URL
- **Cloudflare Pages** — serve from the `pdf-output/` directory

## Safety Notes

- This workflow does **not** deploy GitHub Pages and has no write permissions on `contents`.
- The sidecar writes only to `pdf-output/` — never to `dist/` or the HTML build output.
- `PDF_WRITEBACK` defaults to `false` in the workflow, so manually triggering without enabling writeback is always safe.
- All changes to Notion are isolated to the 5 PDF properties listed above.
- The workflow only runs on the branch you specify — no automatic production behavior.
