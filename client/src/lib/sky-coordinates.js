/**
 * Convert equatorial ICRS/J2000 RA/Dec (degrees) into the sky-view renderer's
 * right-handed unit direction. RA=0h, Dec=0° points down camera -Z; positive
 * RA rotates toward +X and positive declination points toward +Y. This is a
 * rendering-axis mapping, not a replacement for astro/coords.js frame transforms.
 */
export function raDecToSkyDirection(raDeg, decDeg) {
  assertEquatorial(raDeg, decDeg);
  const ra = ((raDeg % 360) + 360) % 360 * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.sin(ra), Math.sin(dec), -cosDec * Math.cos(ra)];
}

const MAS_TO_RAD = Math.PI / (180 * 3600 * 1000);
const DAYS_PER_YEAR = 365.25;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function assertEquatorial(raDeg, decDeg) {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
    throw new TypeError('RA and Dec must be finite numbers in degrees');
  }
  if (decDeg < -90 || decDeg > 90) {
    throw new RangeError('Declination must be between -90 and +90 degrees');
  }
}

/**
 * Advance an equatorial position (ICRS/J2000 degrees) along the great circle
 * that leaves it in the given bearing, by the given angular distance.
 *
 * `bearingRad` is measured from local north toward local east (0 = north,
 * +π/2 = east), matching the convention used for stellar position angles. The
 * motion is applied as a rotation in the tangent plane, so it behaves correctly
 * at and near the celestial poles where a change in right ascension alone is
 * ill-conditioned.
 */
export function advanceAlongGreatCircle(raDeg, decDeg, angleRad, bearingRad) {
  assertEquatorial(raDeg, decDeg);
  if (!Number.isFinite(angleRad) || !Number.isFinite(bearingRad)) {
    throw new TypeError('angle and bearing must be finite numbers in radians');
  }
  const a = raDeg * DEG_TO_RAD;
  const d = decDeg * DEG_TO_RAD;
  const cosD = Math.cos(d);
  const sinD = Math.sin(d);
  // Position and the local east/north tangent basis in the renderer's axes.
  const p = [cosD * Math.sin(a), sinD, -cosD * Math.cos(a)];
  const east = [Math.cos(a), 0, Math.sin(a)];
  const north = [-sinD * Math.sin(a), cosD, sinD * Math.cos(a)];
  const sb = Math.sin(bearingRad);
  const cb = Math.cos(bearingRad);
  const tangent = [
    east[0] * sb + north[0] * cb,
    east[1] * sb + north[1] * cb,
    east[2] * sb + north[2] * cb,
  ];
  const cA = Math.cos(angleRad);
  const sA = Math.sin(angleRad);
  const q = [
    p[0] * cA + tangent[0] * sA,
    p[1] * cA + tangent[1] * sA,
    p[2] * cA + tangent[2] * sA,
  ];
  const length = Math.hypot(q[0], q[1], q[2]);
  const x = q[0] / length;
  const y = q[1] / length;
  const z = q[2] / length;
  return {
    ra: ((Math.atan2(x, -z) * RAD_TO_DEG) % 360 + 360) % 360,
    dec: Math.asin(Math.max(-1, Math.min(1, y))) * RAD_TO_DEG,
  };
}

/**
 * Propagate a catalogue position by a stellar proper-motion vector.
 *
 * `pmRaMasYr` is the *projected* motion μ*α = cos(dec)·dRA/dt and
 * `pmDecMasYr` is μδ = dDec/dt, both in mas/yr — the convention used by
 * Hipparcos, Gaia and the Yale BSC. Because μ*α already carries the cos(dec)
 * factor, the total angular speed is hypot(μ*α, μδ) and no explicit division by
 * cos(dec) is needed; advancing along the tangent plane (instead of adding a
 * ΔRA) keeps the result well behaved at the poles.
 *
 * Missing components are treated as zero, so a null proper motion is an exact
 * no-op rather than a fabricated value. The tangent-plane model is first order
 * in time and adequate for the Explore time-offset range.
 */
export function propagateProperMotion({
  raDeg,
  decDeg,
  pmRaMasYr = 0,
  pmDecMasYr = 0,
  refEpochJD,
  targetEpochJD,
}) {
  assertEquatorial(raDeg, decDeg);
  if (!Number.isFinite(refEpochJD) || !Number.isFinite(targetEpochJD)) {
    throw new TypeError('Both epochs must be finite Julian dates');
  }
  const muRa = Number.isFinite(pmRaMasYr) ? pmRaMasYr : 0;   // east component, mas/yr
  const muDec = Number.isFinite(pmDecMasYr) ? pmDecMasYr : 0; // north component, mas/yr
  const years = (targetEpochJD - refEpochJD) / DAYS_PER_YEAR;
  const angleRad = Math.hypot(muRa, muDec) * years * MAS_TO_RAD;
  const bearingRad = Math.atan2(muRa, muDec); // north = 0, east = +π/2
  return advanceAlongGreatCircle(raDeg, decDeg, angleRad, bearingRad);
}