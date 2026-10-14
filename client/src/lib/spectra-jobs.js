// Promise-based facade over the SPECTRA Web Worker.
//
// A single worker is created lazily and shared. When Web Workers are unavailable
// (SSR, jsdom unit tests) or the worker fails to start, the jobs fall back to
// running synchronously on the main thread so behaviour is never lost — just
// off the critical path when the platform allows it.
import { nearestGridIndices, estimateRedshift } from './spectral-analysis.js';

let worker;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker !== undefined) return worker; // null once we've given up
  if (typeof Worker === 'undefined') { worker = null; return worker; }
  try {
    worker = new Worker(new URL('./spectra-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data || {};
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (ok) job.resolve(result);
      else job.reject(new Error(error || 'worker job failed'));
    };
    worker.onerror = () => {
      // The worker died (e.g. failed to load). Recover by running every
      // in-flight job on the main thread instead of rejecting them, then fall
      // back for good so the feature keeps working.
      const dead = worker;
      worker = null;
      if (dead && typeof dead.terminate === 'function') dead.terminate();
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) {
        try { job.resolve(job.fallback()); } catch (err) { job.reject(err); }
      }
    };
  } catch {
    worker = null;
  }
  return worker;
}

function post(type, payload, fallback) {
  const w = ensureWorker();
  if (!w) return Promise.resolve().then(fallback);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, fallback });
    try {
      w.postMessage({ id, type, payload });
    } catch (err) {
      // e.g. DataCloneError on a non-cloneable payload — settle rather than
      // leave the caller hanging with an orphaned pending entry.
      pending.delete(id);
      reject(err);
    }
  });
}

/** Nearest-source index grid for the HEALPix hover map. */
export function nearestGrid(ra, dec, geom, cols) {
  return post('nearestGrid', { ra, dec, geom, cols }, () => nearestGridIndices(ra, dec, geom, cols));
}

/** Best-fit redshift by template cross-correlation. */
export function autoRedshift(sed, lines, opts) {
  return post('autoZ', { sed, lines, opts }, () => estimateRedshift(sed, lines, opts));
}
