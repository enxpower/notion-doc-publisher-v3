import type { DocumentBlock, RichTextSpan } from "../model/document.js";

export function renderBlocks(blocks: DocumentBlock[], mode: "draft" | "publishable"): string {
  const html: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    switch (block.type) {
      case "paragraph":
        html.push(`<p>${renderRichText(block.richText)}</p>`);
        break;
      case "heading_1":
        html.push(`<h2>${renderRichText(block.richText)}</h2>`);
        break;
      case "heading_2":
        html.push(`<h3>${renderRichText(block.richText)}</h3>`);
        break;
      case "heading_3":
        html.push(`<h4>${renderRichText(block.richText)}</h4>`);
        break;
      case "bulleted_list_item": {
        const items: string[] = [];
        while (index < blocks.length && blocks[index]!.type === "bulleted_list_item") {
          const item = blocks[index]! as { richText: RichTextSpan[] };
          items.push(`<li>${renderRichText(item.richText)}</li>`);
          index += 1;
        }
        index -= 1;
        html.push(`<ul>${items.join("")}</ul>`);
        break;
      }
      case "numbered_list_item": {
        const items: string[] = [];
        while (index < blocks.length && blocks[index]!.type === "numbered_list_item") {
          const item = blocks[index]! as { richText: RichTextSpan[] };
          items.push(`<li>${renderRichText(item.richText)}</li>`);
          index += 1;
        }
        index -= 1;
        html.push(`<ol>${items.join("")}</ol>`);
        break;
      }
      case "quote":
        html.push(`<blockquote>${renderRichText(block.richText)}</blockquote>`);
        break;
      case "callout":
        html.push(`<aside class="callout">${renderRichText(block.richText)}</aside>`);
        break;
      case "code":
        html.push(`<pre><code>${escapeHtml(block.richText.map((span) => span.text).join(""))}</code></pre>`);
        break;
      case "divider":
        html.push("<hr>");
        break;
      case "image":
        html.push(`<figure><img src="${escapeAttribute(block.asset.outputPath)}" alt="${escapeAttribute(block.asset.alt ?? "")}">${renderCaption(block.asset.caption)}</figure>`);
        break;
      case "file":
        html.push(`<p class="file-link"><a href="${escapeAttribute(block.asset.outputPath)}">${escapeHtml(block.asset.alt ?? block.asset.outputPath)}</a></p>`);
        break;
      case "table":
        html.push(renderTable(block.rows));
        break;
      case "unsupported":
        if (mode === "draft") {
          html.push(`<aside class="block-warning">Unsupported block: ${escapeHtml(block.notionType)}. ${escapeHtml(block.message)}</aside>`);
        }
        break;
    }
  }
  return html.join("\n");
}

export function renderRichText(spans: RichTextSpan[]): string {
  return spans.map(renderSpan).join("");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSpan(span: RichTextSpan): string {
  let html = escapeHtml(span.text);
  if (span.code) html = `<code>${html}</code>`;
  if (span.bold) html = `<strong>${html}</strong>`;
  if (span.italic) html = `<em>${html}</em>`;
  if (span.underline) html = `<u>${html}</u>`;
  if (span.strike) html = `<s>${html}</s>`;
  if (span.href) html = `<a href="${escapeAttribute(span.href)}">${html}</a>`;
  return html;
}

function renderCaption(caption: RichTextSpan[] | undefined): string {
  if (!caption || caption.length === 0) {
    return "";
  }
  return `<figcaption>${renderRichText(caption)}</figcaption>`;
}

function renderTable(rows: RichTextSpan[][][]): string {
  if (rows.length === 0) {
    return `<aside class="block-warning">Empty or unsupported table.</aside>`;
  }
  return `<div class="table-wrap"><table><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderRichText(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
