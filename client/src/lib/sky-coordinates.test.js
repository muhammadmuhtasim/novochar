// Unit tests for the sky-view coordinate mapping.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { raDecToSkyDirection } from './sky-coordinates.js';

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

test('RA 0h Dec 0° maps to [0, 0, -1]', () => {
  const v = raDecToSkyDirection(0, 0);
  assert.ok(Math.abs(v[0]) < 1e-12, 'x near zero');
  assert.ok(Math.abs(v[1]) < 1e-12, 'y near zero');
  assert.ok(Math.abs(v[2] + 1) < 1e-12, 'z -1');
});

test('positive declination moves toward +Y', () => {
  const v = raDecToSkyDirection(0, 45);
  assert.ok(v[1] > 0.7, 'Y up');
});

test('positive RA moves toward +X (right-handed)', () => {
  const v = raDecToSkyDirection(90, 0);
  assert.ok(v[0] > 0.9999, 'X forward-right');
  assert.ok(Math.abs(v[2]) < 1e-12, 'Z near zero');
});

test('direction remains unit length and RA wraps at 360 degrees', () => {
  const a = raDecToSkyDirection(360, 30);
  const b = raDecToSkyDirection(0, 30);
  assert.ok(Math.abs(length(a) - 1) < 1e-12);
  assert.ok(Math.abs(length(b) - 1) < 1e-12);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-12);
  assert.ok(Math.abs(a[1] - b[1]) < 1e-12);
  assert.ok(Math.abs(a[2] - b[2]) < 1e-12);
});

test('invalid declination and non-finite input are rejected', () => {
  assert.throws(() => raDecToSkyDirection(0, 95));
  assert.throws(() => raDecToSkyDirection(0, -95));
  assert.throws(() => raDecToSkyDirection(NaN, 0));
  assert.throws(() => raDecToSkyDirection(0, Infinity));
});
