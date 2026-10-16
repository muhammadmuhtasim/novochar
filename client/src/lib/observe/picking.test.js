// Unit tests for plane-space picking.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildCatalog } from './catalog.js';
import { mollweide } from './projections/mollweide.js';
import { buildPlaneIndex, pickInBox, pickNearest, projectAll } from './picking.js';

/** Minimal plane point with a record, the shape projectAll emits. */
const mk = (x, y, id, mag = null) => ({
  x,
  y,
  id,
  record: { id, name: id, ra: 0, dec: 0, mag, pmRa: null, pmDec: null, pmUnits: 'mas/yr', frame: 'icrs', extras: {} },
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Brute-force nearest distance within an inclusive radius. */
function bruteNearestDistance(points, x, y, radius) {
  let min = Infinity;
  for (const p of points) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 <= radius * radius && d2 < min) min = d2;
  }
  return min === Infinity ? null : Math.sqrt(min);
}

test('projectAll projects canonical records and keeps ids', () => {
  const catalog = buildCatalog([
    { id: 'a', ra: 0, dec: 0, frame: 'icrs' },
    { id: 'b', ra: 90, dec: 45, frame: 'icrs' },
  ]);
  const points = projectAll(catalog.records, mollweide);
  assert.equal(points.length, 2);
  const a = points.find((p) => p.id === 'a');
  assert.ok(Math.abs(a.x) < 1e-12 && Math.abs(a.y) < 1e-12, `origin ${a.x},${a.y}`);
  assert.equal(a.record.id, 'a');
});

test('projectAll drops off-map positions instead of emitting NaN', () => {
  const stub = { forward: (lonRad) => (lonRad > 0 ? { x: 1, y: 2 } : null) };
  const records = [
    { id: 'p', ra: 10, dec: 0, frame: 'icrs' },
    { id: 'n', ra: -10, dec: 0, frame: 'icrs' },
  ];
  assert.deepEqual(projectAll(records, stub).map((p) => p.id), ['p']);
  assert.throws(() => projectAll(records, {}), TypeError);
  assert.deepEqual(projectAll([], mollweide), []);
});

test('pickNearest finds the nearest within an inclusive radius', () => {
  const points = [mk(0, 0, 'a'), mk(3, 4, 'b')]; // b is 5 from the origin
  const index = buildPlaneIndex(points, { cellSize: 1 });

  assert.equal(pickNearest(index, 0, 0, { radius: 4.9 }).point.id, 'a');
  assert.equal(pickNearest(index, 3, 4, { radius: 0.0001 }).point.id, 'b');
  assert.ok(pickNearest(index, 2, 2, { radius: 0.1 }) === null, 'nothing that close');
  assert.equal(pickNearest(index, 100, 100, { radius: 1 }), null);

  // Invalid queries return null rather than throwing.
  assert.equal(pickNearest(index, NaN, 0, { radius: 1 }), null);
  assert.equal(pickNearest(index, 0, 0, { radius: -1 }), null);
  assert.equal(pickNearest(index, 0, 0, { radius: Infinity }), null);
  assert.equal(pickNearest(index, 0, 0, {}), null);
});

test('the pick radius boundary is inclusive', () => {
  const points = [mk(0, 0, 'a'), mk(5, 0, 'b')];
  const index = buildPlaneIndex(points, { cellSize: 2 });

  // A point exactly at distance 0 and exactly at the boundary are both included.
  assert.equal(pickNearest(index, 5, 0, { radius: 0 }).point.id, 'b');
  assert.equal(pickNearest(index, 10, 0, { radius: 5 }).point.id, 'b');
  // Just short of the boundary excludes it.
  assert.equal(pickNearest(index, 10, 0, { radius: 4.999 }), null);
});

test('pickNearest breaks ties by brightness then by ascending id', () => {
  // Equal distance, equal magnitude -> smaller id wins.
  const same = buildPlaneIndex([mk(1, 0, 'b', 8), mk(-1, 0, 'a', 8)], { cellSize: 1 });
  assert.equal(pickNearest(same, 0, 0, { radius: 2 }).point.id, 'a');

  // Equal distance -> brighter magnitude wins regardless of id order.
  const brighter = buildPlaneIndex([mk(1, 0, 'a', 9), mk(-1, 0, 'b', 3)], { cellSize: 1 });
  assert.equal(pickNearest(brighter, 0, 0, { radius: 2 }).point.id, 'b');

  // A missing magnitude sorts behind any real magnitude.
  const missing = buildPlaneIndex([mk(1, 0, 'a', null), mk(-1, 0, 'b', 12)], { cellSize: 1 });
  assert.equal(pickNearest(missing, 0, 0, { radius: 2 }).point.id, 'b');
});

test('pickInBox handles reversed bounds and is inclusive', () => {
  const index = buildPlaneIndex([mk(0, 0, 'a'), mk(1, 1, 'b'), mk(2, 2, 'c')], { cellSize: 1 });

  assert.deepEqual(pickInBox(index, { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }).map((p) => p.id), ['a', 'b']);
  // A reversed drag selects the same region.
  assert.deepEqual(pickInBox(index, { xMin: 1, xMax: -1, yMin: 1, yMax: -1 }).map((p) => p.id), ['a', 'b']);
  // Edges are inclusive.
  assert.deepEqual(pickInBox(index, { xMin: 1, xMax: 1, yMin: 1, yMax: 1 }).map((p) => p.id), ['b']);
  // Empty and invalid rectangles.
  assert.deepEqual(pickInBox(index, { xMin: 10, xMax: 11, yMin: 10, yMax: 11 }), []);
  assert.deepEqual(pickInBox(index, { xMin: NaN, xMax: 1, yMin: 0, yMax: 1 }), []);
});

test('buildPlaneIndex validates its cell size and handles empty input', () => {
  assert.deepEqual(buildPlaneIndex([]).points, []);
  assert.ok(buildPlaneIndex([]).cellSize > 0);
  assert.ok(buildPlaneIndex([mk(1, 2, 'a')]).cellSize > 0);
  assert.throws(() => buildPlaneIndex([], { cellSize: 0 }), RangeError);
  assert.throws(() => buildPlaneIndex([], { cellSize: -1 }), RangeError);
  assert.throws(() => buildPlaneIndex([], { cellSize: NaN }), RangeError);
  assert.equal(pickNearest(buildPlaneIndex([]), 0, 0, { radius: 1 }), null);
});

test('the index is complete for negative coordinates and exact-radius boundaries', () => {
  const points = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) points.push(mk(i, j, `g${i}_${j}`, (i + j) % 2 ? null : 3));
  }
  const queries = [[0, 0], [-2.5, 1.5], [2, -2], [-1.25, 0.75]];
  for (const cellSize of [0.5, 1, 2]) {
    const index = buildPlaneIndex(points, { cellSize });
    for (const target of points) {
      for (const [qx, qy] of queries) {
        // Snap the radius to the exact distance so the target sits on the
        // inclusive boundary every time.
        const radius = Math.hypot(target.x - qx, target.y - qy);
        const got = pickNearest(index, qx, qy, { radius });
        const ref = bruteNearestDistance(points, qx, qy, radius);
        assert.ok(ref !== null, 'expected a boundary hit');
        assert.ok(got, `missed boundary target ${target.id} at (${qx},${qy}) cell=${cellSize}`);
        assert.ok(Math.abs(got.distance - ref) < 1e-12, `boundary distance cell=${cellSize}`);
      }
    }
  }
});

test('the one-cell query expansion never admits out-of-range points', () => {
  const index = buildPlaneIndex([mk(0, 0, 'a'), mk(3, 0, 'b')], { cellSize: 1 });
  // b lies in an adjacent cell just outside the radius; the exact filter drops it.
  const near = pickNearest(index, 0, 0, { radius: 2.9 });
  assert.equal(near.point.id, 'a');
  assert.equal(near.distance, 0);
  assert.deepEqual(
    pickInBox(index, { xMin: -0.5, xMax: 0.5, yMin: -0.5, yMax: 0.5 }).map((p) => p.id),
    ['a'],
  );
});

test('the plane index never omits candidates (property, vs brute force)', () => {
  const rand = mulberry32(2024);
  const sizes = [0.1, 0.5, 2];
  for (let trial = 0; trial < 120; trial++) {
    const n = Math.floor(rand() * 40);
    const points = [];
    for (let i = 0; i < n; i++) {
      points.push(mk(rand() * 20 - 10, rand() * 20 - 10, `p${i}`, rand() < 0.5 ? rand() * 10 : null));
    }

    for (const cellSize of sizes) {
      const index = buildPlaneIndex(points, { cellSize });

      for (let q = 0; q < 8; q++) {
        const x = rand() * 40 - 20;
        const y = rand() * 40 - 20;
        const radius = rand() * 8;
        const got = pickNearest(index, x, y, { radius });
        const ref = bruteNearestDistance(points, x, y, radius);
        if (ref === null) {
          assert.equal(got, null, `expected miss trial ${trial} cell ${cellSize}`);
          continue;
        }
        assert.ok(got, `expected hit trial ${trial} cell ${cellSize}`);
        assert.ok(Math.abs(got.distance - ref) < 1e-9, `distance trial ${trial} cell ${cellSize}`);
        assert.ok(got.distance <= radius + 1e-12, 'within radius');
      }

      const x0 = rand() * 30 - 15;
      const x1 = rand() * 30 - 15;
      const y0 = rand() * 30 - 15;
      const y1 = rand() * 30 - 15;
      const gotBox = pickInBox(index, { xMin: x0, xMax: x1, yMin: y0, yMax: y1 }).map((p) => p.id).sort();
      const refBox = points
        .filter(
          (p) =>
            p.x >= Math.min(x0, x1) &&
            p.x <= Math.max(x0, x1) &&
            p.y >= Math.min(y0, y1) &&
            p.y <= Math.max(y0, y1),
        )
        .map((p) => p.id)
        .sort();
      assert.deepEqual(gotBox, refBox, `box trial ${trial} cell ${cellSize}`);
    }
  }
});
