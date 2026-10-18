// Unit tests for the SPHEREx mission adapter.
//
// No network is touched: every retrieval path takes an injected fetchImpl, and
// the FITS fixtures are synthesised in-memory (no binary committed).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectorFromRow,
  normalizeSpherexRow,
  spherexEpochs,
  selectEpochPair,
  buildCutoutUrl,
  cutoutKey,
  readFitsStructure,
  readFits,
  readFitsImage,
  normalizeFitsWcs,
  extractFitsMetadata,
  fitsFileMetadata,
  fetchCutout,
  verifyCutout,
  sha256Hex,
  SPHEREX_CUTOUT_MAX_SIZE_DEG,
} from './spherex.js';

// --- synthetic FITS helpers -------------------------------------------------

function cardText(key, value) {
  let v;
  if (typeof value === 'string') v = `'${value.replace(/'/g, "''")}'`;
  else if (typeof value === 'boolean') v = value ? 'T' : 'F';
  else v = String(value);
  return `${key.padEnd(8)}= ${v}`;
}

function headerBlock(cards) {
  const all = [...cards, 'END'].map((c) => c.padEnd(80, ' ').slice(0, 80));
  while (all.length < 36) all.push(' '.repeat(80));
  return new Uint8Array(Buffer.from(all.join(''), 'latin1'));
}

function buildFits(hdus) {
  const parts = [];
  for (const h of hdus) {
    parts.push(headerBlock(h.cards.map((c) => c.padEnd(80, ' ').slice(0, 80))));
    const n = h.dataBytes || 0;
    if (n) parts.push(new Uint8Array(Math.ceil(n / 2880) * 2880));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const IMAGE_HDU = {
  cards: [
    "XTENSION= 'IMAGE   '",
    'BITPIX  =                  -32',
    'NAXIS   =                    2',
    'NAXIS1  =                    4',
    'NAXIS2  =                    3',
    "EXTNAME = 'IMAGE   '",
    "BUNIT   = 'MJy / sr'",
    'CRPIX1  =                  2.5',
    'CRPIX2  =                  1.5',
    'CRVAL1  =                270.0',
    'CRVAL2  =                 66.5',
    "CTYPE1  = 'RA---TAN-SIP'",
    'MJD-OBS =           60794.160',
    "DATE-OBS= '2025-04-29T03:50:28.360'",
    'DETECTOR=                    2',
  ],
  dataBytes: 4 * 3 * 4,
};

const FIXTURE_FITS = buildFits([
  {
    cards: [
      'SIMPLE  =                    T',
      'BITPIX  =                    8',
      'NAXIS   =                    0',
      // The SSDC pipeline version lives on the PRIMARY header, as in real files.
      "VERSION = '6.4+psffix1'",
    ],
  },
  IMAGE_HDU,
]);

// --- rows -------------------------------------------------------------------

const D2_A = {
  obs_id: '2025W18_1B_0095_2',
  energy_bandpassname: 'SPHEREx-D2',
  t_min: 60794.16,
  t_max: 60794.161,
  em_min: 1.1033e-6,
  em_max: 1.6499e-6,
  s_ra: 270.28,
  s_dec: 66.33,
  s_pixel_scale: 6.15,
  calib_level: 2,
  obs_collection: 'spherex_qr2',
  obs_publisher_did: 'ivo://irsa.ipac/spherex_qr2?2025W18_1B_0095_2/D2',
  access_url: 'https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/x.fits',
  access_format: 'image/fits',
  cloud_access: '{"aws":{"bucket_name":"nasa-irsa-spherex","key":"qr2/x.fits","region":"us-east-1"}}',
};
const D2_B = { ...D2_A, obs_id: '2025W46_2A_0537_1', t_min: 60995.088835, t_max: 60995.09 };
const D2_B_SAME_EPOCH_ROW = { ...D2_B, t_min: 60995.5, t_max: 60995.51 }; // duplicate obs_id+detector
const D5_A = { ...D2_A, energy_bandpassname: 'SPHEREx-D5', obs_id: '2025W18_1B_0095_2' };

test('detectorFromRow parses the SIA bandpass name', () => {
  assert.equal(detectorFromRow({ energy_bandpassname: 'SPHEREx-D2' }), 'D2');
  assert.equal(detectorFromRow({ spherex_detector: 'D5' }), 'D5');
  assert.equal(detectorFromRow({ detector: 'D1' }), 'D1');
  assert.equal(detectorFromRow({ energy_bandpassname: 'SPHEREx-D7' }), null);
  assert.equal(detectorFromRow({}), null);
});

test('normalizeSpherexRow builds a (obs_id, detector) key and numeric fields', () => {
  const r = normalizeSpherexRow(D2_A);
  assert.equal(r.obsId, '2025W18_1B_0095_2');
  assert.equal(r.detector, 'D2');
  assert.equal(r.key, '2025W18_1B_0095_2/D2');
  assert.equal(r.tMin, 60794.16);
  assert.equal(r.emMin, 1.1033e-6);
  assert.equal(r.cloud.aws.region, 'us-east-1');
  assert.throws(() => normalizeSpherexRow({}), TypeError);
});

test('spherexEpochs dedupes by (obs_id,detector), filters detector, sorts by time', () => {
  const rows = [D2_B_SAME_EPOCH_ROW, D2_B, D2_A, D5_A];
  const d2 = spherexEpochs(rows, { detector: 'D2' });
  assert.equal(d2.length, 2);
  assert.deepEqual(d2.map((e) => e.obsId), ['2025W18_1B_0095_2', '2025W46_2A_0537_1']);
  // duplicate obs_id+detector keeps the earliest t_min
  assert.equal(d2[1].tMin, 60995.088835);
  const d5 = spherexEpochs(rows, { detector: 'D5' });
  assert.equal(d5.length, 1);
});

test('selectEpochPair picks the widest same-detector baseline', () => {
  const pair = selectEpochPair([D2_A, D2_B, D5_A], { detector: 'D2', minBaselineDays: 30 });
  assert.equal(pair.baselineDays.toFixed(2), '200.93');
  assert.equal(pair.first.obsId, '2025W18_1B_0095_2');
  assert.equal(pair.second.obsId, '2025W46_2A_0537_1');
});

test('selectEpochPair fails honestly when no pair qualifies', () => {
  assert.throws(() => selectEpochPair([D2_A], { detector: 'D2' }), /at least two/);
  assert.throws(() => selectEpochPair([D2_A, D2_B], { detector: 'D2', minBaselineDays: 5000 }), /spans 5000/);
  assert.throws(() => selectEpochPair([D2_A, D2_B], { detector: 'D2', minBaselineDays: -1 }), RangeError);
});

test('buildCutoutUrl appends a bounded cutout request verbatim (comma unencoded)', () => {
  const url = buildCutoutUrl(D2_A.access_url, { ra: 270, dec: 66.5, sizeDeg: 0.5 });
  assert.equal(url, `${D2_A.access_url}?center=270,66.5&size=0.5`);
  const withQuery = buildCutoutUrl(`${D2_A.access_url}?foo=1`, { ra: 270, dec: 66.5, sizeDeg: 0.5 });
  assert.ok(withQuery.includes('&center=270,66.5&size=0.5'));
  assert.throws(() => buildCutoutUrl(D2_A.access_url, { ra: 270, dec: 66.5, sizeDeg: SPHEREX_CUTOUT_MAX_SIZE_DEG + 0.1 }), RangeError);
  assert.throws(() => buildCutoutUrl(D2_A.access_url, { ra: 270, dec: 66.5, sizeDeg: 0 }), RangeError);
  assert.throws(() => buildCutoutUrl(D2_A.access_url, { ra: NaN, dec: 66.5, sizeDeg: 0.5 }), TypeError);
});

test('cutoutKey is stable and validated', () => {
  assert.equal(cutoutKey({ obsId: 'X', detector: 'D2', sizeDeg: 0.5 }), 'X_D2_0.5deg');
  assert.throws(() => cutoutKey({ detector: 'D2', sizeDeg: 0.5 }), TypeError);
  assert.throws(() => cutoutKey({ obsId: 'X', sizeDeg: 0.5 }), TypeError);
});

// --- FITS structure ---------------------------------------------------------

test('readFitsStructure walks HDUs and sizes data without decoding it', () => {
  const hdus = readFitsStructure(FIXTURE_FITS);
  assert.equal(hdus.length, 2);
  assert.equal(hdus[0].extension, 'PRIMARY');
  assert.equal(hdus[0].dataBytes, 0);
  assert.equal(hdus[1].extension, 'IMAGE');
  assert.equal(hdus[1].dataBytes, 48); // 4 * 3 * 4 bytes, unpadded
  assert.equal(hdus[1].headerComplete, true);
  assert.equal(hdus[1].dataStart - hdus[1].headerStart, 2880);
});

test('extractFitsMetadata normalises the validated keywords', () => {
  const [, image] = readFits(FIXTURE_FITS);
  const m = image.metadata;
  assert.equal(m.extname, 'IMAGE');
  assert.equal(m.bunit, 'MJy / sr');
  assert.deepEqual(m.shape, [4, 3]);
  assert.deepEqual(m.crpix, [2.5, 1.5]);
  assert.deepEqual(m.crval, [270, 66.5]);
  assert.equal(m.ctype[0], 'RA---TAN-SIP');
  assert.equal(m.mjdObs, 60794.16);
  assert.equal(m.detector, 2);
});

test('fitsFileMetadata reads global keywords from the PRIMARY header', () => {
  const hdus = readFits(FIXTURE_FITS);
  const file = fitsFileMetadata(hdus);
  assert.equal(file.version, '6.4+psffix1');
  assert.equal(file.hduCount, 2);
  // The extension header does not repeat the pipeline version.
  assert.equal(hdus[1].metadata.pipeline, null);
});

test('normalizeSpherexRow is idempotent (accepts normalised epochs)', () => {
  const once = normalizeSpherexRow(D2_A);
  const twice = normalizeSpherexRow(once);
  assert.deepEqual(twice, once);
});

test('readFitsStructure flags a truncated header instead of throwing', () => {
  const truncated = FIXTURE_FITS.slice(0, 2880 + 100);
  const hdus = readFitsStructure(truncated);
  assert.equal(hdus.length, 1);
  assert.equal(hdus[0].headerComplete, true);
});

// --- bounded retrieval ------------------------------------------------------

function fakeResponse({ ok = true, status = 200, body, contentType = 'application/fits', contentLength } = {}) {
  const headers = {
    get: (k) => {
      const key = k.toLowerCase();
      if (key === 'content-type') return contentType;
      if (key === 'content-length') return contentLength == null ? null : String(contentLength);
      return null;
    },
  };
  const buf = body ? Buffer.from(body) : Buffer.alloc(0);
  return {
    ok,
    status,
    headers,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    body: undefined,
  };
}

test('fetchCutout returns bytes, length and sha256', async () => {
  const bytes = Buffer.from('FITS-BYTES');
  const out = await fetchCutout({ url: 'https://x/y.fits', fetchImpl: async () => fakeResponse({ body: bytes }) });
  assert.equal(out.byteLength, bytes.length);
  assert.equal(out.sha256, await sha256Hex(bytes));
  assert.equal(out.contentType, 'application/fits');
});

test('fetchCutout rejects a non-OK response, a declared-oversize body and an actual-oversize body', async () => {
  await assert.rejects(() => fetchCutout({ url: 'https://x/y.fits', fetchImpl: async () => fakeResponse({ ok: false, status: 500 }) }), /HTTP 500/);
  await assert.rejects(
    () => fetchCutout({ url: 'https://x/y.fits', maxBytes: 4, fetchImpl: async () => fakeResponse({ body: 'abc', contentLength: 100 }) }),
    /content-length 100 exceeds ceiling 4/,
  );
  await assert.rejects(
    () => fetchCutout({ url: 'https://x/y.fits', maxBytes: 4, fetchImpl: async () => fakeResponse({ body: 'abcdefghij' }) }),
    /exceeds ceiling 4/,
  );
});

test('fetchCutout enforces the ceiling on a streaming body and cancels it', async () => {
  let cancelled = false;
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
  let i = 0;
  const reader = {
    read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
    cancel: async () => {
      cancelled = true;
    },
  };
  const res = { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => reader } };
  await assert.rejects(() => fetchCutout({ url: 'u', maxBytes: 4, fetchImpl: async () => res }), /stream exceeded ceiling 4/);
  assert.equal(cancelled, true);
});

test('verifyCutout compares a constant-shape hash', async () => {
  const bytes = Buffer.from('abc');
  const good = await sha256Hex(bytes);
  assert.deepEqual(await verifyCutout(bytes, good), { ok: true, expected: good, actual: good });
  const bad = await verifyCutout(bytes, 'deadbeef');
  assert.equal(bad.ok, false);
  assert.equal(bad.expected, 'deadbeef');
});

// --- FITS pixel decoding (M3-C) ---------------------------------------------
//
// The header-only reader above stops at structure. The viewer needs pixels, so
// `readFitsImage` decodes exactly the three BITPIX layouts that appear in
// SPHEREx products and the sidecar's outputs. These fixtures carry real
// big-endian bytes — a byte-swap bug has to fail here.

function pixelFits({ bitpix, nx, ny, values, extraCards = [] }) {
  const valueBytes = Math.abs(bitpix) / 8;
  const data = Buffer.alloc(nx * ny * valueBytes);
  values.forEach((v, i) => {
    if (bitpix === -32) data.writeFloatBE(v, i * 4);
    else if (bitpix === 32) data.writeInt32BE(v, i * 4);
    else data.writeUInt8(v, i);
  });
  const header = headerBlock([
    "XTENSION= 'IMAGE   '",
    `BITPIX  = ${String(bitpix).padStart(20)}`,
    'NAXIS   =                    2',
    `NAXIS1  = ${String(nx).padStart(20)}`,
    `NAXIS2  = ${String(ny).padStart(20)}`,
    'PCOUNT  =                    0',
    'GCOUNT  =                    1',
    "EXTNAME = 'IMAGE'",
    ...extraCards,
  ]);
  const padded = new Uint8Array(Math.ceil(data.length / 2880) * 2880);
  padded.set(data, 0);
  const out = new Uint8Array(header.length + padded.length);
  out.set(header, 0);
  out.set(padded, header.length);
  return out;
}

const imageHduOf = (fits) => readFitsStructure(fits).find((h) => h.keywords.EXTNAME === 'IMAGE');

test('readFitsImage decodes big-endian float32 pixels row-major', () => {
  const values = [-1.5, 0, 1.25, 100, 3.5, -2, 0.125, 7, 8, 9, 10, 11];
  const fits = pixelFits({ bitpix: -32, nx: 4, ny: 3, values });
  const { nx, ny, data } = readFitsImage(fits, imageHduOf(fits));
  assert.equal(nx, 4);
  assert.equal(ny, 3);
  assert.equal(data.constructor, Float32Array);
  assert.deepEqual([...data], values, 'NAXIS1 varies fastest, byte order swapped');
});

test('readFitsImage decodes signed int32 and unsigned uint8 planes', () => {
  const ints = [-1, 0, 1, 8388608, -8388609, 2228288];
  const intFits = pixelFits({ bitpix: 32, nx: 3, ny: 2, values: ints });
  assert.deepEqual([...readFitsImage(intFits, imageHduOf(intFits)).data], ints);

  const bytes = [0, 1, 1, 0, 255, 128];
  const byteFits = pixelFits({ bitpix: 8, nx: 3, ny: 2, values: bytes });
  const mask = readFitsImage(byteFits, imageHduOf(byteFits));
  assert.equal(mask.data.constructor, Uint8Array, 'uint8 needs no byte swap');
  assert.deepEqual([...mask.data], bytes);
});

test('readFitsImage refuses a truncated HDU instead of returning short data', () => {
  const fits = pixelFits({ bitpix: -32, nx: 4, ny: 3, values: new Array(12).fill(1) });
  const truncated = fits.subarray(0, fits.length - 2880);
  assert.throws(() => readFitsImage(truncated, imageHduOf(truncated)), /truncated image/);
});

test('readFitsImage refuses layouts it does not understand', () => {
  const sixteen = pixelFits({ bitpix: 16, nx: 2, ny: 1, values: [1, 2] });
  assert.throws(() => readFitsImage(sixteen, imageHduOf(sixteen)), /does not support BITPIX=16/);

  const oneD = buildFits([
    {
      cards: [
        'SIMPLE  =                    T',
        'BITPIX  =                    8',
        'NAXIS   =                    0',
      ],
    },
    {
      cards: [
        "XTENSION= 'IMAGE   '",
        'BITPIX  =                  -32',
        'NAXIS   =                    1',
        'NAXIS1  =                   12',
        "EXTNAME = 'IMAGE'",
      ],
      dataBytes: 12 * 4,
    },
  ]);
  assert.throws(() => readFitsImage(oneD, imageHduOf(oneD)), /needs a 2D image/);
});

// --- WCS normalisation (M3-C) ------------------------------------------------

test('normalizeFitsWcs collapses CDELT*PC into a single CD matrix', () => {
  const wcs = normalizeFitsWcs({
    CTYPE1: 'RA---TAN',
    CTYPE2: 'DEC--TAN',
    CRPIX1: 147.5,
    CRPIX2: 147.5,
    CRVAL1: 270,
    CRVAL2: 66.5,
    CDELT1: 1,
    CDELT2: 1,
    PC1_1: -0.0017083333333333,
    PC2_2: 0.0017083333333333,
    RADESYS: 'ICRS',
  });
  assert.ok(Math.abs(wcs.cd[0][0] - -0.0017083333333333) < 1e-15);
  assert.ok(Math.abs(wcs.cd[1][1] - 0.0017083333333333) < 1e-15);
  assert.deepEqual(wcs.crpix, [147.5, 147.5]);
  assert.equal(wcs.cd[0][1], 0);
  assert.equal(wcs.cd[1][0], 0);
  assert.equal(wcs.radesys, 'ICRS');

  // The scale may equally live in CDELT with an identity PC matrix.
  const scaled = normalizeFitsWcs({
    CRPIX1: 2, CRPIX2: 2, CRVAL1: 270, CRVAL2: 66.5,
    CDELT1: -6.15 / 3600, CDELT2: 6.15 / 3600,
  });
  assert.ok(Math.abs(scaled.cd[0][0] - -6.15 / 3600) < 1e-18);
  assert.ok(Math.abs(scaled.cd[1][1] - 6.15 / 3600) < 1e-18);
});

test('normalizeFitsWcs prefers an explicit CD matrix when one is present', () => {
  const wcs = normalizeFitsWcs({
    CRPIX1: 1, CRPIX2: 2, CRVAL1: 12, CRVAL2: 34,
    CD1_1: -0.001, CD1_2: 0.0001, CD2_1: -0.0001, CD2_2: 0.001,
    CDELT1: 1, CDELT2: 1,
  });
  assert.deepEqual(wcs.cd, [[-0.001, 0.0001], [-0.0001, 0.001]]);
});

test('normalizeFitsWcs returns null without a usable celestial WCS', () => {
  assert.equal(normalizeFitsWcs({}), null);
  assert.equal(normalizeFitsWcs(null), null);
  assert.equal(normalizeFitsWcs({ CRPIX1: 1, CRPIX2: 1 }), null, 'CRVAL missing');
  assert.equal(normalizeFitsWcs({ CRVAL1: 1, CRVAL2: 1 }), null, 'CRPIX missing');
});
