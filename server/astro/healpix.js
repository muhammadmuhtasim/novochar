// HEALPix spatial-index utilities (pure JS, no dependencies).
//
// This module mirrors the reference Healpy implementation so that pixel
// assignments, pixel centers and ring<->nest conversions match Healpy /
// astropy-healpix exactly:
//   - forward  ang2pix (ring & nest) ported from the Healpy-compatible C++
//              `loc2pix` kernel (expression order preserved for identical
//              floating-point behaviour near the poles).
//   - reverse  pix2ang (ring & nest) via the astrometry.net `healpix` kernel
//              (ring_to_xy / nested_to_xy + hp_to_xyz -> (theta,phi)).
//
// Units: angles in RADIANS unless a *LonLat / Deg name says otherwise.
// `theta` is the co-latitude in [0, pi]; `phi` is the longitude in [0, 2*pi).

export const PI = Math.PI;
export const TWOTHIRD = 2.0 / 3.0;
export const HALFPI = Math.PI / 2;
export const INV_HALFPI = 2.0 / Math.PI;

export const ORDERING = Object.freeze({ RING: 'RING', NEST: 'NEST' });

// alias for readability in spatial-index code
export const Ordering = ORDERING;

// ---------------------------------------------------------------------------
// nsides
// ---------------------------------------------------------------------------

export function nside2npix(nside) {
  return 12 * nside * nside;
}

export function npix2nside(npix) {
  if (!Number.isInteger(npix) || npix <= 0 || npix % 12 !== 0) {
    throw new RangeError(`npix must be a positive multiple of 12, got ${npix}`);
  }
  const nside = Math.round(Math.sqrt(npix / 12));
  if (nside * nside * 12 !== npix) {
    throw new RangeError(`npix=${npix} is not 12*nside^2`);
  }
  return nside;
}

export function nside2order(nside) {
  if (!Number.isInteger(nside) || nside <= 0) return -1;
  if ((nside & (nside - 1)) !== 0) return -1;
  return Math.round(Math.log2(nside));
}

export function order2nside(order) {
  return Math.pow(2, order);
}

// Side length (radians) of one pixel - the standard `nside2resol` result.
export function nside2resol(nside) {
  return Math.sqrt((4 * Math.PI) / nside2npix(nside));
}

export const RESOL_ARCSEC = 206264.8;

export function resolArcsec(nside) {
  return nside2resol(nside) * RESOL_ARCSEC;
}

export function isNsideValid(nside, nest = false) {
  if (!Number.isInteger(nside) || nside <= 0 || nside >= 1 << 30) return false;
  if (nest && (nside & (nside - 1)) !== 0) return false;
  return true;
}

export function checkNside(nside, nest = false) {
  if (!isNsideValid(nside, nest)) {
    throw new RangeError(
      `${nside} is not a valid nside parameter (must be a power of 2 for NEST, less than 2**30)`
    );
  }
  return nside;
}

// ---------------------------------------------------------------------------
// low-level bit helpers (Morton interleaving, used by the NEST scheme)
// ---------------------------------------------------------------------------

function fmodulo(v1, v2) {
  if (v1 >= 0) return v1 < v2 ? v1 : v1 % v2;
  const t = (v1 % v2) + v2;
  return t === v2 ? 0 : t;
}

// Spread the lower bits of v into the EVEN bit positions (32-bit Morton).
// Safe for ix/iy < nside <= 2^16, i.e. up to ~12·2^32 pixels.
function spreadBits(v) {
  let x = v & 0xffff;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  return x >>> 0;
}

// Move the EVEN bits of v into the low position (inverse of spreadBits).
function compressBits(v) {
  let x = v & 0x55555555;
  x = (x | (x >> 1)) & 0x33333333;
  x = (x | (x >> 2)) & 0x0f0f0f0f;
  x = (x | (x >> 4)) & 0x00ff00ff;
  x = (x | (x >> 8)) & 0x0000ffff;
  return x >>> 0;
}

function log2i(nside) {
  return Math.round(Math.log2(nside));
}

// ---------------------------------------------------------------------------
// NEST: (x, y, face) <-> pixel   (x,y in [0, nside), face in [0,12))
// ---------------------------------------------------------------------------

export function xyf2nest(ix, iy, face, nside) {
  const order = log2i(nside);
  return face * Math.pow(2, 2 * order) + spreadBits(ix) + spreadBits(iy) * 2;
}

export function nest2xyf(ipix, nside) {
  const order = log2i(nside);
  const ns2 = nside * nside;
  const face = Math.floor(ipix / ns2);
  const rest = ipix % ns2;
  const ix = compressBits(rest);
  const iy = compressBits(Math.floor(rest / 2));
  return { ix, iy, face };
}
// ---------------------------------------------------------------------------
// RING: (ring number, within-ring longitude index) <-> pixel
// ---------------------------------------------------------------------------

export function composeRing(ring, longind, nside) {
  if (ring <= nside) {
    // north polar
    return ring * (ring - 1) * 2 + longind;
  }
  if (ring < 3 * nside) {
    // equatorial
    return nside * (nside - 1) * 2 + nside * 4 * (ring - nside) + longind;
  }
  // south polar
  const ri = 4 * nside - ring;
  return 12 * nside * nside - 1 - (ri * (ri - 1) * 2 + (ri * 4 - 1 - longind));
}

export function decomposeRing(ipix, nside) {
  const ns2 = nside * nside;
  if (ipix < 2 * ns2) {
    // north polar cap
    let ring = Math.trunc(0.5 + Math.sqrt(0.25 + 0.5 * ipix));
    let offset = 2 * ring * (ring - 1);
    if (offset > ipix) {
      ring -= 1;
      offset = 2 * ring * (ring - 1);
    }
    return { ring, longind: ipix - offset };
  }
  let offset = 2 * nside * (nside - 1);
  if (ipix < 10 * ns2) {
    // equatorial
    const ring = Math.trunc((ipix - offset) / (nside * 4) + nside);
    offset += 4 * (ring - nside) * nside;
    return { ring, longind: ipix - offset };
  }
  // south polar cap
  offset += 8 * ns2;
  const x =
    (2 * nside + 1 - Math.sqrt((2 * nside + 1) * (2 * nside + 1) - 2 * (ipix - offset))) * 0.5;
  let ring = Math.trunc(x);
  offset += 2 * ring * (2 * nside + 1 - ring);
  if (offset > ipix) {
    ring -= 1;
    offset -= 4 * nside - 4 * ring;
  }
  const longind = ipix - offset;
  return { ring: ring + 3 * nside, longind };
}

// ---------------------------------------------------------------------------
// (x, y, face) <-> ring pixel   [astrometry.net kernel]
// ---------------------------------------------------------------------------

export function ringToXY(nside, ipix) {
  const { ring, longind } = decomposeRing(ipix, nside);
  if (ring <= nside) {
    // north polar
    const bighp = Math.floor(longind / ring);
    const ind = longind - bighp * ring;
    const y = nside - 1 - ind;
    const frow = Math.floor(bighp / 4);
    const F1 = frow + 2;
    const v = F1 * nside - ring - 1;
    const x = v - y;
    return { bighp, x, y };
  }
  if (ring < 3 * nside) {
    // equatorial
    const panel = Math.floor(longind / nside);
    const ind = longind % nside;
    const bottomleft = ind < Math.floor((ring - nside + 1) / 2);
    const topleft = ind < Math.floor((3 * nside - ring + 1) / 2);
    let bighp = -1;
    let R = 0;
    let ln = longind;
    if (!bottomleft && topleft) {
      bighp = panel;
    } else if (bottomleft && !topleft) {
      bighp = 8 + panel;
    } else if (bottomleft && topleft) {
      bighp = 4 + panel;
    } else {
      bighp = 4 + (panel + 1) % 4;
      if (bighp === 4) {
        ln -= 4 * nside - 1;
        R = 1;
      }
    }
    const frow = Math.floor(bighp / 4);
    const F1 = frow + 2;
    const F2 = 2 * (bighp % 4) - (frow % 2) + 1;
    const s = (ring - nside) % 2;
    const v = F1 * nside - ring - 1;
    let h = 2 * ln - s - F2 * nside;
    if (R) h -= 1;
    let x = Math.trunc((v + h) / 2);
    let y = Math.trunc((v - h) / 2);
    if (v !== x + y || h !== x - y) {
      h += 1;
      x = Math.trunc((v + h) / 2);
      y = Math.trunc((v - h) / 2);
    }
    return { bighp, x, y };
  }
  // south polar
  const ri = 4 * nside - ring;
  const bighp = 8 + Math.floor(longind / ri);
  const ind = longind - (bighp % 4) * ri;
  const y = ri - 1 - ind;
  const frow = Math.floor(bighp / 4);
  const F1 = frow + 2;
  const v = F1 * nside - ring - 1;
  const x = v - y;
  return { bighp, x, y };
}

export function xyToRing(nside, bighp, x, y) {
  const frow = Math.floor(bighp / 4);
  const F1 = frow + 2;
  const v = x + y;
  const ring = F1 * nside - v - 1;
  if (ring < 1 || ring >= 4 * nside) return -1;
  if (ring <= nside) {
    // north polar
    return nside - 1 - y + (bighp % 4) * ring + ring * (ring - 1) * 2;
  }
  if (ring >= 3 * nside) {
    // south polar
    const ri = 4 * nside - ring;
    let index = ri - 1 - x + (3 - (bighp % 4)) * ri + ri * (ri - 1) * 2;
    return 12 * nside * nside - 1 - index;
  }
  // equatorial
  const s = (ring - nside) % 2;
  const F2 = 2 * (bighp % 4) - (frow % 2) + 1;
  const h = x - y;
  let index = Math.trunc((F2 * nside + h + s) / 2);
  index += nside * (nside - 1) * 2;
  index += nside * 4 * (ring - nside);
  if (bighp === 4 && y > x) index += 4 * nside - 1;
  return index;
}

// ring <-> nest conversions (independent of angular coordinates)
export function ring2nest(nside, ipix) {
  const { bighp, x, y } = ringToXY(nside, ipix);
  return xyf2nest(x, y, bighp, nside);
}

export function nest2ring(nside, ipix) {
  const { ix, iy, face } = nest2xyf(ipix, nside);
  return xyToRing(nside, face, ix, iy);
}

// ---------------------------------------------------------------------------
// Forward:  (theta, phi)      -> pixel          [Healpy-compatible loc2pix]
// ---------------------------------------------------------------------------

function loc2pixRing(nside, z, phi, sth, have_sth) {
  const nside_f = nside;
  const za = Math.abs(z);
  const tt = fmodulo(phi * INV_HALFPI, 4.0);
  const ncap = 2 * nside * (nside - 1);
  const npix = 12 * nside * nside;
  if (za <= TWOTHIRD) {
    // equatorial region
    const nl4 = 4 * nside;
    const temp1 = nside_f * (0.5 + tt);
    const temp2 = nside_f * z * 0.75;
    const jp = Math.floor(temp1 - temp2);
    const jm = Math.floor(temp1 + temp2);
    const ir = nside + 1 + jp - jm;
    const kshift = 1 - (ir & 1);
    const t1 = jp + jm - nside + kshift + 1 + nl4 + nl4;
    const ip = Math.floor(t1 / 2) % nl4;
    return ncap + (ir - 1) * nl4 + ip;
  }
  // north / south polar cap
  const tp = tt - Math.floor(tt);
  let tmp;
  if (za < 0.99 || !have_sth) {
    tmp = nside_f * Math.sqrt(3.0 * (1.0 - za));
  } else {
    tmp = nside_f * sth / Math.sqrt((1.0 + za) / 3.0);
  }
  const jp = Math.floor(tp * tmp);
  const jm = Math.floor((1.0 - tp) * tmp);
  const ir = jp + jm + 1;
  const ip = Math.floor(tt * ir);
  if (z > 0) return 2 * ir * (ir - 1) + ip;
  return npix - 2 * ir * (ir + 1) + ip;
}

function loc2pixNest(nside, z, phi, sth, have_sth) {
  const order = log2i(nside);
  const za = Math.abs(z);
  const tt = fmodulo(phi * INV_HALFPI, 4.0);
  if (za <= TWOTHIRD) {
    // equatorial region
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * (z * 0.75);
    const jp = Math.floor(temp1 - temp2);
    const jm = Math.floor(temp1 + temp2);
    const ifp = Math.floor(jp / Math.pow(2, order));
    const ifm = Math.floor(jm / Math.pow(2, order));
    let face;
    if (ifp === ifm) face = ifp | 4;
    else if (ifp < ifm) face = ifp;
    else face = ifm + 8;
    const ix = jm & (nside - 1);
    const iy = nside - (jp & (nside - 1)) - 1;
    return xyf2nest(ix, iy, face, nside);
  }
  // polar regions
  const ntt = Math.min(3, Math.floor(tt));
  const tp = tt - ntt;
  let tmp;
  if (za < 0.99 || !have_sth) {
    tmp = nside * Math.sqrt(3.0 * (1.0 - za));
  } else {
    tmp = nside * sth / Math.sqrt((1.0 + za) / 3.0);
  }
  let jp = Math.floor(tp * tmp);
  let jm = Math.floor((1.0 - tp) * tmp);
  if (jp >= nside) jp = nside - 1;
  if (jm >= nside) jm = nside - 1;
  if (z >= 0) return xyf2nest(nside - jm - 1, nside - jp - 1, ntt, nside);
  return xyf2nest(jp, jm, ntt + 8, nside);
}

function ang2pixScheme(nside, theta, phi, nest) {
  // Near-pole branch selection matches Healpy (literal 3.14159 threshold).
  if (theta < 0.01 || theta > 3.14159 - 0.01) {
    return nest
      ? loc2pixNest(nside, Math.cos(theta), phi, Math.sin(theta), true)
      : loc2pixRing(nside, Math.cos(theta), phi, Math.sin(theta), true);
  }
  return nest
    ? loc2pixNest(nside, Math.cos(theta), phi, 0.0, false)
    : loc2pixRing(nside, Math.cos(theta), phi, 0.0, false);
}

// theta (co-latitude, rad) in [0, pi]; phi (longitude, rad) in [0, 2*pi).
export function ang2pix(nside, theta, phi, ordering = ORDERING.RING) {
  if (!(theta >= 0 && theta <= PI)) {
    throw new RangeError(`theta must be in [0, pi], got ${theta}`);
  }
  const nest = ordering === ORDERING.NEST;
  return ang2pixScheme(nside, theta, phi, nest);
}

export function ang2pixRing(nside, theta, phi) {
  return ang2pixScheme(nside, theta, phi, false);
}

export function ang2pixNest(nside, theta, phi) {
  return ang2pixScheme(nside, theta, phi, true);
}

// lon/lat in DEGREES -> pixel. lat is geodetic latitude (-90..90).
export function ang2pixLonLat(nside, lonDeg, latDeg, ordering = ORDERING.RING) {
  const theta = HALFPI - latDeg * (PI / 180);
  const phi = lonDeg * (PI / 180);
  return ang2pix(nside, theta, phi, ordering);
}

// ---------------------------------------------------------------------------
// Reverse:  pixel -> (x, y, z) and (theta, phi)   [astrometry.net hp_to_xyz]
// ---------------------------------------------------------------------------

function isNorthPolar(c) {
  return c <= 3;
}
function isSouthPolar(c) {
  return c >= 8;
}

// Returns a unit 3-vector for the point (xp+dx, yp+dy) inside face `chp0`.
function hpToXyz(nside, chp0, xp, yp, dx, dy) {
  let chp = chp0;
  let equatorial = true;
  let zfactor = 1.0;
  let x = xp + dx;
  let y = yp + dy;

  if (isNorthPolar(chp) && x + y > nside) {
    equatorial = false;
    zfactor = 1.0;
  }
  if (isSouthPolar(chp) && x + y < nside) {
    equatorial = false;
    zfactor = -1.0;
  }

  let z;
  let phi;
  let rad;
  if (equatorial) {
    let zoff = 0;
    let phioff = 0;
    x /= nside;
    y /= nside;
    if (chp <= 3) {
      phioff = 1.0;
    } else if (chp <= 7) {
      zoff = -1.0;
      chp -= 4;
    } else {
      phioff = 1.0;
      zoff = -2.0;
      chp -= 8;
    }
    z = (2.0 / 3.0) * (x + y + zoff);
    phi = (PI / 4) * (x - y + phioff + 2 * chp);
    rad = Math.sqrt(1.0 - z * z);
  } else {
    if (zfactor === -1.0) {
      let t = x;
      x = y;
      y = t;
      x = nside - x;
      y = nside - y;
    }
    let phi_t;
    if (y === nside && x === nside) {
      phi_t = 0.0;
    } else {
      phi_t = (PI * (nside - y)) / (2.0 * (nside - x + nside - y));
    }
    let vv;
    if (phi_t < PI / 4) {
      vv = Math.abs((PI * (nside - x)) / ((2.0 * phi_t - PI) * nside) / Math.sqrt(3));
    } else {
      vv = Math.abs((PI * (nside - y)) / (2.0 * phi_t * nside) / Math.sqrt(3));
    }
    z = (1 - vv) * (1 + vv);
    rad = Math.sqrt(1.0 + z) * vv;
    z *= zfactor;
    phi = isSouthPolar(chp)
      ? (PI / 2.0) * (chp - 8) + phi_t
      : (PI / 2.0) * chp + phi_t;
  }
  if (phi < 0.0) phi += 2 * PI;
  return [rad * Math.cos(phi), rad * Math.sin(phi), z];
}

function pixelToXYF(nside, ipix, ordering) {
  if (ordering === ORDERING.NEST) {
    const { ix, iy, face } = nest2xyf(ipix, nside);
    return { bighp: face, x: ix, y: iy };
  }
  return ringToXY(nside, ipix);
}

export function pix2xyz(nside, ipix, ordering = ORDERING.RING) {
  const { bighp, x, y } = pixelToXYF(nside, ipix, ordering);
  return hpToXyz(nside, bighp, x, y, 0.5, 0.5);
}

export function pix2ang(nside, ipix, ordering = ORDERING.RING) {
  const [rx, ry, rz] = pix2xyz(nside, ipix, ordering);
  const z = rz < -1 ? -1 : rz > 1 ? 1 : rz;
  const theta = Math.acos(z);
  let phi = Math.atan2(ry, rx);
  if (phi < 0) phi += 2 * PI; // Healpy convention: phi in [0, 2*pi)
  return { theta, phi };
}

export function pix2angRing(nside, ipix) {
  return pix2ang(nside, ipix, ORDERING.RING);
}

export function pix2angNest(nside, ipix) {
  return pix2ang(nside, ipix, ORDERING.NEST);
}

// Pixel center as {ra, dec} in degrees (convenience for RA/Dec pipelines).
export function pix2angRaDec(nside, ipix, ordering = ORDERING.RING) {
  const { theta, phi } = pix2ang(nside, ipix, ordering);
  return {
    ra: phi * (180 / PI),
    dec: 90 - theta * (180 / PI),
  };
}

// Geo-index convenience used by the spatial cross-matching layer.
export function raDecToPixel(nside, raDeg, decDeg, ordering = ORDERING.RING) {
  return ang2pixLonLat(nside, raDeg, decDeg, ordering);
}
