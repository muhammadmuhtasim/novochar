// Canonical spherical <-> unit-vector conversions for the Novochar scientific
// core.
//
// The scientific basis is documented and renderer-independent:
//
//   s(alpha, delta) = [ cos(delta) cos(alpha),
//                       cos(delta) sin(alpha),
//                       sin(delta) ]
//
// with alpha the right ascension (degrees) and delta the declination (degrees).
// This matches Astropy and the Novochar processing layer. Renderers must convert
// to their own axis convention only at the rendering boundary; never encode a
// screen or Three.js basis here.
//
// Pure and dependency-free so the same code runs in Node tests, the server, and
// the browser bundle.

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Wrap an angle in degrees into [0, 360). */
export function normalizeRaDeg(raDeg) {
  return ((raDeg % 360) + 360) % 360;
}

/** Throw unless `value` is a finite number. */
export function assertFiniteNumber(value, name = 'value') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

/** Validate an equatorial (RA, Dec) pair in degrees. */
export function assertEquatorialDeg(raDeg, decDeg) {
  assertFiniteNumber(raDeg, 'raDeg');
  assertFiniteNumber(decDeg, 'decDeg');
  if (decDeg < -90 || decDeg > 90) {
    throw new RangeError('decDeg must be between -90 and +90 degrees');
  }
}

/** Spherical (RA, Dec in degrees) -> unit vector in the scientific basis. */
export function sphericalToUnit(raDeg, decDeg) {
  assertEquatorialDeg(raDeg, decDeg);
  const a = raDeg * DEG2RAD;
  const d = decDeg * DEG2RAD;
  const cd = Math.cos(d);
  return [cd * Math.cos(a), cd * Math.sin(a), Math.sin(d)];
}

/**
 * Unit vector -> spherical. The input is normalized first, so a slightly
 * denormalized vector is accepted. RA is returned in [0, 360); Dec in [-90, 90].
 * At the poles RA is ill-conditioned; the vector remains authoritative.
 */
export function unitToSpherical(v) {
  if (!Array.isArray(v) || v.length !== 3 || v.some((c) => !Number.isFinite(c))) {
    throw new TypeError('unitToSpherical expects three finite components');
  }
  const [x, y, z] = v;
  const length = Math.hypot(x, y, z);
  if (length === 0) throw new RangeError('zero-length vector has no direction');
  const dec = Math.asin(Math.max(-1, Math.min(1, z / length)));
  const ra = Math.atan2(y, x);
  return { raDeg: normalizeRaDeg(ra * RAD2DEG), decDeg: dec * RAD2DEG };
}

export function norm(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalizeVector(v) {
  const n = norm(v);
  if (n === 0) throw new RangeError('cannot normalize a zero-length vector');
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function scale(v, k) {
  return [v[0] * k, v[1] * k, v[2] * k];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
