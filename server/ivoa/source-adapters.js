import { ARCHIVES } from './registry.js';
import { tapQuery } from './tap.js';

const MAST_API = 'https://mast.stsci.edu/api/v0/invoke';
const NED_SRS = 'https://ned.ipac.caltech.edu/srs/ObjectLookup';
const REGTAP = 'https://dc.g-vo.org/tap';
const LAMBDA_ROOT = 'https://lambda.gsfc.nasa.gov/data/';
const DARTS_ROOT = 'https://data.darts.isas.jaxa.jp/pub/';

export const SOURCE_ADAPTERS = {
  vizier: { name: 'VizieR', protocols: ['tap'], state: 'live-query-verified' },
  simbad: { name: 'SIMBAD', protocols: ['tap', 'resolve'], state: 'live-resolver-verified' },
  gaia: { name: 'Gaia DR3', protocols: ['tap'], state: 'live-query-verified' },
  noirlab: { name: 'NOIRLab Astro Data Lab', protocols: ['tap', 'sia'], state: 'tap-live-verified' },
  eso: { name: 'ESO Science Archive', protocols: ['tap', 'ssa'], state: 'tap-live-verified' },
  irsa: { name: 'IRSA', protocols: ['tap', 'sia'], state: 'adapter-present-live-unverified' },
  mast: { name: 'MAST', protocols: ['rest', 'sia'], state: 'live-rest-query-verified' },
  heasarc: { name: 'HEASARC', protocols: ['tap'], state: 'adapter-present-live-unverified' },
  lambda: { name: 'LAMBDA', protocols: ['file'], state: 'file-route-present-live-unverified' },
  darts: { name: 'DARTS', protocols: ['registry'], state: 'registry-search-no-match-yet' },
    darts: { name: 'DARTS', protocols: ['file', 'registry', 'tap'], state: 'file-route-live-unverified-registry-no-match-yet' },
  ned: { name: 'NED', protocols: ['rest'], state: 'live-object-lookup-verified' },
  esdc: { name: 'ESA Science Archives / ESDC', protocols: ['registry', 'tap'], state: 'live-registry-and-tap-query-verified' },
};

function finite(value, key, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new RangeError(`${key} must be between ${min} and ${max}`);
  return n;
}

async function mastRequest(service, params, fetchImpl) {
  const request = {
    service,
    params,
    format: 'json',
    pagesize: params.pagesize || 500,
    page: params.page || 1,
    removenullcolumns: true,
  };
  delete request.params.pagesize;
  delete request.params.page;
  const response = await fetchImpl(MAST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ request: JSON.stringify(request) }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`MAST HTTP ${response.status}`);
  const data = await response.json();
  return {
    archive: 'mast',
    service,
    status: data.status || 'OK',
    count: Array.isArray(data.data) ? data.data.length : 0,
    fields: data.fields || [],
    rows: data.data || [],
    data,
  };
}

async function queryMast(operation, params, fetchImpl) {
  if (operation === 'cone') {
    const ra = finite(params.ra, 'ra', 0, 360);
    const dec = finite(params.dec, 'dec', -90, 90);
    const radius = finite(params.radius ?? 0.02, 'radius', 0.001, 5);
    const page = Math.floor(finite(params.page ?? 1, 'page', 1, 100000));
    const pagesize = Math.floor(finite(params.pagesize ?? 500, 'pagesize', 1, 5000));
    return mastRequest('Mast.Caom.Cone', { ra, dec, radius, page, pagesize }, fetchImpl);
  }
  if (operation === 'name') {
    const input = String(params.name || '').trim();
    if (!input || input.length > 200) throw new TypeError('name is required (maximum 200 characters)');
    return mastRequest('Mast.Name.Lookup', { input, format: 'json' }, fetchImpl);
  }
  if (operation === 'products') {
    const obsid = String(params.obsid || '').trim();
    if (!/^[\w.,-]{1,200}$/.test(obsid)) throw new TypeError('a valid MAST obsid is required');
    return mastRequest('Mast.Caom.Products', { obsid }, fetchImpl);
  }
  throw new TypeError('MAST operation must be cone, name, or products');
}

async function queryNed(operation, params, fetchImpl) {
  if (operation !== 'name') throw new TypeError('NED currently supports the name operation');
  const name = String(params.name || '').trim();
  if (!name || name.length > 200) throw new TypeError('name is required (maximum 200 characters)');
  const url = new URL(NED_SRS);
  url.searchParams.set('name', name);
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`NED HTTP ${response.status}`);
  const data = await response.json();
  const preferred = data.Preferred || null;
  return {
    archive: 'ned',
    service: NED_SRS,
    status: preferred ? 'OK' : 'EMPTY',
    count: preferred ? 1 : 0,
    fields: [],
    rows: preferred ? [preferred] : [],
    data,
  };
}

async function discoverRegistry(archive, params, fetchImpl) {
  const term = String(params.term || (archive === 'darts' ? 'DARTS' : 'ESA')).trim();
  if (!term || term.length > 80 || /['%_]/.test(term)) throw new TypeError('term must be 1-80 plain characters');
  const query = `SELECT TOP 100 r.ivoid, r.short_name, r.res_title, r.reference_url, c.standard_id, i.access_url, i.intf_type FROM rr.resource AS r JOIN rr.capability AS c ON r.ivoid=c.ivoid JOIN rr.interface AS i ON c.ivoid=i.ivoid WHERE (ivo_hasword(r.res_title, '${term}')=1 OR ivo_hasword(r.short_name, '${term}')=1) AND i.intf_type='vs:paramhttp'`;
  const result = await tapQuery({ endpoint: REGTAP, query, format: 'votable/td', fetchImpl, timeout: 30000 });
  return {
    archive,
    service: REGTAP,
    status: result.status,
    count: result.rows.length,
    fields: result.resources.flatMap((resource) => resource.fields),
    rows: result.rows,
    query: result.query,
  };
}

async function queryDiscoveredTap(archive, params, fetchImpl) {
  const ivoid = String(params.ivoid || '').trim();
  const query = String(params.query || '').trim();
  if (!/^ivo:\/\/[A-Za-z0-9][A-Za-z0-9._:/-]{1,250}$/.test(ivoid)) throw new TypeError('a valid IVOID is required');
  if (!query || query.length > 12000) throw new TypeError('query is required (maximum 12000 characters)');
  const registryQuery = `SELECT TOP 30 r.ivoid, c.standard_id, i.access_url FROM rr.resource AS r JOIN rr.capability AS c ON r.ivoid=c.ivoid JOIN rr.interface AS i ON c.ivoid=i.ivoid WHERE r.ivoid='${ivoid}' AND c.standard_id LIKE 'ivo://ivoa.net/std/tap%' AND i.intf_type='vs:paramhttp'`;
  const discovery = await tapQuery({ endpoint: REGTAP, query: registryQuery, format: 'votable/td', fetchImpl, timeout: 30000 });
  const allowedSuffix = archive === 'esdc' ? '.esa.int' : '.isas.jaxa.jp';
  const service = discovery.rows.find((row) => {
    try {
      const url = new URL(row.access_url);
      return url.protocol === 'https:' && (url.hostname === allowedSuffix.slice(1) || url.hostname.endsWith(allowedSuffix)) && /\/tap\/?$/i.test(url.pathname);
    } catch (_) { return false; }
  });
  if (!service) throw new Error(`no registered HTTPS TAP endpoint found for ${ivoid} under ${archive}`);
  const result = await tapQuery({ endpoint: service.access_url, query, fetchImpl, timeout: 45000 });
  return {
    archive,
    ivoid,
    service: result.endpoint,
    status: result.status,
    count: result.rows.length,
    fields: result.resources.flatMap((resource) => resource.fields),
    rows: result.rows.slice(0, 5000),
    query: result.query,
  };
}

export async function queryArchiveSource({ archive, operation, params = {}, fetchImpl = globalThis.fetch } = {}) {
  if (!SOURCE_ADAPTERS[archive]) throw new TypeError(`unknown archive "${archive}"`);
  if (archive === 'mast') return queryMast(operation, params, fetchImpl);
  if (archive === 'ned') return queryNed(operation, params, fetchImpl);
  if ((archive === 'lambda' || archive === 'darts') && operation === 'index') {
    const root = archive === 'lambda' ? LAMBDA_ROOT : DARTS_ROOT;
    const response = await fetchImpl(root, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${archive.toUpperCase()} HTTP ${response.status}`);
    return { archive, service: root, status: 'OK', contentType: response.headers.get('content-type'), content: await response.text() };
  }
  if ((archive === 'lambda' || archive === 'darts') && operation === 'file') {
    const url = archive === 'lambda' ? lambdaFileUrl(params.path) : dartsFileUrl(params.path);
    return { archive, service: url, status: 'READY', count: 1, rows: [{ url }] };
  }
  if (archive === 'darts' || archive === 'esdc') {
    if (operation === 'discover') return discoverRegistry(archive, params, fetchImpl);
    if (operation === 'tap') return queryDiscoveredTap(archive, params, fetchImpl);
    throw new TypeError(`${archive} operation must be discover or tap`);
  }
  if (archive === 'lambda' || archive === 'darts') throw new TypeError(`${archive.toUpperCase()} operation must be index or file`);
  if (operation === 'tap') {
    if (!ARCHIVES[archive]?.protocols?.tap) throw new TypeError(`${archive} has no registered TAP interface`);
    const query = String(params.query || '').trim();
    if (!query || query.length > 12000) throw new TypeError('query is required (maximum 12000 characters)');
    const result = await tapQuery({ archive, query, limit: params.limit, timeout: 45000, fetchImpl });
    return {
      archive,
      service: result.endpoint,
      status: result.status,
      count: result.rows.length,
      fields: result.resources.flatMap((resource) => resource.fields),
      rows: result.rows.slice(0, 5000),
      query: result.query,
    };
  }
  throw new TypeError(`operation "${operation}" is not supported for ${archive}`);
}

function publicFileUrl(root, path) {
  let relative;
  try {
    relative = decodeURIComponent(String(path || '').trim()).replace(/^\/+/, '');
  } catch (_) {
    throw new TypeError('a valid relative LAMBDA data path is required');
  }
  if (!relative || relative.length > 500 || relative.split('/').some((part) => part === '.' || part === '..') || /^[a-z][a-z\d+.-]*:/i.test(relative) || /[\\?#\u0000-\u001f]/.test(relative)) {
    throw new TypeError('a valid relative LAMBDA data path is required');
  }
  return new URL(relative, root).toString();
}

export function lambdaFileUrl(path) {
  return publicFileUrl(LAMBDA_ROOT, path);
}

export function dartsFileUrl(path) {
  return publicFileUrl(DARTS_ROOT, path);
}

export function mastProductUrl(dataUri) {
  const uri = String(dataUri || '').trim();
  if (!/^mast:(?!\/\/)[\w./+-]{1,500}$/i.test(uri)) throw new TypeError('a valid MAST dataURI is required');
  const url = new URL('https://mast.stsci.edu/api/v0.1/Download/file');
  url.searchParams.set('uri', uri);
  return url.toString();
}