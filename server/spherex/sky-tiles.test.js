// Unit tests for the four-epoch sky-tile generator.
//
// These exercise the real PNG path, not a mock: the route tests below use an
// injected renderer, but the product itself must produce a valid, deterministic
// image and honest errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_ORDER,
  BASE_HEIGHT,
  BASE_WIDTH,
  MAX_ORDER,
  SKY_INDEX_SCHEMA,
  SKY_MODEL_REVISION,
  SKY_SOURCES_SCHEMA,
  SkyTileError,
  TILE_SIZE,
  clearSkyTileCache,
  encodePng,
  renderBase,
  renderTile,
  skyIndex,
  skySources,
  tileChildren,
} from './sky-tiles.js';

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('PNG encoder writes a valid RGBA8 header and round-trips its dimensions', () => {
  const rgba = new Uint8ClampedArray(4 * 3 * 4);
  const png = encodePng(4, 3, rgba);
  assert.deepEqual(pngDimensions(png), { width: 4, height: 3 });
  assert.throws(() => encodePng(0, 3, rgba), RangeError);
  assert.throws(() => encodePng(4, 3, new Uint8ClampedArray(1)), RangeError);
});

test('index declares a HEALPix NEST pyramid, four epochs and an explicit illustrative mode', () => {
  const index = skyIndex();
  assert.equal(index.schema, SKY_INDEX_SCHEMA);
  assert.equal(index.mode, 'illustrative');
  assert.equal(index.modelRevision, SKY_MODEL_REVISION);
  assert.equal(index.epochs.length, 4);
  assert.deepEqual(index.epochs.map((e) => e.index), [0, 1, 2, 3]);
  assert.ok(index.epochs.every((e) => e.status === 'illustrative'));
  assert.equal(index.epochs.filter((e) => e.realDetail).length, 2);
  assert.equal(index.tiles.scheme, 'healpix-nest');
  assert.equal(index.tiles.ordering, 'NEST');
  assert.equal(index.tiles.baseOrder, BASE_ORDER);
  assert.equal(index.tiles.maxOrder, MAX_ORDER);
  assert.equal(index.tiles.textureSize, TILE_SIZE);
  assert.deepEqual(index.tiles.levels.map((l) => l.order), [1, 2, 3, 4]);
  assert.equal(index.tiles.levels.find((l) => l.initial).npix, 48);
  assert.equal(index.tiles.base.width, BASE_WIDTH);
  assert.equal(index.tiles.base.height, BASE_HEIGHT);
  assert.match(index.tiles.urlTemplate, /healpix|tile/);
  assert.equal(index.performance.initialTileCount, 48);
  assert.ok(index.performance.maxTextureUnits >= index.performance.initialTileCount);
  assert.ok(index.epochs[0].coverage >= 0.999, 'epoch 1 is a full-coverage prototype');
  assert.ok(index.epochs[2].coverage < 0.98, 'epoch 3 exposes a real coverage gap');
  assert.ok(index.epochs.every((e) => e.coverage > 0 && e.coverage <= 1));
});

test('base textures are valid, deterministic and epoch-specific', () => {
  clearSkyTileCache();
  const a = renderBase({ epoch: 'epoch-1' });
  assert.deepEqual(pngDimensions(a.png), { width: BASE_WIDTH, height: BASE_HEIGHT });
  assert.equal(a.mode, 'illustrative');
  assert.equal(a.epoch, 'epoch-1');
  assert.equal(a.cached, false);

  const again = renderBase({ epoch: 'epoch-1' });
  assert.equal(again.cached, true);
  assert.equal(again.etag, a.etag);
  assert.deepEqual(again.png, a.png);

  clearSkyTileCache();
  const fresh = renderBase({ epoch: 'epoch-1' });
  assert.deepEqual(fresh.png, a.png, 'deterministic across cache clears');

  const b = renderBase({ epoch: 'epoch-2' });
  assert.notEqual(b.etag, a.etag);
  assert.notDeepEqual(b.png, a.png, 'epochs are not byte-identical');

  assert.throws(() => renderBase({ epoch: 'nope' }), (error) => error.code === 'unknown_epoch');
  assert.throws(() => renderBase({ epoch: 'epoch-1', width: 5000 }), (error) => error.code === 'bad_request');
});

test('tiles are valid PNGs at the declared size, deterministic and epoch-specific', () => {
  clearSkyTileCache();
  const tile = renderTile({ epoch: 'epoch-1', order: 1, ipix: 0 });
  assert.deepEqual(pngDimensions(tile.png), { width: TILE_SIZE, height: TILE_SIZE });
  assert.equal(tile.order, 1);
  assert.equal(tile.ipix, 0);
  assert.equal(tile.size, TILE_SIZE);
  assert.equal(tile.mode, 'illustrative');
  assert.equal(tile.cached, false);
  assert.match(tile.etag, /^"[0-9a-f]{40}"$/);

  const again = renderTile({ epoch: 'epoch-1', order: 1, ipix: 0 });
  assert.equal(again.cached, true);
  assert.deepEqual(again.png, tile.png);

  clearSkyTileCache();
  const fresh = renderTile({ epoch: 'epoch-1', order: 1, ipix: 0 });
  assert.deepEqual(fresh.png, tile.png, 'deterministic across cache clears');

  const otherEpoch = renderTile({ epoch: 'epoch-2', order: 1, ipix: 0 });
  assert.notDeepEqual(otherEpoch.png, tile.png);
  const otherPixel = renderTile({ epoch: 'epoch-1', order: 1, ipix: 1 });
  assert.notDeepEqual(otherPixel.png, tile.png);
  const finer = renderTile({ epoch: 'epoch-1', order: 2, ipix: 0 });
  assert.notDeepEqual(finer.png, tile.png);
});

test('tile addressing is validated rather than clamped', () => {
  const badOrder = [0, 5, 1.5, 'x', null];
  for (const order of badOrder) {
    assert.throws(
      () => renderTile({ epoch: 'epoch-1', order, ipix: 0 }),
      (error) => error instanceof SkyTileError && error.code === 'bad_tile',
    );
  }
  assert.throws(() => renderTile({ epoch: 'epoch-1', order: 1, ipix: 48 }), (error) => error.code === 'bad_tile');
  assert.throws(() => renderTile({ epoch: 'epoch-1', order: 1, ipix: -1 }), (error) => error.code === 'bad_tile');
  assert.throws(() => renderTile({ epoch: 'missing', order: 1, ipix: 0 }), (error) => error.code === 'unknown_epoch');
});

test('the pyramid exposes four children until the maximum order', () => {
  assert.deepEqual(tileChildren(1, 0), [0, 1, 2, 3]);
  assert.deepEqual(tileChildren(2, 7), [28, 29, 30, 31]);
  assert.deepEqual(tileChildren(MAX_ORDER, 0), []);
});

test('source measurements carry one position per epoch and never claim a detection', () => {
  const sources = skySources();
  assert.equal(sources.schema, SKY_SOURCES_SCHEMA);
  assert.equal(sources.mode, 'illustrative');
  assert.match(sources.notice, /not measurements/i);
  assert.ok(sources.candidates.length >= 8);
  const ids = new Set();
  for (const candidate of sources.candidates) {
    assert.ok(!ids.has(candidate.id), `duplicate candidate ${candidate.id}`);
    ids.add(candidate.id);
    assert.equal(candidate.epochs.length, 4);
    assert.deepEqual(candidate.epochs.map((e) => e.index), [0, 1, 2, 3]);
    for (const epoch of candidate.epochs) {
      assert.ok(epoch.ra >= 0 && epoch.ra < 360);
      assert.ok(epoch.dec >= -90 && epoch.dec <= 90);
      assert.equal(typeof epoch.visible, 'boolean');
    }
  }
  // The change layer must actually contain a visible change for the timeline.
  assert.ok(sources.candidates.some((c) => new Set(c.epochs.filter((e) => e.visible).map((e) => `${e.ra.toFixed(3)},${e.dec.toFixed(3)}`)).size > 1));
});
