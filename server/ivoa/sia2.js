// IVOA SIA (Simple Image Access) client.
//
// Queries image-footprint tables overlapping a sky position and returns VOTable
// rows, each exposing an access_url for the actual pixel data (FITS cutout).
// Handles both SIA1-style (POS/SIZE in one call, INTERSECT=OVERLAPS) and the
// IRSA SIA2 form which adds a COLLECTION selector.

import { parseVOTable, queryStatus } from './votable.js';
import { ARCHIVES } from './registry.js';
import { resolveEndpoint } from './tap.js';

export const SIA2_ENDPOINTS = {
  irsa: 'https://irsa.ipac.caltech.edu/SIA',
  widefield: 'https://datalab.noirlab.edu/sia/coadd_all',
  mast: 'https://archive.stsci.edu/ssap/search2.php',
};

function resolveSiaTarget(endpoint) {
  if (ARCHIVES[endpoint] && ARCHIVES[endpoint].protocols && ARCHIVES[endpoint].protocols.sia) {
    const s = ARCHIVES[endpoint].protocols.sia;
    return { endpoint: s.endpoint, param: s.param || null };
  }
  return { endpoint, param: null };
}

/**
 * Query a SIA service for cutouts within `pos` of angular `size`.
 * @param {object} opts { archive|endpoint, pos: "RA Dec", size(deg), collection, timeout, fetchImpl }
 */
export async function querySIA({ endpoint, pos, size = 0.05, collection, timeout = 30000, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint || !pos) throw new TypeError('querySIA requires `endpoint` and `pos`');
  const { endpoint: base, param } = resolveSiaTarget(endpoint);
  const url = new URL(resolveEndpoint(base, SIA2_ENDPOINTS));
  url.searchParams.set('REQUEST', 'queryData');
  url.searchParams.set('POS', pos);
  url.searchParams.set('SIZE', String(size));
  url.searchParams.set('INTERSECT', 'OVERLAPS');
  if (collection || param) url.searchParams.set(param || 'COLLECTION', collection || '');

  const res = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/x-votable+xml, text/xml, application/xml' },
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined),
  });
  if (!res.ok) throw new Error(`SIA HTTP ${res.status}`);
  const xml = await res.text();
  const resources = parseVOTable(xml);
  const rows = resources.flatMap((r) => r.rows);
  return { resources, rows, status: queryStatus(xml), first: rows[0] || null };
}

// Back-compat alias that works for SIA1/SIA2 endpoints registered under 'sia2'.
export async function querySIA2(o) {
  return querySIA(o);
}
