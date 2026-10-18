// M3-C HTTP surface for the real reprojected SPHEREx products.
//
// These routes live in their own module — unlike the rest of the server, which
// registers inline in index.js — because the product store has to be injectable:
// `npm test` must never need Python, a network fetch or a warm cache. Everything
// here is exercised against a fake store; the real path runs in the browser
// acceptance.
//
//   GET /api/spherex/products             metadata only (archive | derived | gate)
//   GET /api/spherex/products/:role/raster  bytes, already formatted for display
//
// There is deliberately no route that compares, subtracts or differences two
// epochs. Contract 4 (docs/spherex-m3c-contracts.md) makes that absence a test
// rather than a convention.

import express from 'express';
import { ProductError, WIRE_FORMAT } from '../store/spherex-products.js';

/**
 * A missing sidecar, an unretrievable cutout or a failed reprojection are
 * retryable environment states (503), not client mistakes (404).
 */
export function statusForError(err) {
  if (err instanceof ProductError) return err.code === 'product_unavailable' ? 404 : 503;
  return 500;
}

function sendError(res, err) {
  res.status(statusForError(err)).json({
    error: err?.message ?? 'unknown failure',
    code: err?.code ?? null,
    detail: err?.detail ?? null,
  });
}

export function createSpherexProductsRouter(store) {
  if (!store || typeof store.metadata !== 'function' || typeof store.raster !== 'function') {
    throw new TypeError('createSpherexProductsRouter requires a product store');
  }

  const router = express.Router();

  router.get('/products', async (_req, res) => {
    try {
      res.json(await store.metadata());
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/products/:role/raster', async (req, res) => {
    try {
      const raster = await store.raster(req.params.role);
      res.set({
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'x-novochar-wire': WIRE_FORMAT,
        'x-novochar-width': String(raster.width),
        'x-novochar-height': String(raster.height),
        'x-novochar-sha256': raster.sha256,
      });
      res.send(Buffer.from(raster.bytes));
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
