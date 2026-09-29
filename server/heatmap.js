// HEALPix density heatmap builder (Layer 4 "spatial footprints").
//
// Reuses the Layer-2 HEALPix engine (server/astro/healpix.js) to bin catalogue
// positions into ring-scheme pixels and report per-pixel counts + centers, for
// rendering as a sky-density heatmap in the client. Later this seam also
// ingests imported-archive counts.

import { ang2pixLonLat, pix2angRaDec, nside2npix, nside2resol, ORDERING } from './astro/healpix.js';

/**
 * Bin an array of {ra, dec} rows into HEALPix (ring) pixels.
 *
 * @param {Array<{ra:number,dec:number}>} rows
 * @param {number} [nside=64]
 * @returns {{nside, npix, resolArcsec, field?:object, bins:Array<{pixel,count,ra,dec}>}}
 */
export function buildHeatmap(rows, nside = 64) {
  const counts = new Map();
  for (const r of rows) {
    const p = ang2pixLonLat(nside, r.ra, r.dec, ORDERING.RING);
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const bins = [];
  for (const [pixel, count] of counts) {
    const c = pix2angRaDec(nside, pixel);
    bins.push({ pixel, count, ra: +c.ra.toFixed(5), dec: +c.dec.toFixed(5) });
  }
  bins.sort((a, b) => b.count - a.count || a.pixel - b.pixel);
  return {
    nside,
    npix: nside2npix(nside),
    resolArcsec: +(nside2resol(nside) * 206264.8).toFixed(1),
    pixelCount: bins.length,
    bins,
  };
}