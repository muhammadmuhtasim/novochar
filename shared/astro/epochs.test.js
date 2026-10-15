// Epoch conversion tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  J2000_JD,
  JULIAN_YEAR_DAYS,
  julianYearToJD,
  jdToJulianYear,
  daysBetweenEpochs,
  yearsBetweenEpochs,
} from './epochs.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('J2000.0 is JD 2451545.0 and round-trips', () => {
  assert.equal(julianYearToJD(2000.0), J2000_JD);
  assert.equal(jdToJulianYear(J2000_JD), 2000.0);
  for (const year of [1950.0, 1999.5, 2016.0, 2025.25]) {
    assert.ok(close(jdToJulianYear(julianYearToJD(year)), year));
  }
});

test('epoch differences use the Julian year', () => {
  assert.equal(daysBetweenEpochs(J2000_JD, J2000_JD + 365.25), 365.25);
  assert.equal(yearsBetweenEpochs(J2000_JD, J2000_JD + 365.25), 1);
  assert.equal(yearsBetweenEpochs(J2000_JD, J2000_JD - 365.25), -1);
  assert.equal(JULIAN_YEAR_DAYS, 365.25);
});
