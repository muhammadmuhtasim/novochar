/**
 * Renderer-boundary coordinate mapping for the sky view.
 *
 * RA/Dec (ICRS/J2000, degrees) map into the sky-view renderer's right-handed
 * unit direction: RA=0h, Dec=0° points down camera -Z; positive RA rotates
 * toward +X and positive declination points toward +Y.
 *
 * This is ONLY the rendering-axis mapping. The authoritative scientific
 * transforms (unit vectors, equatorial/Galactic frames, epoch handling and
 * proper-motion propagation) live in the shared @novochar/astro package; the
 * proper-motion helpers below are thin adapters that expose the renderer's
 * historical { ra, dec } shape over that single implementation.
 */
import {
  assertEquatorialDeg,
  advanceAlongGreatCircle as advanceScientific,
  propagateProperMotion as propagateScientific,
} from '@novochar/astro';

export function raDecToSkyDirection(raDeg, decDeg) {
  assertEquatorialDeg(raDeg, decDeg);
  const ra = ((((raDeg % 360) + 360) % 360) * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.sin(ra), Math.sin(dec), -cosDec * Math.cos(ra)];
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
 *
 * Returns { ra, dec } (degrees) for renderer compatibility.
 */
export function advanceAlongGreatCircle(raDeg, decDeg, angleRad, bearingRad) {
  const { raDeg: ra, decDeg: dec } = advanceScientific(raDeg, decDeg, angleRad, bearingRad);
  return { ra, dec };
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
 * no-op rather than a fabricated value. Returns { ra, dec } (degrees).
 */
export function propagateProperMotion(input) {
  const { raDeg: ra, decDeg: dec } = propagateScientific(input);
  return { ra, dec };
}
