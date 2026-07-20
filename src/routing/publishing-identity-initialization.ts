import { UserFacingError, type AppConfig } from "../config.js";
import { createAssignmentPlan, assertPlanWritable } from "../doc-id/generator.js";
import { isPrivateLinkVisibility } from "../model/document.js";
import { NotionClient } from "../notion/client.js";
import { enableNotionMutationAllowList } from "../notion/read-only-guard.js";
import { autoFillDocuments, loadDocuments } from "../cli/shared.js";
import { isPublishableCandidate } from "../validate/validate.js";

/**
 * Initializes stable system-owned publishing identities before an apply plan.
 *
 * This is deliberately separate from the incremental state machine. It only
 * fills missing DOC_ID / Share Token values, re-reads Notion, and returns. The
 * existing planner, renderer, deployer, verifier, state persistence, and final
 * lifecycle writeback remain unchanged.
 */
export async function initializePublishingIdentities(config: AppConfig): Promise<void> {
  const initialDocuments = await loadDocuments(config);
  const initialPlan = createAssignmentPlan(initialDocuments, config);
  assertPlanWritable(initialPlan);

  // Re-query immediately before any DOC_ID write. The assignment sequence must
  // be identical or the run fails closed rather than risking a collision.
  const reloadedDocuments = await loadDocuments(config);
  const confirmedPlan = createAssignmentPlan(reloadedDocuments, config);
  assertPlanWritable(confirmedPlan);
  assertSameAssignments(initialPlan.assignments, confirmedPlan.assignments);

  const client = new NotionClient(config);
  const restoreMutationAllowList = enableNotionMutationAllowList(
    "incremental-content-publish identity initialization",
    ["updateDocId", "writeAutoFillProperties", "updatePageProperties"]
  );

  try {
    for (const assignment of confirmedPlan.assignments) {
      await client.updateDocId(assignment.pageId, assignment.docId);
    }

    // Routed production planning is intentionally read-only and therefore
    // supplies autoGenerateShareToken=false. Identity initialization is the
    // one narrowly authorized pre-plan mutation boundary, so explicitly enable
    // stable Share Token generation here without changing the planner config.
    const identityConfig: AppConfig = {
      ...config,
      autoGenerateShareToken: true,
      allowMissingShareToken: false
    };

    // Reload after DOC_ID assignment so Share Token / namespace canonical paths
    // are calculated from the persisted identity, never from stale memory.
    const documentsWithIds = await loadDocuments(identityConfig);
    await autoFillDocuments(documentsWithIds, identityConfig);
  } finally {
    restoreMutationAllowList();
  }

  // Final re-read proves that all documents currently eligible for publishing
  // have their required stable identity fields persisted before planning.
  const verifiedDocuments = await loadDocuments(config);
  const missing = verifiedDocuments.filter((document) => {
    if (!isPublishableCandidate(document, config)) {
      return false;
    }
    if (!document.meta.docId) {
      return true;
    }
    return isPrivateLinkVisibility(document.meta.visibility) && !document.meta.shareToken;
  });

  if (missing.length > 0) {
    const titles = missing.map((document) => document.meta.title || document.source.notionPageId).join(", ");
    throw new UserFacingError(
      `Publishing identity initialization did not persist all required DOC_ID / Share Token values: ${titles}`
    );
  }

  console.log(
    `Publishing identity initialization complete: ${confirmedPlan.assignments.length} DOC_ID assignment(s); ` +
    "required private-link Share Tokens verified."
  );
}

function assertSameAssignments(
  first: Array<{ pageId: string; docId: string }>,
  second: Array<{ pageId: string; docId: string }>
): void {
  const left = first.map((item) => `${item.pageId}:${item.docId}`).join("\n");
  const right = second.map((item) => `${item.pageId}:${item.docId}`).join("\n");
  if (left !== right) {
    throw new UserFacingError(
      "DOC_ID assignment changed after re-query. Aborting production identity initialization to avoid a race."
    );
  }
}
