// Unit tests for the Yale BSC5 (VizieR V/50) adapter.
//
// These build synthetic fixed-width records at the documented byte offsets, so
// the adapter can be verified without redistributing any third-party catalogue
// file. Values mirror a well-known star (Sirius) to catch column misalignment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStarCatalog, normalizeBsc5Record, J2000_JD } from './bsc5.js';

// Place a field at 1-based inclusive byte range [a, b] in a 197-column record.
function record(fields) {
  const line = Array(197).fill(' ');
  const put = (a, b, value) => {
    const width = b - a + 1;
    const text = String(value ?? '').slice(0, width);
    for (let i = 0; i < text.length; i += 1) line[a - 1 + i] = text[i];
  };
  put(1, 4, fields.hr);
  put(5, 14, fields.name);
  put(15, 25, fields.dm);
  put(26, 31, fields.hd);
  put(32, 37, fields.sao);
  put(38, 41, fields.fk5);
  put(52, 60, fields.varId);
  put(76, 83, fields.ra);
  put(84, 90, fields.dec);
  put(103, 107, fields.vmag);
  put(110, 114, fields.bv);
  put(128, 147, fields.sp);
  put(149, 154, fields.pmRa);
  put(155, 160, fields.pmDec);
  put(162, 166, fields.plx);
  return line.join('');
}

const SIRIUS = record({
  hr: '2491',
  name: '9Alp CMa',
  dm: 'BD-16 1591',
  hd: '48915',
  sao: '151881',
  fk5: '257',
  ra: '064508.9',
  dec: '-164258',
  vmag: '-1.46',
  bv: '0.00',
  sp: 'A1Vm',
  pmRa: '-0.553',
  pmDec: '-1.205',
  plx: '0.375',
});

test('parses a record into the star contract (Sirius)', () => {
  const star = normalizeBsc5Record(SIRIUS);
  assert.ok(star);
  assert.equal(star.id, 'BSC-HR2491');
  assert.equal(star.hr, 2491);
  assert.equal(star.type, 'STAR');
  assert.equal(star.name, '9Alp CMa');
  assert.equal(star.refEpochJD, J2000_JD);
  // 06h45m08.9s, -16°42'58"
  assert.ok(Math.abs(star.ra - 101.2871) < 1e-3, `ra ${star.ra}`);
  assert.ok(Math.abs(star.dec - (-16.7161)) < 1e-3, `dec ${star.dec}`);
  assert.equal(star.mag, -1.46);
  assert.equal(star.bv, 0);
  assert.equal(star.spectralType, 'A1Vm');
  // arcsec/yr → mas/yr, and arcsec → mas
  assert.equal(star.pmRaMasYr, -553);
  assert.equal(star.pmDecMasYr, -1205);
  assert.equal(star.parallaxMas, 375);
  assert.ok(Math.abs(star.distanceLy - 8.6975) < 0.01, `distance ${star.distanceLy}`);
  assert.ok(star.aliases.includes('HR 2491'));
  assert.ok(star.aliases.includes('HD 48915'));
  assert.ok(star.aliases.includes('BD-16 1591'));
});

test('missing photometry/motion/parallax stays null, never zero-filled', () => {
  const star = normalizeBsc5Record(record({ hr: '3', ra: '120000.0', dec: '+100000', vmag: '4.5' }));
  assert.ok(star);
  assert.equal(star.pmRaMasYr, null);
  assert.equal(star.pmDecMasYr, null);
  assert.equal(star.parallaxMas, null);
  assert.equal(star.distanceLy, null);
  assert.equal(star.bv, null);
  assert.equal(star.spectralType, null);
  assert.equal(star.name, 'HR 3');
});

test('a blank-position record is dropped, not fabricated', () => {
  assert.equal(normalizeBsc5Record(record({ hr: '9000' })), null);
});

test('buildStarCatalog counts blank-position records as dropped', () => {
  const text = `${record({ hr: '1' })}\n${record({ hr: '2', ra: '000000.0', dec: '+000000', vmag: '5.0' })}`;
  const catalog = buildStarCatalog(text);
  assert.equal(catalog.count, 1);
  assert.equal(catalog.dropped, 1);
  assert.equal(catalog.schema, 'novochar.stars/v1');
  assert.equal(catalog.frame, 'FK5');
  assert.equal(catalog.equinox, 'J2000');
});

test('buildStarCatalog is deterministic', () => {
  assert.deepEqual(buildStarCatalog(SIRIUS), buildStarCatalog(SIRIUS));
});
