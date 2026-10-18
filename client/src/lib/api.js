// Thin typed-ish API client for the Novochar backend.
const BASE = '/api';
// Deterministic dataset is baked into client/dist/data at build time and served
// from Vercel's edge CDN, so first paint never blocks on a serverless cold
// start. We try the static file first and fall back to the live API only if it
// is missing (e.g. local `vite dev` before any build).
const DATA = '/data';

async function getJSON(path, { signal } = {}) {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) {
    // Carry the server's error code through so callers can react to specific
    // failures (e.g. a superseded shell cursor) instead of matching on text.
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `API ${path} -> ${res.status}`);
    error.status = res.status;
    error.code = body.code ?? null;
    error.reason = body.reason ?? null;
    throw error;
  }
  return res.json();
}

// Try a precomputed static JSON file; fall back to the live API on any error.
async function staticOrApi(dataFile, apiPath) {
  try {
    const res = await fetch(`${DATA}/${dataFile}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`static ${dataFile} -> ${res.status}`);
    return await res.json();
  } catch {
    return getJSON(apiPath);
  }
}

async function postJSON(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const result = await res.json().catch(() => ({}));
    throw new Error(result.error || `API ${path} -> ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => getJSON('/health'),
  survey: () => staticOrApi('survey.json', '/survey'),
  stats: () => staticOrApi('stats.json', '/stats'),
  objects: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.type && params.type !== 'ALL') qs.set('type', params.type);
    if (params.band && params.band !== 'ALL') qs.set('band', params.band);
    if (params.q) qs.set('q', params.q);
    // No filters -> deterministic full dataset is precomputed at build time.
    if (!qs.toString()) return staticOrApi('objects.json', '/objects');
    return getJSON(`/objects?${qs}`);
  },
  object: (id) => getJSON(`/objects/${id}`),
  // Star catalogue for the Mode A sphere. The active catalogue source is chosen
  // in server/catalog/index.js (currently the redistributable fixture, pending a
  // production catalogue's licence terms). Kept separate from the simulated
  // survey `objects` so the two never blur together.
  stars: () => staticOrApi('stars.json', '/catalog/stars'),
  star: (id) => getJSON(`/catalog/stars/${encodeURIComponent(id)}`),
  // Sun-centered spherical-shell query for Mode B Observe. The server does the
  // candidate retrieval and exact membership from the shared @novochar/astro
  // predicates; the client only asks for a band and the layers it should show.
  shell: ({ radius, thickness, unit, include, limit, cursor, sources } = {}, { signal } = {}) => {
    const qs = new URLSearchParams();
    if (radius !== undefined) qs.set('radius', String(radius));
    if (thickness !== undefined) qs.set('thickness', String(thickness));
    if (unit) qs.set('unit', unit);
    if (include) qs.set('include', include);
    if (limit !== undefined) qs.set('limit', String(limit));
    if (cursor !== undefined) qs.set('cursor', String(cursor));
    if (sources) qs.set('sources', sources);
    return getJSON(`/observe/shell?${qs.toString()}`, { signal });
  },
  blink: (id, count = 18) => getJSON(`/objects/${id}/blink?count=${count}`),
  presets: () => staticOrApi('presets.json', '/presets'),
  neo: (key) => getJSON(`/nasa/neo${key ? `?api_key=${encodeURIComponent(key)}` : ''}`),
  spectra: (id) => getJSON(`/spectra/${id}`),
  fieldHeatmap: (nside = 64) =>
    nside === 64 ? staticOrApi('heatmap/64.json', `/field/heatmap?nside=${nside}`) : getJSON(`/field/heatmap?nside=${nside}`),
  ivoa: () => getJSON('/ivoa'),
  archives: () => getJSON('/archives'),
  archiveQuery: (archive, operation, params = {}) =>
    postJSON(`/archives/${encodeURIComponent(archive)}/query`, { operation, params }),
  lambdaFile: (path) => `${BASE}/archives/lambda/file?${new URLSearchParams({ path })}`,
    dartsFile: (path) => `${BASE}/archives/darts/file?${new URLSearchParams({ path })}`,
    mastFile: (uri) => `${BASE}/archives/mast/file?${new URLSearchParams({ uri })}`,
  ivoaProbe: () => getJSON('/ivoa/probe'),
  ivoaGaiaMotion: (ra, dec, radius = 0.1, epoch = 2025) =>
    getJSON(`/ivoa/gaia/motion?${new URLSearchParams({ ra, dec, radius, epoch })}`),
  ivoaTap: (archive, query, limit) =>
    getJSON(`/ivoa/tap?archive=${encodeURIComponent(archive)}&query=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ''}`),
  ivoaTapTables: (archive) => getJSON(`/ivoa/tap/tables?archive=${encodeURIComponent(archive)}`),
  ivoaSia2: (archive, pos, size) =>
    getJSON(`/ivoa/sia2?archive=${encodeURIComponent(archive)}&pos=${encodeURIComponent(pos)}${size ? `&size=${size}` : ''}`),
  ivoaSsa: (archive, pos, size) =>
    getJSON(`/ivoa/ssa?archive=${encodeURIComponent(archive)}&pos=${encodeURIComponent(pos)}${size ? `&size=${size}` : ''}`),
  ivoaResolve: (name, service = 'sesame') => getJSON(`/ivoa/resolve?name=${encodeURIComponent(name)}${service ? `&service=${service}` : ''}`),
  // Real reprojected SPHEREx products (M3-C): metadata only — the pixels come
  // back as octet-stream from `epoch.raster`, which is a full /api path.
  spherexProducts: () => getJSON('/spherex/products'),
};

export function fmtRA(ra) {
  ra = ((ra % 360) + 360) % 360;
  const h = Math.floor(ra / 15);
  const m = Math.floor((ra / 15 - h) * 60);
  const s = Math.floor((((ra / 15 - h) * 60 - m) * 60) * 10) / 10;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(4, '0')}s`;
}

export function fmtDec(dec) {
  const sign = dec < 0 ? '-' : '+';
  dec = Math.abs(dec);
  const d = Math.floor(dec);
  const m = Math.floor((dec - d) * 60);
  const s = Math.floor(((dec - d) * 60 - m) * 60 * 10) / 10;
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(4, '0')}″`;
}