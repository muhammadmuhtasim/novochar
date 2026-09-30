// IVOA SSA (Simple Spectral Access) client.
//
// Returns VOTable rows describing spectra overlapping a sky position, each
// pointing at a retrievable spectrum (SSA_DAP/access_url).

import { parseVOTable, queryStatus } from './votable.js';
import { ARCHIVES } from './registry.js';
import { resolveEndpoint } from './tap.js';

export const SSA_ENDPOINTS = {
  mast: 'https://archive.stsci.edu/ssap/search2.php',
  irsa: 'https://irsa.ipac.caltech.edu/SSA',
  eso: 'https://archive.eso.org/ssa',
};

export async function querySSA({ endpoint, pos, size = 0.05, timeout = 30000, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint || !pos) throw new TypeError('querySSA requires `endpoint` and `pos`');
  let base = endpoint;
  if (ARCHIVES[endpoint] && ARCHIVES[endpoint].protocols && ARCHIVES[endpoint].protocols.ssa) {
    base = ARCHIVES[endpoint].protocols.ssa.endpoint;
  }
  const url = new URL(resolveEndpoint(base, SSA_ENDPOINTS));
  url.searchParams.set('REQUEST', 'queryData');
  url.searchParams.set('POS', pos);
  url.searchParams.set('SIZE', String(size));

  const res = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/x-votable+xml, text/xml, application/xml' },
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined),
  });
  if (!res.ok) throw new Error(`SSA HTTP ${res.status}`);
  const xml = await res.text();
  const resources = parseVOTable(xml);
  const rows = resources.flatMap((r) => r.rows);
  return { resources, rows, status: queryStatus(xml) };
}
