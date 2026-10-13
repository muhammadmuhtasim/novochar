// Client unit tests for the shared spectrum-plot transform.
//
//   node --test src/lib/spectrum-plot.test.js   (from client/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { spectrumTransform, spectrumPoints, niceTicks } from './spectrum-plot.js';

const sed = (pts) => ({ spectrum: pts.map(([lambda, flux]) => ({ lambda, flux })) });

test('linear/log transforms produce finite, deterministic coordinates', () => {
  const s = sed([[0.5, 1], [1, 100], [5, 1]]);
  const tr = spectrumTransform([s], { xScale: 'log', w: 400, h: 300, pad: { l: 40, r: 10, t: 10, b: 30 } });
  assert.ok(Number.isFinite(tr.wMin) && Number.isFinite(tr.wMax));
  assert.ok(Number.isFinite(tr.fMin) && Number.isFinite(tr.fMax));
  const pts = spectrumPoints(s, tr);
  assert.equal(pts.length, 3);
  for (const [x, y] of pts) assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

test('non-positive flux in log mode maps to NaN (never -Infinity) and is skipped', () => {
  const s = sed([[0.5, 0], [1, -2], [2, 10]]);
  const tr = spectrumTransform([s], { xScale: 'linear' });
  assert.ok(Number.isNaN(tr.Y(0)), 'zero flux is not plottable on a logarithm');
  assert.ok(Number.isNaN(tr.Y(-2)), 'negative flux is not plottable on a logarithm');
  assert.ok(Number.isFinite(tr.Y(10)));
  assert.ok(Number.isFinite(tr.X(-1)), 'linear X remains a plain affine mapping');
  const pts = spectrumPoints(s, tr);
  assert.equal(pts.length, 1, 'only the positive-flux point survives');
});

test('axis bounds stay finite for empty and all-non-positive data', () => {
  const trEmpty = spectrumTransform([sed([])]);
  for (const k of ['wMin', 'wMax', 'fMin', 'fMax']) assert.ok(Number.isFinite(trEmpty[k]), `${k}`);
  const bad = sed([[0.5, 0], [1, 0]]);
  const trBad = spectrumTransform([bad]);
  for (const k of ['wMin', 'wMax', 'fMin', 'fMax']) assert.ok(Number.isFinite(trBad[k]), `${k}`);
  assert.ok(Number.isFinite(trBad.X(0.75)) && Number.isFinite(trBad.Y(1)));
});

test('niceTicks returns sensible steps and a stable default', () => {
  const ticks = niceTicks(0, 10, 6);
  assert.ok(ticks.length >= 2);
  assert.ok(ticks.every(Number.isFinite));
  assert.deepEqual(niceTicks(3, 3), [3]);
});