import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SHELL_SELECTION,
  SHELL_LAYERS,
  insideBounds,
  insideShell,
  normalizeShellSelection,
  shellBounds,
  shellVolume,
  shellVolumeApprox,
} from './shell.js';

test('bounds are mid-radius ± half the FULL thickness', () => {
  assert.deepEqual(shellBounds(100, 20), { rMin: 90, rMax: 110 });
  assert.deepEqual(shellBounds(0, 0), { rMin: 0, rMax: 0 });
  assert.deepEqual(shellBounds(7.5, 1.5), { rMin: 6.75, rMax: 8.25 });
});

test('thickness greater than twice the radius clamps the inner radius at zero', () => {
  assert.deepEqual(shellBounds(10, 100), { rMin: 0, rMax: 60 });
  assert.deepEqual(shellBounds(10, 20), { rMin: 0, rMax: 20 }); // exactly twice
});

test('membership includes both boundaries and excludes just outside', () => {
  const { rMin, rMax } = shellBounds(100, 20); // 90 .. 110
  assert.equal(insideShell(rMin, 100, 20), true);
  assert.equal(insideShell(rMax, 100, 20), true);
  assert.equal(insideShell(100, 100, 20), true);
  assert.equal(insideShell(rMin - 1e-6, 100, 20), false);
  assert.equal(insideShell(rMax + 1e-6, 100, 20), false);
  assert.equal(insideBounds(95, { rMin, rMax }), true);
  assert.equal(insideBounds(0, { rMin, rMax }), false);
});

test('non-finite or negative distances are never members', () => {
  for (const d of [NaN, Infinity, -Infinity, -1]) {
    assert.equal(insideShell(d, 100, 20), false, `${d} should not be a member`);
  }
});

test('invalid radius or thickness throws instead of coercing', () => {
  for (const bad of [-1, NaN, Infinity, '5', null, undefined]) {
    assert.throws(() => shellBounds(bad, 10), Error, `radius ${String(bad)}`);
    assert.throws(() => shellBounds(10, bad), Error, `thickness ${String(bad)}`);
  }
});

test('a zero-radius shell is a valid degenerate edge case', () => {
  assert.equal(insideShell(0, 0, 0), true);
  assert.equal(insideShell(1e-9, 0, 0), false);
  assert.equal(shellVolume(0, 0), 0);
});

test('exact volume matches the closed form and the thin-shell approximation', () => {
  const exact = (4 * Math.PI / 3) * (110 ** 3 - 90 ** 3);
  assert.ok(Math.abs(shellVolume(100, 20) - exact) < 1e-6);
  const v = shellVolume(100, 1);
  const approx = shellVolumeApprox(100, 1);
  assert.ok(Math.abs(v - approx) / v < 0.01, 'thin shell should be near 4πR²T');
});

test('selection normalization fills defaults and validates', () => {
  assert.deepEqual(normalizeShellSelection(), DEFAULT_SHELL_SELECTION);

  const s = normalizeShellSelection({ radius: 50, thickness: 10, unit: 'pc' });
  assert.equal(s.radius, 50);
  assert.equal(s.thickness, 10);
  assert.equal(s.unit, 'pc');
  assert.deepEqual(s.layers, { located: true, uncertain: true, unknown: false });

  assert.throws(() => normalizeShellSelection({ radius: -1 }), RangeError);
  assert.throws(() => normalizeShellSelection({ thickness: -1 }), RangeError);
  assert.throws(() => normalizeShellSelection({ unit: 'furlong' }), RangeError);
  assert.throws(() => normalizeShellSelection({ radius: NaN }), TypeError);
});

test('layer normalization keeps explicit false and coerces the rest', () => {
  const s = normalizeShellSelection({ layers: { located: false, unknown: 'yes' } });
  assert.equal(s.layers[SHELL_LAYERS.LOCATED], false);
  assert.equal(s.layers[SHELL_LAYERS.UNCERTAIN], true);
  assert.equal(s.layers[SHELL_LAYERS.UNKNOWN], true);
});
