import { UserFacingError, type AppConfig } from "../config.js";
import { NotionClient, type NotionDatabase } from "./client.js";

export type BuildStatus = "pending" | "success" | "failed" | "skipped";

const REQUIRED_WRITEBACK_FIELDS: Record<string, string> = {
  PUBLISHED_URL: "url",
  PUBLISHED_AT: "date",
  BUILD_STATUS: "select",
  BUILD_MESSAGE: "rich_text",
  LAST_BUILD_RUN: "rich_text"
};

export class NotionWriteback {
  private readonly client: NotionClient;

  constructor(config: AppConfig) {
    this.client = new NotionClient(config);
  }

  async assertSchema(): Promise<void> {
    const database = await this.client.retrieveDatabase();
    assertWritebackSchema(database);
  }

  async updateBuildStarted(pageId: string, runId: string, message = "Preview publish started"): Promise<void> {
    await this.updateStatus(pageId, "pending", message, runId);
  }

  async updateDocumentSuccess(pageId: string, url: string, runId: string, message = "Published successfully"): Promise<void> {
    await this.client.updatePageProperties(pageId, {
      PUBLISHED_URL: { url },
      PUBLISHED_AT: { date: { start: new Date().toISOString() } },
      BUILD_STATUS: { select: { name: "success" } },
      BUILD_MESSAGE: richText(message),
      LAST_BUILD_RUN: richText(runId)
    });
  }

  async updateDocumentSkipped(pageId: string, message: string, runId: string): Promise<void> {
    await this.updateStatus(pageId, "skipped", message, runId);
  }

  async updateDocumentFailed(pageId: string, message: string, runId: string): Promise<void> {
    await this.updateStatus(pageId, "failed", message, runId);
  }

  private async updateStatus(pageId: string, status: BuildStatus, message: string, runId: string): Promise<void> {
    await this.client.updatePageProperties(pageId, {
      BUILD_STATUS: { select: { name: status } },
      BUILD_MESSAGE: richText(message),
      LAST_BUILD_RUN: richText(runId)
    });
  }
}

export function assertWritebackSchema(database: NotionDatabase): void {
  const missing: string[] = [];
  const wrongType: string[] = [];
  for (const [name, expectedType] of Object.entries(REQUIRED_WRITEBACK_FIELDS)) {
    const property = database.properties[name];
    if (!property) {
      missing.push(`${name} (${expectedType})`);
      continue;
    }
    if (property.type !== expectedType) {
      wrongType.push(`${name} must be ${expectedType}, found ${property.type ?? "unknown"}`);
    }
  }
  if (missing.length > 0 || wrongType.length > 0) {
    const parts = [];
    if (missing.length > 0) {
      parts.push(`missing fields: ${missing.join(", ")}`);
    }
    if (wrongType.length > 0) {
      parts.push(`wrong field types: ${wrongType.join(", ")}`);
    }
    throw new UserFacingError(`Notion write-back fields are not ready; ${parts.join("; ")}.`);
  }
}

function richText(content: string): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return {
    rich_text: [
      {
        type: "text",
        text: { content: content.slice(0, 1900) }
      }
    ]
  };
}
