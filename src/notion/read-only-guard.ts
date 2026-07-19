import { UserFacingError } from "../config.js";

let activeReadOnlyContext: string | null = null;

export function enableNotionReadOnlyMode(context: string): () => void {
  const previousContext = activeReadOnlyContext;
  activeReadOnlyContext = context;
  return () => {
    activeReadOnlyContext = previousContext;
  };
}

export function assertNotionMutationAllowed(operation: string): void {
  if (!activeReadOnlyContext) {
    return;
  }
  throw new UserFacingError(`Notion mutation blocked during ${activeReadOnlyContext}: ${operation}.`);
}

export function isNotionReadOnlyMode(): boolean {
  return activeReadOnlyContext !== null;
}
