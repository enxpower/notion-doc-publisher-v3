import { strict as assert } from "node:assert";
import { test } from "node:test";

import { loadRoutedDryRunConfig, routedDryRunDocuments } from "../fixtures/routed-dry-run.js";
import { normalizeBrand } from "../routing/brand-routing.js";
import { createDesiredDocumentState, createIncrementalPlan, type IncrementalStateManifest } from "../routing/incremental.js";
import { loadBrandRoutes } from "../routing/routes.js";
import { validateDocuments } from "../validate/validate.js";

test("validated invalid Share Token preserves previous state through INVALID planning", async () => {
  const config = await loadRoutedDryRunConfig();
  const routes = await loadBrandRoutes();
  const valid = structuredClone(routedDryRunDocuments().find((document) => normalizeBrand(document.meta.brand.label) === "GONG")!);
  const route = routes.find((candidate) => normalizeBrand(candidate.brand) === "GONG")!;
  const previousState: IncrementalStateManifest = {
    schema: "notion-doc-publisher-v3/incremental-state",
    version: 1,
    generatedAt: "2026-07-19T00:00:00.000Z",
    records: [{
      ...createDesiredDocumentState({ document: valid, route, config }),
      publishedAt: "2026-07-19T00:00:00.000Z"
    }]
  };
  const invalid = structuredClone(valid);
  invalid.meta.shareToken = "INVALIDTOKEN";
  validateDocuments([invalid], config);

  const plan = createIncrementalPlan({ documents: [invalid], routes, config, previousState });

  assert.equal(invalid.validation.errors.some((issue) => issue.code === "INVALID_SHARE_TOKEN"), true);
  assert.equal(plan.counts.INVALID, 1);
  assert.equal(plan.records[0]?.action, "INVALID");
  assert.equal(plan.records[0]?.previous?.desiredStateHash, previousState.records[0]?.desiredStateHash);
});
