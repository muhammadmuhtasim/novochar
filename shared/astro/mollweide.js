// Mollweide equal-area whole-sky projection for the Novochar scientific core.
//
// This is the all-sky projection for maps that must cover the full celestial
// sphere: unlike a gnomonic (TAN) projection, which is only valid inside a
// hemisphere, the Mollweide projects the entire sphere onto an ellipse
//
//   (x / 2√2)² + (y / √2)² = 1
//
// with an area that is equal on both axes (hence "equal-area") and therefore
// preserves surface brightness across the whole sky. It is the standard choice
// for all-sky density maps, CMB renderings and any survey-wide view.
//
// Forward transform:
//   2θ + sin 2θ = π sin φ                      (θ solved numerically)
//   x = (2√2 / π) · λ · cos θ
//   y = √2 · sin θ
//
// Inverse: the same equations inverted, exact to double precision.
//
// Frame neutrality (contract): like the HEALPix kernels, this module consumes a
// longitude/latitude pair in RADIANS and carries no astronomical-frame
// semantics. Callers hand it a single consistent frame (ICRS equatorial or
// Galactic) via their frame adapter; the projection never inspects or assumes
// one. The optional `centralMeridianRad` shifts the map centre, which is how a
// regional "view" of a larger all-sky map is expressed.
//
// Invalid or singular inputs return `null` rather than an ambiguous NaN, so
// callers can distinguish "off the map" from a real coordinate.
//
// Pure and dependency-free so the same code runs in Node tests, the server
// (texture generation) and the browser (renderer + projection registry).

import { DEG2RAD, RAD2DEG, normalizeRaDeg } from './vector.js';

const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const SQRT2 = Math.SQRT2;
const TWO_SQRT2 = 2 * SQRT2;
const HALF_PI = Math.PI / 2;

export const MOLLWEIDE_X_MIN = -TWO_SQRT2;
export const MOLLWEIDE_X_MAX = TWO_SQRT2;
export const MOLLWEIDE_Y_MIN = -SQRT2;
export const MOLLWEIDE_Y_MAX = SQRT2;

const X_MIN = MOLLWEIDE_X_MIN;
const X_MAX = MOLLWEIDE_X_MAX;
const Y_MIN = MOLLWEIDE_Y_MIN;
const Y_MAX = MOLLWEIDE_Y_MAX;

/** Canonical extent of the Mollweide map (width 4√2, height 2√2, aspect 2). */
export const MOLLWEIDE_EXTENT = Object.freeze({
  xMin: X_MIN,
  xMax: X_MAX,
  yMin: Y_MIN,
  yMax: Y_MAX,
});

/** Width / height of the canonical Mollweide extent = 2 (square in scaled units). */
export const MOLLWEIDE_ASPECT_RATIO = (X_MAX - X_MIN) / (Y_MAX - Y_MIN);

export const MOLLWEIDE_NAME = 'Mollweide (equal-area, whole sky)';

/** Reduce an angle to [-π, π). */
function wrapPi(angleRad) {
  return ((((angleRad + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

/** True when (lonRad, latRad) is a finite, in-range on-sphere coordinate. */
export function isValidLonLat(lonRad, latRad) {
  return (
    Number.isFinite(lonRad) &&
    Number.isFinite(latRad) &&
    latRad >= -HALF_PI &&
    latRad <= HALF_PI
  );
}

/** True when (x, y) lies inside (or on) the Mollweide ellipse. */
export function isInsideMap(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const r = (x * x) / (X_MAX * X_MAX) + (y * y) / (Y_MAX * Y_MAX);
  return r <= 1 + 1e-12;
}

/**
 * Solve 2θ + sin 2θ = π sin φ for θ ∈ [-π/2, π/2].
 *
 * The left-hand side is strictly increasing on that interval, so a bounded
 * bisection converges for every φ (including φ = 0 and the poles, where the
 * Newton derivative would vanish). Returns θ in radians.
 */
export function solveTheta(latRad) {
  if (latRad === 0) return 0;
  if (latRad <= -HALF_PI) return -HALF_PI;
  if (latRad >= HALF_PI) return HALF_PI;
  const target = PI * Math.sin(latRad);
  let lo = -HALF_PI;
  let hi = HALF_PI;
  // 80 halvings reduce the bracket far below double precision.
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const g = 2 * mid + Math.sin(2 * mid);
    if (g < target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Forward projection.
 * @returns {{x:number, y:number}|null} plane coordinates, or null if invalid.
 */
export function forward(lonRad, latRad, { centralMeridianRad = 0 } = {}) {
  if (!isValidLonLat(lonRad, latRad) || !Number.isFinite(centralMeridianRad)) return null;
  const lambda = wrapPi(lonRad - centralMeridianRad);
  const theta = solveTheta(latRad);
  return {
    x: (TWO_SQRT2 / PI) * lambda * Math.cos(theta),
    y: SQRT2 * Math.sin(theta),
  };
}

/**
 * Inverse projection.
 * @returns {{lonRad:number, latRad:number}|null} iff the point is on the map,
 *   otherwise null. At the poles longitude is undefined and the central
 *   meridian is returned.
 */
export function inverse(x, y, { centralMeridianRad = 0 } = {}) {
  if (!Number.isFinite(centralMeridianRad) || !isInsideMap(x, y)) return null;
  const theta = Math.asin(Math.max(-1, Math.min(1, y / SQRT2)));
  const latRad = Math.asin(
    Math.max(-1, Math.min(1, (2 * theta + Math.sin(2 * theta)) / PI)),
  );
  const cosTheta = Math.cos(theta);
  if (Math.abs(cosTheta) < 1e-12) {
    return { lonRad: wrapPi(centralMeridianRad), latRad };
  }
  const lambda = (PI * x) / (TWO_SQRT2 * cosTheta);
  return { lonRad: wrapPi(centralMeridianRad + lambda), latRad };
}

/**
 * The Mollweide projection descriptor consumed by the projection registry and
 * the (future) renderer. Adding a regional projection means providing this same
 * shape; nothing in the renderer needs to change.
 */
export const mollweide = {
  id: 'mollweide',
  name: MOLLWEIDE_NAME,
  kind: 'whole-sky',
  aspectRatio: MOLLWEIDE_ASPECT_RATIO,
  bounds: MOLLWEIDE_EXTENT,
  forward,
  inverse,
  isValidLonLat,
  isInsideMap,
};

/**
 * RA/Dec in degrees -> Mollweide plane coordinates. Convenience wrapper for
 * the texture generators and renderers that work in (RA, Dec) degrees rather
 * than raw longitude/latitude radians. Returns null for an invalid position or
 * an off-map plane coordinate.
 */
export function raDecToMollweidePlane(raDeg, decDeg, { centralMeridianRad = 0 } = {}) {
  if (decDeg < -90 || decDeg > 90) return null;
  const result = forward(raDeg * DEG2RAD, decDeg * DEG2RAD, { centralMeridianRad });
  if (!result) return null;
  return { x: result.x, y: result.y };
}

/**
 * Mollweide plane coordinates -> RA/Dec in degrees. Inverse of
 * `raDecToMollweidePlane`; returns null for off-map coordinates.
 */
export function mollweidePlaneToRaDec(x, y, { centralMeridianRad = 0 } = {}) {
  const back = inverse(x, y, { centralMeridianRad });
  if (!back) return null;
  return {
    ra: normalizeRaDeg(back.lonRad * RAD2DEG),
    dec: back.latRad * RAD2DEG,
  };
}
