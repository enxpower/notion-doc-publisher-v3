import { UserFacingError, type AppConfig } from "../config.js";

export type NotionPage = {
  id: string;
  created_time?: string;
  last_edited_time?: string;
  url?: string;
  properties: Record<string, unknown>;
};

export type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

export class NotionClient {
  constructor(private readonly config: AppConfig) {}

  async queryDatabase(): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let startCursor: string | undefined;
    do {
      const response = await this.request<{ results: NotionPage[]; has_more: boolean; next_cursor?: string }>(
        `/databases/${this.config.notionDatabaseId}/query`,
        {
          method: "POST",
          body: JSON.stringify(startCursor ? { start_cursor: startCursor } : {})
        }
      );
      pages.push(...response.results);
      startCursor = response.has_more ? response.next_cursor : undefined;
    } while (startCursor);
    return pages;
  }

  async listBlockChildren(blockId: string): Promise<NotionBlock[]> {
    const blocks: NotionBlock[] = [];
    let startCursor: string | undefined;
    do {
      const query = startCursor ? `?start_cursor=${encodeURIComponent(startCursor)}` : "";
      const response = await this.request<{ results: NotionBlock[]; has_more: boolean; next_cursor?: string }>(
        `/blocks/${blockId}/children${query}`,
        { method: "GET" }
      );
      blocks.push(...response.results);
      startCursor = response.has_more ? response.next_cursor : undefined;
    } while (startCursor);
    return blocks;
  }

  async updateDocId(pageId: string, docId: string): Promise<void> {
    await this.request(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          DOC_ID: {
            rich_text: [{ type: "text", text: { content: docId } }]
          }
        }
      })
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.notion.com/v1${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.notionToken}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
          ...(init.headers ?? {})
        }
      });
    } catch (error) {
      throw new UserFacingError(`Could not reach Notion API: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new UserFacingError(`Notion API request failed (${response.status}): ${summarize(text)}`);
    }
    return (await response.json()) as T;
  }
}

function summarize(text: string): string {
  if (!text) {
    return "no response body";
  }
  try {
    const parsed = JSON.parse(text) as { message?: string };
    return parsed.message ?? text.slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}
