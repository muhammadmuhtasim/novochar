// Unit tests for the Observe view-frame adapter.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  angularSeparationArcsec,
  DEG2RAD,
  galacticToRaDec,
  raDecToGalactic,
} from '@novochar/astro';
import { isViewFrame, VIEW_FRAMES, viewLonLat, viewLonLatRad, viewLonLatToIcrs } from './frame.js';

const record = (ra, dec) => ({
  id: 'r',
  name: 'r',
  ra,
  dec,
  mag: null,
  pmRa: null,
  pmDec: null,
  pmUnits: 'mas/yr',
  frame: 'icrs',
  extras: {},
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('view frames are enumerated', () => {
  assert.ok(isViewFrame('icrs'));
  assert.ok(isViewFrame('galactic'));
  assert.ok(!isViewFrame('fk5'));
  assert.deepEqual(Object.values(VIEW_FRAMES).sort(), ['galactic', 'icrs']);
});

test('the ICRS view is the identity on canonical coordinates', () => {
  const r = record(123.4, -45.6);
  assert.deepEqual(viewLonLat(r, 'icrs'), { lonDeg: 123.4, latDeg: -45.6 });
  const rad = viewLonLatRad(r, 'icrs');
  assert.equal(rad.lonRad, 123.4 * DEG2RAD);
  assert.equal(rad.latRad, -45.6 * DEG2RAD);
  // Default frame is ICRS.
  assert.deepEqual(viewLonLat(r), { lonDeg: 123.4, latDeg: -45.6 });
});

test('the Galactic view delegates to the shared ICRS-native transform', () => {
  const centre = galacticToRaDec(0, 0); // ICRS position of l = 0, b = 0
  const r = record(centre.ra, centre.dec);
  const g = viewLonLat(r, 'galactic');
  const ref = raDecToGalactic(r.ra, r.dec);
  assert.equal(g.lonDeg, ref.l);
  assert.equal(g.latDeg, ref.b);
  assert.ok(Math.abs(g.lonDeg) < 1e-9, `l near 0: ${g.lonDeg}`);
  assert.ok(Math.abs(g.latDeg) < 1e-9, `b near 0: ${g.latDeg}`);
});

test('the Galactic north pole sits at b = +90', () => {
  const ngp = galacticToRaDec(0, 90);
  const g = viewLonLat(record(ngp.ra, ngp.dec), 'galactic');
  assert.ok(Math.abs(g.latDeg - 90) < 1e-9, `b ${g.latDeg}`);
});

test('Galactic view matches the shared transform and round-trips (property)', () => {
  const rand = mulberry32(999);
  let worst = 0;
  for (let i = 0; i < 500; i++) {
    const ra = rand() * 360;
    const dec = (rand() * 2 - 1) * 90;
    const r = record(ra, dec);

    const g = viewLonLat(r, 'galactic');
    const ref = raDecToGalactic(ra, dec);
    assert.equal(g.lonDeg, ref.l);
    assert.equal(g.latDeg, ref.b);

    // view -> ICRS round-trip, measured on the sphere (pole-safe).
    const back = viewLonLatToIcrs(g.lonDeg, g.latDeg, 'galactic');
    assert.ok(angularSeparationArcsec(ra, dec, back.ra, back.dec) < 1e-6, `sep at ${ra},${dec}`);
  }
});

test('the Galactic pole survives a view round-trip on the sphere', () => {
  // The equatorial coordinates of the galactic pole, viewed in Galactic, must
  // come back to b = 90 within machine precision, checked as a sphere angle.
  const ngp = galacticToRaDec(0, 90);
  const g = viewLonLat(record(ngp.ra, ngp.dec), 'galactic');
  const back = viewLonLatToIcrs(g.lonDeg, g.latDeg, 'galactic');
  assert.ok(angularSeparationArcsec(ngp.ra, ngp.dec, back.ra, back.dec) < 1e-6);
});

test('an unknown view frame throws', () => {
  const r = record(1, 2);
  assert.throws(() => viewLonLat(r, 'fk5'), RangeError);
  assert.throws(() => viewLonLatRad(r, 'ecliptic'), RangeError);
  assert.throws(() => viewLonLatToIcrs(0, 0, 'nope'), RangeError);
});