// Equatorial (ICRS) <-> Galactic frame transforms.
//
// This is the ICRS-native Galactic transform: it reproduces Astropy's default
// `ICRS(...).transform_to(Galactic())` to ~1e-9 arcsec (machine precision)
// across the whole sky, rather than the bare FK5(J2000) convention.
//
// Astropy builds ICRS -> Galactic as the composition of two steps:
//   1. ICRS -> FK5(J2000): the USNO Circular 179 "B-matrix" frame bias
//      (eta0 = -19.9 mas, xi0 = 9.1 mas, da0 = -22.9 mas).
//   2. FK5(J2000) -> Galactic: the classic IAU 1958 rotation built from the
//      galactic north pole and the galactic longitude of the celestial north
//      pole, expressed in FK5(J2000).
// We reproduce that composition exactly (see the matrices below), so the result
// is ICRS-native. The bare FK5(J2000) transform differs from it only by the
// ~20 mas frame bias, which is why an implementation that skips step 1 can look
// almost right while failing machine-precision reference tests.
// See scripts/generate-astro-reference.py, which regenerates the committed
// Astropy reference values from `frame='icrs'` inputs.
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
//   rotation_matrix(a, axis='x') = [[1, 0, 0], [0, cos a, sin a], [0, -sin a, cos a]]

import { DEG2RAD, sphericalToUnit, unitToSpherical } from './vector.js';

// Galactic frame constants: the galactic north pole (RA, Dec) and the galactic
// longitude of the celestial north pole, expressed in FK5(J2000). These are the
// classic IAU 1958 values Astropy uses in galactic_transforms.py
// (`Galactic._ngp_J2000`, `Galactic._lon0_J2000`). They define step 2 of the
// composition; the ICRS-native result adds the frame-bias B-matrix below.
export const RA_NGP_DEG = 192.8594812065348; // galactic north pole, RA in FK5(J2000) (deg)
export const DEC_NGP_DEG = 27.12825118085622; // galactic north pole, Dec in FK5(J2000) (deg)
export const GAL_LON_OF_NCP_DEG = 122.9319185680026; // galactic longitude of the NCP (deg)

// ICRS -> FK5(J2000) frame-bias angles (USNO Circular 179 B-matrix), in
// milliarcseconds. Astropy: `_icrs_to_fk5_matrix()`.
const ICRS_TO_FK5_ETA0_MAS = -19.9;
const ICRS_TO_FK5_XI0_MAS = 9.1;
const ICRS_TO_FK5_DA0_MAS = -22.9;
const MAS_TO_DEG = 1 / 3600000;

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

/** Coordinate-frame rotation about X by `deg` (Astropy convention). */
export function rotX(deg) {
  const a = deg * DEG2RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [1, 0, 0],
    [0, c, s],
    [0, -s, c],
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

// Step 2 of the composition: FK5(J2000) -> Galactic (classic IAU 1958 pole).
//   E2G_fk5 = rotZ(180 - L_NCP) @ rotY(90 - DEC_NGP) @ rotZ(RA_NGP)
// Exported so tests can verify the definitional FK5 identity (pole -> b=+90)
// separately from the ICRS-native result.
export const fk5EquatorialToGalacticMatrix = matMul3(
  matMul3(rotZ(180 - GAL_LON_OF_NCP_DEG), rotY(90 - DEC_NGP_DEG)),
  rotZ(RA_NGP_DEG),
);

// Step 1 of the composition: ICRS -> FK5(J2000) frame bias (USNO Circular 179
// B-matrix), Astropy's `_icrs_to_fk5_matrix()`:
//   B = rotX(-eta0) @ rotY(xi0) @ rotZ(da0)
export const icrsToFk5Matrix = matMul3(
  matMul3(rotX(-ICRS_TO_FK5_ETA0_MAS * MAS_TO_DEG), rotY(ICRS_TO_FK5_XI0_MAS * MAS_TO_DEG)),
  rotZ(ICRS_TO_FK5_DA0_MAS * MAS_TO_DEG),
);

// ICRS (RA, Dec) -> Galactic (l, b). Applying an active rotation to a column
// vector: v_gal = (E2G_fk5 @ B) @ v_icrs.
export const equatorialToGalacticMatrix = matMul3(
  fk5EquatorialToGalacticMatrix,
  icrsToFk5Matrix,
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

/** Equatorial (RA, Dec in degrees, ICRS) -> Galactic (l, b in degrees). */
export function raDecToGalactic(raDeg, decDeg) {
  const v = matVec3(equatorialToGalacticMatrix, sphericalToUnit(raDeg, decDeg));
  const { raDeg: l, decDeg: b } = unitToSpherical(v);
  return { l, b };
}

/** Galactic (l, b in degrees) -> Equatorial (RA, Dec in degrees, ICRS). */
export function galacticToRaDec(lDeg, bDeg) {
  const v = matVec3(galacticToEquatorialMatrix, sphericalToUnit(lDeg, bDeg));
  const { raDeg, decDeg } = unitToSpherical(v);
  return { ra: raDeg, dec: decDeg };
}
