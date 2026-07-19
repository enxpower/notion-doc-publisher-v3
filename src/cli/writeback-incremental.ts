import fs from "node:fs/promises";
import path from "node:path";

import { runCli, UserFacingError } from "../config.js";
import { NotionWriteback } from "../notion/writeback.js";
import { enableNotionMutationAllowList } from "../notion/read-only-guard.js";
import type { IncrementalPlan, IncrementalPlanRecord, IncrementalStateManifest, LifecycleAction } from "../routing/incremental.js";
import { loadBrandRoutes } from "../routing/routes.js";
import { loadRoutedReadonlyConfigFromEnvironment } from "../routing/routed-readonly.js";

type ApplyRecordResult = {
  action: LifecycleAction;
  brand: string;
  docId: string;
  status: "planned" | "success" | "failed" | "skipped";
  reason: string;
};

type ApplyResult = {
  schema: "notion-doc-publisher-v3/incremental-apply-result";
  version: 1;
  recordResults: ApplyRecordResult[];
};

await runCli(async () => {
  const resultPath = path.resolve(process.env.INCREMENTAL_APPLY_RESULT_PATH ?? "dist/incremental-apply/result.json");
  const planPath = path.resolve(process.env.INCREMENTAL_PLAN_PATH ?? "dist/incremental-plan/plan.json");
  const previousStatePath = path.resolve(
    process.env.PHASE2_PREVIOUS_STATE_PATH ?? "dist/phase2-run/previous-state.json"
  );
  const nextStatePath = path.resolve(process.env.PHASE2_STATE_PATH ?? "dist/phase2-run/next-state.json");
  const outputPath = path.resolve(
    process.env.INCREMENTAL_WRITEBACK_RESULT_PATH ?? "dist/incremental-apply/writeback.json"
  );
  const runId = process.env.GITHUB_RUN_ID ?? "incremental-content-publish";

  const result = await readApplyResult(resultPath);
  const plan = await readPlan(planPath);
  const previousState = await readState(previousStatePath);
  const nextState = await readState(nextStatePath);
  const previousByDocId = new Map(previousState.records.map((record) => [record.docId, record]));
  const nextByDocId = new Map(nextState.records.map((record) => [record.docId, record]));
  const planByKey = new Map(plan.records.map((record) => [`${record.action}:${record.docId}`, record]));

  const routes = await loadBrandRoutes();
  const config = await loadRoutedReadonlyConfigFromEnvironment(routes);
  const writeback = new NotionWriteback(config);
  await writeback.assertSchema();

  const updates: Array<{ action: LifecycleAction; brand: string; docId: string; status: string; message: string }> = [];
  const restoreMutationAllowList = enableNotionMutationAllowList(
    "incremental-post-deployment-writeback",
    ["updateLifecycleResult"]
  );
  try {
    for (const recordResult of result.recordResults) {
      if (recordResult.action === "NOOP" || recordResult.action === "FILTERED" || recordResult.status === "skipped") {
        continue;
      }
      const planRecord = planByKey.get(`${recordResult.action}:${recordResult.docId}`);
      if (!planRecord) {
        throw new UserFacingError(`Incremental plan record is missing for ${recordResult.action}:${recordResult.docId}.`);
      }
      const lifecycle = lifecycleUpdateForRecord({
        planRecord,
        recordResult,
        previous: previousByDocId.get(recordResult.docId),
        next: nextByDocId.get(recordResult.docId)
      });
      await writeback.updateLifecycleResult({
        pageId: planRecord.pageId,
        status: lifecycle.status,
        message: lifecycle.message,
        publishedUrl: lifecycle.publishedUrl,
        runId
      });
      updates.push({
        action: recordResult.action,
        brand: recordResult.brand,
        docId: recordResult.docId,
        status: lifecycle.status,
        message: lifecycle.message
      });
    }
  } finally {
    restoreMutationAllowList();
  }

  const summary = {
    schema: "notion-doc-publisher-v3/incremental-writeback-result",
    version: 1,
    writtenAt: new Date().toISOString(),
    runId,
    mutationCount: updates.length,
    updates
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Incremental post-deployment writeback completed with ${updates.length} Notion mutations.`);
  console.log(`Writeback: ${path.relative(process.cwd(), outputPath)}`);
});

function lifecycleUpdateForRecord(input: {
  planRecord: IncrementalPlanRecord;
  recordResult: ApplyRecordResult;
  previous?: IncrementalStateManifest["records"][number];
  next?: IncrementalStateManifest["records"][number];
}): { status: "success" | "failed" | "unpublished"; message: string; publishedUrl?: string } {
  if (input.recordResult.status !== "success") {
    return {
      status: "failed",
      message: `Phase 2 incremental publish failed: ${input.recordResult.reason}.`
    };
  }
  if (input.recordResult.action === "REMOVE") {
    return {
      status: "unpublished",
      message: "Removed because Publish was unchecked. The previous published URL is retained as historical metadata."
    };
  }
  if (!input.next) {
    throw new UserFacingError(`Successful ${input.recordResult.action} is missing next state for ${input.recordResult.docId}.`);
  }
  if (input.recordResult.action === "MOVE") {
    const previousRoute = input.previous
      ? `${input.previous.brand}/${input.previous.namespace}`
      : "previous route";
    const nextRoute = `${input.next.brand}/${input.next.namespace}`;
    return {
      status: "success",
      message: `Moved from ${previousRoute} to ${nextRoute}.`,
      publishedUrl: input.next.finalUrl
    };
  }
  const verb = input.recordResult.action === "CREATE" ? "Created" : "Updated";
  return {
    status: "success",
    message: `${verb} and verified live by Phase 2 incremental publish.`,
    publishedUrl: input.next.finalUrl
  };
}

async function readApplyResult(filePath: string): Promise<ApplyResult> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as ApplyResult;
  if (parsed.schema !== "notion-doc-publisher-v3/incremental-apply-result" || parsed.version !== 1) {
    throw new UserFacingError("Incremental apply result has an unexpected schema.");
  }
  return parsed;
}

async function readPlan(filePath: string): Promise<IncrementalPlan> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as IncrementalPlan;
  if (parsed.schema !== "notion-doc-publisher-v3/incremental-plan" || parsed.version !== 1) {
    throw new UserFacingError("Incremental plan has an unexpected schema.");
  }
  return parsed;
}

async function readState(filePath: string): Promise<IncrementalStateManifest> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as IncrementalStateManifest;
  if (parsed.schema !== "notion-doc-publisher-v3/incremental-state" || parsed.version !== 1) {
    throw new UserFacingError(`Incremental state has an unexpected schema: ${filePath}`);
  }
  return parsed;
}
