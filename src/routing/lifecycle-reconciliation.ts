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
  | "URL_ROUTE_BOUNDARY_MISMATCH"
  | "NOTION_STATUS_NOT_STALE";

export type ReconciliationDecision =
  | { eligible: true; state: DocumentStateRecord }
  | { eligible: false; reason: ReconciliationSkipReason };

export type PreconditionSkipReason = Exclude<ReconciliationSkipReason, "NOTION_STATUS_NOT_STALE">;

export type PreconditionResult =
  | { eligible: true; state: DocumentStateRecord }
  | { eligible: false; reason: PreconditionSkipReason };

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
 * computed desired state, a known deployed URL that structurally falls within
 * the document's own origin and path-prefix boundary (independent defense
 * against a private-state record whose URL field drifted out of sync with its
 * hash fields), and a Notion BUILD_STATUS of exactly "failed" (the narrowest,
 * primary intended defect case). Any missing or inconsistent evidence fails
 * closed with zero mutation.
 */
export function evaluateNoopReconciliation(input: {
  planRecord: IncrementalPlanRecord;
  previousState?: DocumentStateRecord;
  nextState?: DocumentStateRecord;
  notionStatus: NotionLifecycleSnapshot;
}): ReconciliationDecision {
  const preconditions = evaluateNoopReconciliationPreconditions(input);
  if (!preconditions.eligible) {
    return preconditions;
  }
  if (normalizeStatus(input.notionStatus.buildStatus) !== "failed") {
    return { eligible: false, reason: "NOTION_STATUS_NOT_STALE" };
  }
  return { eligible: true, state: preconditions.state };
}

/**
 * Phase 3 Prompt 6: every check that does NOT require contacting Notion,
 * split out so the orchestrator can skip the Notion `readLifecycleStatus`
 * API call entirely for records that are already structurally ineligible
 * (missing/mismatched private state, hash disagreement, missing or
 * out-of-boundary URL). This changes nothing about eligibility — the
 * combination of this function followed by the Notion status check is
 * exactly equivalent to `evaluateNoopReconciliation` — it only changes
 * *when* the Notion read happens, avoiding it entirely when the answer
 * would be "not eligible" regardless of the Notion status.
 */
export function evaluateNoopReconciliationPreconditions(input: {
  planRecord: IncrementalPlanRecord;
  previousState?: DocumentStateRecord;
  nextState?: DocumentStateRecord;
}): PreconditionResult {
  const { planRecord, previousState, nextState } = input;

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
  if (!urlMatchesRouteBoundary(nextState)) {
    return { eligible: false, reason: "URL_ROUTE_BOUNDARY_MISMATCH" };
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
 *
 * Phase 3 Prompt 6: all in-memory eligibility preconditions are checked
 * before any Notion API call. A structurally ineligible NOOP record (missing
 * or mismatched private state, hash disagreement, missing/out-of-boundary
 * URL) costs zero `readLifecycleStatus` calls. Only a record that passes
 * every precondition triggers exactly one Notion read, and a mutation is
 * still written only when that read shows a stale `"failed"` status —
 * mutation eligibility and ordering are unchanged from before this prompt.
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
    const preconditions = evaluateNoopReconciliationPreconditions({
      planRecord,
      previousState: input.previousByDocId.get(planRecord.docId),
      nextState: input.nextByDocId.get(planRecord.docId)
    });
    if (!preconditions.eligible) {
      continue;
    }
    const notionStatus = await input.writeback.readLifecycleStatus(planRecord.pageId);
    if (normalizeStatus(notionStatus.buildStatus) !== "failed") {
      continue;
    }
    const payload = buildReconciliationPayload(preconditions.state, input.runId);
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

/**
 * Independent, non-hash-based confinement check: the verified state's public
 * URL must structurally fall within that same record's own canonical origin
 * and path prefix. This guards against a corrupted or manually edited private
 * state record whose finalUrl no longer matches its own routing boundary,
 * even if its hash fields were left untouched.
 */
function urlMatchesRouteBoundary(state: DocumentStateRecord): boolean {
  const origin = state.canonicalOrigin.replace(/\/+$/, "");
  const prefix = state.pathPrefix ? `/${state.pathPrefix.replace(/^\/+|\/+$/g, "")}` : "";
  return state.finalUrl.startsWith(`${origin}${prefix}`);
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
