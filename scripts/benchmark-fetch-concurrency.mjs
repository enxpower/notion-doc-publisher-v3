#!/usr/bin/env node
// Phase 3 Prompt 6: local, offline synthetic benchmark for bounded document
// fetch concurrency. Simulates independent Notion round-trip latency with
// setTimeout — no network access, no credentials, no Notion contact.
//
// Usage: node scripts/benchmark-fetch-concurrency.mjs
//
// Re-run this before raising NOTION_FETCH_CONCURRENCY above its default (4):
// it shows the expected relative benefit at the current document-count scale
// and confirms the marginal return shrinks quickly past 4-6 concurrent
// requests for a single-runner Notion fetch workload.

async function mapWithConcurrency(items, concurrency, worker) {
  if (items.length === 0) return [];
  const bounded = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    for (;;) {
      const i = next;
      if (i >= items.length) return;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: bounded }, run));
  return results;
}

async function timeRun(docCount, latencyMs, concurrency) {
  const items = Array.from({ length: docCount }, (_, i) => i);
  const start = performance.now();
  await mapWithConcurrency(items, concurrency, async () => {
    await new Promise((resolve) => setTimeout(resolve, latencyMs));
  });
  return performance.now() - start;
}

const docCounts = [1, 10, 50, 100];
const latencies = [10, 50, 100];
const concurrencies = [1, 4, 8];

console.log("docs\tlatencyMs\tconcurrency\telapsedMs\tspeedupVsSerial");
for (const docCount of docCounts) {
  for (const latencyMs of latencies) {
    let serialMs;
    for (const concurrency of concurrencies) {
      const elapsed = await timeRun(docCount, latencyMs, concurrency);
      if (concurrency === 1) serialMs = elapsed;
      const speedup = (serialMs / elapsed).toFixed(2);
      console.log(`${docCount}\t${latencyMs}\t${concurrency}\t${elapsed.toFixed(0)}\t${speedup}x`);
    }
  }
}
