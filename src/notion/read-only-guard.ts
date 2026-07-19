import { UserFacingError } from "../config.js";

let activeReadOnlyContext: string | null = null;
let activeMutationAllowList: { context: string; allowedOperations: Set<string> } | null = null;

export function enableNotionReadOnlyMode(context: string): () => void {
  const previousContext = activeReadOnlyContext;
  activeReadOnlyContext = context;
  return () => {
    activeReadOnlyContext = previousContext;
  };
}

export function assertNotionMutationAllowed(operation: string): void {
  if (!activeReadOnlyContext) {
    if (activeMutationAllowList && !activeMutationAllowList.allowedOperations.has(operation)) {
      throw new UserFacingError(`Notion mutation blocked during ${activeMutationAllowList.context}: ${operation}.`);
    }
    return;
  }
  throw new UserFacingError(`Notion mutation blocked during ${activeReadOnlyContext}: ${operation}.`);
}

export function isNotionReadOnlyMode(): boolean {
  return activeReadOnlyContext !== null;
}

export function enableNotionMutationAllowList(context: string, allowedOperations: string[]): () => void {
  const previousAllowList = activeMutationAllowList;
  activeMutationAllowList = { context, allowedOperations: new Set(allowedOperations) };
  return () => {
    activeMutationAllowList = previousAllowList;
  };
}
