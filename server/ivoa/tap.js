// IVOA TAP (Table Access Protocol) client - ADQL over VOTable, no Python.
//
// Supports both wire dialects in common use:
//   style 'ivoad' - standard TAP sync (?REQUEST=doQuery&LANG=ADQL&FORMAT=votable&QUERY=...)
//   style 'irsa'  - IRSA TAP (?QUERY=...&FORMAT=votable, spaces as '+', CONTAINS()/CIRCLE())
//
// Any endpoint can be given as an archive registry key (see registry.js) or
// as an absolute URL. Table/schema introspection is provided through
// tapTables()/tapColumns() (TAP_SCHEMA.*) for services that support it.

import { parseVOTable, queryStatus } from './votable.js';
import { ARCHIVES } from './registry.js';

/** Back-compat registry of well-known TAP endpoints. */
export const TAP_ENDPOINTS = {
  vizier: 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap',
  simbad: 'https://simbad.u-strasbg.fr/simbad/sim-tap',
  gaia: 'https://gea.esac.esa.int/tap-server/tap',
  irsa: 'https://irsa.ipac.caltech.edu/TAP',
  heasarc: 'https://heasarc.gsfc.nasa.gov/xamin/vo/tap',
  mast: 'https://mast.stsci.edu/tap',
  eso: 'https://archive.eso.org/tap_obs',
  noirlab: 'https://datalab.noirlab.edu/tap',
};

export function resolveEndpoint(key, registry = TAP_ENDPOINTS) {
  if (!key) throw new TypeError('endpoint required');
  if (/^https?:\/\//.test(key)) return key;
  const url = registry[key];
  if (!url) throw new Error(`unknown endpoint "${key}" (known: ${Object.keys(registry).join(', ')})`);
  return url;
}

/** Resolve a registry key / archive key to a TAP endpoint + style. */
export function tapTarget(archiveOrEndpoint) {
  const arch = ARCHIVES[archiveOrEndpoint];
  if (arch && arch.protocols && arch.protocols.tap) {
    return { endpoint: arch.protocols.tap.endpoint, style: arch.protocols.tap.style };
  }
  return { endpoint: archiveOrEndpoint, style: 'ivoad' };
}

function makeSignal(timeout) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try { return AbortSignal.timeout(timeout); } catch (_) { /* ignore */ }
  }
  return undefined;
}

async function fetchText(url, fetchImpl, timeout) {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/x-votable+xml, text/xml, application/xml' },
    signal: makeSignal(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  return res.text();
}

/** Build a standard TAP sync URL for a given base endpoint. */
function ivoadUrl(base, adql, extra = {}) {
  const u = new URL(String(base).replace(/\/?$/, '') + '/sync');
  u.searchParams.set('REQUEST', 'doQuery');
  u.searchParams.set('LANG', 'ADQL');
  u.searchParams.set('FORMAT', 'votable');
  u.searchParams.set('QUERY', adql);
  for (const [k, v] of Object.entries(extra)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

/** IRSA TAP uses QUERY=... with '+' for spaces and CONTAINS()/CIRCLE(). */
function irsaUrl(base, adql) {
  const q = adql.replace(/ /g, '+').replace(/,/g, ',');
  return `${String(base).replace(/\/?$/, '')}/sync?QUERY=${q}&FORMAT=votable`;
}

/**
 * Run an ADQL query against a TAP /sync endpoint.
 * @param {object} opts { archive|endpoint, query, limit, style, timeout, fetchImpl }
 * @returns {Promise<{endpoint, query, style, status, resources, rows, error?}>}
 */
export async function tapQuery({
  archive,
  endpoint,
  query,
  limit,
  style = 'auto',
  format = 'votable',
  timeout = 30000,
  fetchImpl = globalThis.fetch,
} = {}) {
  let target;
  if (archive) target = tapTarget(archive);
  else if (endpoint) target = { endpoint, style: style === 'auto' ? 'ivoad' : style };
  else throw new TypeError('tapQuery requires `archive` or `endpoint`');

  if (!query) throw new TypeError('tapQuery requires an ADQL `query`');
  const base = resolveEndpoint(target.endpoint, TAP_ENDPOINTS);
  const useStyle = target.style && target.style !== 'auto' ? target.style : (style !== 'auto' ? style : 'ivoad');
  let adql = String(query).trim();
  if (limit && limit > 0 && !/\b(TOP|LIMIT)\b/i.test(adql)) {
    adql = `SELECT TOP ${limit} ${adql.replace(/^select\s+/i, '')}`;
  }

  const url = useStyle === 'irsa' ? irsaUrl(base, adql) : ivoadUrl(base, adql, { FORMAT: format });
  const xml = await fetchText(url, fetchImpl, timeout);
  const resources = parseVOTable(xml);
  const rows = resources.flatMap((r) => r.rows);
  return {
    endpoint: base,
    query: adql,
    style: useStyle,
    status: queryStatus(xml),
    resources,
    rows,
  };
}

/** Discover tables a TAP service exposes (TAP_SCHEMA.tables). */
export async function tapTables(opts = {}) {
  const out = await tapQuery({
    ...opts,
    query: 'SELECT * FROM TAP_SCHEMA.tables',
    style: 'ivoad',
  });
  return out.rows;
}

/** Discover columns a TAP service exposes (TAP_SCHEMA.columns). */
export async function tapColumns(opts = {}) {
  const out = await tapQuery({
    ...opts,
    query: 'SELECT * FROM TAP_SCHEMA.columns',
    style: 'ivoad',
  });
  return out.rows;
}
