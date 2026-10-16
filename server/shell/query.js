// Shell query service: candidate retrieval, exact filtering, pagination and
// coverage reporting for the spherical-shell explorer.
//
// The browser never downloads a whole catalogue to filter it. This service loads
// each selected source, prunes to a CONSERVATIVE candidate set, then applies the
// shared exact membership predicate and distance classifier. A candidate prune
// may keep extra rows, but it may never drop a row that is genuinely inside the
// band — that invariant is what makes the query trustworthy and it is checked
// against a brute-force reference in the tests.
//
// All the science lives in `@novochar/astro` (shell geometry + distance quality);
// this module only sequences sources, isolates failures, pages results and
// reports honestly what was and was not covered.

import {
  DISTANCE_CLASS,
  classifyDistanceEvidence,
  isKnownDistanceUnit,
  shellBounds,
  toLightYears,
} from '@novochar/astro';
import { SHELL_SOURCES } from './sources.js';

export const SHELL_LAYER_IDS = Object.freeze([
  DISTANCE_CLASS.LOCATED,
  DISTANCE_CLASS.UNCERTAIN,
  DISTANCE_CLASS.UNKNOWN,
]);

export const DEFAULT_SHELL_PAGE_LIMIT = 200;
export const MAX_SHELL_PAGE_LIMIT = 5000;

function nonNegativeNumber(value, name, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new RangeError(`${name} must be a finite number >= 0`);
  }
  return number;
}

function parseLayers(include) {
  const ids = include === undefined || include === null || include === ''
    ? [DISTANCE_CLASS.LOCATED, DISTANCE_CLASS.UNCERTAIN]
    : String(include).split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  for (const id of ids) {
    if (!SHELL_LAYER_IDS.includes(id)) throw new RangeError(`unknown layer "${id}"`);
  }
  const layers = {};
  for (const id of SHELL_LAYER_IDS) layers[id] = ids.includes(id);
  return layers;
}

function parseLimit(limit) {
  if (limit === undefined || limit === null || limit === '') return DEFAULT_SHELL_PAGE_LIMIT;
  const number = Number.parseInt(limit, 10);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError('limit must be a positive integer');
  return Math.min(number, MAX_SHELL_PAGE_LIMIT);
}

function parseCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === '') return 0;
  const number = Number.parseInt(cursor, 10);
  if (!Number.isFinite(number) || number < 0) throw new RangeError('cursor must be a non-negative integer');
  return number;
}

function parseSources(sources) {
  if (sources === undefined || sources === null || sources === '') return null;
  return String(sources).split(',').map((part) => part.trim()).filter(Boolean);
}

/**
 * Validate and normalize raw query parameters into a shell query plan.
 * @throws {RangeError} for any invalid input — never guesses a unit or layer.
 */
export function normalizeShellQueryParams(params = {}) {
  const radius = nonNegativeNumber(params.radius, 'radius', 100);
  const thickness = nonNegativeNumber(params.thickness, 'thickness', 20);
  const unit = params.unit ?? 'ly';
  if (!isKnownDistanceUnit(unit)) throw new RangeError(`unknown unit "${unit}"`);
  return {
    radius,
    thickness,
    unit,
    layers: parseLayers(params.include),
    limit: parseLimit(params.limit),
    cursor: parseCursor(params.cursor),
    sources: parseSources(params.sources),
  };
}

/**
 * Lower bound of an evidence's support, in canonical light-years. Used only to
 * prune candidates: a row whose minimum possible distance already exceeds the
 * outer radius cannot be inside the band. Unknown evidence returns 0 so it is
 * never pruned (it belongs to the unknown layer, not to a spatial band).
 */
function minPossibleDistance(evidence) {
  if (!evidence || typeof evidence !== 'object') return 0;
  if (evidence.kind === 'point') {
    try { return Math.max(0, toLightYears(evidence.value, evidence.unit)); } catch { return 0; }
  }
  if (evidence.kind === 'interval') {
    try {
      const low = evidence.low === -Infinity ? 0 : toLightYears(evidence.low, evidence.unit);
      return Math.max(0, low);
    } catch { return 0; }
  }
  return 0;
}

function summarizeSkipped(skipped) {
  const reasons = {};
  for (const item of skipped) reasons[item.reason] = (reasons[item.reason] || 0) + 1;
  return reasons;
}

function orderById(a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Run a shell query.
 *
 * @param {object} plan from {@link normalizeShellQueryParams}
 * @param {{world?:object, sources?:object[], now?:() => number}} [options]
 */
export function queryShell(plan, { world = {}, sources = SHELL_SOURCES, now = () => Date.now() } = {}) {
  const radiusLy = toLightYears(plan.radius, plan.unit);
  const thicknessLy = toLightYears(plan.thickness, plan.unit);
  const bounds = shellBounds(radiusLy, thicknessLy);

  const selected = plan.sources
    ? sources.filter((source) => plan.sources.includes(source.id))
    : sources;

  const members = [];
  const seenIds = new Set();
  const coverage = [];
  const counts = {
    sources: selected.length,
    rows: 0,
    skipped: 0,
    candidates: 0,
    duplicates: 0,
    located: 0,
    uncertain: 0,
    unknown: 0,
    outside: 0,
  };

  for (const source of selected) {
    const started = now();
    let loaded;
    try {
      loaded = source.load(world);
    } catch (error) {
      coverage.push({ source: source.id, status: 'error', error: String(error?.message || error) });
      continue;
    }

    const rows = Array.isArray(loaded?.rows) ? loaded.rows : [];
    const skipped = Array.isArray(loaded?.skipped) ? loaded.skipped : [];
    let candidates = 0;
    let sourceMembers = 0;

    for (const row of rows) {
      counts.rows += 1;
      // Conservative prune: anything whose minimum possible distance is beyond
      // the outer radius is definitely outside.
      if (minPossibleDistance(row.evidence) > bounds.rMax) {
        counts.outside += 1;
        continue;
      }
      candidates += 1;

      const classification = classifyDistanceEvidence(row.evidence, bounds);
      if (classification.status === DISTANCE_CLASS.OUTSIDE) {
        counts.outside += 1;
        continue;
      }
      counts[classification.status] += 1;

      if (!plan.layers[classification.status]) continue;
      if (seenIds.has(row.id)) {
        counts.duplicates += 1;
        continue;
      }
      seenIds.add(row.id);
      members.push({ ...row, status: classification.status, classification });
      sourceMembers += 1;
    }

    counts.skipped += skipped.length;
    counts.candidates += candidates;
    coverage.push({
      source: source.id,
      label: source.label,
      kind: source.kind,
      status: 'ok',
      rows: rows.length,
      candidates,
      members: sourceMembers,
      skipped: skipped.length,
      skippedReasons: summarizeSkipped(skipped),
      ms: Math.max(0, now() - started),
      capabilities: source.capabilities,
    });
  }

  members.sort(orderById);

  const pageRecords = members.slice(plan.cursor, plan.cursor + plan.limit);
  const nextCursor = plan.cursor + plan.limit < members.length ? plan.cursor + plan.limit : null;

  return {
    selection: { radius: plan.radius, thickness: plan.thickness, unit: plan.unit, layers: plan.layers },
    bounds: { rMin: bounds.rMin, rMax: bounds.rMax, unit: 'ly' },
    records: pageRecords,
    counts: {
      ...counts,
      members: members.length,
      returned: pageRecords.length,
      pending: Math.max(0, members.length - (plan.cursor + pageRecords.length)),
    },
    coverage,
    page: {
      limit: plan.limit,
      offset: plan.cursor,
      next: nextCursor,
      complete: nextCursor === null,
    },
  };
}
