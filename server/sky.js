// Real sky-imagery layer for the sky viewer.
//
// The survey archives connected to Novochar serve footprints over IVOA SIA but
// deliver pixel products as FITS. This module pulls a genuine Digitized Sky
// Survey (DSS) cutout - the same plates served by IRSA / STScI / MAST - and
// renders it into a browser-safe grayscale PNG using Node's built-in zlib only.
//
// The returned PNG is already oriented to match the client's plate carree
// projection (RA decreasing to the right, declination increasing downward) and
// ships the true WCS corner coordinates so the client can register it exactly.

import { deflateSync } from 'node:zlib';

export const DSS_MAX_ARCMIN = 120; // DSS cutouts cap at 2 deg

export const DSS_ENDPOINT = 'https://archive.stsci.edu/cgi-bin/dss_search';
export const MAX_OUTPUT_WIDTH = 720;

function parseFits(bytes) {
  const header = {};
  let dataOffset = 0;
  let done = false;
  for (let off = 0; off + 2880 <= bytes.length; off += 2880) {
    const block = bytes.subarray(off, off + 2880);
    for (let i = 0; i < 36; i++) {
      const text = Buffer.from(block.subarray(i * 80, (i + 1) * 80)).toString('ascii');
      if (text.startsWith('END')) { done = true; break; }
      const eq = text.indexOf('=');
      if (eq < 0) continue;
      const key = text.slice(0, 8).trim();
      let value = text.slice(eq + 1, 80).trim();
      const slash = value.indexOf('/');
      if (slash >= 0) value = value.slice(0, slash).trim();
      if (!key) continue;
      const m = value.match(/^'([^']*)'/);
      if (m) header[key] = m[1];
      else if (value !== '') { const n = Number(value); header[key] = Number.isFinite(n) ? n : value; }
    }
    dataOffset = off + 2880;
    if (done) break;
  }
  return { header, dataOffset };
}

function readWcs(header) {
  const useCd = Number.isFinite(header.CD1_1);
  return {
    crpix1: header.CRPIX1 ?? 1,
    crpix2: header.CRPIX2 ?? 1,
    crval1: header.CRVAL1 ?? 0,
    crval2: header.CRVAL2 ?? 0,
    cd11: useCd ? header.CD1_1 : (header.CDELT1 ?? 0),
    cd22: useCd ? header.CD2_2 : (header.CDELT2 ?? 0),
    cd12: useCd ? (header.CD1_2 || 0) : 0,
    cd21: useCd ? (header.CD2_1 || 0) : 0,
  };
}

function pixelToRaDec(x, y, w) {
  const dx = x - w.crpix1;
  const dy = y - w.crpix2;
  const dra = dx * w.cd11 + dy * w.cd12;
  const ddec = dx * w.cd21 + dy * w.cd22;
  return [w.crval1 + dra, w.crval2 + ddec];
}

function decodeFits(bytes) {
  const { header, dataOffset } = parseFits(bytes);
  const bitpix = Number(header.BITPIX ?? 0);
  const naxis1 = Number(header.NAXIS1 || 0);
  const naxis2 = Number(header.NAXIS2 || 0);
  if (!naxis1 || !naxis2) throw new Error('unsupported FITS: expected a 2-D image');
  const bscale = Number.isFinite(header.BSCALE) ? header.BSCALE : 1;
  const bzero = Number.isFinite(header.BZERO) ? header.BZERO : 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = naxis1 * naxis2;
  const data = new Float64Array(n);
  const item = bitpix < 0 ? Math.abs(bitpix) / 8 : bitpix / 8;
  for (let i = 0; i < n; i++) {
    const o = dataOffset + i * item;
    let v;
    switch (bitpix) {
      case 16: v = dv.getInt16(o, false); break;
      case 32: v = dv.getInt32(o, false); break;
      case -32: v = dv.getFloat32(o, false); break;
      case -64: v = dv.getFloat64(o, false); break;
      default: throw new Error('unsupported FITS BITPIX ' + bitpix);
    }
    data[i] = v * bscale + bzero;
  }
  return { naxis1, naxis2, data, header };
}

function fitsCorners(w, naxis1, naxis2, flipX, flipY) {
  const [ra0] = pixelToRaDec(1, 1, w);
  const [ra1] = pixelToRaDec(naxis1, 1, w);
  const [, decRow1] = pixelToRaDec(1, 1, w);
  const [, decRowLast] = pixelToRaDec(1, naxis2, w);
  let raLeft = ra0;
  let raRight = ra1;
  let decTop = decRow1;
  let decBottom = decRowLast;
  if (flipX) { const t = raLeft; raLeft = raRight; raRight = t; }
  if (flipY) { const t = decTop; decTop = decBottom; decBottom = t; }
  return { raLeft, raRight, decTop, decBottom };
}

export function fitsToPng(fitsBytes, { width = MAX_OUTPUT_WIDTH, gamma = 0.55 } = {}) {
  const { naxis1, naxis2, data, header } = decodeFits(fitsBytes);
  const wcs = readWcs(header);
  const flipX = wcs.cd11 > 0;
  const flipY = wcs.cd22 < 0;
  const meta = { ...fitsCorners(wcs, naxis1, naxis2, flipX, flipY), width, height: 0 };

  const sample = [];
  const step = Math.max(1, Math.floor((naxis1 * naxis2) / 200000));
  for (let i = 0; i < naxis1 * naxis2; i += step) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.01)];
  const hi = sample[Math.floor(sample.length * 0.99)];
  const range = hi - lo || 1;
  const stretch = (v) => {
    const p = Math.max(0, Math.min(1, (v - lo) / range));
    return Math.max(0, Math.min(255, Math.round(Math.pow(p, gamma) * 255)));
  };

  const tw = Math.min(naxis1, width);
  const th = Math.max(1, Math.round((naxis2 * tw) / naxis1));
  meta.height = th;
  const gray = new Uint8Array(tw * th);
  const sx = naxis1 / tw;
  const sy = naxis2 / th;
  for (let oy = 0; oy < th; oy++) {
    const row = flipY ? (naxis2 - 1 - Math.round(oy * sy)) : Math.round(oy * sy);
    const srcRow = row * naxis1;
    const outRow = oy * tw;
    for (let ox = 0; ox < tw; ox++) {
      const col = flipX ? (naxis1 - 1 - Math.round(ox * sx)) : Math.round(ox * sx);
      gray[outRow + ox] = stretch(data[srcRow + col]);
    }
  }

  return { png: composePng(tw, th, gray), meta, survey: header.SURVEY || 'DSS', band: header.FILTER || 'Photographic' };
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function composePng(width, height, gray) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc(width * height + height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    Buffer.from(gray.subarray(y * width, (y + 1) * width)).copy(raw, y * (width + 1) + 1);
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

export function normSkyParams(ra, dec, size, aspect) {
  const r = Number(ra);
  const d = Number(dec);
  const s = Number(size);
  const a = Number(aspect);
  if (!Number.isFinite(r) || r < 0 || r >= 360) throw new RangeError('ra must be in [0, 360) degrees');
  if (!Number.isFinite(d) || d < -89.5 || d > 89.5) throw new RangeError('dec must be in [-89.5, 89.5] degrees');
  if (!Number.isFinite(s) || s <= 0 || s > DSS_MAX_ARCMIN / 60) throw new RangeError('size must be small enough for a DSS cutout');
  return { ra: r, dec: d, size: s, aspect: Number.isFinite(a) && a > 0.1 ? Math.max(0.2, Math.min(5, a)) : 1 };
}

export async function fetchDssImage({ ra, dec, size, aspect = 1, width = MAX_OUTPUT_WIDTH, fetchImpl = globalThis.fetch, timeout = 30000 } = {}) {
  const p = normSkyParams(ra, dec, size, aspect);
  // Base the cutout on `size` degrees then apply the RA/Dec aspect ratio,
  // capping the larger side at the DSS 120' limit.
  let wArcmin = p.size * 60;
  let hArcmin = p.size * 60;
  if (p.aspect >= 1) wArcmin *= p.aspect; else hArcmin *= 1 / p.aspect;
  const cap = DSS_MAX_ARCMIN / Math.max(wArcmin, hArcmin);
  if (cap < 1) { wArcmin *= cap; hArcmin *= cap; }
  wArcmin = Math.max(1, Math.round(wArcmin));
  hArcmin = Math.max(1, Math.round(hArcmin));

  const url = new URL(DSS_ENDPOINT);
  url.searchParams.set('ra', String(p.ra));
  url.searchParams.set('dec', String(p.dec));
  url.searchParams.set('width', String(wArcmin));
  url.searchParams.set('height', String(hArcmin));
  url.searchParams.set('type', 'dss2r');
  url.searchParams.set('get', 'FITS');
  url.searchParams.set('mime_type', 'application/octet-stream');
  const res = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/fits, application/x-fits, application/octet-stream' },
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined),
  });
  if (!res.ok) throw new Error('DSS HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const { png, meta, survey, band } = fitsToPng(buf, { width });
  return {
    contentType: 'image/png',
    buffer: png,
    meta: Object.assign({}, meta, {
      ra: p.ra, dec: p.dec, size: p.size, aspect: p.aspect, wArcmin, hArcmin,
      source: 'DSS (STScI/MAST connected archive)', survey, band,
    }),
  };
}

export const __test = { parseFits, decodeFits, fitsToPng, composePng, readWcs, pixelToRaDec };
