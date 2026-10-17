// SPHEREx mission adapter (Layer 1 - IVOA Ingestion & Access).
//
// Sits on top of the generic SIA / VOTable clients and adds the mission-specific
// knowledge needed to turn an archive query into a *reproducible, bounded*
// retrieval:
//
//   * normalising SIA rows into a stable shape (obs_id repeats across detectors,
//     so (obs_id, detector) is the real key);
//   * selecting a same-detector epoch pair for a change-over-time comparison;
//   * building a bounded cutout URL from a SIA access_url;
//   * reading a FITS MEF header structure (no pixel decoding);
//   * extracting the validated metadata keywords (units, WCS, time, quality);
//   * fetching a cutout with a hard byte ceiling, a timeout, and a SHA-256.
//
// Every network call accepts an injected `fetchImpl`, so the whole module is
// testable offline. See docs/spherex-m2a-validation.md for the validation that
// fixes the units and the WCS caveats this code encodes.

import { createHash } from 'node:crypto';

import { querySIA } from './sia2.js';

/** SPHEREx data currently live in Quick Release 2 (see demo-manifest.json). */
export const SPHEREX_COLLECTION = 'spherex_qr2';

/** Nominal detector pixel scale, arcsec/pixel (SIA s_pixel_scale). */
export const SPHEREX_PIXEL_SCALE_ARCSEC = 6.15;

/** Upper bound on a single cutout request; beyond this we page a mosaic. */
export const SPHEREX_CUTOUT_MAX_SIZE_DEG = 1.0;

/** Hard ceiling on a single cutout download (bytes). */
export const SPHEREX_MAX_CUTOUT_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Row normalisation and epoch selection
// ---------------------------------------------------------------------------

/** `SPHEREx-D2` -> `D2`; also accepts a bare `D2`. Returns null if unknown. */
export function detectorFromRow(row) {
  const raw = row && (row.energy_bandpassname || row.spherex_detector || row.detector);
  if (!raw) return null;
  const m = /(?:^|[-_ ])D?([1-6])$/.exec(String(raw).trim());
  return m ? `D${m[1]}` : null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCloudAccess(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/**
 * Normalise one SIA row into the fields the retrieval path depends on.
 * Tolerance for missing optional fields is deliberate: the row shape differs
 * between SIA2 (VOTable) and the CSV variant, but the key columns are stable.
 */
export function normalizeSpherexRow(row) {
  if (!row || !row.obs_id) throw new TypeError('SPHEREx row requires obs_id');
  const detector = detectorFromRow(row);
  return {
    obsId: String(row.obs_id),
    detector,
    key: detector ? `${row.obs_id}/${detector}` : String(row.obs_id),
    tMin: num(row.t_min),
    tMax: num(row.t_max),
    emMin: num(row.em_min),
    emMax: num(row.em_max),
    bandpass: row.energy_bandpassname || null,
    exposure: num(row.t_exptime),
    ra: num(row.s_ra),
    dec: num(row.s_dec),
    pixelScale: num(row.s_pixel_scale),
    calibLevel: num(row.calib_level),
    collection: row.obs_collection || null,
    publisherDid: row.obs_publisher_did || null,
    accessUrl: row.access_url || null,
    accessFormat: row.access_format || null,
    cloud: parseCloudAccess(row.cloud_access),
  };
}

/**
 * Group normalised rows by (obs_id, detector) and sort each group by t_min.
 * Returns an array of epochs, earliest first.
 */
export function spherexEpochs(rows, { detector } = {}) {
  const byKey = new Map();
  for (const raw of rows) {
    let r;
    try {
      r = normalizeSpherexRow(raw);
    } catch {
      continue;
    }
    if (detector && r.detector !== detector) continue;
    if (r.tMin == null || !r.accessUrl) continue;
    const prev = byKey.get(r.key);
    if (!prev || r.tMin < prev.tMin) byKey.set(r.key, r);
  }
  return [...byKey.values()].sort((a, b) => a.tMin - b.tMin);
}

/**
 * Choose an epoch pair that spans at least `minBaselineDays`, preferring the
 * widest baseline within the given detector. Throws when no qualifying pair
 * exists — an honest failure rather than a silent single-epoch "comparison".
 *
 * @returns {{ first, second, baselineDays, detector }}
 */
export function selectEpochPair(rows, { detector, minBaselineDays = 30 } = {}) {
  if (!Number.isFinite(minBaselineDays) || minBaselineDays < 0) {
    throw new RangeError('minBaselineDays must be a non-negative number');
  }
  const epochs = spherexEpochs(rows, { detector });
  if (epochs.length < 2) {
    throw new Error(`need at least two ${detector || ''} epochs, found ${epochs.length}`.replace('  ', ' '));
  }
  const first = epochs[0];
  let second = null;
  for (const e of epochs.slice(1)) {
    if (e.tMin - first.tMin >= minBaselineDays) second = e;
  }
  if (!second) second = epochs[epochs.length - 1];
  const baselineDays = second.tMin - first.tMin;
  if (baselineDays < minBaselineDays) {
    throw new Error(
      `no ${detector || ''} epoch pair spans ${minBaselineDays} days (widest ${baselineDays.toFixed(2)})`.replace('  ', ' '),
    );
  }
  return { first, second, baselineDays, detector: detector || first.detector, count: epochs.length, epochs };
}

/** Query IRSA SIA for a SPHEREx field, returning normalised epoch rows. */
export async function querySpherexField({
  endpoint = 'irsa',
  ra,
  dec,
  size = 0.05,
  collection = SPHEREX_COLLECTION,
  timeout = 30000,
  fetchImpl = globalThis.fetch,
  detector,
} = {}) {
  if (![ra, dec].every(Number.isFinite)) throw new TypeError('querySpherexField requires numeric ra and dec');
  const pos = `circle ${ra} ${dec} ${size}`;
  const { rows, status } = await querySIA({ endpoint, pos, size, collection, timeout, fetchImpl });
  return { status, rows, epochs: spherexEpochs(rows, { detector }) };
}

// ---------------------------------------------------------------------------
// Bounded cutout URL
// ---------------------------------------------------------------------------

/**
 * Append a bounded cutout request to a SIA `access_url`.
 * The literal comma in `center` matches the form verified against the live
 * service (docs/spherex-m2a-validation.md) — URLSearchParams would emit %2C.
 */
export function buildCutoutUrl(accessUrl, { ra, dec, sizeDeg } = {}) {
  if (!accessUrl || typeof accessUrl !== 'string') throw new TypeError('buildCutoutUrl requires accessUrl');
  if (![ra, dec].every(Number.isFinite)) throw new TypeError('buildCutoutUrl requires numeric ra and dec');
  if (!Number.isFinite(sizeDeg) || sizeDeg <= 0) throw new RangeError('sizeDeg must be a positive number');
  if (sizeDeg > SPHEREX_CUTOUT_MAX_SIZE_DEG) {
    throw new RangeError(`sizeDeg ${sizeDeg} exceeds the ${SPHEREX_CUTOUT_MAX_SIZE_DEG} deg cutout ceiling`);
  }
  const sep = accessUrl.includes('?') ? '&' : '?';
  return `${accessUrl}${sep}center=${ra},${dec}&size=${sizeDeg}`;
}

/** Stable, filesystem-safe cache key for an (exposure, detector, size) cutout. */
export function cutoutKey({ obsId, detector, sizeDeg } = {}) {
  if (!obsId) throw new TypeError('cutoutKey requires obsId');
  if (!detector) throw new TypeError('cutoutKey requires detector');
  if (!Number.isFinite(sizeDeg) || sizeDeg <= 0) throw new RangeError('cutoutKey requires a positive sizeDeg');
  return `${obsId}_${detector}_${sizeDeg}deg`;
}

// ---------------------------------------------------------------------------
// FITS header / MEF structure (no pixel decoding)
// ---------------------------------------------------------------------------

const HEADER_DECODER = new TextDecoder('latin1');

function parseCard(card) {
  const key = card.slice(0, 8).trim();
  if (key === 'END') return { key: 'END', value: null, comment: '' };
  if (key === '' || card[8] !== '=') {
    return { key: key || null, value: null, comment: card.slice(8).trim() };
  }
  const rest = card.slice(10);
  const s = rest.trim();
  let value = null;
  let comment = '';
  if (s.startsWith("'")) {
    let i = 1;
    let out = '';
    for (; i < s.length; i++) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i++;
          continue;
        }
        i++;
        break;
      }
      out += s[i];
    }
    value = out.replace(/\s+$/, '');
    const slash = s.indexOf('/', i);
    comment = slash >= 0 ? s.slice(slash + 1).trim() : '';
  } else {
    const slash = s.indexOf('/');
    const raw = (slash >= 0 ? s.slice(0, slash) : s).trim();
    comment = slash >= 0 ? s.slice(slash + 1).trim() : '';
    if (raw === 'T') value = true;
    else if (raw === 'F') value = false;
    else if (raw === '') value = null;
    else if (/^[+-]?(\d+\.?\d*|\.\d+)[dDeE]?[+-]?\d*$/.test(raw) && /[.dDeE]/.test(raw)) {
      const n = Number(raw.replace(/[dD]/, 'e'));
      value = Number.isFinite(n) ? n : raw;
    } else if (/^[+-]?\d+$/.test(raw)) {
      value = parseInt(raw, 10);
    } else {
      const n = Number(raw);
      value = Number.isFinite(n) ? n : raw;
    }
  }
  return { key, value, comment };
}

function readHeader(bytes, start) {
  const keywords = {};
  const cards = [];
  let pos = start;
  let foundEnd = false;
  while (pos + 2880 <= bytes.length) {
    const text = HEADER_DECODER.decode(bytes.subarray(pos, pos + 2880));
    for (let i = 0; i < 36; i++) {
      const card = text.slice(i * 80, i * 80 + 80);
      const parsed = parseCard(card);
      if (parsed.key === 'END') {
        foundEnd = true;
        break;
      }
      if (parsed.key && keywords[parsed.key] === undefined) keywords[parsed.key] = parsed.value;
      if (parsed.key) cards.push(parsed);
    }
    pos += 2880;
    if (foundEnd) break;
  }
  return { keywords, cards, headerEnd: pos, headerComplete: foundEnd };
}

function hduDataBytes(keywords) {
  const naxis = keywords.NAXIS ?? 0;
  if (!naxis) return 0;
  let prod = 1;
  for (let i = 1; i <= naxis; i++) prod *= keywords[`NAXIS${i}`] ?? 0;
  const bitpix = Math.abs(keywords.BITPIX ?? 8) || 8;
  const pcount = keywords.PCOUNT ?? 0;
  const gcount = keywords.GCOUNT ?? 1;
  return (bitpix / 8) * gcount * (pcount + prod);
}

/**
 * Walk a FITS MEF header structure without touching pixel data.
 * Returns one entry per HDU up to `maxHdus`, each with its keyword map and byte
 * offsets. A truncated file is reported (`headerComplete:false`), not thrown —
 * the validation traps in M2-A showed that cutouts can silently truncate.
 */
export function readFitsStructure(bytes, { maxHdus = 16 } = {}) {
  if (!bytes || typeof bytes.length !== 'number') throw new TypeError('readFitsStructure requires a byte array');
  const hdus = [];
  let offset = 0;
  while (offset + 2880 <= bytes.length && hdus.length < maxHdus) {
    const headerStart = offset;
    const { keywords, cards, headerEnd, headerComplete } = readHeader(bytes, offset);
    const dataBytes = hduDataBytes(keywords);
    hdus.push({
      index: hdus.length,
      extension: keywords.XTENSION ?? 'PRIMARY',
      keywords,
      cards,
      headerStart,
      dataStart: headerEnd,
      dataBytes,
      headerComplete,
    });
    if (!headerComplete) break;
    offset = headerEnd + Math.ceil(dataBytes / 2880) * 2880;
  }
  return hdus;
}

/** Extract the validated metadata keywords from one HDU structure entry. */
export function extractFitsMetadata(hdu) {
  const k = hdu.keywords || {};
  const pair = (a, b) => [k[a] ?? null, k[b] ?? null];
  return {
    extension: hdu.extension,
    extname: k.EXTNAME ?? null,
    bitpix: k.BITPIX ?? null,
    naxis: k.NAXIS ?? 0,
    shape: [k.NAXIS1, k.NAXIS2, k.NAXIS3].filter((x) => x != null),
    bunit: k.BUNIT ?? null,
    ctype: pair('CTYPE1', 'CTYPE2'),
    crpix: pair('CRPIX1', 'CRPIX2'),
    crval: pair('CRVAL1', 'CRVAL2'),
    cd: [[k.CD1_1 ?? null, k.CD1_2 ?? null], [k.CD2_1 ?? null, k.CD2_2 ?? null]],
    radesys: k.RADESYS ?? null,
    mjdObs: k['MJD-OBS'] ?? null,
    dateObs: k['DATE-OBS'] ?? null,
    detector: k.DETECTOR ?? k.DETECTORID ?? null,
    band: k.BAND ?? k.SPXBAND ?? null,
    // SPHEREx stamps the SSDC pipeline version in VERSION (e.g. '6.4+psffix1').
    pipeline: k.VERSION ?? k.PIPELINE ?? k.PIPEVERS ?? k.CALIBVER ?? null,
    exptime: k.EXPTIME ?? k.TEXPTIME ?? null,
    checksum: k.CHECKSUM ?? null,
    datasum: k.DATASUM ?? null,
  };
}

/** Structure + metadata for every HDU in a cutout. */
export function readFits(bytes, { maxHdus = 16 } = {}) {
  return readFitsStructure(bytes, { maxHdus }).map(((h) => ({ ...h, metadata: extractFitsMetadata(h) })));
}

// ---------------------------------------------------------------------------
// Bounded retrieval
// ---------------------------------------------------------------------------

export async function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readBounded(res, maxBytes) {
  const declared = Number(res.headers && res.headers.get ? res.headers.get('content-length') : null);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RangeError(`cutout content-length ${declared} exceeds ceiling ${maxBytes}`);
  }
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        if (typeof reader.cancel === 'function') await reader.cancel();
        throw new RangeError(`cutout stream exceeded ceiling ${maxBytes}`);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new RangeError(`cutout body ${buf.length} exceeds ceiling ${maxBytes}`);
  return buf;
}

/**
 * Fetch a cutout with a hard byte ceiling, a timeout and a SHA-256.
 * Returns `{ bytes, byteLength, sha256, contentType, url }`.
 */
export async function fetchCutout({
  url,
  maxBytes = SPHEREX_MAX_CUTOUT_BYTES,
  timeout = 30000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!url) throw new TypeError('fetchCutout requires url');
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be positive');
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined;
  const res = await fetchImpl(url, { signal, headers: { Accept: 'application/fits, application/octet-stream' } });
  if (!res.ok) throw new Error(`cutout HTTP ${res.status} for ${url}`);
  const bytes = await readBounded(res, maxBytes);
  return {
    bytes,
    byteLength: bytes.length,
    sha256: await sha256Hex(bytes),
    contentType: (res.headers && res.headers.get ? res.headers.get('content-type') : null) || null,
    url,
  };
}

/** Constant-shape SHA-256 check; returns { ok, expected, actual }. */
export async function verifyCutout(bytes, expectedSha256) {
  const actual = await sha256Hex(bytes);
  return { ok: actual === expectedSha256, expected: expectedSha256, actual };
}
