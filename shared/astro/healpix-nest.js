// Minimal HEALPix NEST-scheme helpers for the Novochar sky-tile pyramid.
//
// The server's `server/astro/healpix.js` remains the full spatial-index engine
// (RING + NEST, ang2pix, neighbours, cross-matching). This module is the small,
// dependency-free subset shared by the server tile generator and the browser
// renderer: pixel -> centre, parent/child, and the angular size of a pixel.
//
// Keeping it in @novochar/astro means the texture pyramid and the geometry on
// the GPU use exactly the same pixel definitions; the tile contract is not
// duplicated in the client.
//
// NEST ordering is the nested (Morton) HEALPix scheme. A level-`order` pixel
// `p` has four children at level `order + 1`:
//
//   child = p * 4 + k,  k = 0..3
//
// That makes progressive refinement a pure integer operation.

import { DEG2RAD, RAD2DEG, normalizeRaDeg } from './vector.js';

const PI = Math.PI;
const TWO_PI = 2 * PI;

/** Maximum nside supported by the 16-bit Morton interleaver. */
export const MAX_NSIDE_NEST = 1 << 16;

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

/** Validate an nside for the NEST scheme. Returns the value for chaining. */
export function checkNside(nside) {
  if (!isPowerOfTwo(nside) || nside > MAX_NSIDE_NEST) {
    throw new RangeError(
      `nside must be a power of two in [1, ${MAX_NSIDE_NEST}], got ${nside}`,
    );
  }
  return nside;
}

/** Number of pixels at a given nside (12 * nside^2). */
export function nside2npix(nside) {
  checkNside(nside);
  return 12 * nside * nside;
}

/** HEALPix resolution order `log2(nside)`. */
export function nside2order(nside) {
  checkNside(nside);
  return Math.round(Math.log2(nside));
}

/** nside from a resolution order. */
export function order2nside(order) {
  if (!Number.isInteger(order) || order < 0 || order > 16) {
    throw new RangeError(`order must be an integer in [0, 16], got ${order}`);
  }
  return 2 ** order;
}

/**
 * Approximate angular resolution of one pixel, in radians.
 * This is the square root of the pixel area (4π / npix), not the exact
 * latitude-dependent HEALPix spacing. The tile renderer uses it only to size
 * a tangent-plane patch.
 */
export function nside2resolRad(nside) {
  checkNside(nside);
  return Math.sqrt((4 * PI) / (12 * nside * nside));
}

/** Angular half-size of the square patch used for a tile at this order. */
export function tileHalfAngleRad(order) {
  const nside = order2nside(order);
  return 0.5 * nside2resolRad(nside);
}

// Spread the lower 16 bits of `v` into the even bit positions (Morton code).
function spreadBits(value) {
  let x = value & 0xffff;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  return x >>> 0;
}

// Inverse of spreadBits: move the even bits back into the low positions.
function compressBits(value) {
  let x = value & 0x55555555;
  x = (x | (x >> 1)) & 0x33333333;
  x = (x | (x >> 2)) & 0x0f0f0f0f;
  x = (x | (x >> 4)) & 0x00ff00ff;
  x = (x | (x >> 8)) & 0x0000ffff;
  return x >>> 0;
}

/** NEST pixel -> (face, ix, iy). */
export function nest2xyf(ipix, nside) {
  checkNside(nside);
  const npix = 12 * nside * nside;
  if (!Number.isInteger(ipix) || ipix < 0 || ipix >= npix) {
    throw new RangeError(`ipix must be an integer in [0, ${npix}), got ${ipix}`);
  }
  const ns2 = nside * nside;
  const face = Math.floor(ipix / ns2);
  const rest = ipix % ns2;
  return {
    ix: compressBits(rest),
    iy: compressBits(Math.floor(rest / 2)),
    face,
  };
}

/** (face, ix, iy) -> NEST pixel. */
export function xyf2nest(ix, iy, face, nside) {
  checkNside(nside);
  if (!Number.isInteger(face) || face < 0 || face > 11) {
    throw new RangeError(`face must be an integer in [0, 11], got ${face}`);
  }
  if (
    !Number.isInteger(ix) || ix < 0 || ix >= nside ||
    !Number.isInteger(iy) || iy < 0 || iy >= nside
  ) {
    throw new RangeError(`ix and iy must be integers in [0, ${nside})`);
  }
  const ns2 = nside * nside;
  return face * ns2 + spreadBits(ix) + spreadBits(iy) * 2;
}

function isNorthPolar(face) {
  return face <= 3;
}

function isSouthPolar(face) {
  return face >= 8;
}

// Unit vector for the point (xp + dx, yp + dy) inside a HEALPix face.
// This mirrors the astrometry.net hp_to_xyz kernel used by the server engine.
function hpToXyz(nside, face0, xp, yp, dx, dy) {
  let face = face0;
  let equatorial = true;
  let zfactor = 1;
  let x = xp + dx;
  let y = yp + dy;

  if (isNorthPolar(face) && x + y > nside) {
    equatorial = false;
  }
  if (isSouthPolar(face) && x + y < nside) {
    equatorial = false;
    zfactor = -1;
  }

  let z;
  let phi;
  let rad;

  if (equatorial) {
    let zoff = 0;
    let phioff = 0;
    x /= nside;
    y /= nside;
    if (face <= 3) {
      phioff = 1;
    } else if (face <= 7) {
      zoff = -1;
      face -= 4;
    } else {
      phioff = 1;
      zoff = -2;
      face -= 8;
    }
    z = (2 / 3) * (x + y + zoff);
    phi = (PI / 4) * (x - y + phioff + 2 * face);
    rad = Math.sqrt(Math.max(0, 1 - z * z));
  } else {
    if (zfactor === -1) {
      const t = x;
      x = y;
      y = t;
      x = nside - x;
      y = nside - y;
    }
    const phiT = y === nside && x === nside
      ? 0
      : (PI * (nside - y)) / (2 * (nside - x + nside - y));
    const vv = phiT < PI / 4
      ? Math.abs((PI * (nside - x)) / ((2 * phiT - PI) * nside) / Math.sqrt(3))
      : Math.abs((PI * (nside - y)) / (2 * phiT * nside) / Math.sqrt(3));
    z = (1 - vv) * (1 + vv);
    rad = Math.sqrt(1 + z) * vv;
    z *= zfactor;
    phi = isSouthPolar(face)
      ? (PI / 2) * (face - 8) + phiT
      : (PI / 2) * face + phiT;
  }

  if (phi < 0) phi += TWO_PI;
  return [rad * Math.cos(phi), rad * Math.sin(phi), z];
}

/** NEST pixel centre as a unit vector in the scientific basis. */
export function pix2xyzNest(nside, ipix) {
  const { ix, iy, face } = nest2xyf(ipix, nside);
  return hpToXyz(nside, face, ix, iy, 0.5, 0.5);
}

/** NEST pixel centre as { theta, phi } in radians (theta from +Z). */
export function pix2angNest(nside, ipix) {
  const [x, y, z] = pix2xyzNest(nside, ipix);
  const theta = Math.acos(Math.max(-1, Math.min(1, z)));
  let phi = Math.atan2(y, x);
  if (phi < 0) phi += TWO_PI;
  return { theta, phi };
}

/** NEST pixel centre as { ra, dec } in degrees (ICRS convention). */
export function pix2angRaDecNest(nside, ipix) {
  const { theta, phi } = pix2angNest(nside, ipix);
  return {
    ra: normalizeRaDeg(phi * RAD2DEG),
    dec: 90 - theta * RAD2DEG,
  };
}

/** Convenience: centre of a pixel addressed by resolution order. */
export function pixelCenterRaDec(order, ipix) {
  return pix2angRaDecNest(order2nside(order), ipix);
}

/** All four NEST children of a pixel at the next resolution. */
export function nestChildren(ipix) {
  if (!Number.isInteger(ipix) || ipix < 0) {
    throw new RangeError(`ipix must be a non-negative integer, got ${ipix}`);
  }
  const base = ipix * 4;
  return [base, base + 1, base + 2, base + 3];
}

/** Parent pixel at the previous resolution. */
export function nestParent(ipix) {
  if (!Number.isInteger(ipix) || ipix < 0) {
    throw new RangeError(`ipix must be a non-negative integer, got ${ipix}`);
  }
  return Math.floor(ipix / 4);
}

/** Angular distance between two (ra, dec) positions, in radians. */
export function angularDistanceRad(ra1Deg, dec1Deg, ra2Deg, dec2Deg) {
  const a1 = ra1Deg * DEG2RAD;
  const d1 = dec1Deg * DEG2RAD;
  const a2 = ra2Deg * DEG2RAD;
  const d2 = dec2Deg * DEG2RAD;
  const cosSep = Math.sin(d1) * Math.sin(d2) +
    Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, cosSep)));
}
