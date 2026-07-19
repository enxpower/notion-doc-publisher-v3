import fs from "node:fs/promises";
import path from "node:path";

import { runCli, UserFacingError } from "../config.js";
import { routedDryRunDocuments, loadRoutedDryRunConfig } from "../fixtures/routed-dry-run.js";
import { enableNotionReadOnlyMode } from "../notion/read-only-guard.js";
import { loadDocuments } from "./shared.js";
import { createIncrementalPlan, type IncrementalStateManifest } from "../routing/incremental.js";
import {
  applyReadOnlyPersistedFieldRequirements,
  loadRoutedReadonlyConfigFromEnvironment
} from "../routing/routed-readonly.js";
import { loadBrandRoutes } from "../routing/routes.js";
import { validateDocuments } from "../validate/validate.js";

await runCli(async () => {
  const routes = await loadBrandRoutes();
  const testMode = process.env.INCREMENTAL_TEST_MODE === "fixture";
  const config = testMode
    ? await loadRoutedDryRunConfig()
    : await loadRoutedReadonlyConfigFromEnvironment(routes);
  const statePath = path.resolve(
    process.env.PHASE2_STATE_PATH ?? process.env.INCREMENTAL_STATE_PATH ?? "dist/incremental-state/state.json"
  );
  const outputPath = path.resolve(process.env.INCREMENTAL_PLAN_PATH ?? "dist/incremental-plan/plan.json");
  const previousState = await readOptionalState(statePath);

  const restoreReadOnly = enableNotionReadOnlyMode("plan:incremental");
  try {
    const documents = testMode ? routedDryRunDocuments() : await loadDocuments(config);
    validateDocuments(documents, config);
    applyReadOnlyPersistedFieldRequirements(documents, config);
    const plan = createIncrementalPlan({
      documents,
      routes,
      config,
      previousState
    });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    console.log(
      `Incremental lifecycle plan: CREATE=${plan.counts.CREATE}, UPDATE=${plan.counts.UPDATE}, ` +
      `MOVE=${plan.counts.MOVE}, REMOVE=${plan.counts.REMOVE}, NOOP=${plan.counts.NOOP}, ` +
      `INVALID=${plan.counts.INVALID}, FILTERED=${plan.counts.FILTERED}.`
    );
    console.log(`Plan: ${path.relative(process.cwd(), outputPath)}`);
  } finally {
    restoreReadOnly();
  }
});

async function readOptionalState(filePath: string): Promise<IncrementalStateManifest | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as IncrementalStateManifest;
    if (parsed.schema !== "notion-doc-publisher-v3/incremental-state") {
      throw new UserFacingError("Incremental state manifest has an unexpected schema.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
