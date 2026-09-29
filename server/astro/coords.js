// Coordinate conversion utilities for the Processing/Matching layer.
//
// Implements the equatorial (RA/Dec, ICRS/equinox J2000) <-> Galactic (l, b)
// transformation using the exact rotation matrix and constants that Astropy
// uses for the `FK5(J2000) <-> Galactic` transform (astropy
// galactic_transforms.py), so results match Astropy / reputable catalogs.
//
// Byte-compatible conventions:
//   rotation_matrix(a, axis='z') = [[cos a, sin a, 0],
//                                   [-sin a, cos a, 0],
//                                   [0,      0,     1]]
//   rotation_matrix(a, axis='y') = [[cos a, 0, -sin a],
//                                   [0,     1, 0],
//                                   [sin a, 0,  cos a]]
// All angles are in degrees unless a *Rad function name is used.

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

// Galactic frame constants (Astropy `Galactic._ngp_J2000`, `_lon0_J2000`).
const RA_NGP = 192.8594812065348; // galactic north pole, RA (deg)
const DEC_NGP = 27.12825118085622; // galactic north pole, Dec (deg)
const L_NCP = 122.9319185680026; // galactic longitude of the NCP (deg)

// Rotation matrices (as active column-vector rotations, matching Astropy).
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

export function matMul3(a, b) {
  // a @ b
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

function matVec3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function transpose3(m) {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

// Equatorial (FK5-J2000) -> Galactic rotation matrix.
//   E2G = rotZ(180 - L_NCP) @ rotY(90 - DEC_NGP) @ rotZ(RA_NGP)
const equatorialToGalacticMatrix = matMul3(
  matMul3(rotZ(180 - L_NCP), rotY(90 - DEC_NGP)),
  rotZ(RA_NGP)
);
const galacticToEquatorialMatrix = transpose3(equatorialToGalacticMatrix);

export function raDecToVector(raDeg, decDeg) {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

export function vectorToRaDec(x, y, z) {
  const dec = Math.asin(Math.max(-1, Math.min(1, z)));
  let ra = Math.atan2(y, x);
  if (ra < 0) ra += 2 * Math.PI;
  return { ra: ra * RAD2DEG, dec: dec * RAD2DEG };
}

/**
 * Equatorial (RA, Dec in degrees) -> Galactic (l, b in degrees).
 */
export function raDecToGalactic(raDeg, decDeg) {
  const v = matVec3(equatorialToGalacticMatrix, raDecToVector(raDeg, decDeg));
  const b = Math.asin(Math.max(-1, Math.min(1, v[2])));
  let l = Math.atan2(v[1], v[0]);
  if (l < 0) l += 2 * Math.PI;
  return { l: l * RAD2DEG, b: b * RAD2DEG };
}

/**
 * Galactic (l, b in degrees) -> Equatorial (RA, Dec in degrees).
 */
export function galacticToRaDec(lDeg, bDeg) {
  const l = lDeg * DEG2RAD;
  const b = bDeg * DEG2RAD;
  const cb = Math.cos(b);
  const v = matVec3(galacticToEquatorialMatrix, [cb * Math.cos(l), cb * Math.sin(l), Math.sin(b)]);
  return vectorToRaDec(v[0], v[1], v[2]);
}

/**
 * Great-circle angular separation (haversine) in degrees.
 */
export function angularSeparationDeg(ra1, dec1, ra2, dec2) {
  const a1 = ra1 * DEG2RAD;
  const d1 = dec1 * DEG2RAD;
  const a2 = ra2 * DEG2RAD;
  const d2 = dec2 * DEG2RAD;
  const dLat = d2 - d1;
  const dLon = a2 - a1;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(d1) * Math.cos(d2) * sinLon * sinLon;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * RAD2DEG;
}

export const ARCSEC_PER_DEG = 3600;

export function angularSeparationArcsec(ra1, dec1, ra2, dec2) {
  return angularSeparationDeg(ra1, dec1, ra2, dec2) * ARCSEC_PER_DEG;
}