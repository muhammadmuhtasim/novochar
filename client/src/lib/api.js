// Thin typed-ish API client for the Novochar backend.
const BASE = '/api';

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json();
}

export const api = {
  health: () => getJSON('/health'),
  survey: () => getJSON('/survey'),
  stats: () => getJSON('/stats'),
  objects: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.type && params.type !== 'ALL') qs.set('type', params.type);
    if (params.q) qs.set('q', params.q);
    return getJSON(`/objects${qs.toString() ? `?${qs}` : ''}`);
  },
  object: (id) => getJSON(`/objects/${id}`),
  blink: (id, count = 18) => getJSON(`/objects/${id}/blink?count=${count}`),
  neo: (key) => getJSON(`/nasa/neo${key ? `?api_key=${encodeURIComponent(key)}` : ''}`),
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