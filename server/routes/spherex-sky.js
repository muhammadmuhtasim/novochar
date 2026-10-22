// HTTP surface for the four-epoch sky-tile pyramid.
//
// The routes are intentionally thin: validation, cache headers and honest
// errors live here; the tile math lives in server/spherex/sky-tiles.js. Tests
// can inject a renderer so the HTTP contract is exercised without spending CPU
// on PNG generation.

import express from 'express';
import {
  renderBase,
  renderTile,
  skyIndex,
  skySources,
  SkyTileError,
} from '../spherex/sky-tiles.js';

export function statusForSkyError(error) {
  if (!(error instanceof SkyTileError)) return 500;
  if (error.code === 'unknown_epoch') return 404;
  if (error.code === 'bad_tile' || error.code === 'bad_request') return 400;
  return 500;
}

function sendPng(req, res, result, headers = {}) {
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.set('ETag', result.etag);
  res.set('X-Novochar-Sky-Mode', result.mode ?? 'illustrative');
  res.set('X-Novochar-Sky-Cached', result.cached ? '1' : '0');
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) res.set(key, String(value));
  }
  if (req.headers['if-none-match'] === result.etag) {
    return res.status(304).end();
  }
  return res.status(200).send(result.png);
}

/**
 * @param {object} [options]
 * @param {Function} [options.renderTile]
 * @param {Function} [options.renderBase]
 * @param {Function} [options.index]
 * @param {Function} [options.sources]
 */
export function createSpherexSkyRouter(options = {}) {
  if (options === null) {
    throw new TypeError('createSpherexSkyRouter requires an options object, not null');
  }
  const opts = options ?? {};
  const getTile = opts.renderTile === undefined ? renderTile : opts.renderTile;
  const getBase = opts.renderBase === undefined ? renderBase : opts.renderBase;
  const getIndex = opts.index === undefined ? skyIndex : opts.index;
  const getSources = opts.sources === undefined ? skySources : opts.sources;

  if (
    typeof getTile !== 'function' ||
    typeof getBase !== 'function' ||
    typeof getIndex !== 'function' ||
    typeof getSources !== 'function'
  ) {
    throw new TypeError('createSpherexSkyRouter requires renderTile, renderBase, index and sources functions');
  }

  const router = express.Router();

  router.get('/', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    res.json(getIndex());
  });

  router.get('/sources', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    res.json(getSources());
  });

  router.get('/base/:epoch.png', (req, res) => {
    try {
      const result = getBase({ epoch: req.params.epoch });
      return sendPng(req, res, result, {
        'X-Novochar-Sky-Epoch': result.epoch,
        'X-Novochar-Sky-Width': result.width,
        'X-Novochar-Sky-Height': result.height,
      });
    } catch (error) {
      return res.status(statusForSkyError(error)).json({
        error: error.message,
        code: error.code ?? null,
      });
    }
  });

  router.get('/tile/:epoch/:order/:ipix.png', (req, res) => {
    try {
      const result = getTile({
        epoch: req.params.epoch,
        order: req.params.order,
        ipix: req.params.ipix,
      });
      return sendPng(req, res, result, {
        'X-Novochar-Sky-Epoch': result.epoch,
        'X-Novochar-Sky-Order': result.order,
        'X-Novochar-Sky-Ipix': result.ipix,
        'X-Novochar-Sky-Size': result.size,
      });
    } catch (error) {
      return res.status(statusForSkyError(error)).json({
        error: error.message,
        code: error.code ?? null,
      });
    }
  });

  return router;
}
