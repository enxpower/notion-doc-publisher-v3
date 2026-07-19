import { UserFacingError, type AppConfig } from "../config.js";
import { assertNotionMutationAllowed } from "./read-only-guard.js";

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

export type NotionDatabase = {
  id: string;
  properties: Record<string, { type?: string; [key: string]: unknown }>;
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
    assertNotionMutationAllowed("updateDocId");
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

  async retrieveDatabase(): Promise<NotionDatabase> {
    return await this.request<NotionDatabase>(`/databases/${this.config.notionDatabaseId}`, { method: "GET" });
  }

  async retrievePage(pageId: string): Promise<NotionPage> {
    return await this.request<NotionPage>(`/pages/${pageId}`, { method: "GET" });
  }

  async updatePageProperties(pageId: string, properties: Record<string, unknown>, guardOperation = "updatePageProperties"): Promise<void> {
    assertNotionMutationAllowed(guardOperation);
    await this.request(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties })
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let lastRateLimitText = "";
    for (let attempt = 0; attempt < MAX_NOTION_REQUEST_ATTEMPTS; attempt += 1) {
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

      if (response.status === 429 && attempt < MAX_NOTION_REQUEST_ATTEMPTS - 1) {
        lastRateLimitText = await response.text();
        await waitForNotionRetry(response.headers.get("retry-after"));
        continue;
      }

      if (!response.ok) {
        const text = response.status === 429 && lastRateLimitText ? lastRateLimitText : await response.text();
        throw new UserFacingError(`Notion API request failed (${response.status}): ${summarize(text)}`);
      }
      return (await response.json()) as T;
    }
    throw new UserFacingError("Notion API request failed (429): rate limit retry budget exhausted.");
  }
}

const MAX_NOTION_REQUEST_ATTEMPTS = 5;

async function waitForNotionRetry(retryAfter: string | null): Promise<void> {
  const seconds = retryAfter ? Number(retryAfter) : 1;
  const boundedSeconds = Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds, 10)
    : 1;
  await new Promise((resolve) => setTimeout(resolve, boundedSeconds * 1000));
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
