// Thin typed-ish API client for the Novochar backend.
const BASE = '/api';

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json();
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
  survey: () => getJSON('/survey'),
  stats: () => getJSON('/stats'),
  objects: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.type && params.type !== 'ALL') qs.set('type', params.type);
    if (params.band && params.band !== 'ALL') qs.set('band', params.band);
    if (params.q) qs.set('q', params.q);
    return getJSON(`/objects${qs.toString() ? `?${qs}` : ''}`);
  },
  object: (id) => getJSON(`/objects/${id}`),
  blink: (id, count = 18) => getJSON(`/objects/${id}/blink?count=${count}`),
  presets: () => getJSON('/presets'),
  neo: (key) => getJSON(`/nasa/neo${key ? `?api_key=${encodeURIComponent(key)}` : ''}`),
  spectra: (id) => getJSON(`/spectra/${id}`),
  fieldHeatmap: (nside = 64) => getJSON(`/field/heatmap?nside=${nside}`),
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
  // Real sky imagery (DSS cutout proxied through the server).
  skyImageUrl: (ra, dec, size, { aspect = 1, width = 480 } = {}) =>
    `${BASE}/sky/image?${new URLSearchParams({ ra, dec, size, aspect, width })}`,
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