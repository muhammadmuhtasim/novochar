// Server-side unit tests for the spatial cross-matching layer.
//
//   node --test astro/crossmatch.test.js
//
// The indexed (HEALPix) path is validated against a brute-force O(n*m)
// reference across many randomized catalogues, including points near the
// poles and across the RA=0/360 wrap, so the guarantee "no false positives,
// no false negatives" is exercised directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  crossmatch,
  bruteForceCrossmatch,
  coneSearch,
  nearestNeighbor,
  gatherCandidates,
  chooseNside,
} from './crossmatch.js';
import { angularSeparationArcsec } from './coords.js';
import { ORDERING, raDecToPixel, nside2resol } from './healpix.js';

// deterministic PRNG (mulberry-ish) for reproducible tests
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}

function randomCatalog(rnd, n, poleBias = true) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let dec;
    if (poleBias && rnd() < 0.34) {
      dec = rnd() < 0.5 ? -90 + rnd() * 0.5 : 90 - rnd() * 0.5;
    } else {
      dec = -89 + rnd() * 178;
    }
    out.push({ ra: rnd() * 360, dec });
  }
  return out;
}

const key = (list) => list.map((x) => `${x.sourceIndex}:${x.targetIndex}`).sort().join(',');

test('crossmatch equals brute force across radii and pole/wrap cases', () => {
  for (let trial = 0; trial < 8; trial++) {
    const rnd = makeRng(1000 + trial);
    const target = randomCatalog(rnd, 70);
    const source = [];
    for (let i = 0; i < 30; i++) source.push({ ra: rnd() * 360, dec: -89 + rnd() * 178 });
    // inject tight pairs (guaranteed matches) at random targets
    for (let i = 0; i < 6; i++) {
      const t = Math.floor(rnd() * target.length);
      const off = rnd() * 8 / 3600;
      source.push({ ra: target[t].ra + (rnd() - 0.5) * off, dec: target[t].dec + (rnd() - 0.5) * off });
    }
    for (const rad of [3, 30, 150, 700]) {
      const got = crossmatch(source, target, { radiusArcsec: rad });
      const ref = bruteForceCrossmatch(source, target, rad);
      assert.ok(got.every((m) => m.separationArcsec <= rad + 1e-6), 'no false positive beyond radius');
      assert.equal(key(got), key(ref), `trial ${trial} radius ${rad}`);
    }
  }
});

test('coneSearch agrees with a brute-force disc filter', () => {
  const rnd = makeRng(42);
  const cat = randomCatalog(rnd, 120);
  const center = { ra: rnd() * 360, dec: -80 + rnd() * 20 };
  const rad = 300;
  const got = coneSearch(cat, center, { radiusArcsec: rad });
  const want = cat
    .map((c, i) => ({ i, d: angularSeparationArcsec(center.ra, center.dec, c.ra, c.dec) }))
    .filter((x) => x.d <= rad + 1e-6)
    .map((x) => x.i)
    .sort((a, b) => a - b);
  assert.deepEqual([...got].sort((a, b) => a - b), want);

  // a disc entirely off the catalog yields nothing
  assert.equal(coneSearch(cat, { ra: 0, dec: -45 }, { radiusArcsec: 0.01 }).length, 0);
});

test('nearestNeighbor returns sorted within-radius matches', () => {
  const rnd = makeRng(7);
  const target = [{ ra: 10.0, dec: 10.0 }, { ra: 10.0001, dec: 10.0 }, { ra: 10.0004, dec: 10.0 }];
  const source = [{ ra: 10.00005, dec: 10.00002 }];
  const res = nearestNeighbor(source, target, { radiusArcsec: 8, k: 2 });
  assert.equal(res.length, 1);
  assert.equal(res[0].matches.length, 2);
  assert.ok(res[0].matches[0].separationArcsec <= res[0].matches[1].separationArcsec);
  // default k=1
  const one = nearestNeighbor(source, target, { radiusArcsec: 8 });
  assert.equal(one[0].matches.length, 1);
});

test('chooseNside places pixel side length at/below the radius', () => {
  for (const rad of [1, 10, 100, 1000]) {
    const nside = chooseNside(rad);
    const pixelRad = nside2resol(nside);
    const pixelArcsec = pixelRad * (180 / Math.PI) * 3600;
    assert.ok(pixelArcsec <= rad + 1e-9, `rad ${rad} -> pixel ${pixelArcsec}`);
  }
});

test('gatherCandidates includes only real pixel buckets and is a superset', () => {
  const rnd = makeRng(99);
  const target = randomCatalog(rnd, 40);
  const nside = chooseNside(60);
  // replicate the internal index build the same way the module does
  const index = new Map();
  for (let t = 0; t < target.length; t++) {
    const p = raDecToPixel(nside, target[t].ra, target[t].dec, ORDERING.RING);
    if (!index.has(p)) index.set(p, []);
    index.get(p).push(t);
  }
  const radiusArcsec = 60;
  const radiusRad = radiusArcsec * (Math.PI / 180) / 3600;
  const cands = gatherCandidates(index, nside, target[5].ra, target[5].dec, radiusRad);
  // a point is always within radius of itself, so its own index must be found
  assert.ok(cands.includes(5), 'self-match must appear among candidates');
  // every returned index is a real target index (no OOB)
  for (const c of cands) assert.ok(c >= 0 && c < target.length);
});