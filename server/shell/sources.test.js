import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHELL_SOURCES,
  findShellSource,
  isCanonicalFrame,
  parallaxMasToLightYears,
  shellSourceIds,
  starRows,
  surveyRows,
} from './sources.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('parallax converts to a distance, and a non-measurement does not', () => {
  assert.ok(close(parallaxMasToLightYears(1000), 3.261563777, 1e-6)); // 1 pc
  assert.ok(close(parallaxMasToLightYears(100), 32.61563777, 1e-6)); // 10 pc
  for (const bad of [0, -1, NaN, Infinity, '100', null, undefined]) {
    assert.equal(parallaxMasToLightYears(bad), null);
  }
});

test('the frame policy is applied to a whole non-ICRS catalogue', () => {
  const catalog = {
    frame: 'FK5',
    source: { catalog: 'V/50' },
    stars: [{ id: 'BSC-HR0001', name: 'x', ra: 10, dec: 20, parallaxMas: 10 }],
  };
  const { rows, skipped, frame } = starRows(catalog);
  assert.equal(rows.length, 0);
  assert.equal(frame, 'FK5');
  assert.deepEqual(skipped, [{ id: 'BSC-HR0001', reason: 'unsupported-frame:FK5' }]);
  assert.equal(isCanonicalFrame('icrs'), true);
  assert.equal(isCanonicalFrame('ICRS'), true);
  assert.equal(isCanonicalFrame('fk5'), false);
});

test('star distances become point evidence or an honest missing value', () => {
  const catalog = {
    frame: 'ICRS',
    source: { catalog: 'fixture' },
    stars: [
      { id: 'a', name: 'A', type: 'STAR', ra: 1, dec: 2, distanceLy: 42 },
      { id: 'b', name: 'B', type: 'STAR', ra: 3, dec: 4, parallaxMas: 100 },
      { id: 'c', name: 'C', ra: 5, dec: 6 },
      { id: 'bad', name: 'bad', ra: 'nope', dec: 1 },
    ],
  };
  const { rows, skipped } = starRows(catalog);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].evidence, { kind: 'point', value: 42, unit: 'ly' });
  assert.ok(rows[0].qualityNotes.includes('distance-without-uncertainty'));
  assert.deepEqual(rows[1].evidence.kind, 'point');
  assert.equal(rows[1].evidence.unit, 'ly');
  assert.ok(close(rows[1].evidence.value, 32.61563777, 1e-6));
  assert.ok(rows[1].qualityNotes.includes('distance-from-parallax'));
  assert.deepEqual(rows[2].evidence, { kind: 'missing', reason: 'no-distance' });
  assert.deepEqual(rows[2].qualityNotes, ['directional-only']);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'invalid-position');
});

test('a distance without a parallax is preferred and flagged, never error-inflated', () => {
  const catalog = {
    frame: 'ICRS',
    stars: [
      { id: 'a', ra: 1, dec: 2, distanceLy: 10, parallaxMas: 100 }, // 10 ly vs derived 32.6
    ],
  };
  const { rows } = starRows(catalog);
  assert.deepEqual(rows[0].evidence, { kind: 'point', value: 10, unit: 'ly' });
  // The adopted distance is used as given; no symmetric error is invented.
  assert.deepEqual(rows[0].qualityNotes, ['distance-without-uncertainty']);
});

test('survey objects carry heliocentric point evidence and are marked simulated', () => {
  const objects = [
    { id: 'NC-0001', name: 'A', type: 'TNO', ra: 10, dec: 5, distanceLy: 0.01 },
    { id: 'NC-0002', name: 'B', type: 'HPM', ra: 20, dec: -5, distanceLy: 50 },
    { id: 'NC-0003', name: 'C', type: 'AST', ra: 30, dec: 0, distanceLy: null },
    { id: '', name: 'bad', ra: 1, dec: 1, distanceLy: 1 },
  ];
  const { rows, skipped } = surveyRows(objects);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].evidence, { kind: 'point', value: 0.01, unit: 'ly' });
  assert.ok(rows[0].qualityNotes.includes('heliocentric-distance'));
  assert.ok(rows[0].qualityNotes.includes('simulated'));
  assert.deepEqual(rows[2].evidence, { kind: 'missing', reason: 'no-distance' });
  assert.equal(skipped.length, 1);
});

test('the registry declares capabilities and stable ids', () => {
  const ids = SHELL_SOURCES.map((s) => s.id);
  assert.deepEqual(ids, ['survey', 'stars']);
  for (const source of SHELL_SOURCES) {
    assert.equal(typeof source.load, 'function');
    assert.ok(source.capabilities && typeof source.capabilities.distance === 'string');
    assert.equal(typeof source.capabilities.uncertainty, 'boolean');
  }
});
