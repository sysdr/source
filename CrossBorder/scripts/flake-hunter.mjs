#!/usr/bin/env node
/**
 * Flake hunter — run the suite N times (REQ flake gate / RW flake).
 * Default N=3 for CI budget; set FLAKE_RUNS=10 for Gate 3 bar.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RUNS = Number(process.env.FLAKE_RUNS || 3);
const results = [];

for (let i = 1; i <= RUNS; i++) {
  console.log(`\n=== Flake run ${i}/${RUNS} ===`);
  const started = Date.now();
  const proc = spawnSync('npm', ['test'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    maxBuffer: 20 * 1024 * 1024,
  });
  const ok = proc.status === 0;
  results.push({
    run: i,
    ok,
    exit_code: proc.status,
    duration_ms: Date.now() - started,
  });
  if (!ok) {
    console.error(proc.stdout?.slice(-2000));
    console.error(proc.stderr?.slice(-2000));
  }
}

const failed = results.filter((r) => !r.ok);
const report = {
  meta: {
    artifact: 'flake_report',
    version: '1.0.0',
    phase: 'verify',
    cycle: 1,
    generated_at: new Date().toISOString(),
    agent_id: 'flake-hunter',
  },
  runs_requested: RUNS,
  runs_completed: results.length,
  flake_rate: failed.length / results.length,
  gate3_target_runs: 10,
  gate3_ready: RUNS >= 10 && failed.length === 0,
  results,
  notes: RUNS < 10
    ? 'Partial flake sample — set FLAKE_RUNS=10 before Gate 3.'
    : failed.length === 0
      ? 'Zero flakes across full 10-run gate.'
      : 'Flakes detected — file FIX_REQUEST to test author.',
};

mkdirSync(resolve('context/reports'), { recursive: true });
writeFileSync(resolve('context/reports/flake_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);
