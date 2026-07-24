// Phase 3 Prompt 6: a small, dependency-free bounded worker pool used to run
// independent async operations (currently: per-document Notion block fetches)
// with a conservative, validated concurrency cap. Output preserves input
// order regardless of completion order; the first rejection fails the whole
// operation (no partial/silent-continue results), matching the existing
// serial behavior this replaces.

export const DEFAULT_CONCURRENCY = 4;
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 8;

/**
 * Parses a concurrency override from an environment-style string value.
 * Any missing, empty, non-integer, or out-of-range value fails closed to
 * `fallback` (the safe default) rather than throwing — concurrency is a
 * performance knob, not a correctness-affecting configuration, so invalid
 * input must never block a run.
 */
export function resolveConcurrency(rawValue: string | undefined, fallback: number = DEFAULT_CONCURRENCY): number {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < MIN_CONCURRENCY || parsed > MAX_CONCURRENCY) {
    return fallback;
  }
  return parsed;
}

/**
 * Maps `items` through `worker` with at most `concurrency` operations
 * in flight at once. Results are returned in the same order as `items`,
 * independent of completion order. If any worker rejects, no further items
 * are started and the returned promise rejects with that error once all
 * already-in-flight workers settle (never a silently partial result).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let hasError = false;
  let firstError: unknown;

  async function runWorker(): Promise<void> {
    for (;;) {
      if (hasError) {
        return;
      }
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) {
        return;
      }
      nextIndex += 1;
      try {
        results[currentIndex] = await worker(items[currentIndex] as T, currentIndex);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: boundedConcurrency }, () => runWorker()));

  if (hasError) {
    throw firstError;
  }
  return results;
}
