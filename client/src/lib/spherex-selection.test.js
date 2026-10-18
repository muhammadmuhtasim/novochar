import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pixelValidity,
  pixelValue,
  selectionFromScreen,
  selectionInBounds,
  selectionMatchesGrid,
  selectionToSky,
  validityReason,
} from './spherex-selection.js';

const wcs = {
  crval: [270.0, 66.5],
  crpix: [147.5, 147.5],
  cd: [[0.00170833, 0], [0, 0.00170833]],
};

test('selectionFromScreen maps a screen click to grid coordinates', () => {
  const rect = { left: 0, top: 0, width: 294, height: 294 };
  // Click at the centre of the screen → centre of the grid.
  const sel = selectionFromScreen(147, 147, rect, 294, 294);
  assert.deepEqual(sel, { x: 147, y: 147 });
});

test('selectionFromScreen returns null outside the grid', () => {
  const rect = { left: 0, top: 0, width: 294, height: 294 };
  assert.equal(selectionFromScreen(-1, 100, rect, 294, 294), null);
  assert.equal(selectionFromScreen(100, 295, rect, 294, 294), null);
  assert.equal(selectionFromScreen(294, 100, rect, 294, 294), null);
});

test('selectionFromScreen handles a scaled canvas', () => {
  // Canvas displayed at 2× CSS size.
  const rect = { left: 10, top: 20, width: 588, height: 588 };
  const sel = selectionFromScreen(10 + 294, 20 + 294, rect, 294, 294);
  assert.deepEqual(sel, { x: 147, y: 147 });
});

test('selectionToSky derives ICRS coordinates from the grid selection', () => {
  const sky = selectionToSky(wcs, { x: 147, y: 147 });
  assert.ok(sky);
  assert.ok(Number.isFinite(sky.ra));
  assert.ok(Number.isFinite(sky.dec));
});

test('selectionToSky returns null for missing inputs', () => {
  assert.equal(selectionToSky(null, { x: 0, y: 0 }), null);
  assert.equal(selectionToSky(wcs, null), null);
});

test('pixelValidity reports valid pixels', () => {
  const mask = new Uint8Array([1, 0, 1, 0]);
  const image = new Float32Array([5, 0, 3, 0]);
  assert.deepEqual(pixelValidity(mask, image, 0, 0, 2, 2), { valid: true, reason: null });
  assert.deepEqual(pixelValidity(mask, image, 1, 0, 2, 2), { valid: false, reason: 'quality-masked (MASK = 0)' });
});

test('pixelValidity reports out-of-grid coordinates', () => {
  const mask = new Uint8Array([1]);
  const image = new Float32Array([5]);
  assert.deepEqual(pixelValidity(mask, image, 5, 0, 1, 1), { valid: false, reason: 'outside grid' });
});

test('pixelValidity reports non-finite values', () => {
  const mask = new Uint8Array([1]);
  const image = new Float32Array([Infinity]);
  assert.deepEqual(pixelValidity(mask, image, 0, 0, 1, 1), { valid: false, reason: 'not finite' });
});

test('pixelValue reads the IMAGE plane verbatim', () => {
  const image = new Float32Array([1.5, 2.5, 3.5, 4.5]);
  assert.equal(pixelValue(image, 0, 0, 2), 1.5);
  assert.equal(pixelValue(image, 1, 1, 2), 4.5);
  assert.equal(pixelValue(image, 5, 0, 2), null);
});

test('selectionInBounds checks grid bounds', () => {
  assert.equal(selectionInBounds({ x: 0, y: 0 }, 2, 2), true);
  assert.equal(selectionInBounds({ x: 2, y: 0 }, 2, 2), false);
  assert.equal(selectionInBounds(null, 2, 2), false);
});

test('selectionMatchesGrid checks the selection against the declared grid', () => {
  assert.equal(selectionMatchesGrid({ x: 100, y: 100 }, [294, 294]), true);
  assert.equal(selectionMatchesGrid({ x: 300, y: 100 }, [294, 294]), false);
  assert.equal(selectionMatchesGrid(null, [294, 294]), false);
});

test('validityReason returns a human-readable string', () => {
  const mask = new Uint8Array([1, 0]);
  const image = new Float32Array([5, 0]);
  assert.equal(validityReason(mask, image, 0, 0, 2, 1), 'valid');
  assert.equal(validityReason(mask, image, 1, 0, 2, 1), 'quality-masked (MASK = 0)');
});