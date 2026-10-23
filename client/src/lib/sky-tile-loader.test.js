import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SkyTileLoader } from './sky-tile-loader.js';

test('a queued prefetch is promoted when the user requests the same key', async () => {
  const loader = new SkyTileLoader({ workerCount: 0, maxConcurrent: 1 });
  const prefetch = loader.request({
    key: 'base:epoch-2',
    url: '/api/spherex/sky/base/epoch-2.png',
    priority: -80,
  });
  // The rejection is asserted below; keep node from treating a cancel during
  // disposal as an unhandled rejection in the meantime.
  prefetch.catch(() => {});

  const interactive = loader.request({
    key: 'base:epoch-2',
    url: '/api/spherex/sky/base/epoch-2.png',
    priority: 6000,
  });

  assert.equal(interactive, prefetch, 'the duplicate request shares one promise');
  assert.equal(loader.queue[0].priority, 6000, 'queued idle work is reprioritized in place');

  loader.dispose();
  await assert.rejects(prefetch, (error) => error.name === 'AbortError');
});
