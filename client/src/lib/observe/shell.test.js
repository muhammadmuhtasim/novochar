import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DISTANCE_CLASS, SHELL_LAYERS } from '@novochar/astro';
import {
  DEFAULT_SHELL_VIEW,
  LAYER_META,
  LAYER_ORDER,
  distanceNote,
  formatDistance,
  isStaleCursorError,
  isSuperseded,
  mergeShellResults,
  radialRange,
  shellQueryParams,
  shellRecordToRow,
  shellResultToRows,
  shellSceneMeta,
  visibleLayers,
} from './shell.js';

const record = (overrides = {}) => ({
  id: 'NC-0001',
  name: 'NC-0001',
  ra: 10,
  dec: -5,
  frame: 'icrs',
  type: 'HPM',
  mag: 15.2,
  spectralType: null,
  status: DISTANCE_CLASS.LOCATED,
  classification: { status: DISTANCE_CLASS.LOCATED, reason: 'inside-shell', distance: 100.5 },
  provenance: { source: 'survey', catalog: 'SPHEREx survey (simulated)' },
  qualityNotes: ['heliocentric-distance', 'simulated'],
  ...overrides,
});

test('the default view shows every layer and is frozen', () => {
  assert.deepEqual(LAYER_ORDER, [SHELL_LAYERS.LOCATED, SHELL_LAYERS.UNCERTAIN, SHELL_LAYERS.UNKNOWN]);
  assert.equal(DEFAULT_SHELL_VIEW.layers[SHELL_LAYERS.UNKNOWN], true);
  assert.ok(Object.isFrozen(DEFAULT_SHELL_VIEW));
  for (const id of LAYER_ORDER) {
    assert.ok(LAYER_META[id].label && LAYER_META[id].note, `${id} has metadata`);
  }
});

test('visibleLayers reflects the toggles without inventing a layer', () => {
  const view = { layers: { located: true, uncertain: false, unknown: true } };
  assert.deepEqual(visibleLayers(view), [SHELL_LAYERS.LOCATED, SHELL_LAYERS.UNKNOWN]);
  assert.deepEqual(visibleLayers({ layers: {} }), []);
});

test('shellQueryParams requests only the visible layers', () => {
  const params = shellQueryParams({
    radius: 42,
    thickness: 7,
    unit: 'pc',
    layers: { located: true, uncertain: false, unknown: false },
  });
  assert.equal(params.radius, 42);
  assert.equal(params.thickness, 7);
  assert.equal(params.unit, 'pc');
  assert.equal(params.include, SHELL_LAYERS.LOCATED);
  assert.equal(params.limit, 1000);

  // With every layer hidden we still ask for something valid, never nothing.
  const fallback = shellQueryParams({ radius: 1, thickness: 0, unit: 'ly', layers: {} });
  assert.equal(fallback.include, SHELL_LAYERS.LOCATED);
});

test('a shell record maps to an ICRS row with its shell metadata in extras', () => {
  const row = shellRecordToRow(record());
  assert.equal(row.id, 'NC-0001');
  assert.equal(row.ra, 10);
  assert.equal(row.dec, -5);
  assert.equal(row.frame, 'icrs');
  assert.equal(row.mag, 15.2);
  assert.equal(row.extras.status, DISTANCE_CLASS.LOCATED);
  assert.equal(row.extras.distance, 100.5);
  assert.equal(row.extras.source, 'survey');
  assert.equal(row.extras.reason, 'inside-shell');
  assert.equal(row.extras.spectralType, null);
  assert.deepEqual(row.extras.qualityNotes, ['heliocentric-distance', 'simulated']);
  // The frame policy sees an ordinary ICRS row.
  assert.equal(shellResultToRows({ records: [record()] }).length, 1);
  assert.deepEqual(shellResultToRows({}), []);
  // Display-only fields survive the mapping.
  const star = shellRecordToRow(record({ id: 'star-sirius', mag: -1.46, spectralType: 'A1V' }));
  assert.equal(star.mag, -1.46);
  assert.equal(star.extras.spectralType, 'A1V');
});

test('radial range keeps a point as a zero-width span and an interval as itself', () => {
  assert.deepEqual(radialRange({ distance: 12 }), { low: 12, high: 12 });
  // An interval is passed through; it is never collapsed to a midpoint.
  assert.deepEqual(radialRange({ interval: { low: 90, high: 110 } }), { low: 90, high: 110 });
  assert.deepEqual(radialRange({ interval: { low: 90, high: Infinity } }), { low: 90, high: Infinity });
  assert.equal(radialRange({}), null);
  assert.equal(radialRange(null), null);
});

test('an interval record never exposes a scalar distance', () => {
  const row = shellRecordToRow(
    record({
      status: DISTANCE_CLASS.UNCERTAIN,
      classification: {
        status: DISTANCE_CLASS.UNCERTAIN,
        reason: 'interval-overlaps-shell',
        interval: { low: 80, high: 130 },
      },
    }),
  );
  assert.equal(row.extras.distance, null);
  assert.deepEqual(row.extras.interval, { low: 80, high: 130 });
  assert.deepEqual(row.extras.radialRange, { low: 80, high: 130 });
});

test('unknown records keep no invented distance', () => {
  const row = shellRecordToRow(
    record({
      status: DISTANCE_CLASS.UNKNOWN,
      classification: { status: DISTANCE_CLASS.UNKNOWN, reason: 'no-distance' },
      provenance: { source: 'stars', catalog: 'fixture' },
      qualityNotes: ['directional-only'],
    }),
  );
  assert.equal(row.extras.status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(row.extras.distance, null);
  assert.equal(row.extras.source, 'stars');
});

test('shellSceneMeta carries bounds, counts and coverage for the UI', () => {
  const meta = shellSceneMeta({ bounds: { rMin: 90, rMax: 110, unit: 'ly' }, counts: { members: 5 }, coverage: [{ source: 'survey' }] });
  assert.equal(meta.source, 'shell');
  assert.deepEqual(meta.bounds, { rMin: 90, rMax: 110, unit: 'ly' });
  assert.equal(meta.counts.members, 5);
  assert.equal(shellSceneMeta(null).bounds, null);
});

test('formatDistance renders a value or an interval, and nothing for unknown', () => {
  assert.equal(formatDistance({ distance: 12.345 }), '12.35 ly');
  assert.equal(formatDistance({ interval: { low: 90, high: 110 } }), '90.00–110.00 ly');
  assert.equal(formatDistance({ interval: { low: 120, high: Infinity } }), '≥ 120.00 ly');
  // Converting, not relabelling: 3.261563777 ly is exactly one parsec.
  assert.equal(formatDistance({ distance: 3.261563777 }, 'pc'), '1.00 pc');
  assert.equal(formatDistance({}), null);
  assert.equal(formatDistance(null), null);
});

test('an interval is shown as a range even when a scalar distance is also present', () => {
  // Regression: the display must never collapse an interval to its midpoint.
  assert.equal(
    formatDistance({ distance: 100, interval: { low: 80, high: 130 } }),
    '80.00–130.00 ly',
  );
});

test('pagination never double-counts an id, and superseded responses are dropped', () => {
  const page = (records, counts, next) => ({
    records,
    counts,
    page: { limit: 2, offset: 0, next, complete: next === null },
  });
  const first = page([{ id: 'a' }, { id: 'b' }], { members: 3, returned: 2, pending: 1 }, 2);
  const second = page([{ id: 'b' }, { id: 'c' }], { members: 3, returned: 2, pending: 0 }, null);
  const merged = mergeShellResults(first, second);
  assert.deepEqual(merged.records.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(merged.counts.returned, 3, 'returned reflects what is on screen');
  assert.equal(merged.counts.members, 3);
  assert.equal(merged.counts.pending, 0);
  assert.equal(merged.page.complete, true);
  // A first page has nothing to merge with.
  assert.equal(mergeShellResults(null, first), first);

  // Sequence guard: a slow earlier response must not overwrite a newer one.
  assert.equal(isSuperseded(1, 2), true);
  assert.equal(isSuperseded(2, 2), false);
});

test('a rejected cursor is recognised so the UI can reset instead of failing', () => {
  // The server tags a stale/malformed cursor with a stable code.
  assert.equal(isStaleCursorError({ code: 'invalid-cursor' }), true);
  assert.equal(isStaleCursorError(Object.assign(new Error('API ...'), { code: 'invalid-cursor', reason: 'mismatch' })), true);
  // Ordinary failures are not reset triggers.
  assert.equal(isStaleCursorError(new Error('network down')), false);
  assert.equal(isStaleCursorError({ status: 500 }), false);
  assert.equal(isStaleCursorError(null), false);
  assert.equal(isStaleCursorError(undefined), false);
});

test('distanceNote explains how a distance was obtained, honestly', () => {
  assert.match(distanceNote({ status: 'unknown' }), /No usable distance/);
  assert.match(distanceNote({ status: 'uncertain', interval: { low: 80, high: 130 } }), /overlaps the band/);
  assert.match(distanceNote({ status: 'uncertain', interval: { low: 10, high: Infinity } }), /lower bound/);
  assert.match(distanceNote({ status: 'located', qualityNotes: ['simulated'] }), /Simulated/);
  assert.match(distanceNote({ status: 'located', qualityNotes: ['distance-without-uncertainty'] }), /without an uncertainty/);
  assert.equal(distanceNote({ status: 'located' }), null);
  assert.equal(distanceNote(null), '');
});
