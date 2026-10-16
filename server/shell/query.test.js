import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISTANCE_CLASS,
  classifyDistanceEvidence,
  shellBounds,
  toLightYears,
} from '@novochar/astro';
import {
  DEFAULT_SHELL_PAGE_LIMIT,
  MAX_SHELL_PAGE_LIMIT,
  normalizeShellQueryParams,
  queryShell,
} from './query.js';
import { starRows } from './sources.js';

function pointRow(id, ly, extra = {}) {
  return {
    id,
    name: id,
    ra: 10,
    dec: 5,
    frame: 'icrs',
    type: 'X',
    evidence: { kind: 'point', value: ly, unit: 'ly' },
    provenance: { source: 'test', sourceId: id },
    qualityNotes: [],
    ...extra,
  };
}

function sourceOf(id, rows, { fail = false } = {}) {
  return {
    id,
    label: id,
    kind: 'test',
    capabilities: {},
    load: () => {
      if (fail) throw new Error('source down');
      return { rows, skipped: [] };
    },
  };
}

function makeDataset() {
  const rows = [];
  for (let d = 0; d < 300; d++) rows.push(pointRow(`p${String(d).padStart(3, '0')}`, d + 0.5));
  rows.push(pointRow('i1', 0, { evidence: { kind: 'interval', low: 95, high: 105, unit: 'ly' } }));
  rows.push(pointRow('i2', 0, { evidence: { kind: 'interval', low: 80, high: 130, unit: 'ly' } }));
  rows.push(pointRow('q1', 0, { evidence: { kind: 'posterior', cdf: (x) => Math.min(1, Math.max(0, (x - 95) / 10)) } }));
  rows.push(pointRow('u1', 0, { evidence: { kind: 'missing', reason: 'no-distance' } }));
  return [sourceOf('a', rows)];
}

/** Independent reference: classify every row directly, keep the layer members. */
function referenceMembers(sources, plan) {
  const bounds = shellBounds(
    toLightYears(plan.radius, plan.unit),
    toLightYears(plan.thickness, plan.unit),
  );
  const members = [];
  const seen = new Set();
  for (const source of sources) {
    for (const row of source.load().rows) {
      const classification = classifyDistanceEvidence(row.evidence, bounds);
      if (!plan.layers[classification.status]) continue; // `outside` -> falsy
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      members.push(row.id);
    }
  }
  return members.sort();
}

function memberIds(result) {
  return result.records.map((record) => record.id).sort();
}

test('query parameters are normalized and validated', () => {
  assert.deepEqual(normalizeShellQueryParams({}), {
    radius: 100,
    thickness: 20,
    unit: 'ly',
    layers: { located: true, uncertain: true, unknown: false },
    limit: DEFAULT_SHELL_PAGE_LIMIT,
    cursor: 0,
    sources: null,
  });

  for (const bad of [{ radius: -1 }, { thickness: 'abc' }, { unit: 'furlong' }, { include: 'nope' }, { limit: 0 }, { cursor: -5 }]) {
    assert.throws(() => normalizeShellQueryParams(bad), RangeError, JSON.stringify(bad));
  }
  assert.equal(normalizeShellQueryParams({ limit: 999999 }).limit, MAX_SHELL_PAGE_LIMIT);
  assert.deepEqual(normalizeShellQueryParams({ include: 'unknown' }).layers, {
    located: false, uncertain: false, unknown: true,
  });
  assert.deepEqual(normalizeShellQueryParams({ sources: 'survey, stars' }).sources, ['survey', 'stars']);
});

test('a band selects exactly the rows the shared classifier places inside it', () => {
  const sources = makeDataset();
  const result = queryShell(
    normalizeShellQueryParams({ radius: 100, thickness: 20, include: 'located,uncertain,unknown', limit: MAX_SHELL_PAGE_LIMIT }),
    { sources },
  );
  const byId = new Map(result.records.map((record) => [record.id, record]));

  for (let d = 0; d < 300; d++) {
    const id = `p${String(d).padStart(3, '0')}`;
    const inside = d + 0.5 >= 90 && d + 0.5 <= 110;
    assert.equal(byId.has(id), inside, `${id} membership`);
  }
  assert.equal(byId.get('i1').status, DISTANCE_CLASS.LOCATED);
  assert.equal(byId.get('i2').status, DISTANCE_CLASS.UNCERTAIN);
  assert.equal(byId.get('q1').status, DISTANCE_CLASS.LOCATED);
  assert.equal(byId.get('u1').status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(byId.get('i1').classification.reason, 'interval-inside-shell');
});

test('candidate pruning never drops a true member (brute-force cross-check)', () => {
  const sources = makeDataset();
  for (const radius of [5, 50, 100, 150, 299]) {
    for (const thickness of [0.5, 20, 400]) {
      const plan = normalizeShellQueryParams({
        radius, thickness, include: 'located,uncertain,unknown', limit: MAX_SHELL_PAGE_LIMIT,
      });
      assert.deepEqual(memberIds(queryShell(plan, { sources })), referenceMembers(sources, plan), `band ${radius}/${thickness}`);
    }
  }
});

test('layer selection controls what is returned', () => {
  const sources = makeDataset();
  const locatedOnly = queryShell(
    normalizeShellQueryParams({ radius: 100, thickness: 20, include: 'located', limit: MAX_SHELL_PAGE_LIMIT }),
    { sources },
  );
  assert.ok(locatedOnly.records.length > 0);
  assert.ok(locatedOnly.records.every((record) => record.status === DISTANCE_CLASS.LOCATED));

  const unknownOnly = queryShell(
    normalizeShellQueryParams({ radius: 100, thickness: 20, include: 'unknown', limit: MAX_SHELL_PAGE_LIMIT }),
    { sources },
  );
  assert.deepEqual(memberIds(unknownOnly), ['u1']);
});

test('pagination covers every member once, with a stable cursor', () => {
  const sources = makeDataset();
  const swept = [];
  let cursor = 0;
  for (let guard = 0; guard < 200; guard++) {
    const page = queryShell(
      normalizeShellQueryParams({ radius: 100, thickness: 20, include: 'located,uncertain', limit: 7, cursor }),
      { sources },
    );
    assert.ok(page.records.length <= 7);
    swept.push(...page.records.map((record) => record.id));
    if (page.page.complete) {
      assert.equal(page.page.next, null);
      break;
    }
    assert.equal(page.page.next, cursor + 7);
    cursor = page.page.next;
  }
  assert.equal(new Set(swept).size, swept.length, 'no duplicate ids across pages');
  assert.deepEqual(memberIds({ records: swept.map((id) => ({ id })) }), referenceMembers(sources, normalizeShellQueryParams({ radius: 100, thickness: 20, include: 'located,uncertain' })));
});

test('a failing source is isolated and does not hide the others', () => {
  const good = sourceOf('good', [pointRow('g1', 100), pointRow('g2', 105)]);
  const bad = sourceOf('bad', [], { fail: true });
  const result = queryShell(
    normalizeShellQueryParams({ radius: 100, thickness: 20, limit: MAX_SHELL_PAGE_LIMIT }),
    { sources: [good, bad] },
  );
  assert.deepEqual(memberIds(result), ['g1', 'g2']);
  assert.equal(result.coverage.find((c) => c.source === 'bad').status, 'error');
  assert.equal(result.coverage.find((c) => c.source === 'good').status, 'ok');
});

test('the query unit is honoured end to end', () => {
  const sources = [sourceOf('a', [pointRow('in-band', 32.7), pointRow('out-band', 500)])];
  const plan = normalizeShellQueryParams({
    radius: 10, thickness: 1, unit: 'pc', include: 'located', limit: MAX_SHELL_PAGE_LIMIT,
  });
  const result = queryShell(plan, { sources });
  assert.deepEqual(memberIds(result), ['in-band']);
  assert.ok(Math.abs(result.bounds.rMin - 9.5 * 3.261563777) < 1e-6);
  assert.equal(result.bounds.unit, 'ly');
});

test('coverage and counts report what was actually searched', () => {
  const sources = makeDataset();
  const result = queryShell(
    normalizeShellQueryParams({ radius: 100, thickness: 20, include: 'located,uncertain,unknown', limit: MAX_SHELL_PAGE_LIMIT }),
    { sources },
  );
  assert.equal(result.counts.sources, 1);
  assert.equal(result.counts.rows, 304);
  assert.equal(result.counts.located, 22); // 20 in-band points + i1 + q1
  assert.equal(result.counts.uncertain, 1); // i2
  assert.equal(result.counts.unknown, 1); // u1
  assert.equal(result.counts.members, result.records.length);
  assert.equal(result.counts.pending, 0);
  assert.equal(result.page.complete, true);
  assert.equal(result.coverage[0].source, 'a');
  assert.equal(result.coverage[0].status, 'ok');
  assert.equal(result.coverage[0].candidates, result.counts.candidates);
});

test('a distance-bearing catalogue populates located, uncertain, outside and unknown', () => {
  // The real production code path, exercised through the actual star adapter: a
  // parallax converts to a distance, and a parallax *with its error* converts to
  // an interval that can straddle the band. The bundled CC0 fixture carries no
  // parallax at all, so this synthetic catalogue stands in for a real
  // distance-bearing source until its redistribution terms are settled.
  const catalog = {
    frame: 'ICRS',
    source: { catalog: 'acceptance-test' },
    stars: [
      // ~100 ly within ±0.03 ly -> wholly inside [90, 110] -> located.
      { id: 'located', ra: 10, dec: 0, parallaxMas: 32.6156, parallaxErrorMas: 0.01 },
      // ±4 mas straddles the inner edge -> interval overlaps -> uncertain.
      { id: 'uncertain', ra: 20, dec: 0, parallaxMas: 32.6156, parallaxErrorMas: 4 },
      // Far outside the band -> outside, never a visible layer.
      { id: 'outside', ra: 30, dec: 0, distanceLy: 500 },
      // No distance at all -> unknown (direction only).
      { id: 'unknown', ra: 40, dec: 0 },
    ],
  };
  const { rows, skipped } = starRows(catalog);
  assert.equal(skipped.length, 0);
  const sources = [sourceOf('stars', rows)];
  const plan = normalizeShellQueryParams({
    radius: 100, thickness: 20, include: 'located,uncertain,unknown', limit: MAX_SHELL_PAGE_LIMIT,
  });
  const result = queryShell(plan, { sources });
  const byId = new Map(result.records.map((record) => [record.id, record]));

  assert.equal(byId.get('located').status, DISTANCE_CLASS.LOCATED);
  assert.equal(byId.get('uncertain').status, DISTANCE_CLASS.UNCERTAIN);
  assert.equal(byId.get('unknown').status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(byId.has('outside'), false, 'outside is excluded from every layer');
  assert.equal(result.counts.outside, 1);
  // The uncertain record keeps its interval; no midpoint is invented.
  assert.ok(byId.get('uncertain').classification.interval.high > result.bounds.rMax);
  assert.equal(byId.get('uncertain').classification.distance, undefined);
  assert.deepEqual(memberIds(result), referenceMembers(sources, normalizeShellQueryParams({
    radius: 100, thickness: 20, include: 'located,uncertain,unknown',
  })));
});

test('a large synthetic catalogue is pruned conservatively and matches brute force', () => {
  const N = 20000;
  const rows = [];
  for (let i = 0; i < N; i++) {
    // Deterministic distances 0..2000 ly, with every tenth row distance-less.
    const distance = i % 10 === 0 ? null : (i / N) * 2000;
    rows.push({
      id: `s${String(i).padStart(6, '0')}`,
      name: `s${i}`,
      ra: (i * 7) % 360,
      dec: ((i * 13) % 180) - 90,
      frame: 'icrs',
      type: 'X',
      evidence: distance === null
        ? { kind: 'missing', reason: 'no-distance' }
        : { kind: 'point', value: distance, unit: 'ly' },
      provenance: { source: 'test', sourceId: `s${i}` },
      qualityNotes: [],
    });
  }
  const sources = [sourceOf('big', rows)];
  const plan = normalizeShellQueryParams({
    radius: 100, thickness: 20, include: 'located,uncertain,unknown', limit: MAX_SHELL_PAGE_LIMIT,
  });
  const started = Date.now();
  const result = queryShell(plan, { sources });
  const elapsed = Date.now() - started;
  assert.deepEqual(memberIds(result), referenceMembers(sources, plan));
  assert.equal(result.counts.unknown, N / 10);
  assert.ok(result.counts.candidates < N / 4, `pruned to ${result.counts.candidates} of ${N}`);
  // A smoke bound only; the point of this test is correctness at scale.
  assert.ok(elapsed < 15000, `query took ${elapsed}ms`);
});
