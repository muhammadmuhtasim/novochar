// IVOA SIA2 (Simple Image Access 2.0) client.
//
// Returns VOTable rows describing image cutouts overlapping a sky position,
// each exposing an `access_url` for the actual pixel data (e.g. a FITS/PNG).

import { parseVOTable } from './votable.js';
import { resolveEndpoint } from './tap.js';

/** Default SIA² services per archive (Layer-1 targets). */
export const SIA2_ENDPOINTS = {
  irsa: 'https://irsa.ipac.caltech.edu/SIA2',
  widefield: 'https://datalab.noirlab.edu/sia2',
};

/**
 * Query a SIA² service for cutouts within `pos` of angular `size`.
 *
 * @param {object} opts
 * @param {string} opts.endpoint absolute URL or registry key
 * @param {string} opts.pos "RA Dec" in degrees
 * @param {number} [opts.size=0.05] field size in degrees
 * @param {function} [opts.fetchImpl]
 * @returns {Promise<{resources, rows, first}>}
 */
export async function querySIA2({ endpoint, pos, size = 0.05, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint || !pos) throw new TypeError('querySIA2 requires `endpoint` and `pos`');
  const url = new URL(resolveEndpoint(keyOrUrl(endpoint), SIA2_ENDPOINTS));
  url.searchParams.set('REQUEST', 'queryData');
  url.searchParams.set('POS', pos);
  url.searchParams.set('SIZE', String(size));
  url.searchParams.set('INTERSECT', 'OVERLAPS');

  const res = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/x-votable+xml, text/xml, application/xml' },
  });
  if (!res.ok) throw new Error(`SIA2 HTTP ${res.status}`);
  const xml = await res.text();
  const resources = parseVOTable(xml);
  const rows = resources.flatMap((r) => r.rows);
  return {
    resources,
    rows,
    first: rows[0] || null,
  };
}

function keyOrUrl(s) {
  return /^https?:\/\//.test(s) ? s : s;
}