// Spatial cross-matching and cone search for the Processing/Matching layer.
//
// Builds a HEALPix spatial index (RING scheme) over a target catalogue and
// answers geometric queries against it:
//   - crossmatch(source, target, {radiusArcsec})  -> matched pairs
//   - coneSearch(catalog, center, {radiusArcsec}) -> indices in a disc
//   - nearestNeighbor(source, target, {...})      -> k nearest within radius
//
// A target within `radius` of a source is guaranteed to be considered: the
// source's neighbourhood is sampled on a grid fine enough (step = half the
// pixel side length) that every HEALPix pixel touching the search disc is
// probed. Exact great-circle separations then filter the candidate set, so
// there are never false positives and, by construction of the index + probe
// geometry, no false negatives.

import { ORDERING, ang2pixLonLat, nside2resol } from './healpix.js';
import { angularSeparationArcsec } from './coords.js';

const DEG2RAD = Math.PI / 180;
const ARCSEC = 3600; // arcsec per degree
const SQRT_4PI_OVER_12 = Math.sqrt((4 * Math.PI) / 12);
const MAX_NSIDE = 1 << 20;

/**
 * Choose an nside whose pixel side length is at most the search radius, so the
 * probe-neighbourhood of any source stays small while remaining exact.
 */
export function chooseNside(radiusArcsec) {
  const radiusRad = (radiusArcsec * DEG2RAD) / ARCSEC;
  const nside = Math.max(1, Math.ceil(SQRT_4PI_OVER_12 / radiusRad));
  return Math.min(nside, MAX_NSIDE);
}

function buildIndex(targets, nside) {
  const index = new Map();
  for (let t = 0; t < targets.length; t++) {
    const { ra, dec } = targets[t];
    const p = ang2pixLonLat(nside, ra, dec, ORDERING.RING);
    let bucket = index.get(p);
    if (!bucket) {
      bucket = [];
      index.set(p, bucket);
    }
    bucket.push(t);
  }
  return index;
}

// Local unit tangent-plane basis (east / north) at a sky position. Both are
// unit vectors, so probing by (u*east + v*north) stays well-behaved even at
// the poles (no 1/cos(dec) blow-up).
function tangentBasis(raDeg, decDeg) {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cd = Math.cos(dec);
  const sd = Math.sin(dec);
  const cr = Math.cos(ra);
  const sr = Math.sin(ra);
  // east = d/d(ra) of the unit position vector
  const east = [-sr, cr, 0];
  // north = d/d(dec) of the unit position vector
  const north = [-sd * cr, -sd * sr, cd];
  return { east, north };
}

function offsetPoint(raDeg, decDeg, u, v) {
  const { east, north } = tangentBasis(raDeg, decDeg);
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cd = Math.cos(dec);
  let x = cd * Math.cos(ra) + u * east[0] + v * north[0];
  let y = cd * Math.sin(ra) + u * east[1] + v * north[1];
  let z = Math.sin(dec) + u * east[2] + v * north[2];
  const n = Math.hypot(x, y, z) || 1;
  x /= n;
  y /= n;
  z /= n;
  return {
    ra: (Math.atan2(y, x) * (1 / DEG2RAD) + 360) % 360,
    dec: Math.asin(Math.max(-1, Math.min(1, z))) * (1 / DEG2RAD),
  };
}

// Returns the set of HEALPix pixel indices that the search disc overlaps, by
// sampling a local tangent-plane grid around `center`.
function probePixels(nside, raDeg, decDeg, radiusRad) {
  const pixSize = nside2resol(nside);
  const halfw = radiusRad + 2.0 * pixSize;
  const step = 0.5 * pixSize;
  const steps = Math.max(1, Math.ceil(halfw / step));
  const out = new Set();
  for (let i = -steps; i <= steps; i++) {
    const u = i * step;
    for (let j = -steps; j <= steps; j++) {
      const v = j * step;
      const p = offsetPoint(raDeg, decDeg, u, v);
      out.add(ang2pixLonLat(nside, p.ra, p.dec, ORDERING.RING));
    }
  }
  return out;
}

/**
 * Candidate target indices (deduped) in the search region around a point,
 * drawn from a pre-built HEALPix index. Callers apply exact filtering.
 */
export function gatherCandidates(index, nside, raDeg, decDeg, radiusRad) {
  const pixels = probePixels(nside, raDeg, decDeg, radiusRad);
  const out = [];
  for (const p of pixels) {
    const bucket = index.get(p);
    if (!bucket) continue;
    for (const t of bucket) out.push(t);
  }
  return out;
}
/**
 * Cross-match every source against the target catalogue within
 * `radiusArcsec`. Returns [{ sourceIndex, targetIndex, separationArcsec }];
 * separations are computed exactly, so only genuine matches are returned.
 */
export function crossmatch(source, target, { radiusArcsec, nside } = {}) {
  if (!(radiusArcsec > 0)) throw new RangeError('radiusArcsec must be > 0');
  const n = nside ?? chooseNside(radiusArcsec);
  const radiusRad = (radiusArcsec * DEG2RAD) / ARCSEC;
  const index = buildIndex(target, n);
  const results = [];
  for (let s = 0; s < source.length; s++) {
    const { ra, dec } = source[s];
    const cands = gatherCandidates(index, n, ra, dec, radiusRad);
    for (const t of cands) {
      const sep = angularSeparationArcsec(ra, dec, target[t].ra, target[t].dec);
      if (sep <= radiusArcsec + 1e-9) {
        results.push({ sourceIndex: s, targetIndex: t, separationArcsec: sep });
      }
    }
  }
  return results;
}

/**
 * Indices of catalogue rows inside a disc of `radiusArcsec` around `center`.
 */
export function coneSearch(catalog, center, { radiusArcsec, nside } = {}) {
  if (!(radiusArcsec > 0)) throw new RangeError('radiusArcsec must be > 0');
  const n = nside ?? chooseNside(radiusArcsec);
  const radiusRad = (radiusArcsec * DEG2RAD) / ARCSEC;
  const index = buildIndex(catalog, n);
  const cands = gatherCandidates(index, n, center.ra, center.dec, radiusRad);
  const out = [];
  for (const t of cands) {
    const sep = angularSeparationArcsec(center.ra, center.dec, catalog[t].ra, catalog[t].dec);
    if (sep <= radiusArcsec + 1e-9) out.push(t);
  }
  return out;
}

/**
 * For every source, the up-to-`k` nearest target rows within `radiusArcsec`,
 * sorted by increasing separation.
 */
export function nearestNeighbor(source, target, { radiusArcsec, nside, k = 1 } = {}) {
  if (!(radiusArcsec > 0)) throw new RangeError('radiusArcsec must be > 0');
  const n = nside ?? chooseNside(radiusArcsec);
  const radiusRad = (radiusArcsec * DEG2RAD) / ARCSEC;
  const index = buildIndex(target, n);
  const out = [];
  for (let s = 0; s < source.length; s++) {
    const { ra, dec } = source[s];
    const cands = gatherCandidates(index, n, ra, dec, radiusRad);
    const hits = [];
    for (const t of cands) {
      const sep = angularSeparationArcsec(ra, dec, target[t].ra, target[t].dec);
      if (sep <= radiusArcsec + 1e-9) hits.push({ targetIndex: t, separationArcsec: sep });
    }
    hits.sort((a, b) => a.separationArcsec - b.separationArcsec);
    out.push({ sourceIndex: s, matches: hits.slice(0, k) });
  }
  return out;
}

// Reference O(n*m) implementation used to validate the indexed path in tests.
export function bruteForceCrossmatch(source, target, radiusArcsec) {
  const out = [];
  for (let s = 0; s < source.length; s++) {
    for (let t = 0; t < target.length; t++) {
      const sep = angularSeparationArcsec(
        source[s].ra,
        source[s].dec,
        target[t].ra,
        target[t].dec
      );
      if (sep <= radiusArcsec + 1e-9) {
        out.push({ sourceIndex: s, targetIndex: t, separationArcsec: sep });
      }
    }
  }
  return out;
}
