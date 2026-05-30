# 02_IMPLEMENT_V3

Implement notion-doc-publisher-v3 according to the approved architecture documents.

Rules:

- Do not modify existing V2 repositories.
- Do not write to production repositories.
- Build local output first under ./output.
- Keep code simple and readable.
- Prefer explicit logic over clever abstraction.
- Add validation before publishing.

Required features:

- read Notion database
- generate missing DOC_ID
- normalize document metadata
- render page body to HTML
- generate static output
- apply enterprise HTML template
- apply screen.css and print.css
- validate required fields
- produce build report
