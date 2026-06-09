import fs from "node:fs/promises";
import { loadConfigOrThrow, loadPreviewDeployConfig, runCli, UserFacingError, type AppConfig } from "../config.js";
import { isPrivateLinkVisibility, type BuildReport, type ValidationIssue } from "../model/document.js";
import { NotionWriteback } from "../notion/writeback.js";

type ReportDocument = BuildReport["documents"][number];

await runCli(async () => {
  const config = loadConfigOrThrow();
  const preview = loadPreviewDeployConfig();
  const validationReport = await readReport("dist/reports/validation-report.json");
  const buildReport = await readOptionalReport("dist/reports/build-report.json");
  const writeback = new NotionWriteback(config);
  await writeback.assertSchema();

  const builtDocIds = new Set((buildReport?.documents ?? []).map((document) => document.docId));
  const errorMessagesByPage = groupIssues(validationReport.errors);
  const warningMessagesByPage = groupIssues(validationReport.warnings);
  const buildFailed = process.env.BUILD_RESULT === "failure" || validationReport.errors.length > 0;
  const deployFailed = preview.enabled && process.env.DEPLOY_RESULT !== "success";

  if (validationReport.documents.length === 0 && buildFailed) {
    console.warn(
      "Write-back: validation report contains no documents. " +
      "The build likely crashed before Notion data could be loaded (e.g. API timeout). " +
      "No Notion pages will be updated this run."
    );
  }

  for (const document of validationReport.documents) {
    if (buildFailed && errorMessagesByPage.has(document.pageId)) {
      await writeback.updateDocumentFailed(document.pageId, errorMessagesByPage.get(document.pageId)!.join("; "), preview.runId);
      continue;
    }

    if (builtDocIds.has(document.docId)) {
      if (deployFailed) {
        await writeback.updateDocumentFailed(document.pageId, "Preview deployment failed after static build.", preview.runId);
        continue;
      }
      if (!preview.enabled) {
        await writeback.updateDocumentSkipped(
          document.pageId,
          "Preview deployment skipped because PREVIEW_DEPLOY_ENABLED is not true.",
          preview.runId
        );
        continue;
      }
      const url = publishedUrl(preview.baseUrl, document.path);
      await writeback.updateDocumentSuccess(document.pageId, url, preview.runId);
      continue;
    }

    const message = skipMessage(document, config, warningMessagesByPage.get(document.pageId));
    await writeback.updateDocumentSkipped(document.pageId, message, preview.runId);
  }

  console.log(`Notion preview write-back updated ${validationReport.documents.length} document(s).`);
});

async function readReport(filePath: string): Promise<BuildReport> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as BuildReport;
  } catch (error) {
    throw new UserFacingError(`Could not read ${filePath}. Run npm run build before write-back.`);
  }
}

async function readOptionalReport(filePath: string): Promise<BuildReport | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as BuildReport;
  } catch {
    return undefined;
  }
}

function groupIssues(issues: ValidationIssue[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.pageId) {
      continue;
    }
    const messages = grouped.get(issue.pageId) ?? [];
    messages.push(`${issue.code}: ${issue.message}`);
    grouped.set(issue.pageId, messages);
  }
  return grouped;
}

function skipMessage(document: ReportDocument, config: AppConfig, warnings: string[] | undefined): string {
  if (!document.publish) {
    return "Skipped: Publish is not checked.";
  }
  if (!config.publishableStatuses.has(document.status)) {
    return `Skipped: Status "${document.status || "(empty)"}" is not configured for publishing.`;
  }
  if (!isPrivateLinkVisibility(document.visibility) && !config.allowedVisibility.has(document.visibility)) {
    return `Skipped: Visibility "${document.visibility || "(empty)"}" is not allowed for this build target.`;
  }
  if (warnings && warnings.length > 0) {
    return `Skipped: ${warnings.join("; ")}`;
  }
  return "Skipped: document was not included in preview build output.";
}

function publishedUrl(baseUrl: string | undefined, canonicalPath: string): string {
  if (!baseUrl) {
    throw new UserFacingError("PREVIEW_BASE_URL is required to write published URLs.");
  }
  return `${baseUrl}${canonicalPath}`;
}
