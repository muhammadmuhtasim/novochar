// Off-main-thread PNG decode for sky tiles.
//
// The worker fetches the tile and turns it into a north-up ImageBitmap. The
// bitmap is transferable, so the main thread receives a GPU-ready object
// without parsing PNG bytes or blocking on decode. Cancellation aborts the
// fetch as well.

import { decodeSkyTile } from './sky-tile-decode.js';

const controllers = new Map();

self.onmessage = async (event) => {
  const data = event.data || {};
  const { id, url, cancel } = data;

  if (cancel) {
    controllers.get(id)?.abort();
    controllers.delete(id);
    return;
  }

  if (!id || !url) return;
  const controller = new AbortController();
  controllers.set(id, controller);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'image/png' },
    });
    if (!response.ok) {
      throw new Error(`tile HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const bitmap = await decodeSkyTile(blob);
    controllers.delete(id);
    self.postMessage(
      { id, ok: true, bitmap, bytes: blob.size, type: blob.type },
      [bitmap],
    );
  } catch (error) {
    controllers.delete(id);
    const aborted = controller.signal.aborted || error?.name === 'AbortError';
    self.postMessage({
      id,
      ok: false,
      aborted,
      error: aborted ? 'aborted' : String(error?.message || error),
    });
  }
};
