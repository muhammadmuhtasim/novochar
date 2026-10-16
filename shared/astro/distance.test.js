import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AU_PER_LIGHT_YEAR,
  AU_PER_PARSEC,
  CANONICAL_DISTANCE_UNIT,
  DISTANCE_UNITS,
  LIGHT_YEARS_PER_PARSEC,
  canonicalDistanceUnit,
  convertDistance,
  fromLightYears,
  isKnownDistanceUnit,
  toLightYears,
} from './distance.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('canonical unit is the light-year and known units are recognised', () => {
  assert.equal(CANONICAL_DISTANCE_UNIT, DISTANCE_UNITS.LY);
  for (const unit of ['ly', 'LY', 'light-year', 'light years', ' LightYear ']) {
    assert.ok(isKnownDistanceUnit(unit), `${unit} should be known`);
    assert.equal(canonicalDistanceUnit(unit), DISTANCE_UNITS.LY);
  }
  assert.equal(canonicalDistanceUnit('pc'), DISTANCE_UNITS.PC);
  assert.equal(canonicalDistanceUnit('parsecs'), DISTANCE_UNITS.PC);
  assert.equal(canonicalDistanceUnit('au'), DISTANCE_UNITS.AU);
});

test('unknown or missing units are rejected, never assumed', () => {
  for (const unit of ['furlong', '', null, undefined, 42, {}]) {
    assert.equal(isKnownDistanceUnit(unit), false, `${String(unit)} should be unknown`);
    assert.throws(() => canonicalDistanceUnit(unit), RangeError);
    assert.throws(() => toLightYears(1, unit), RangeError);
  }
});

test('a light-year passes through unchanged', () => {
  assert.equal(toLightYears(12.5, 'ly'), 12.5);
  assert.equal(fromLightYears(12.5, 'ly'), 12.5);
});

test('parsec and astronomical-unit conversions are exact and lossless', () => {
  assert.ok(close(toLightYears(1, 'pc'), LIGHT_YEARS_PER_PARSEC));
  assert.ok(close(LIGHT_YEARS_PER_PARSEC, 3.2615637771674337, 1e-12));
  assert.ok(close(toLightYears(1, 'au'), 1 / AU_PER_LIGHT_YEAR));
  assert.ok(close(toLightYears(AU_PER_PARSEC, 'au'), LIGHT_YEARS_PER_PARSEC, 1e-9));

  // Round-trips return the original value for every supported unit.
  for (const unit of ['ly', 'pc', 'au']) {
    for (const value of [0, 1, 4.2, 1e6]) {
      assert.ok(close(convertDistance(value, unit, unit), value, 1e-6), `${value} ${unit}`);
    }
  }
  assert.ok(close(convertDistance(1, 'pc', 'ly'), LIGHT_YEARS_PER_PARSEC));
  assert.ok(close(convertDistance(LIGHT_YEARS_PER_PARSEC, 'ly', 'pc'), 1, 1e-12));
});

test('non-finite values are rejected rather than propagated', () => {
  for (const value of [NaN, Infinity, -Infinity, '10', null]) {
    assert.throws(() => toLightYears(value, 'ly'), TypeError);
    assert.throws(() => fromLightYears(value, 'ly'), TypeError);
  }
});
