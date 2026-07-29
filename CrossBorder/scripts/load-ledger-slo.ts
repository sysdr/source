/**
 * Ledger query load smoke vs SLO target (REQ-031 / REQ-066 / RW-004).
 * Runs N sequential GETs against /api/transactions and asserts p95 < 500ms.
 */
process.env.VITEST = '1'; // must precede dynamic import of server/index

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ITERATIONS = Number(process.env.LOAD_ITERS || 40);
const TARGET_P95_MS = 500;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const { createServer } = await import('../server/index.ts');
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  const base = `http://127.0.0.1:${addr.port}`;

  await fetch(`${base}/api/health`);
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${base}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: 'load-org',
        transactions: [{
          id: `load-tx-${i}`,
          date: '2026-07-01',
          description: `Load seed ${i}`,
          amount: 100 + i,
          currency: 'INR',
          type: 'Income',
          source: 'Manual',
          category: 'Services',
          status: 'Completed',
        }],
      }),
    });
    if (!res.ok && i === 0) {
      console.warn('seed status', res.status, await res.text());
    }
  }

  const durations: number[] = [];
  let errors = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = Date.now();
    const res = await fetch(`${base}/api/transactions?orgId=load-org&limit=100`);
    durations.push(Date.now() - t0);
    if (!res.ok) errors += 1;
  }

  durations.sort((a, b) => a - b);
  const report = {
    meta: {
      artifact: 'performance_report',
      version: '1.0.0',
      phase: 'verify',
      cycle: 1,
      generated_at: new Date().toISOString(),
      agent_id: 'performance-analyst',
    },
    scenario: 'ledger_query_sequential',
    iterations: ITERATIONS,
    target_p95_ms: TARGET_P95_MS,
    p50_ms: percentile(durations, 50),
    p95_ms: percentile(durations, 95),
    p99_ms: percentile(durations, 99),
    max_ms: durations[durations.length - 1] || 0,
    error_count: errors,
    within_slo: percentile(durations, 95) <= TARGET_P95_MS && errors === 0,
    requirement_ids: ['REQ-031', 'REQ-066'],
  };

  mkdirSync(resolve('context/reports'), { recursive: true });
  writeFileSync(resolve('context/reports/performance_report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  try {
    server.close();
  } catch {
    /* ignore */
  }
  process.exit(report.within_slo ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
