// Contract tests for the inside-out sky sphere geometry.
//
// The all-sky base is a Mollweide ellipse. These tests pin the mapping between
// sphere directions and texture UVs so a rectangular-texture assumption cannot
// quietly return: every vertex must be a real sky direction, every UV must be
// inside the ellipse, and the ±180° seam must sample both map edges.

import test from 'node:test';
import assert from 'node:assert/strict';
import { skyRenderDirection } from './sky3d-orientation.js';
import {
  buildSkySphereGrid,
  isInsideMollweideUv,
  mollweideUv,
} from './sky3d-geometry.js';

const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

function vertexAt(grid, lonSegments, index) {
  return {
    position: grid.positions.slice(index * 3, index * 3 + 3),
    uv: grid.uvs.slice(index * 2, index * 2 + 2),
  };
}

test('the Mollweide sphere uses real sky directions and ellipse-constrained UVs', () => {
  const lonSegments = 8;
  const latSegments = 4;
  const radius = 2;
  const grid = buildSkySphereGrid({ radius, lonSegments, latSegments, projection: 'mollweide' });

  assert.equal(grid.positions.length, (lonSegments + 1) * (latSegments + 1) * 3);
  assert.equal(grid.uvs.length, (lonSegments + 1) * (latSegments + 1) * 2);
  assert.equal(grid.indices.length, lonSegments * latSegments * 6);

  for (let index = 0; index < grid.positions.length / 3; index++) {
    const { position, uv } = vertexAt(grid, lonSegments, index);
    assert.ok(close(Math.hypot(...position), radius), `vertex ${index} must sit on the sphere`);
    assert.ok(close(uv[1], uv[1]), 'uv must be finite');
    assert.ok(isInsideMollweideUv(uv[0], uv[1]), `vertex ${index} UV ${uv} must lie in the ellipse`);
  }

  // Equator, central meridian (longitude 0): the middle of the map.
  const equator = latSegments / 2;
  const centre = vertexAt(grid, lonSegments, equator * (lonSegments + 1) + lonSegments / 2);
  assert.ok(close(centre.uv[0], 0.5));
  assert.ok(close(centre.uv[1], 0.5));
  const expectedCentre = skyRenderDirection(0, 0).map((value) => value * radius);
  centre.position.forEach((value, axis) => assert.ok(close(value, expectedCentre[axis])));
});

test('the Mollweide seam samples both edges of the ellipse', () => {
  const lonSegments = 8;
  const latSegments = 4;
  const grid = buildSkySphereGrid({ radius: 1, lonSegments, latSegments, projection: 'mollweide' });

  for (let j = 0; j <= latSegments; j++) {
    const row = j * (lonSegments + 1);
    const left = vertexAt(grid, lonSegments, row);
    const right = vertexAt(grid, lonSegments, row + lonSegments);
    // Both columns are the same physical meridian.
    left.position.forEach((value, axis) => assert.ok(close(value, right.position[axis]), `row ${j} must close`));
    assert.ok(close(left.uv[1], right.uv[1]), `row ${j} must share v`);
    // −180° is the left edge, +180° is the mirrored right edge. At the poles
    // both collapse to the centre of the top/bottom, so mirroring is a no-op.
    assert.ok(close(right.uv[0], 1 - left.uv[0]), `row ${j} right edge must mirror the left`);
  }

  // At the equator the left/right edges are the extreme map columns.
  const equator = latSegments / 2;
  const row = equator * (lonSegments + 1);
  assert.ok(close(vertexAt(grid, lonSegments, row).uv[0], 0));
  assert.ok(close(vertexAt(grid, lonSegments, row + lonSegments).uv[0], 1));
});

test('the equirectangular sphere keeps the historical rectangular UV contract', () => {
  const grid = buildSkySphereGrid({
    radius: 1,
    lonSegments: 4,
    latSegments: 2,
    projection: 'equirectangular',
  });
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 4; i++) {
      const { uv } = vertexAt(grid, 4, j * 5 + i);
      assert.deepEqual(uv, [i / 4, j / 2]);
    }
  }
});

test('mollweideUv matches the shared forward projection', () => {
  const uv = mollweideUv(0, 0);
  assert.ok(close(uv.u, 0.5) && close(uv.v, 0.5));
  const seam = mollweideUv(180, 0);
  assert.ok(close(seam.u, 0), 'the +180° seam normalises to the left edge');
  assert.ok(close(seam.v, 0.5));
  const north = mollweideUv(123, 90);
  assert.ok(close(north.u, 0.5) && close(north.v, 1));
  assert.equal(mollweideUv(0, 91), null);
});

test('unknown projections are rejected rather than silently drawn as rectangles', () => {
  assert.throws(
    () => buildSkySphereGrid({ projection: 'aitoff' }),
    /unknown sky projection/,
  );
});
