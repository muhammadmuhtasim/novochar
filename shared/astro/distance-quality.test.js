import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MEMBERSHIP_POLICY,
  DISTANCE_CLASS,
  classifyDistanceEvidence,
  classifyDistanceMembership,
  isLayerClass,
} from './distance-quality.js';
import { shellBounds } from './shell.js';

const BOUNDS = shellBounds(100, 20); // 90 .. 110
const point = (value, unit = 'ly') => ({ kind: 'point', value, unit });
const interval = (low, high, unit = 'ly') => ({ kind: 'interval', low, high, unit });
const posterior = (cdf) => ({ kind: 'posterior', cdf });

// Cumulative distribution for a value distributed uniformly on [lo, hi].
const uniformCdf = (lo, hi) => (d) => Math.min(1, Math.max(0, (d - lo) / (hi - lo)));

test('a point distance inside the band is located, boundaries included', () => {
  for (const d of [90, 100, 110]) {
    const c = classifyDistanceEvidence(point(d), BOUNDS);
    assert.equal(c.status, DISTANCE_CLASS.LOCATED);
    assert.equal(c.distance, d);
  }
});

test('a precise distance outside the band is outside, not uncertain', () => {
  for (const d of [0, 89.999, 110.001, 5000]) {
    const c = classifyDistanceEvidence(point(d), BOUNDS);
    assert.equal(c.status, DISTANCE_CLASS.OUTSIDE);
  }
});

test('missing, invalid, and malformed evidence is unknown', () => {
  assert.equal(classifyDistanceEvidence(null, BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(classifyDistanceEvidence({ kind: 'missing' }, BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(classifyDistanceEvidence({ kind: 'invalid', reason: 'x' }, BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(classifyDistanceEvidence(point(-5), BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(classifyDistanceEvidence(point(10, 'furlong'), BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(classifyDistanceEvidence(point(NaN), BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(classifyDistanceEvidence({ kind: 'wat' }, BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
});

test('an interval wholly inside the band is located under the default policy', () => {
  const c = classifyDistanceEvidence(interval(95, 105), BOUNDS);
  assert.equal(c.status, DISTANCE_CLASS.LOCATED);
  assert.deepEqual(c.interval, { low: 95, high: 105 });

  const strict = classifyDistanceEvidence(interval(95, 105), BOUNDS, { locateFullInterval: false });
  assert.equal(strict.status, DISTANCE_CLASS.UNCERTAIN);
});

test('an interval that only partly overlaps the band is uncertain', () => {
  for (const [low, high] of [[80, 95], [105, 130], [80, 130]]) {
    const c = classifyDistanceEvidence(interval(low, high), BOUNDS);
    assert.equal(c.status, DISTANCE_CLASS.UNCERTAIN, `[${low}, ${high}]`);
  }
});

test('an interval that clears the band is outside, including an open upper bound', () => {
  assert.equal(classifyDistanceEvidence(interval(120, 140), BOUNDS).status, DISTANCE_CLASS.OUTSIDE);
  assert.equal(classifyDistanceEvidence(interval(0, 50), BOUNDS).status, DISTANCE_CLASS.OUTSIDE);
  // "at least 120 ly" can never reach a band that ends at 110.
  assert.equal(classifyDistanceEvidence(interval(120, Infinity), BOUNDS).status, DISTANCE_CLASS.OUTSIDE);
  // "at least 10 ly" always overlaps a band that starts at 90.
  assert.equal(classifyDistanceEvidence(interval(10, Infinity), BOUNDS).status, DISTANCE_CLASS.UNCERTAIN);
});

test('an inverted interval is rejected as unknown, not silently swapped', () => {
  assert.equal(classifyDistanceEvidence(interval(130, 80), BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
});

test('a posterior contained in the band is located; an overlapping one is uncertain', () => {
  const inside = classifyDistanceEvidence(posterior(uniformCdf(95, 105)), BOUNDS);
  assert.equal(inside.status, DISTANCE_CLASS.LOCATED);
  assert.equal(inside.probability, 1);

  const overlapping = classifyDistanceEvidence(posterior(uniformCdf(80, 130)), BOUNDS);
  assert.equal(overlapping.status, DISTANCE_CLASS.UNCERTAIN);
  assert.ok(overlapping.probability > 0 && overlapping.probability < 1);
});

test('a posterior that assigns no probability to the band is outside', () => {
  const c = classifyDistanceEvidence(posterior(uniformCdf(200, 300)), BOUNDS);
  assert.equal(c.status, DISTANCE_CLASS.OUTSIDE);
  assert.equal(c.probability, 0);
});

test('the probability threshold is explicit and configurable', () => {
  const p = uniformCdf(80, 130); // P(shell) = cdf(110) - cdf(90) = 0.4
  const low = classifyDistanceEvidence(posterior(p), BOUNDS, { probabilityThreshold: 0 });
  assert.equal(low.status, DISTANCE_CLASS.UNCERTAIN);
  const high = classifyDistanceEvidence(posterior(p), BOUNDS, { probabilityThreshold: 0.9 });
  assert.equal(high.status, DISTANCE_CLASS.OUTSIDE);
});

test('posterior evidence that is not a usable CDF is unknown', () => {
  assert.equal(classifyDistanceEvidence({ kind: 'posterior' }, BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(classifyDistanceEvidence(posterior(() => NaN), BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
  assert.equal(classifyDistanceEvidence(posterior(() => { throw new Error('boom'); }), BOUNDS).status, DISTANCE_CLASS.UNKNOWN);
});

test('classification is deterministic and computes bounds from radius/thickness', () => {
  assert.deepEqual(
    classifyDistanceMembership(point(100), 100, 20),
    classifyDistanceMembership(point(100), 100, 20),
  );
  assert.equal(classifyDistanceMembership(point(100), 100, 20).status, DISTANCE_CLASS.LOCATED);
  assert.equal(classifyDistanceMembership(point(100), 200, 20).status, DISTANCE_CLASS.OUTSIDE);
});

test('isLayerClass separates the three layers from the excluded class', () => {
  for (const s of [DISTANCE_CLASS.LOCATED, DISTANCE_CLASS.UNCERTAIN, DISTANCE_CLASS.UNKNOWN]) {
    assert.equal(isLayerClass(s), true);
  }
  assert.equal(isLayerClass(DISTANCE_CLASS.OUTSIDE), false);
  assert.equal(DEFAULT_MEMBERSHIP_POLICY.locateFullInterval, true);
});
