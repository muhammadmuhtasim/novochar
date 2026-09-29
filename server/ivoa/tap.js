// IVOA TAP (Table Access Protocol) client — ADQL queries over VOTable.
//
// Uses the global fetch (Node 18+). No Python / PyVO dependency.

import { parseVOTable } from './votable.js';

/** Registry of well-known TAP endpoints (Layer-1 targets). */
export const TAP_ENDPOINTS = {
  vizier: 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap',
  simbad: 'https://simbad.u-strasbg.fr/simbad/sim-tap',
  gaia: 'https://gea.esac.esa.int/tap-server/tap/sync',
  irsa: 'https://irsa.ipac.caltech.edu/TAP',
  heasarc: 'https://heasarc.gsfc.nasa.gov/xamin/vo/tap',
  mast: 'https://mast.stsci.edu/tap',
};

/**
 * Run an ADQL query against a TAP /sync endpoint.
 *
 * @param {object} opts
 * @param {string} [opts.endpoint='vizier'] registry key or absolute URL
 * @param {string} opts.query ADQL SELECT ...
 * @param {number} [opts.limit] rows returned by the archive (advisory)
 * @param {function} [opts.fetchImpl=globalThis.fetch] injectable for tests
 * @returns {Promise<{endpoint, query, resources, rows}>}
 */
export async function tapQuery({ endpoint = 'vizier', query, limit, fetchImpl = globalThis.fetch } = {}) {
  if (!query) throw new TypeError('tapQuery requires an ADQL `query`');
  const base = resolveEndpoint(endpoint, TAP_ENDPOINTS);
  let adql = String(query).trim();
  if (limit && limit > 0 && !/\b(TOP|LIMIT)\b/i.test(adql)) adql = `SELECT TOP ${limit} ${adql.replace(/^select\s+/i, '')}`;

  const url = new URL(base);
  url.searchParams.set('REQUEST', 'doQuery');
  url.searchParams.set('LANG', 'ADQL');
  url.searchParams.set('QUERY', adql);
  url.searchParams.set('FORMAT', 'votable');

  const res = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/x-votable+xml, text/xml, application/xml' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TAP ${base} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const xml = await res.text();
  const resources = parseVOTable(xml);
  const rows = resources.flatMap((r) => r.rows);
  return { endpoint: base, query: adql, resources, rows };
}

export function resolveEndpoint(key, registry) {
  if (!key) throw new TypeError('endpoint required');
  if (/^https?:\/\//.test(key)) return key;
  const url = registry[key];
  if (!url) throw new Error(`unknown endpoint "${key}" (known: ${Object.keys(registry).join(', ')})`);
  return url;
}