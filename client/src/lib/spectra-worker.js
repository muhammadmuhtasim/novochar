// Dedicated worker for the CPU-bound SPECTRA jobs (nearest-source grid build and
// the redshift cross-correlation scan). Both are pure functions over plain data,
// so running them off the main thread keeps painting smooth even while a job is
// in flight. Each request carries an `id` that is echoed back on the reply.
import { nearestGridIndices, estimateRedshift } from './spectral-analysis.js';

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  try {
    let result;
    if (type === 'nearestGrid') {
      result = nearestGridIndices(payload.ra, payload.dec, payload.geom, payload.cols);
    } else if (type === 'autoZ') {
      result = estimateRedshift(payload.sed, payload.lines, payload.opts);
    } else {
      throw new Error(`unknown job: ${type}`);
    }
    // Transfer the Int32 grid buffer back instead of copying it.
    const transfer = result && result.buffer ? [result.buffer] : [];
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
