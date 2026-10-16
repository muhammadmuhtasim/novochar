import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DISTANCE_CLASS, SHELL_LAYERS } from '@novochar/astro';
import {
  DEFAULT_SHELL_VIEW,
  LAYER_META,
  LAYER_ORDER,
  distanceNote,
  formatDistance,
  representativeDistance,
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

test('representative distance uses the value, then the interval midpoint, then null', () => {
  assert.equal(representativeDistance({ distance: 12 }), 12);
  assert.equal(representativeDistance({ interval: { low: 90, high: 110 } }), 100);
  assert.equal(representativeDistance({ interval: { low: 90, high: Infinity } }), null);
  assert.equal(representativeDistance({}), null);
  assert.equal(representativeDistance(null), null);
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
  // Converting, not relabelling: 3.261563777 ly is exactly one parsec.
  assert.equal(formatDistance({ distance: 3.261563777 }, 'pc'), '1.00 pc');
  assert.equal(formatDistance({}), null);
  assert.equal(formatDistance(null), null);
});

test('distanceNote explains how a distance was obtained, honestly', () => {
  assert.match(distanceNote({ status: 'unknown' }), /No usable distance/);
  assert.match(distanceNote({ status: 'located', qualityNotes: ['simulated'] }), /Simulated/);
  assert.match(distanceNote({ status: 'located', qualityNotes: ['distance-without-uncertainty'] }), /without an uncertainty/);
  assert.equal(distanceNote({ status: 'located' }), null);
  assert.equal(distanceNote(null), '');
});
