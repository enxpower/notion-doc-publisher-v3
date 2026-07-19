import { strict as assert } from "node:assert";
import { test } from "node:test";

import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { createIncrementalPlan } from "../routing/incremental.js";
import { assertIncrementalPlanUnchanged, planFingerprint } from "../routing/incremental-plan-drift.js";
import { loadBrandRoutes } from "../routing/routes.js";

test("plan drift ignores generated timestamps but preserves the prepared lifecycle transaction", async () => {
  const config = await loadRoutedDryRunConfig();
  const routes = await loadBrandRoutes();
  const expected = createIncrementalPlan({
    documents: routedDryRunDocuments(),
    routes,
    config,
    now: "2026-07-19T00:00:00.000Z"
  });
  const actual = { ...structuredClone(expected), generatedAt: "2026-07-19T00:01:00.000Z" };

  assert.equal(planFingerprint(expected), planFingerprint(actual));
  assert.doesNotThrow(() => assertIncrementalPlanUnchanged(expected, actual));
});

test("plan drift fails closed when an output-relevant desired state changes", async () => {
  const config = await loadRoutedDryRunConfig();
  const routes = await loadBrandRoutes();
  const expected = createIncrementalPlan({ documents: routedDryRunDocuments(), routes, config });
  const actual = structuredClone(expected);
  const desired = actual.records[0]?.desired;
  assert.ok(desired);
  desired.desiredStateHash = "changed-after-planning";

  assert.throws(
    () => assertIncrementalPlanUnchanged(expected, actual),
    /INCREMENTAL_PLAN_DRIFT/
  );
});
