// Mollweide equal-area whole-sky projection.
//
// Pure mathematics: no canvas, DOM, or renderer dependency, and no hidden
// global state. Longitude/latitude are in RADIANS. `forward` returns
// dimensionless projection-plane coordinates in the canonical Mollweide extent;
// `inverse` is its exact inverse. Scaling to device pixels, panning and any
// rotation other than about the map centre are the caller's concern (pass
// `centralMeridianRad`).
//
// Forward transform:
//   2θ + sin 2θ = π sin φ                      (θ solved numerically)
//   x = (2√2 / π) · λ · cos θ
//   y = √2 · sin θ
// where λ = wrap(lon − centralMeridian) is the longitude difference in
// [-π, π) and φ is the latitude. The full sphere maps onto the ellipse
//   (x / 2√2)² + (y / √2)² = 1.
//
// Invalid or singular inputs return `null` rather than an ambiguous NaN, so
// callers can distinguish "off the map" from "a real coordinate that happens to
// be zero".

const SQRT2 = Math.SQRT2;
const TWO_SQRT2 = 2 * SQRT2;
const HALF_PI = Math.PI / 2;
const X_MIN = -TWO_SQRT2;
const X_MAX = TWO_SQRT2;
const Y_MIN = -SQRT2;
const Y_MAX = SQRT2;

/** Reduce an angle to [-π, π). */
function wrapPi(angleRad) {
  const twoPi = 2 * Math.PI;
  return ((((angleRad + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
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
  const target = Math.PI * Math.sin(latRad);
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
  if (!isValidLonLat(lonRad, latRad)) return null;
  const lambda = wrapPi(lonRad - centralMeridianRad);
  const theta = solveTheta(latRad);
  return {
    x: (TWO_SQRT2 / Math.PI) * lambda * Math.cos(theta),
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
  if (!isInsideMap(x, y)) return null;
  const theta = Math.asin(Math.max(-1, Math.min(1, y / SQRT2)));
  const latRad = Math.asin(
    Math.max(-1, Math.min(1, (2 * theta + Math.sin(2 * theta)) / Math.PI)),
  );
  const cosTheta = Math.cos(theta);
  if (Math.abs(cosTheta) < 1e-12) {
    return { lonRad: wrapPi(centralMeridianRad), latRad };
  }
  const lambda = (Math.PI * x) / (TWO_SQRT2 * cosTheta);
  return { lonRad: wrapPi(centralMeridianRad + lambda), latRad };
}

/**
 * The Mollweide projection descriptor consumed by the projection registry and
 * the (future) renderer. Adding a regional projection means providing this same
 * shape; nothing in the renderer needs to change.
 */
export const mollweide = {
  id: 'mollweide',
  name: 'Mollweide (equal-area, whole sky)',
  kind: 'whole-sky',
  // Width / height of the canonical extent (2·2√2 by 2·√2).
  aspectRatio: (X_MAX - X_MIN) / (Y_MAX - Y_MIN), // = 2
  bounds: Object.freeze({ xMin: X_MIN, xMax: X_MAX, yMin: Y_MIN, yMax: Y_MAX }),
  forward,
  inverse,
  isValidLonLat,
  isInsideMap,
};
