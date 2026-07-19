import { UserFacingError } from "../config.js";
import type { IncrementalPlan } from "./incremental.js";

export function assertIncrementalPlanUnchanged(expected: IncrementalPlan, actual: IncrementalPlan): void {
  const expectedFingerprint = planFingerprint(expected);
  const actualFingerprint = planFingerprint(actual);
  if (expectedFingerprint !== actualFingerprint) {
    throw new UserFacingError(
      "INCREMENTAL_PLAN_DRIFT: Notion or publisher state changed after planning. Retry the production run from a fresh plan."
    );
  }
}

export function planFingerprint(plan: IncrementalPlan): string {
  return JSON.stringify(
    plan.records
      .map((record) => ({
        action: record.action,
        pageId: record.pageId,
        docId: record.docId,
        brand: record.brand,
        reason: record.reason,
        previousHash: record.previous?.desiredStateHash ?? "",
        previousUrl: record.previous?.finalUrl ?? "",
        desiredHash: record.desired?.desiredStateHash ?? "",
        desiredUrl: record.desired?.finalUrl ?? "",
        errors: [...record.errors].sort()
      }))
      .sort((left, right) => left.pageId.localeCompare(right.pageId))
  );
}
