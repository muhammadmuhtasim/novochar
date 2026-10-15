// Proper-motion and tangent-plane propagation in the scientific basis.
//
// Model: constant angular velocity, applied as a spherical exponential-map
// rotation in the local tangent plane. This avoids dividing RA motion by
// cos(delta) and stays well defined at the celestial poles.
//
// It is NOT a full astrometric solution: parallax, radial velocity, perspective
// acceleration, aberration, precession/nutation and observer location are
// excluded. Preserve the original catalogue values; never overwrite them with
// propagated positions.

import {
  DEG2RAD,
  sphericalToUnit,
  unitToSpherical,
  assertEquatorialDeg,
  assertFiniteNumber,
} from './vector.js';
import { yearsBetweenEpochs } from './epochs.js';

/** mas/yr -> rad/yr: pi / (648000 * 1000). */
export const MAS_TO_RAD_PER_YEAR = Math.PI / (180 * 3600 * 1000);

/**
 * Local tangent basis at (raDeg, decDeg):
 *   east  = e_alpha = [-sin a,        cos a,        0    ]  (toward +RA)
 *   north = e_delta = [-sin d cos a, -sin d sin a,  cos d]  (toward +Dec)
 */
export function tangentBasis(raDeg, decDeg) {
  const a = raDeg * DEG2RAD;
  const d = decDeg * DEG2RAD;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  return {
    east: [-sa, ca, 0],
    north: [-sd * ca, -sd * sa, cd],
  };
}

/**
 * Advance along the great circle leaving (raDeg, decDeg) in `bearingRad`
 * (0 = north, +pi/2 = east) by the angular distance `angleRad`. Pole-safe.
 * Returns { raDeg, decDeg }.
 */
export function advanceAlongGreatCircle(raDeg, decDeg, angleRad, bearingRad) {
  assertEquatorialDeg(raDeg, decDeg);
  assertFiniteNumber(angleRad, 'angleRad');
  assertFiniteNumber(bearingRad, 'bearingRad');

  const s = sphericalToUnit(raDeg, decDeg);
  const { east, north } = tangentBasis(raDeg, decDeg);
  const sb = Math.sin(bearingRad);
  const cb = Math.cos(bearingRad);
  const t = [
    east[0] * sb + north[0] * cb,
    east[1] * sb + north[1] * cb,
    east[2] * sb + north[2] * cb,
  ];
  const cA = Math.cos(angleRad);
  const sA = Math.sin(angleRad);
  return unitToSpherical([
    s[0] * cA + t[0] * sA,
    s[1] * cA + t[1] * sA,
    s[2] * cA + t[2] * sA,
  ]);
}

/**
 * Propagate a catalogue position by a proper-motion vector.
 *
 * `pmRaMasYr` is the *projected* motion mu_alpha* = cos(dec) dRA/dt (it already
 * carries the cos(dec) factor), and `pmDecMasYr` is mu_delta; both in mas/yr.
 * Missing (null/undefined/non-finite) components are treated as zero, so a null
 * proper motion is an exact no-op rather than a fabricated value.
 *
 * Returns { raDeg, decDeg }. The tangent-plane model is first order in time and
 * is adequate for the supported epoch range.
 */
export function propagateProperMotion({
  raDeg,
  decDeg,
  pmRaMasYr = 0,
  pmDecMasYr = 0,
  refEpochJD,
  targetEpochJD,
}) {
  assertEquatorialDeg(raDeg, decDeg);
  assertFiniteNumber(refEpochJD, 'refEpochJD');
  assertFiniteNumber(targetEpochJD, 'targetEpochJD');

  const muRa = Number.isFinite(pmRaMasYr) ? pmRaMasYr : 0;
  const muDec = Number.isFinite(pmDecMasYr) ? pmDecMasYr : 0;
  const years = yearsBetweenEpochs(refEpochJD, targetEpochJD);
  const angleRad = Math.hypot(muRa, muDec) * years * MAS_TO_RAD_PER_YEAR;

  // Zero motion or zero time offset: return the original direction exactly, so
  // the pole's ill-conditioned RA is never perturbed.
  if (angleRad === 0) {
    return { raDeg: ((raDeg % 360) + 360) % 360, decDeg };
  }

  const bearingRad = Math.atan2(muRa, muDec); // north = 0, east = +pi/2
  return advanceAlongGreatCircle(raDeg, decDeg, angleRad, bearingRad);
}
