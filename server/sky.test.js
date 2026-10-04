// Tests for the real sky-imagery layer (server/sky.js): FITS-to-PNG conversion,
// projection-orientation rules, PNG encoding and request validation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { __test, fitsToPng, normSkyParams } from './sky.js';
const { composePng } = __test;

function makeFits(width, height, vals) {
  const keys = [
    ['SIMPLE', 'T'], ['BITPIX', 16], ['NAXIS', 2], ['NAXIS1', width], ['NAXIS2', height],
    ['BSCALE', 1], ['BZERO', 0],
    ['CTYPE1', 'RA---TAN'], ['CRPIX1', 2], ['CRVAL1', 10], ['CD1_1', -0.01],
    ['CTYPE2', 'DEC--TAN'], ['CRPIX2', 2], ['CRVAL2', -20], ['CD2_2', 0.01],
    ['SURVEY', 'TEST-PLATE'], ['FILTER', 'J'], ['END', null],
  ];
  const cards = keys.map(([k, v]) => {
    let val;
    if (v === null) val = '';
    else if (typeof v === 'number') val = v.toFixed(6);
    else if (v === true) val = 'T';
    else val = v.includes("'") ? v : `'${v}'`;
    const body = `${k.padEnd(8, ' ')} = ${val}`;
    return body.padEnd(80, ' ').slice(0, 80);
  }).join('');
  const header = Buffer.alloc(2880);
  header.write(cards, 'latin1');
  header.fill(' ', cards.length);
  const data = Buffer.alloc(width * height * 2);
  vals.forEach((v, i) => data.writeInt16BE(v, i * 2));
  return Buffer.concat([header, data]);
}

const TRIANGLE = [
  800, 800, 800, 800,
  800, 7800, 900, 700,
  800, 900, 900, 800,
  800, 800, 800, 800,
];

const black = Buffer.from([0, 0, 0]);
function chunkCRC(buf) {
  return buf[4] << 24 | buf[5] << 16 | buf[6] << 8 | buf[7];
}

function readIDAT(png) {
  // chunk walk: sig(8) + IHDR(4len+4type+13data+4crc) then IDAT
  let off = 8 + 25;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const start = off + 8;
    if (type === 'IDAT') return png.subarray(start, start + len);
    off = start + len + 4;
  }
  return null;
}

function quickCRC32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

void black; void chunkCRC; void quickCRC32;

test('fitsToPng returns a real PNG with client-oriented WCS corners', () => {
  const fits = makeFits(4, 4, TRIANGLE);
  const { png, meta, survey } = fitsToPng(fits, { width: 4 });
  assert.ok(png.length > 24);
  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(meta.width, 4);
  assert.equal(meta.height, 4);
  assert.equal(survey, 'TEST-PLATE');
  // RA decreases to the right, Dec increases downward (both client conventions).
  assert.ok(meta.raLeft > meta.raRight, 'RA must decrease to the right');
  assert.ok(meta.decBottom > meta.decTop, 'Dec must increase downward');
});

test('fitsToPng brightens a star core above the plate background', () => {
  const fits = makeFits(4, 4, TRIANGLE);
  const idat = readIDAT(fitsToPng(fits, { width: 4 }).png);
  const raw = inflateSync(idat);
  // One filter byte per row + 4 samples: rows 4, cols 4 => 20 bytes.
  assert.equal(raw.length, 20);
  const core = raw[1 * 5 + 1];
  const bg = raw[0 * 5 + 0];
  assert.ok(core > bg, `star core (${core}) should be brighter than background (${bg})`);
});

test('composePng produces a decryptable grayscale PNG', () => {
  const gray = Uint8Array.from([0, 96, 160, 255]);
  const png = composePng(4, 1, gray);
  assert.equal(png.readUInt32BE(16), 4); // IHDR width
  assert.equal(png.readUInt32BE(20), 1); // IHDR height
  const idat = readIDAT(png);
  assert.ok(idat);
  const raw = inflateSync(idat);
  // 1 row: filter byte + 4 samples
  assert.equal(raw.length, 5);
  assert.deepEqual([...raw], [0, 0, 96, 160, 255]);
});

test('normSkyParams validates coordinates and size', () => {
  assert.deepEqual(normSkyParams(84, -58, 0.4, 1.5), { ra: 84, dec: -58, size: 0.4, aspect: 1.5 });
  assert.throws(() => normSkyParams(400, 0, 0.1), RangeError);
  assert.throws(() => normSkyParams(0, -100, 0.1), RangeError);
  assert.throws(() => normSkyParams(0, 0, 5), RangeError);
});
