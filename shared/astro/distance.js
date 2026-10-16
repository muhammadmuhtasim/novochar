// Distance units and conversion for the spherical-shell explorer.
//
// Pure, dependency-free, and shared by the server and the Mode B Observe client
// (see the coverage note in `./index.js`). This module owns exactly one job:
// turning a distance expressed in a named unit into the ONE canonical internal
// unit, and back again.
//
// CANONICAL INTERNAL UNIT: the light-year (`ly`).
//
// The plan allows parsecs or SI units; `ly` is chosen because it is already the
// unit of the project's data contracts — the star artifact and the simulated
// survey both publish `distanceLy`. Keeping the scientific core in the same unit
// as the contracts means no opportunistic conversion happens inside render or
// query code: values are converted once, at the boundary, with an explicit unit.
//
// Rules this module enforces (plan §4.5):
//   * every value carries a unit that must be known — unknown units are rejected,
//     never assumed;
//   * non-finite values are rejected rather than silently propagated;
//   * display formatting is NOT done here; this module returns numbers only.

import { assertFiniteNumber } from './vector.js';

export const DISTANCE_UNITS = Object.freeze({
  LY: 'ly',
  PC: 'pc',
  AU: 'au',
});

/** The one unit every calculation in the shell core uses. */
export const CANONICAL_DISTANCE_UNIT = DISTANCE_UNITS.LY;

// Astronomical unit counts. `AU_PER_LY` matches the value already used by the
// server's survey generator; `AU_PER_PC` is the exact IAU definition
// (1 pc = 648000/π au).
export const AU_PER_LIGHT_YEAR = 63241.07708426628;
export const AU_PER_PARSEC = 206264.80624709636;
export const LIGHT_YEARS_PER_PARSEC = AU_PER_PARSEC / AU_PER_LIGHT_YEAR;

// The factor that converts one unit into canonical light-years. Only known units
// appear here; lookup failure is the definition of an unknown unit.
const FACTOR_TO_LIGHT_YEARS = Object.freeze({
  [DISTANCE_UNITS.LY]: 1,
  [DISTANCE_UNITS.PC]: LIGHT_YEARS_PER_PARSEC,
  [DISTANCE_UNITS.AU]: 1 / AU_PER_LIGHT_YEAR,
});

// Accepted spellings -> canonical unit id. Tokens are normalized (trim,
// lower-case, separators collapsed) before lookup, so "light-year",
// "light year" and "LightYears" all resolve to `ly`.
const UNIT_ALIASES = new Map([
  ['ly', DISTANCE_UNITS.LY],
  ['lightyear', DISTANCE_UNITS.LY],
  ['lightyears', DISTANCE_UNITS.LY],
  ['pc', DISTANCE_UNITS.PC],
  ['parsec', DISTANCE_UNITS.PC],
  ['parsecs', DISTANCE_UNITS.PC],
  ['au', DISTANCE_UNITS.AU],
  ['astronomicalunit', DISTANCE_UNITS.AU],
  ['astronomicalunits', DISTANCE_UNITS.AU],
]);

function unitToken(unit) {
  return String(unit).trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** True when `unit` names a distance unit this core understands. */
export function isKnownDistanceUnit(unit) {
  return unit !== undefined && unit !== null && UNIT_ALIASES.has(unitToken(unit));
}

/**
 * Resolve a unit spelling to its canonical id.
 * @throws {RangeError} for an unknown unit — never guesses.
 */
export function canonicalDistanceUnit(unit) {
  const resolved = unit === undefined || unit === null ? undefined : UNIT_ALIASES.get(unitToken(unit));
  if (!resolved) throw new RangeError(`unknown distance unit "${unit}"`);
  return resolved;
}

/**
 * Convert `value` from `unit` into canonical light-years.
 * @throws {TypeError} for a non-finite value; {RangeError} for an unknown unit.
 */
export function toLightYears(value, unit) {
  assertFiniteNumber(value, 'distance value');
  const resolved = canonicalDistanceUnit(unit);
  return value * FACTOR_TO_LIGHT_YEARS[resolved];
}

/**
 * Convert a canonical light-year value into `unit`.
 * @throws {RangeError} for an unknown unit.
 */
export function fromLightYears(lightYears, unit) {
  assertFiniteNumber(lightYears, 'lightYears');
  return lightYears / FACTOR_TO_LIGHT_YEARS[canonicalDistanceUnit(unit)];
}

/** Convert a distance from one known unit to another. */
export function convertDistance(value, fromUnit, toUnit) {
  return fromLightYears(toLightYears(value, fromUnit), toUnit);
}
