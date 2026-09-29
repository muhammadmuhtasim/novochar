// IVOA SSA (Simple Spectral Access 1.x) client.
//
// Returns VOTable rows describing spectra overlapping a sky position, each
// pointing at a retrievable spectrum (access_ssa URL).

import { parseVOTable } from './votable.js';
import { resolveEndpoint } from './tap.js';

/** Default SSA services per archive (Layer-1 targets). */
export const SSA_ENDPOINTS = {
  mast: 'https://archive.stsci.edu/ssap/search2.asp',
  irsa: 'https://irsa.ipac.caltech.edu/SSA',
};

/**
 * Query an SSA service for spectra within `pos` of angular `size`.
 *
 * @param {object} opts
 * @param {string} opts.endpoint absolute URL or registry key
 * @param {string} opts.pos "RA Dec" in degrees
 * @param {number} [opts.size=0.05] field size in degrees
 * @param {function} [opts.fetchImpl]
 * @returns {Promise<{resources, rows}>}
 */
export async function querySSA({ endpoint, pos, size = 0.05, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint || !pos) throw new TypeError('querySSA requires `endpoint` and `pos`');
  const url = new URL(resolveEndpoint(endpoint, SSA_ENDPOINTS));
  url.searchParams.set('REQUEST', 'queryData');
  url.searchParams.set('POS', pos);
  url.searchParams.set('SIZE', String(size));

  const res = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/x-votable+xml, text/xml, application/xml' },
  });
  if (!res.ok) throw new Error(`SSA HTTP ${res.status}`);
  const xml = await res.text();
  const resources = parseVOTable(xml);
  return {
    resources,
    rows: resources.flatMap((r) => r.rows),
  };
}