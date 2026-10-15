// Equatorial (ICRS/J2000) <-> Galactic frame transforms.
//
// Uses the exact rotation matrix and constants that Astropy uses for its
// `FK5(J2000) <-> Galactic` transform (astropy galactic_transforms.py), so the
// results match Astropy and reputable catalogs.
//
// Frame contract: the rotation uses the classic IAU 1958 Galactic pole,
// expressed in FK5(J2000). The result is the FK5(J2000) <-> Galactic transform
// and matches Astropy's `FK5(J2000).galactic` to machine precision (reference
// tests). Astropy's *default* Galactic frame is ICRS-native; it differs from
// this transform only by the ICRS <-> FK5(J2000) frame bias (up to ~30 mas,
// asserted in reference.test.js), not by any difference in the galactic
// definition. Catalogs that quote ICRS therefore carry that sub-arcsecond-scale
// offset when transformed here.
//
// Rotation convention (IMPORTANT): these are the *coordinate-frame* rotation
// matrices Astropy uses (astropy.coordinates.matrix_utilities.rotation_matrix),
// i.e. the transpose of the usual active, right-handed rotation operator on
// column vectors. A positive angle rotates the *axes* by +a. Matrix
// multiplication order matters; the composition below already accounts for it.
// Do NOT change signs or ordering without independent reference tests.
//
//   rotation_matrix(a, axis='z') = [[cos a, sin a, 0], [-sin a, cos a, 0], [0, 0, 1]]
//   rotation_matrix(a, axis='y') = [[cos a, 0, -sin a], [0, 1, 0], [sin a, 0, cos a]]

import { DEG2RAD, sphericalToUnit, unitToSpherical } from './vector.js';

// Galactic frame constants (Astropy `Galactic._ngp_J2000`, `_lon0_J2000`).
export const RA_NGP_DEG = 192.8594812065348; // galactic north pole, RA (deg)
export const DEC_NGP_DEG = 27.12825118085622; // galactic north pole, Dec (deg)
export const GAL_LON_OF_NCP_DEG = 122.9319185680026; // galactic longitude of the NCP (deg)

/** Coordinate-frame rotation about Z by `deg` (Astropy convention). */
export function rotZ(deg) {
  const a = deg * DEG2RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, s, 0],
    [-s, c, 0],
    [0, 0, 1],
  ];
}

/** Coordinate-frame rotation about Y by `deg` (Astropy convention). */
export function rotY(deg) {
  const a = deg * DEG2RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [c, 0, -s],
    [0, 1, 0],
    [s, 0, c],
  ];
}

/** 3x3 matrix product a @ b. */
export function matMul3(a, b) {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) out[i][j] += a[i][k] * b[k][j];
    }
  }
  return out;
}

/** 3x3 transpose. */
export function transpose3(m) {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

function matVec3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// Equatorial (FK5-J2000) -> Galactic rotation matrix.
//   E2G = rotZ(180 - L_NCP) @ rotY(90 - DEC_NGP) @ rotZ(RA_NGP)
export const equatorialToGalacticMatrix = matMul3(
  matMul3(rotZ(180 - GAL_LON_OF_NCP_DEG), rotY(90 - DEC_NGP_DEG)),
  rotZ(RA_NGP_DEG),
);
export const galacticToEquatorialMatrix = transpose3(equatorialToGalacticMatrix);

/** Equatorial unit vector (scientific basis) for (RA, Dec) in degrees. */
export function raDecToVector(raDeg, decDeg) {
  return sphericalToUnit(raDeg, decDeg);
}

/** (RA, Dec) in degrees for a vector — `{ ra, dec }` (RA in [0, 360)). */
export function vectorToRaDec(x, y, z) {
  const { raDeg, decDeg } = unitToSpherical([x, y, z]);
  return { ra: raDeg, dec: decDeg };
}

/** Equatorial (RA, Dec in degrees) -> Galactic (l, b in degrees). */
export function raDecToGalactic(raDeg, decDeg) {
  const v = matVec3(equatorialToGalacticMatrix, sphericalToUnit(raDeg, decDeg));
  const { raDeg: l, decDeg: b } = unitToSpherical(v);
  return { l, b };
}

/** Galactic (l, b in degrees) -> Equatorial (RA, Dec in degrees). */
export function galacticToRaDec(lDeg, bDeg) {
  const v = matVec3(galacticToEquatorialMatrix, sphericalToUnit(lDeg, bDeg));
  const { raDeg, decDeg } = unitToSpherical(v);
  return { ra: raDeg, dec: decDeg };
}
