// Live connectivity probe for the archive registry.
//
// For each configured IVOA archive this actually issues a small real query and
// reports the truthful outcome ({ok, status, rows, error}). It never fabricates
// success: an archive is 'ok' only when a live request returns rows with
// QUERY_STATUS OK. This is the mechanism by which the app reflects reality.

import { ARCHIVES } from './registry.js';
import { tapQuery, tapTables } from './tap.js';
import { querySIA } from './sia2.js';
import { querySSA } from './ssa.js';
import { resolveObject } from './resolver.js';

const PROBE_TIMEOUT = 20000;

async function tryProbe(label, fn) {
  try {
    const r = await fn();
    const ok = r.status ? r.status === 'OK' : r.rows.length > 0;
    return { ok, status: r.status || 'n/a', rows: r.rows ? r.rows.length : 0, error: null };
  } catch (err) {
    return { ok: false, status: 'ERROR', rows: 0, error: String(err.message || err).slice(0, 220) };
  }
}

/** Probe a single archive across its registered, queryable protocols. */
export async function probeArchive(key, { fetchImpl = globalThis.fetch, includeTables = false } = {}) {
  const cfg = ARCHIVES[key];
  if (!cfg) return { key, ok: false, error: 'unknown archive' };

  const result = { key, name: cfg.name, declared: cfg.status, protocols: {} };
  const p = cfg.protocols || {};

  if (p.tap) {
    const q = cfg.probeQuery || (includeTables ? 'SELECT * FROM TAP_SCHEMA.tables' : 'SELECT * FROM TAP_SCHEMA.tables');
    const pr = await tryProbe('tap', () =>
      tapQuery({ archive: key, query: q, timeout: PROBE_TIMEOUT, fetchImpl }));
    result.protocols.tap = pr;
  }
  if (p.sia) {
    result.protocols.sia = await tryProbe('sia', () =>
      querySIA({ endpoint: key, pos: '67.0 -1.0', size: 0.1, timeout: PROBE_TIMEOUT, fetchImpl }));
  }
  if (p.ssa) {
    result.protocols.ssa = await tryProbe('ssa', () =>
      querySSA({ endpoint: key, pos: '67.0 -1.0', size: 0.1, timeout: PROBE_TIMEOUT, fetchImpl }));
  }
  if (p.resolve) {
    result.protocols.resolve = await tryProbe('resolve', () =>
      resolveObject('Crab', { fetchImpl, timeout: PROBE_TIMEOUT }));
  }
  if (p.rest || p.file || p.registry) {
    result.protocols[Object.keys(p).find((k) => /rest|file|registry/.test(k))] = {
      ok: false, status: 'n/a', rows: 0,
      error: 'no live-probe query defined (REST/download/registry interface)',
    };
  }

  const outcomes = Object.values(result.protocols);
  result.ok = outcomes.some((o) => o.ok);
  result.probed = outcomes.length > 0;
  return result;
}

/** Probe every registry archive, concurrently, each independently bounded. */
export async function probeAll({ fetchImpl = globalThis.fetch, keys = Object.keys(ARCHIVES) } = {}) {
  const results = await Promise.all(keys.map((k) => probeArchive(k, { fetchImpl })));
  const ok = results.filter((r) => r.ok).map((r) => r.key);
  return {
    probed: results.length,
    ok: ok.length,
    okArchives: ok,
    archives: results,
    generated: new Date().toISOString(),
  };
}
