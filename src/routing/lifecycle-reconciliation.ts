import type { DesiredDocumentState, DocumentStateRecord, IncrementalPlanRecord } from "./incremental.js";

// Phase 3 additive reconciliation: repairs stale Notion lifecycle metadata for a
// document that is already correctly deployed and represented in verified private
// state, but whose Notion BUILD_STATUS still shows a prior failure. This module is
// intentionally narrow: it never renders, deploys, or mutates routing/content
// hashes, DOC_ID, or Share Token. It only decides whether a NOOP record's Notion
// status is safe to correct, and if so, what corrective payload to write.

export type NotionLifecycleSnapshot = {
  buildStatus: string;
};

export type ReconciliationSkipReason =
  | "NOT_NOOP"
  | "MISSING_VERIFIED_STATE"
  | "STATE_MISMATCH_BETWEEN_RUNS"
  | "MISSING_DESIRED_STATE"
  | "IDENTITY_OR_HASH_MISMATCH"
  | "MISSING_PUBLIC_URL"
  | "NOTION_STATUS_NOT_STALE";

export type ReconciliationDecision =
  | { eligible: true; state: DocumentStateRecord }
  | { eligible: false; reason: ReconciliationSkipReason };

export type ReconciliationPayload = {
  status: "success";
  message: string;
  publishedUrl: string;
  publishedAt: string;
  runId: string;
};

export type ReconciliationWritebackClient = {
  readLifecycleStatus(pageId: string): Promise<NotionLifecycleSnapshot>;
  reconcileLifecycleStatus(update: {
    pageId: string;
    publishedUrl: string;
    publishedAt: string;
    runId: string;
    message: string;
  }): Promise<void>;
};

export type ReconciliationOutcome = {
  action: "NOOP";
  brand: string;
  docId: string;
  status: "reconciled";
  message: string;
};

/**
 * Evaluate whether a NOOP record's stale Notion lifecycle status may be safely
 * corrected. Eligibility requires the record to be NOOP, a complete matching
 * known-good private state entry on both sides of this run (previous and
 * post-persistence next state), identity/hash agreement with the freshly
 * computed desired state, a known deployed URL, and a Notion BUILD_STATUS of
 * exactly "failed" (the narrowest, primary intended defect case). Any missing
 * or inconsistent evidence fails closed with zero mutation.
 */
export function evaluateNoopReconciliation(input: {
  planRecord: IncrementalPlanRecord;
  previousState?: DocumentStateRecord;
  nextState?: DocumentStateRecord;
  notionStatus: NotionLifecycleSnapshot;
}): ReconciliationDecision {
  const { planRecord, previousState, nextState, notionStatus } = input;

  if (planRecord.action !== "NOOP") {
    return { eligible: false, reason: "NOT_NOOP" };
  }
  if (!previousState || !nextState) {
    return { eligible: false, reason: "MISSING_VERIFIED_STATE" };
  }
  if (!statesMatch(previousState, nextState)) {
    return { eligible: false, reason: "STATE_MISMATCH_BETWEEN_RUNS" };
  }
  const desired = planRecord.desired;
  if (!desired) {
    return { eligible: false, reason: "MISSING_DESIRED_STATE" };
  }
  if (!identityAndHashesMatch(nextState, desired, planRecord)) {
    return { eligible: false, reason: "IDENTITY_OR_HASH_MISMATCH" };
  }
  if (!nextState.finalUrl) {
    return { eligible: false, reason: "MISSING_PUBLIC_URL" };
  }
  if (normalizeStatus(notionStatus.buildStatus) !== "failed") {
    return { eligible: false, reason: "NOTION_STATUS_NOT_STALE" };
  }
  return { eligible: true, state: nextState };
}

/**
 * Build the exact corrective write payload for an eligible record. The
 * published-at timestamp is always the private manifest's preserved value —
 * never the current time — because reconciliation restores a known-good past
 * state, it does not create a new publication event.
 */
export function buildReconciliationPayload(state: DocumentStateRecord, runId: string): ReconciliationPayload {
  return {
    status: "success",
    message:
      "Lifecycle metadata reconciled from an already verified known-good deployment state. " +
      "No rendering or deployment occurred in this run.",
    publishedUrl: state.finalUrl,
    publishedAt: state.publishedAt,
    runId
  };
}

/**
 * Orchestrate reconciliation across every NOOP record in a plan. Only NOOP
 * records are considered; CREATE/UPDATE/MOVE/REMOVE/INVALID/FILTERED records
 * are untouched here and continue through their existing writeback path.
 * A rejected write is never swallowed — it propagates to the caller, which is
 * the same fail-closed behavior already used by the primary writeback loop.
 */
export async function runNoopLifecycleReconciliation(input: {
  planRecords: IncrementalPlanRecord[];
  previousByDocId: Map<string, DocumentStateRecord>;
  nextByDocId: Map<string, DocumentStateRecord>;
  writeback: ReconciliationWritebackClient;
  runId: string;
}): Promise<ReconciliationOutcome[]> {
  const outcomes: ReconciliationOutcome[] = [];
  for (const planRecord of input.planRecords) {
    if (planRecord.action !== "NOOP") {
      continue;
    }
    const notionStatus = await input.writeback.readLifecycleStatus(planRecord.pageId);
    const decision = evaluateNoopReconciliation({
      planRecord,
      previousState: input.previousByDocId.get(planRecord.docId),
      nextState: input.nextByDocId.get(planRecord.docId),
      notionStatus
    });
    if (!decision.eligible) {
      continue;
    }
    const payload = buildReconciliationPayload(decision.state, input.runId);
    await input.writeback.reconcileLifecycleStatus({
      pageId: planRecord.pageId,
      publishedUrl: payload.publishedUrl,
      publishedAt: payload.publishedAt,
      runId: payload.runId,
      message: payload.message
    });
    outcomes.push({
      action: "NOOP",
      brand: planRecord.brand,
      docId: planRecord.docId,
      status: "reconciled",
      message: payload.message
    });
  }
  return outcomes;
}

function normalizeStatus(value: string): string {
  return value.trim().toLowerCase();
}

function statesMatch(a: DocumentStateRecord, b: DocumentStateRecord): boolean {
  return (
    a.docId === b.docId &&
    a.brand === b.brand &&
    a.namespace === b.namespace &&
    a.finalUrl === b.finalUrl &&
    a.contentHash === b.contentHash &&
    a.routingHash === b.routingHash &&
    a.rendererHash === b.rendererHash &&
    a.assetHash === b.assetHash &&
    a.desiredStateHash === b.desiredStateHash
  );
}

function identityAndHashesMatch(
  state: DocumentStateRecord,
  desired: DesiredDocumentState,
  planRecord: IncrementalPlanRecord
): boolean {
  return (
    state.docId === planRecord.docId &&
    state.brand === planRecord.brand &&
    state.contentHash === desired.contentHash &&
    state.routingHash === desired.routingHash &&
    state.rendererHash === desired.rendererHash &&
    state.assetHash === desired.assetHash &&
    state.desiredStateHash === desired.desiredStateHash
  );
}
