import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectGraticuleLine, wrapPi } from './graticule.js';
import { getProjection } from './projections/index.js';

const mollweide = getProjection('mollweide');
const DEG = Math.PI / 180;
// Half the map width: a real sample step is a tiny fraction of this, while a
// seam chord spans most of the map, so the threshold separates the two cleanly.
const HALF_MAP_WIDTH = 0.5 * (mollweide.bounds.xMax - mollweide.bounds.xMin);

const projectAt = (centralMeridianRad = 0) => (lonRad, latRad) =>
  mollweide.forward(lonRad, latRad, { centralMeridianRad });

function parallel(latDeg, stepDeg = 3) {
  const sample = [];
  for (let lon = 0; lon <= 360; lon += stepDeg) sample.push([lon * DEG, latDeg * DEG]);
  return sample;
}

function meridian(lonDeg, stepDeg = 3) {
  const sample = [];
  for (let lat = -90; lat <= 90; lat += stepDeg) sample.push([lonDeg * DEG, lat * DEG]);
  return sample;
}

function assertNoChords(polylines) {
  for (const line of polylines) {
    for (let i = 1; i < line.length; i++) {
      const gap = Math.abs(line[i].x - line[i - 1].x);
      assert.ok(gap <= HALF_MAP_WIDTH, `polyline chords across the map (Δx = ${gap})`);
    }
  }
}

test('wrapPi wraps into the [-π, π) seam interval', () => {
  assert.ok(Math.abs(wrapPi(0)) < 1e-12);
  assert.ok(Math.abs(wrapPi(Math.PI) + Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapPi(3 * Math.PI) + Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapPi(-3 * Math.PI) + Math.PI) < 1e-12);
});

test('a parallel is split at the seam and never chords across the map', () => {
  const lines = projectGraticuleLine(parallel(30), projectAt());
  assert.ok(lines.length >= 2, `expected a seam split, got ${lines.length} polyline(s)`);
  assertNoChords(lines);
});

test('the equator highlight is also seam-split', () => {
  const lines = projectGraticuleLine(parallel(0), projectAt());
  assert.ok(lines.length >= 2);
  assertNoChords(lines);
});

test('a meridian is a single polyline that keeps every sample', () => {
  const sample = meridian(45);
  const lines = projectGraticuleLine(sample, projectAt());
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, sample.length);
});

test('a shifted central meridian moves the seam without chording', () => {
  const cm = 90 * DEG;
  const lines = projectGraticuleLine(
    parallel(-45),
    (lon, lat) => mollweide.forward(lon, lat, { centralMeridianRad: cm }),
    { centralMeridianRad: cm },
  );
  assert.ok(lines.length >= 2);
  assertNoChords(lines);
});

test('a dropped sample breaks the polyline instead of guessing', () => {
  const sample = [[0, 0], [0.1, 0], [0.2, 0], [0.3, 0]];
  let calls = 0;
  const lines = projectGraticuleLine(sample, () => {
    calls += 1;
    return calls === 3 ? null : { x: calls, y: 0 };
  });
  assert.equal(lines.length, 2);
});

test('the raw, unsplit sampling really does chord (regression guard)', () => {
  const points = parallel(30).map(([lon, lat]) => mollweide.forward(lon, lat, { centralMeridianRad: 0 }));
  let maxStep = 0;
  for (let i = 1; i < points.length; i++) maxStep = Math.max(maxStep, Math.abs(points[i].x - points[i - 1].x));
  assert.ok(maxStep > HALF_MAP_WIDTH, 'expected the unsplit parallel to cross the seam with a chord');
});
