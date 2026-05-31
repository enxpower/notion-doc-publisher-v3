import fs from "node:fs";
import path from "node:path";

export type BrandProfile = {
  displayName: string;
  tagline: string;
};

export type AppConfig = {
  notionToken: string;
  notionDatabaseId: string;
  targetSiteDomain?: string;
  docIdYearMonth: string;
  allowedVisibility: Set<string>;
  publishableStatuses: Set<string>;
  brandTokens: Record<string, string>;
  documentTypeTokens: Record<string, string>;
  brandProfiles: Record<string, BrandProfile>;
};

export type PreviewDeployConfig = {
  enabled: boolean;
  baseUrl?: string;
  runId: string;
};

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function loadConfig(): AppConfig {
  loadDotEnv();
  const notionToken = readRequiredEnv("NOTION_TOKEN");
  const notionDatabaseId = readRequiredEnv("NOTION_DATABASE_ID");
  return {
    notionToken,
    notionDatabaseId,
    targetSiteDomain: cleanOptional(process.env.TARGET_SITE_DOMAIN),
    docIdYearMonth: readYearMonth(),
    allowedVisibility: new Set(readListEnv("ALLOWED_VISIBILITY", "Public")),
    publishableStatuses: new Set(readRequiredListEnv("PUBLISHABLE_STATUSES")),
    brandTokens: readRequiredJsonMap("BRAND_TOKENS_JSON"),
    documentTypeTokens: readRequiredJsonMap("DOCUMENT_TYPE_TOKENS_JSON"),
    brandProfiles: readBrandProfiles()
  };
}

/**
 * Brand presentation (display name + optional tagline) is intentionally
 * separate from publishing logic. It is loaded from an optional, committed
 * config file so the system stays brand-neutral by default and CI needs no
 * extra secrets. A missing or malformed file falls back to no profiles, which
 * renders a clean neutral masthead driven only by the Notion Brand value.
 */
function readBrandProfiles(): Record<string, BrandProfile> {
  const candidates = [
    cleanOptional(process.env.BRAND_PROFILES_PATH),
    "config/brands.json"
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const filePath = path.resolve(process.cwd(), candidate);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      const result: Record<string, BrandProfile> = {};
      for (const [brand, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          continue;
        }
        const profile = value as Record<string, unknown>;
        result[brand] = {
          displayName: typeof profile.displayName === "string" ? profile.displayName : brand,
          tagline: typeof profile.tagline === "string" ? profile.tagline : ""
        };
      }
      return result;
    } catch {
      // A broken branding file should never break a build; fall back to neutral.
      return {};
    }
  }
  return {};
}

function loadDotEnv(): void {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) {
      return;
    }
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const equals = trimmed.indexOf("=");
      if (equals === -1) {
        continue;
      }
      const key = trimmed.slice(0, equals).trim();
      const value = trimmed.slice(equals + 1).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Missing or unreadable .env files are handled by required env validation.
  }
}

export function loadConfigOrThrow(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof UserFacingError) {
      throw error;
    }
    throw new UserFacingError(`Configuration error: ${String(error)}`);
  }
}

export function loadPreviewDeployConfig(): PreviewDeployConfig {
  const enabled = process.env.PREVIEW_DEPLOY_ENABLED === "true";
  const baseUrl = cleanOptional(process.env.PREVIEW_BASE_URL)?.replace(/\/+$/, "");
  if (enabled && !baseUrl) {
    throw new UserFacingError("PREVIEW_BASE_URL is required when PREVIEW_DEPLOY_ENABLED=true.");
  }
  return {
    enabled,
    baseUrl,
    runId: cleanOptional(process.env.GITHUB_RUN_ID) ?? new Date().toISOString()
  };
}

function readRequiredEnv(name: string): string {
  const value = cleanOptional(process.env[name]);
  if (!value) {
    throw new UserFacingError(
      `Missing required environment variable ${name}. Create a .env file or export ${name} before running this command.`
    );
  }
  return value;
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readYearMonth(): string {
  const configured = cleanOptional(process.env.DOC_ID_YEAR_MONTH);
  if (configured) {
    if (!/^\d{4}$/.test(configured)) {
      throw new UserFacingError("DOC_ID_YEAR_MONTH must use YYMM format, for example 2605.");
    }
    return configured;
  }
  const now = new Date();
  const year = String(now.getUTCFullYear()).slice(-2);
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

function readListEnv(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRequiredListEnv(name: string): string[] {
  const values = readListEnv(name, "");
  if (values.length === 0) {
    throw new UserFacingError(`${name} is required and must contain at least one comma-separated value.`);
  }
  return values;
}

function readRequiredJsonMap(name: string): Record<string, string> {
  const raw = readRequiredEnv(name);
  if (!raw) {
    throw new UserFacingError(`${name} is required.`);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || !/^[A-Z0-9]+$/.test(value)) {
        throw new Error(`invalid token for ${key}`);
      }
      result[key] = value;
    }
    return result;
  } catch (error) {
    throw new UserFacingError(`${name} must be a JSON object whose values are uppercase alphanumeric tokens.`);
  }
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    if (error instanceof UserFacingError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
