// The browser must reject a raster whose identity headers disagree with the
// request. A stale CDN entry, a wrong-epoch cache key or a routing mistake must
// surface as a tile error, never as the wrong sky painted silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveExpectation,
  assertSkyResponseIdentity,
  illustrativeExpectation,
} from './sky-tile-contract.js';

function response(headers = {}, contentType = 'image/png') {
  const map = new Map(Object.entries({ ...headers, 'content-type': contentType })
    .map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    headers: {
      get: (name) => map.get(String(name).toLowerCase()) ?? null,
    },
  };
}

test('an illustrative base/tile must match mode, epoch, revision and spatial address', () => {
  const expect = illustrativeExpectation({
    revision: 'illustrative-1',
    epoch: 'epoch-2',
    order: 3,
    ipix: 123,
    width: 512,
    height: 256,
  });
  assert.equal(expect.headers['x-novochar-sky-mode'], 'illustrative');
  assert.equal(expect.headers['x-novochar-sky-revision'], 'illustrative-1');
  assert.equal(expect.headers['x-novochar-sky-order'], '3');

  assert.doesNotThrow(() => assertSkyResponseIdentity(response({
    'X-Novochar-Sky-Mode': 'illustrative',
    'X-Novochar-Sky-Epoch': 'epoch-2',
    'X-Novochar-Sky-Revision': 'illustrative-1',
    'X-Novochar-Sky-Order': '3',
    'X-Novochar-Sky-Ipix': '123',
    'X-Novochar-Sky-Width': '512',
    'X-Novochar-Sky-Height': '256',
  }), expect));
});

test('a wrong epoch or product mode is rejected', () => {
  const expect = illustrativeExpectation({
    revision: 'illustrative-1',
    epoch: 'epoch-2',
    order: 2,
    ipix: 4,
  });
  assert.throws(() => assertSkyResponseIdentity(response({
    'X-Novochar-Sky-Mode': 'illustrative',
    'X-Novochar-Sky-Epoch': 'epoch-3',
    'X-Novochar-Sky-Revision': 'illustrative-1',
    'X-Novochar-Sky-Order': '2',
    'X-Novochar-Sky-Ipix': '4',
  }), expect), /x-novochar-sky-epoch expected "epoch-2", got "epoch-3"/);

  assert.throws(() => assertSkyResponseIdentity(response({
    'X-Novochar-Sky-Mode': 'archive',
    'X-Novochar-Sky-Epoch': 'epoch-2',
    'X-Novochar-Sky-Revision': 'illustrative-1',
  }), expect), /x-novochar-sky-mode expected "illustrative", got "archive"/);
});

test('a stale revision is rejected even when the epoch matches', () => {
  const expect = illustrativeExpectation({ revision: 'new', epoch: 'epoch-1' });
  assert.throws(() => assertSkyResponseIdentity(response({
    'X-Novochar-Sky-Mode': 'illustrative',
    'X-Novochar-Sky-Epoch': 'epoch-1',
    'X-Novochar-Sky-Revision': 'old',
  }), expect), /x-novochar-sky-revision expected "new", got "old"/);
});

test('archive responses must carry their source hash and expected provenance', () => {
  const expect = archiveExpectation({
    revision: 'archive-abc',
    epoch: 'epoch-a',
    width: 294,
    height: 294,
    outputSha256: 'a'.repeat(64),
  });
  assert.equal(expect.headers['x-novochar-sky-role'], 'epoch-a');
  assert.deepEqual(expect.required, ['x-novochar-sky-source-sha256']);

  const good = response({
    'X-Novochar-Sky-Mode': 'archive',
    'X-Novochar-Sky-Epoch': 'epoch-a',
    'X-Novochar-Sky-Revision': 'archive-abc',
    'X-Novochar-Sky-Role': 'epoch-a',
    'X-Novochar-Sky-Width': '294',
    'X-Novochar-Sky-Height': '294',
    'X-Novochar-Sky-Output-Sha256': 'a'.repeat(64),
    'X-Novochar-Sky-Source-Sha256': 'b'.repeat(64),
  });
  assert.doesNotThrow(() => assertSkyResponseIdentity(good, expect));

  assert.throws(() => assertSkyResponseIdentity(response({
    'X-Novochar-Sky-Mode': 'archive',
    'X-Novochar-Sky-Epoch': 'epoch-a',
    'X-Novochar-Sky-Revision': 'archive-abc',
    'X-Novochar-Sky-Role': 'epoch-a',
    'X-Novochar-Sky-Width': '294',
    'X-Novochar-Sky-Height': '294',
    'X-Novochar-Sky-Output-Sha256': 'a'.repeat(64),
  }), expect), /x-novochar-sky-source-sha256 is missing/);
});

test('a non-PNG response is rejected before decode', () => {
  const expect = illustrativeExpectation({ revision: 'r', epoch: 'epoch-1' });
  assert.throws(() => assertSkyResponseIdentity(response({
    'X-Novochar-Sky-Mode': 'illustrative',
    'X-Novochar-Sky-Epoch': 'epoch-1',
    'X-Novochar-Sky-Revision': 'r',
  }, 'application/json'), expect), /content-type expected "image\/png"/);
});

test('a missing header is a mismatch, not an accepted default', () => {
  const expect = illustrativeExpectation({ revision: 'r', epoch: 'epoch-1' });
  assert.throws(() => assertSkyResponseIdentity(response({}), expect), /x-novochar-sky-mode is missing/);
});
