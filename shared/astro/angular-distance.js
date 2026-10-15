// Angular separation between two sky directions.
//
// Uses the vector atan2 form  gamma = atan2(|u x v|, u . v), which stays
// numerically stable for very small separations (where acos(u.v) loses
// precision) and remains exact at 0 and pi. Never substitute Euclidean
// distance between projected map coordinates for on-sky separation.

import { RAD2DEG, sphericalToUnit, dot, cross, norm } from './vector.js';

export const ARCSEC_PER_DEG = 3600;

/** Angular separation (radians) between two vectors. */
export function angularSeparationRad(v1, v2) {
  return Math.atan2(norm(cross(v1, v2)), dot(v1, v2));
}

/** Angular separation (degrees) between two (RA, Dec) pairs in degrees. */
export function angularSeparationDeg(ra1, dec1, ra2, dec2) {
  const u = sphericalToUnit(ra1, dec1);
  const v = sphericalToUnit(ra2, dec2);
  return angularSeparationRad(u, v) * RAD2DEG;
}

/** Angular separation (arcseconds) between two (RA, Dec) pairs in degrees. */
export function angularSeparationArcsec(ra1, dec1, ra2, dec2) {
  return angularSeparationDeg(ra1, dec1, ra2, dec2) * ARCSEC_PER_DEG;
}
