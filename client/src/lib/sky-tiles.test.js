// Unit tests for the client-side sky-tile policy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY_BASE_ORDER,
  SKY_MAX_ORDER,
  SKY_TILE_BYTES,
  SkyTextureCache,
  allPixels,
  baseUrl,
  detailTilesForView,
  fillTileTemplate,
  nearestPixels,
  skyQualityProfile,
  tileKey,
  tileUrl,
} from './sky-tiles.js';

test('URL templates are filled without leaking placeholder text', () => {
  const template = '/api/spherex/sky/tile/{epoch}/{order}/{ipix}.png';
  assert.equal(
    tileUrl(template, { epoch: 'epoch-2', order: 3, ipix: 17 }),
    '/api/spherex/sky/tile/epoch-2/3/17.png',
  );
  assert.equal(baseUrl('/api/spherex/sky/base/{epoch}.png', 'epoch-1'), '/api/spherex/sky/base/epoch-1.png');
  assert.equal(fillTileTemplate('/x/{epoch}', { epoch: 'a b' }), '/x/a%20b');
  assert.equal(tileKey('epoch-1', 2, 7), 'epoch-1:2:7');
});

test('HEALPix pixel counts match the pyramid in the server index', () => {
  assert.equal(allPixels(SKY_BASE_ORDER).length, 48);
  assert.equal(allPixels(2).length, 192);
  assert.equal(allPixels(3).length, 768);
  assert.equal(allPixels(SKY_MAX_ORDER).length, 3072);
  assert.equal(allPixels(SKY_BASE_ORDER)[0], 0);
  assert.equal(allPixels(SKY_BASE_ORDER).at(-1), 47);
});

test('nearest pixels are ordered by angular distance and bounded', () => {
  const nearest = nearestPixels(1, 0, 0, 5);
  assert.equal(nearest.length, 5);
  for (let i = 1; i < nearest.length; i++) {
    assert.ok(nearest[i - 1].distanceRad <= nearest[i].distanceRad);
  }
  assert.ok(nearest[0].distanceRad < Math.PI / 2);
  assert.equal(nearestPixels(1, 0, 0, 0).length, 0);
});

test('the initial wide view requests the base layer plus a central detail island', () => {
  const initial = detailTilesForView({ ra: 0, dec: 0, fovDeg: 62 });
  assert.equal(initial.filter((t) => t.order === SKY_BASE_ORDER).length, 48);
  assert.equal(initial.filter((t) => t.order === 2).length, 32);
  assert.equal(initial.length, 80);
  assert.equal(new Set(initial.map((t) => `${t.order}:${t.ipix}`)).size, initial.length);

  const wide = detailTilesForView({ ra: 0, dec: 0, fovDeg: 80 });
  assert.equal(wide.length, 48);
  assert.ok(wide.every((t) => t.order === SKY_BASE_ORDER));
});

test('zooming adds contiguous children in the expected counts', () => {
  const mid = detailTilesForView({ ra: 120, dec: 20, fovDeg: 50 });
  assert.equal(mid.filter((t) => t.order === 1).length, 48);
  assert.equal(mid.filter((t) => t.order === 2).length, 32);
  assert.equal(mid.filter((t) => t.order === 3).length, 0);
  assert.equal(new Set(mid.map((t) => `${t.order}:${t.ipix}`)).size, mid.length);

  const close = detailTilesForView({ ra: 120, dec: 20, fovDeg: 40 });
  assert.equal(close.filter((t) => t.order === 2).length, 32);
  assert.equal(close.filter((t) => t.order === 3).length, 16);
  assert.equal(close.filter((t) => t.order === 4).length, 0);

  const tight = detailTilesForView({ ra: 120, dec: 20, fovDeg: 20 });
  assert.equal(tight.filter((t) => t.order === 3).length, 16);
  assert.equal(tight.filter((t) => t.order === 4).length, 12);
  assert.equal(tight.length, 108);
});

test('the base layer is always requested first', () => {
  const tiles = detailTilesForView({ ra: 300, dec: -40, fovDeg: 15 });
  const base = tiles.filter((t) => t.order === 1);
  const detail = tiles.filter((t) => t.order > 1);
  assert.equal(base.length, 48);
  assert.ok(Math.min(...base.map((t) => t.priority)) > Math.max(...detail.map((t) => t.priority)));
});

test('respects the device max order', () => {
  const tiles = detailTilesForView({ ra: 0, dec: 0, fovDeg: 12, maxOrder: 2 });
  assert.ok(tiles.every((t) => t.order <= 2));
  assert.equal(tiles.filter((t) => t.order === 3).length, 0);
});

test('LRU cache evicts the least recently used entry and disposes it', () => {
  const disposed = [];
  const cache = new SkyTextureCache({ max: 2, dispose: (value, key) => disposed.push([key, value]) });
  cache.set('a', { id: 'a' });
  cache.set('b', { id: 'b' });
  assert.equal(cache.get('a').id, 'a'); // touch a
  cache.set('c', { id: 'c' }); // evicts b
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
  assert.deepEqual(disposed, [['b', { id: 'b' }]]);
  assert.equal(cache.size, 2);
});

test('LRU cache respects an approximate byte budget', () => {
  const cache = new SkyTextureCache({ max: 10, maxBytes: SKY_TILE_BYTES * 2 });
  cache.set('a', 'a', { bytes: SKY_TILE_BYTES });
  cache.set('b', 'b', { bytes: SKY_TILE_BYTES });
  cache.set('c', 'c', { bytes: SKY_TILE_BYTES });
  assert.equal(cache.size, 2);
  assert.equal(cache.has('a'), false);
  assert.ok(cache.bytes <= SKY_TILE_BYTES * 2);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
});

test('quality profile lowers the path on constrained devices', () => {
  const low = skyQualityProfile({ deviceMemory: 4, hardwareConcurrency: 4 });
  assert.equal(low.tier, 'low');
  assert.equal(low.maxOrder, 3);
  assert.equal(low.antialias, false);
  assert.equal(low.workerCount, 1);
  assert.ok(low.maxTextures < 192);

  const standard = skyQualityProfile({ deviceMemory: 16, hardwareConcurrency: 12 });
  assert.equal(standard.tier, 'standard');
  assert.equal(standard.maxOrder, SKY_MAX_ORDER);
  assert.equal(standard.antialias, true);
  assert.equal(standard.workerCount, 2);

  const saveData = skyQualityProfile({ saveData: true });
  assert.equal(saveData.tier, 'low');
  assert.equal(saveData.prefetch, false);
  const reduced = skyQualityProfile({ reducedMotion: true });
  assert.equal(reduced.autoPlay, false);
  assert.equal(reduced.prefetch, false);
});
