import { UserFacingError, type AppConfig } from "../config.js";
import { NotionClient, type NotionDatabase } from "./client.js";
import { assertNotionMutationAllowed } from "./read-only-guard.js";

export type BuildStatus = "pending" | "success" | "failed" | "skipped" | "unpublished";

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
    assertNotionMutationAllowed("updateBuildStarted");
    await this.updateStatus(pageId, "pending", message, runId);
  }

  async updateDocumentSuccess(pageId: string, url: string, runId: string, message = "Published successfully"): Promise<void> {
    assertNotionMutationAllowed("updateDocumentSuccess");
    await this.client.updatePageProperties(pageId, {
      PUBLISHED_URL: { url },
      PUBLISHED_AT: { date: { start: new Date().toISOString() } },
      BUILD_STATUS: { select: { name: "success" } },
      BUILD_MESSAGE: richText(message),
      LAST_BUILD_RUN: richText(runId)
    });
  }

  async updatePublishedUrlOnly(pageId: string, url: string): Promise<void> {
    assertNotionMutationAllowed("updatePublishedUrlOnly");
    await this.client.updatePageProperties(pageId, {
      PUBLISHED_URL: { url }
    }, "updatePublishedUrlOnly");
  }

  async updateLifecycleResult(update: {
    pageId: string;
    status: BuildStatus;
    message: string;
    publishedUrl?: string;
    runId?: string;
  }): Promise<void> {
    assertNotionMutationAllowed("updateLifecycleResult");
    const properties: Record<string, unknown> = {
      BUILD_STATUS: { select: { name: update.status } },
      BUILD_MESSAGE: richText(update.message),
      LAST_BUILD_RUN: richText(update.runId ?? "incremental-content-publish")
    };
    if (update.publishedUrl !== undefined) {
      properties.PUBLISHED_URL = { url: update.publishedUrl };
      properties.PUBLISHED_AT = { date: { start: new Date().toISOString() } };
    }
    await this.client.updatePageProperties(update.pageId, properties, "updateLifecycleResult");
  }

  async readPublishedUrl(pageId: string): Promise<string> {
    const page = await this.client.retrievePage(pageId);
    return readPublishedUrl(page.properties.PUBLISHED_URL);
  }

  /**
   * Read-only lookup of the current Notion BUILD_STATUS for a single page.
   * Used only to decide whether a NOOP record's lifecycle status is stale;
   * never used to authorize rendering, deployment, or identity changes.
   */
  async readLifecycleStatus(pageId: string): Promise<{ buildStatus: string }> {
    const page = await this.client.retrievePage(pageId);
    return { buildStatus: readSelectStatus(page.properties.BUILD_STATUS) };
  }

  /**
   * Narrow, allow-listed correction for a NOOP record whose private state is
   * verified known-good but whose Notion lifecycle status is stale. Writes
   * only the lifecycle fields already covered by REQUIRED_WRITEBACK_FIELDS,
   * using an explicit preserved publishedAt rather than the current time.
   */
  async reconcileLifecycleStatus(update: {
    pageId: string;
    publishedUrl: string;
    publishedAt: string;
    runId: string;
    message: string;
  }): Promise<void> {
    assertNotionMutationAllowed("reconcileLifecycleStatus");
    await this.client.updatePageProperties(
      update.pageId,
      {
        BUILD_STATUS: { select: { name: "success" } },
        BUILD_MESSAGE: richText(update.message),
        LAST_BUILD_RUN: richText(update.runId),
        PUBLISHED_URL: { url: update.publishedUrl },
        PUBLISHED_AT: { date: { start: update.publishedAt } }
      },
      "reconcileLifecycleStatus"
    );
  }

  async updateDocumentSkipped(pageId: string, message: string, runId: string): Promise<void> {
    assertNotionMutationAllowed("updateDocumentSkipped");
    await this.updateStatus(pageId, "skipped", message, runId);
  }

  async updateDocumentFailed(pageId: string, message: string, runId: string): Promise<void> {
    assertNotionMutationAllowed("updateDocumentFailed");
    await this.updateStatus(pageId, "failed", message, runId);
  }

  private async updateStatus(pageId: string, status: BuildStatus, message: string, runId: string): Promise<void> {
    await this.client.updatePageProperties(pageId, {
      BUILD_STATUS: { select: { name: status } },
      BUILD_MESSAGE: richText(message),
      LAST_BUILD_RUN: richText(runId)
    });
  }

  async writeAutoFillProperties(
    pageId: string,
    props: { shareToken?: string; namespace?: string; portalCategory?: string }
  ): Promise<void> {
    assertNotionMutationAllowed("writeAutoFillProperties");
    const updates: Record<string, unknown> = {};
    if (props.shareToken !== undefined) {
      updates["Share Token"] = { rich_text: [{ type: "text", text: { content: props.shareToken } }] };
      console.log(`  → Writing Share Token to Notion.`);
    }
    if (props.namespace !== undefined) {
      updates["Private Link Namespace"] = { select: { name: props.namespace } };
      console.log(`  → Writing Private Link Namespace "${props.namespace}" to Notion.`);
    }
    if (props.portalCategory !== undefined) {
      updates["Portal Category"] = { select: { name: props.portalCategory } };
      console.log(`  → Writing Portal Category "${props.portalCategory}" to Notion.`);
    }
    if (Object.keys(updates).length > 0) {
      await this.client.updatePageProperties(pageId, updates);
    }
  }
}

function readPublishedUrl(property: unknown): string {
  if (!property || typeof property !== "object" || Array.isArray(property)) {
    return "";
  }
  const value = property as { type?: unknown; url?: unknown };
  if (value.type !== "url" || typeof value.url !== "string") {
    return "";
  }
  return value.url.trim();
}

function readSelectStatus(property: unknown): string {
  if (!property || typeof property !== "object" || Array.isArray(property)) {
    return "";
  }
  const value = property as { type?: unknown; select?: { name?: unknown } | null };
  if (value.type !== "select" || !value.select) {
    return "";
  }
  return typeof value.select.name === "string" ? value.select.name.trim() : "";
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
