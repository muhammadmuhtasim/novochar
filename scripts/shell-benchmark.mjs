// Server-side shell-query performance baseline (audit Step 3).
//
// Measures the *current* spatial query service — a linear scan with a
// conservative prune — before any spatial index exists, so later index work has
// a documented comparison point. It is deliberately NOT part of `npm test`: it
// is a measurement, not a pass/fail gate, and its absolute numbers depend on the
// machine. Run it on demand:
//
//   npm run bench:shell
//
// Environment variables:
//   SHELL_BENCH_SIZES   comma-separated catalogue sizes (default 1000..500000)
//   SHELL_BENCH_RUNS    timed repetitions per cell, median reported (default 5)
//   SHELL_BENCH_JSON    path to also write the machine-readable report
//
// The numbers are only meaningful next to their environment; both are printed.

import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

import {
  MAX_SHELL_PAGE_LIMIT,
  normalizeShellQueryParams,
  queryShell,
} from '../server/shell/query.js';

const sizes = (process.env.SHELL_BENCH_SIZES ?? '1000,10000,50000,100000,250000,500000')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);
const runs = Math.max(1, Number.parseInt(process.env.SHELL_BENCH_RUNS ?? '5', 10) || 5);

// Synthetic catalogue: distances are quasi-random in [0, maxDistance], 10% carry
// no distance at all (so the unknown layer is exercised). This is a shape, not a
// claim about any real catalogue's distribution.
function makeRows(n, { maxDistance = 5000, missingFraction = 0.1 } = {}) {
  const rows = new Array(n);
  const missingEvery = Math.max(1, Math.round(1 / missingFraction));
  for (let i = 0; i < n; i++) {
    const distance = i % missingEvery === 0 ? null : (((i * 2654435761) % 100000) / 100000) * maxDistance;
    rows[i] = {
      id: `s${String(i).padStart(8, '0')}`,
      ra: (i * 7) % 360,
      dec: ((i * 13) % 180) - 90,
      frame: 'icrs',
      type: 'X',
      evidence: distance === null
        ? { kind: 'missing', reason: 'no-distance' }
        : { kind: 'point', value: distance, unit: 'ly' },
      provenance: { source: 'benchmark', sourceId: `s${i}` },
      qualityNotes: [],
    };
  }
  return rows;
}

function sourceOf(id, rows) {
  return { id, label: id, kind: 'benchmark', capabilities: {}, load: () => ({ rows, skipped: [] }) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function timeQuery(sources, params, repetitions = runs) {
  const plan = normalizeShellQueryParams(params);
  const times = [];
  let result;
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    result = queryShell(plan, { sources });
    times.push(performance.now() - started);
  }
  return {
    ms: median(times),
    min: Math.min(...times),
    rows: result.counts.rows,
    candidates: result.counts.candidates,
    members: result.counts.members,
  };
}

const configs = [
  { label: 'default', radius: 100, thickness: 20 },
  { label: 'wide', radius: 1000, thickness: 2000 },
  { label: 'distant', radius: 10000, thickness: 1000 },
];

const environment = {
  node: process.version,
  platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  cores: os.cpus().length,
  totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
  runs,
};
console.log('== env ==');
console.log(`${environment.node} | ${environment.platform} | ${environment.cpu} | cores=${environment.cores} | mem=${environment.totalMemGB}GB | median of ${runs}`);
console.log('synthetic rows: 10% no distance, rest uniform 0..5000 ly\n');

const report = { environment, dataset: { maxDistance: 5000, missingFraction: 0.1 }, cells: [], scale: {} };

for (const n of sizes) {
  const sources = [sourceOf('benchmark', makeRows(n))];
  for (const config of configs) {
    const result = timeQuery(sources, {
      radius: config.radius,
      thickness: config.thickness,
      include: 'located,uncertain,unknown',
      limit: MAX_SHELL_PAGE_LIMIT,
    });
    report.cells.push({ rows: n, config: config.label, ...result, ms: +result.ms.toFixed(2) });
    console.log(
      `${String(n).padStart(7)} rows | ${config.label.padEnd(7)} | scan=${String(result.rows).padStart(7)} ` +
      `cand=${String(result.candidates).padStart(7)} members=${String(result.members).padStart(7)} ` +
      `median=${result.ms.toFixed(1)}ms min=${result.min.toFixed(1)}ms`,
    );
  }
  console.log('');
}

// Pagination cost: a deep page rescans the whole source, so paging shrinks the
// payload but not the server work. Measured at the largest configured size.
{
  const n = sizes[sizes.length - 1];
  const sources = [sourceOf('benchmark', makeRows(n))];
  const params = { radius: 10000, thickness: 1000, include: 'located,uncertain,unknown', limit: 300 };
  const first = timeQuery(sources, { ...params, cursor: 0 });
  const deep = timeQuery(sources, { ...params, cursor: Math.floor(n / 2) });
  report.pagination = {
    rows: n,
    limit: 300,
    firstPageMs: +first.ms.toFixed(2),
    deepPageMs: +deep.ms.toFixed(2),
    note: 'both pages scan the full source; pagination reduces payload, not work',
  };
  console.log('== pagination cost ==');
  console.log(`${n} rows, limit 300: cursor=0 -> ${first.ms.toFixed(1)}ms (scan ${first.rows} rows); cursor=${Math.floor(n / 2)} -> ${deep.ms.toFixed(1)}ms (scan ${deep.rows} rows)`);
}

console.log(`\nJSON:\n${JSON.stringify(report, null, 2)}`);
if (process.env.SHELL_BENCH_JSON) {
  writeFileSync(process.env.SHELL_BENCH_JSON, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${process.env.SHELL_BENCH_JSON}`);
}
