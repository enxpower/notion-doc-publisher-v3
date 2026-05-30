# Preview Deployment

## Architecture

v0.2.0 preview publishing adds a test-only GitHub Actions workflow around the existing local publisher:

```text
Notion
  -> assign missing DOC_IDs
  -> build local dist/
  -> optional same-repository GitHub Pages preview deployment
  -> write publishing result back to Notion
```

Local commands remain usable. `npm run build` does not write publishing results to Notion and does not deploy. Preview publishing uses the separate workflow and `npm run ci:writeback`.

## Safety Boundaries

- Preview deployment is test-only.
- Deployment requires `PREVIEW_DEPLOY_ENABLED=true`.
- Deployment requires `PREVIEW_BASE_URL`.
- The workflow deploys only through this repository's GitHub Pages flow.
- No production target repository is configured by default.
- The workflow denies these repository names:
  - `docs-arcbos-v2`
  - `docs-energize-v2`
  - `notion-publisher-v2`
- No PDF automation is included.
- No approval workflow is included.
- Do not use production Notion database IDs for preview testing.

## GitHub Variables And Secrets

Required secret:

| Name | Purpose |
| --- | --- |
| `NOTION_TOKEN` | Notion integration token with read/update access to the sandbox database. |

Required variables or secrets:

| Name | Purpose |
| --- | --- |
| `NOTION_DATABASE_ID` | Sandbox master database ID. |
| `ALLOWED_VISIBILITY` | Comma-separated visibility values allowed for preview publishing. |
| `PUBLISHABLE_STATUSES` | Comma-separated status values allowed for preview publishing. |
| `BRAND_TOKENS_JSON` | JSON map from Notion `Brand` select labels to DOC_ID brand tokens. |
| `DOCUMENT_TYPE_TOKENS_JSON` | JSON map from Notion `Document Type` select labels to DOC_ID type tokens. |
| `PREVIEW_DEPLOY_ENABLED` | Must be `true` to deploy. Any other value skips deployment. |
| `PREVIEW_BASE_URL` | Public GitHub Pages base URL used for Notion `PUBLISHED_URL`. |

Same-repository GitHub Pages deployment uses `GITHUB_TOKEN`; no personal access token is required.

## Notion Fields

The master database must include these write-back fields:

| Field | Notion type | Values |
| --- | --- | --- |
| `PUBLISHED_URL` | `url` | Final preview URL. |
| `PUBLISHED_AT` | `date` | Publish timestamp for successful documents. |
| `BUILD_STATUS` | `select` | `pending`, `success`, `failed`, `skipped` |
| `BUILD_MESSAGE` | `rich_text` | Human-readable result. |
| `LAST_BUILD_RUN` | `rich_text` | GitHub run ID or timestamp. |

If any field is missing or has the wrong type, write-back fails with a user-facing error.

## Setup Checklist

1. Confirm the repository is not `docs-arcbos-v2`, `docs-energize-v2`, or `notion-publisher-v2`.
2. Confirm the Notion database is a sandbox or test database.
3. Add the required Notion write-back fields.
4. Add `NOTION_TOKEN` as a GitHub secret.
5. Add required GitHub variables or secrets.
6. Configure GitHub Pages for this repository if deployment will be enabled.
7. Set `PREVIEW_DEPLOY_ENABLED=false` for the first dry run.
8. Run the workflow manually.
9. Inspect Notion write-back messages.
10. Set `PREVIEW_DEPLOY_ENABLED=true` only after the dry run is correct.

## Test Procedure

1. In Notion, create or update a sandbox document.
2. Set `Status` to a value in `PUBLISHABLE_STATUSES`.
3. Set `Visibility` to a value in `ALLOWED_VISIBILITY`.
4. Check `Publish`.
5. Run the `Preview Publish` workflow manually.
6. Confirm missing `DOC_ID` values are assigned.
7. Confirm the workflow builds `dist/`.
8. If deployment is enabled, confirm GitHub Pages receives the preview.
9. Confirm Notion fields are updated:
   - `BUILD_STATUS=success`
   - `PUBLISHED_URL=${PREVIEW_BASE_URL}/docs/{DOC_ID}/`
   - `PUBLISHED_AT` is set
   - `BUILD_MESSAGE=Published successfully`
   - `LAST_BUILD_RUN` is set
10. Click `PUBLISHED_URL` from Notion.

## Rollback Procedure

1. Set `PREVIEW_DEPLOY_ENABLED=false`.
2. Re-run the workflow to confirm deployment is skipped.
3. If needed, disable the scheduled workflow in GitHub Actions.
4. If the preview Pages output is wrong, revert the code change and re-run the workflow.
5. Do not point the workflow at production repositories or production Notion databases during rollback.

## Acceptance Criteria

- `npm run check` passes.
- `npm run smoke` passes.
- `npm run build` passes.
- `.github/workflows/preview-publish.yml` exists.
- Deployment is skipped unless `PREVIEW_DEPLOY_ENABLED=true`.
- `PREVIEW_BASE_URL` is required when deployment is enabled.
- Denylist guard blocks known production repository names.
- Required Notion write-back fields are checked before updates.
- Successful documents get `BUILD_STATUS=success` and a public preview URL.
- Skipped documents get `BUILD_STATUS=skipped` and a clear message.
- Failed documents get `BUILD_STATUS=failed` and a clear message.
- No PDF automation is added.
- No production deployment target is configured.
