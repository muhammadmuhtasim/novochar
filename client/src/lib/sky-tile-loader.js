// Priority queue + worker pool for progressive sky-tile loading.
//
// Design constraints:
//   * the visible base layer is fetched before detail tiles;
//   * duplicate requests for the same epoch/order/pixel share one promise;
//   * stale requests are abortable when the timeline or camera moves on;
//   * PNG decode happens in a worker, so the main thread only receives an
//     ImageBitmap and never parses image bytes;
//   * if workers are unavailable (older browser, test environment), a main
//     thread path keeps the view functional.

import { decodeSkyTile } from './sky-tile-decode.js';

function abortError(message = 'tile request aborted') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export class SkyTileLoader {
  constructor({ workerCount = 2, maxConcurrent = 4, onStats = null } = {}) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.onStats = onStats;
    this.queue = [];
    this.active = new Map();
    this.inflight = new Map();
    this.workers = [];
    this.nextId = 1;
    this.completed = 0;
    this.failed = 0;
    this.aborted = 0;
    this.bytes = 0;
    this.disposed = false;
    this._createWorkers(workerCount);
    this._emitStats();
  }

  _createWorkers(count) {
    if (typeof Worker === 'undefined') return;
    for (let index = 0; index < count; index++) {
      try {
        const worker = new Worker(new URL('./sky-tile-worker.js', import.meta.url), { type: 'module' });
        const slot = { worker, busy: false, dead: false, index };
        worker.onmessage = (event) => this._onWorkerMessage(slot, event);
        worker.onerror = () => this._onWorkerFailure(slot);
        worker.onmessageerror = () => this._onWorkerFailure(slot);
        this.workers.push(slot);
      } catch {
        // A worker can fail to construct under strict CSP or an old runtime;
        // the main-thread path is still valid.
        break;
      }
    }
  }

  request({ key, url, priority = 0 }) {
    if (this.disposed) return Promise.reject(new Error('sky tile loader is disposed'));
    if (!key || !url) return Promise.reject(new Error('sky tile request requires key and url'));
    if (this.inflight.has(key)) return this.inflight.get(key);

    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job = {
      id: this.nextId++,
      key,
      url,
      priority,
      resolve,
      reject,
      started: false,
      canceled: false,
      fallbackTried: false,
      worker: null,
      controller: null,
    };
    this.inflight.set(key, promise);
    this.queue.push(job);
    this._sortQueue();
    this._emitStats();
    queueMicrotask(() => this._pump());
    return promise;
  }

  _sortQueue() {
    // Descending priority; stable FIFO within the same priority.
    this.queue.sort((a, b) => (b.priority - a.priority) || (a.id - b.id));
  }

  _idleWorker() {
    return this.workers.find((slot) => !slot.busy && !slot.dead) ?? null;
  }

  _pump() {
    if (this.disposed) return;
    while (this.queue.length > 0) {
      const workerSlot = this._idleWorker();
      if (this.workers.length > 0 && !workerSlot) break;
      if (this.active.size >= this.maxConcurrent) break;
      const job = this.queue.shift();
      if (job.canceled) continue;
      this._start(job, workerSlot);
    }
    this._emitStats();
  }

  _start(job, workerSlot) {
    job.started = true;
    job.worker = workerSlot;
    this.active.set(job.id, job);
    if (workerSlot) {
      workerSlot.busy = true;
      workerSlot.worker.postMessage({ id: job.id, url: job.url });
    } else {
      this._fetchMainThread(job);
    }
    this._emitStats();
  }

  _onWorkerMessage(slot, event) {
    const data = event?.data || {};
    const job = this.active.get(data.id);
    if (!job) {
      data.bitmap?.close?.();
      return;
    }
    if (slot.busy) slot.busy = false;

    if (data.ok && data.bitmap) {
      this._finishSuccess(job, data.bitmap, data.bytes || 0);
      this._pump();
      return;
    }

    if (data.aborted || job.canceled) {
      this._finishAbort(job);
      this._pump();
      return;
    }

    // A decode/network failure in the worker is not fatal: retry this tile on
    // the main thread once, then let the caller decide.
    if (!job.fallbackTried) {
      job.fallbackTried = true;
      job.worker = null;
      this._fetchMainThread(job);
      this._pump();
      return;
    }

    this._finishFailure(job, new Error(data.error || 'tile decode failed'));
    this._pump();
  }

  _onWorkerFailure(slot) {
    if (slot.dead) return;
    slot.dead = true;
    slot.busy = false;
    this.workers = this.workers.filter((candidate) => candidate !== slot);
    try { slot.worker.terminate(); } catch { /* already gone */ }
    // Any job that was on this worker gets one main-thread retry.
    for (const job of [...this.active.values()]) {
      if (job.worker !== slot) continue;
      job.worker = null;
      if (!job.fallbackTried) {
        job.fallbackTried = true;
        this._fetchMainThread(job);
      } else {
        this._finishFailure(job, new Error('tile worker stopped'));
      }
    }
    this._pump();
  }

  async _fetchMainThread(job) {
    job.worker = null;
    if (job.canceled) {
      this._finishAbort(job);
      return;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    job.controller = controller;
    try {
      const response = await fetch(job.url, {
        signal: controller?.signal,
        headers: { Accept: 'image/png' },
      });
      if (!response.ok) throw new Error(`tile HTTP ${response.status}`);
      const blob = await response.blob();
      if (typeof createImageBitmap !== 'function') {
        throw new Error('createImageBitmap is unavailable in this browser');
      }
      const bitmap = await decodeSkyTile(blob);
      if (job.canceled) {
        bitmap.close?.();
        this._finishAbort(job);
      } else {
        this._finishSuccess(job, bitmap, blob.size);
      }
    } catch (error) {
      if (job.canceled || error?.name === 'AbortError') this._finishAbort(job);
      else this._finishFailure(job, error);
    } finally {
      job.controller = null;
      this._pump();
    }
  }

  _finishSuccess(job, bitmap, bytes) {
    if (this.active.get(job.id) !== job) return;
    if (job.canceled) {
      bitmap?.close?.();
      this._finishAbort(job);
      return;
    }
    this.active.delete(job.id);
    this.inflight.delete(job.key);
    this.completed += 1;
    this.bytes += bytes;
    if (job.worker) job.worker.busy = false;
    job.resolve(bitmap);
    this._emitStats();
  }

  _finishAbort(job) {
    if (this.active.get(job.id) !== job) return;
    this.active.delete(job.id);
    this.inflight.delete(job.key);
    this.aborted += 1;
    if (job.worker) job.worker.busy = false;
    job.reject(abortError());
    this._emitStats();
  }

  _finishFailure(job, error) {
    if (this.active.get(job.id) !== job) return;
    this.active.delete(job.id);
    this.inflight.delete(job.key);
    this.failed += 1;
    if (job.worker) job.worker.busy = false;
    job.reject(error);
    this._emitStats();
  }

  /**
   * Cancel queued and in-flight requests matching `predicate`.
   * Active worker jobs receive a cancel message; active main-thread jobs abort
   * their fetch. Every canceled promise rejects with an AbortError.
   */
  cancel(predicate = () => true) {
    const matches = typeof predicate === 'function' ? predicate : () => true;
    const keep = [];
    for (const job of this.queue) {
      if (matches(job)) {
        job.canceled = true;
        this.inflight.delete(job.key);
        this.aborted += 1;
        job.reject(abortError());
      } else {
        keep.push(job);
      }
    }
    this.queue = keep;
    for (const job of [...this.active.values()]) {
      if (!matches(job)) continue;
      job.canceled = true;
      if (job.worker) {
        job.worker.worker.postMessage({ id: job.id, cancel: true });
      }
      job.controller?.abort();
    }
    this._emitStats();
  }

  /** Keep only the active epoch's requests in flight. */
  cancelExceptEpoch(epoch) {
    this.cancel((job) => !String(job.key).startsWith(`${epoch}:`));
  }

  _emitStats() {
    this.onStats?.({
      active: this.active.size,
      queued: this.queue.length,
      completed: this.completed,
      failed: this.failed,
      aborted: this.aborted,
      bytes: this.bytes,
      workers: this.workers.length,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel(() => true);
    // `cancel` waits for a worker acknowledgement for active jobs; dispose
    // terminates the workers immediately, so settle those promises here rather
    // than leaving callers waiting forever.
    for (const job of [...this.active.values()]) this._finishAbort(job);
    this.active.clear();
    this.inflight.clear();
    for (const slot of this.workers) {
      try { slot.worker.terminate(); } catch { /* already gone */ }
    }
    this.workers = [];
    this.queue = [];
    this.active.clear();
    this.inflight.clear();
    this._emitStats();
  }
}
