// Client-side tile contract for the four-epoch 3D sky.
//
// The server owns the HEALPix pixel definitions and the PNG bytes. This module
// owns the browser-side policy: which tiles the current view needs, how the
// URLs are formed, and how many decoded textures may stay resident. Keeping the
// policy here (rather than inside the Three.js component) makes it testable
// without a GPU.

import {
  nestChildren,
  nside2npix,
  order2nside,
  pixelCenterRaDec,
} from '@novochar/astro';

export const SKY_TILE_SIZE = 128;
export const SKY_BASE_ORDER = 1;
export const SKY_MAX_ORDER = 4;

/** Stable cache / mesh key for one epoch tile. */
export function tileKey(epoch, order, ipix) {
  return `${epoch}:${order}:${ipix}`;
}

/** Fill a server URL template such as `/tile/{epoch}/{order}/{ipix}.png`. */
export function fillTileTemplate(template, { epoch, order, ipix }) {
  return String(template)
    .replaceAll('{epoch}', encodeURIComponent(epoch))
    .replaceAll('{order}', String(order))
    .replaceAll('{ipix}', String(ipix));
}

/** URL for one tile. */
export function tileUrl(template, { epoch, order, ipix }) {
  return fillTileTemplate(template, { epoch, order, ipix });
}

/** URL for the equirectangular base texture of an epoch. */
export function baseUrl(template, epoch) {
  return fillTileTemplate(template, { epoch });
}

const PIXEL_CACHE = new Map();
const CENTER_CACHE = new Map();

/** All NEST pixel indices at an order (memoized). */
export function allPixels(order) {
  if (!PIXEL_CACHE.has(order)) {
    const npix = nside2npix(order2nside(order));
    PIXEL_CACHE.set(order, Array.from({ length: npix }, (_, index) => index));
  }
  return PIXEL_CACHE.get(order);
}

/** Pixel centres at an order, memoized as { ipix, ra, dec }. */
export function pixelCenters(order) {
  if (!CENTER_CACHE.has(order)) {
    CENTER_CACHE.set(order, allPixels(order).map((ipix) => {
      const { ra, dec } = pixelCenterRaDec(order, ipix);
      return { ipix, ra, dec };
    }));
  }
  return CENTER_CACHE.get(order);
}

function angularDistanceRad(ra1, dec1, ra2, dec2) {
  const d2r = Math.PI / 180;
  const a1 = ra1 * d2r;
  const d1 = dec1 * d2r;
  const a2 = ra2 * d2r;
  const d2 = dec2 * d2r;
  const cosSep = Math.sin(d1) * Math.sin(d2) +
    Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, cosSep)));
}

/**
 * Nearest pixels at an order to a view direction. Returned in ascending
 * angular distance; the distance is in radians.
 */
export function nearestPixels(order, ra, dec, count) {
  if (!Number.isInteger(count) || count <= 0) return [];
  const candidates = pixelCenters(order).map((pixel) => ({
    ...pixel,
    distanceRad: angularDistanceRad(ra, dec, pixel.ra, pixel.dec),
  }));
  candidates.sort((a, b) => a.distanceRad - b.distanceRad || a.ipix - b.ipix);
  return candidates.slice(0, count);
}

/**
 * The tile set a view needs.
 *
 * - the complete base order is always requested, so the whole sky is covered;
 * - finer orders are the four children of the nearest parents, so refinement
 *   is contiguous and follows the camera instead of downloading the sky;
 * - the returned `priority` is descending: base coverage first, then the
 *   highest-resolution detail closest to the view.
 */
export function detailTilesForView({
  ra,
  dec,
  fovDeg,
  baseOrder = SKY_BASE_ORDER,
  maxOrder = SKY_MAX_ORDER,
  detailParents = { 2: 8, 3: 4, 4: 3 },
}) {
  const tiles = [];
  const seen = new Set();
  const add = (order, ipix, distanceRad, priority) => {
    const key = `${order}:${ipix}`;
    if (seen.has(key)) return;
    seen.add(key);
    tiles.push({ order, ipix, distanceRad, priority });
  };

  // Base layer: all 48 order-1 pixels. Nearer pixels are requested first.
  for (const pixel of nearestPixels(baseOrder, ra, dec, nside2npix(order2nside(baseOrder)))) {
    add(baseOrder, pixel.ipix, pixel.distanceRad, 1000 - pixel.distanceRad * 10);
  }

  // The initial 62° view is already close enough to justify a small central
  // island of order-2 tiles; the low-resolution base still fills the edges, so
  // first paint stays cheap while the middle of the screen is sharp.
  const thresholds = { 2: 72, 3: 42, 4: 24 };
  for (let order = baseOrder + 1; order <= maxOrder; order++) {
    if (fovDeg > thresholds[order]) continue;
    const parents = nearestPixels(order - 1, ra, dec, detailParents[order] ?? 4);
    for (const parent of parents) {
      for (const child of nestChildren(parent.ipix)) {
        add(order, child, parent.distanceRad, 200 + order * 10 - parent.distanceRad);
      }
    }
  }

  return tiles;
}

/**
 * LRU texture cache with deterministic eviction and disposal.
 *
 * `weight` defaults to one texture slot; callers may pass approximate bytes so
 * a memory budget can be enforced instead of a raw count.
 */
export class SkyTextureCache {
  constructor({ max = 192, maxBytes = Infinity, dispose = null } = {}) {
    this.max = max;
    this.maxBytes = maxBytes;
    this.dispose = dispose;
    this.map = new Map();
    this.bytes = 0;
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, { bytes = 1 } = {}) {
    if (this.map.has(key)) {
      const previous = this.map.get(key);
      this.map.delete(key);
      this.bytes -= previous.bytes;
      this.dispose?.(previous.value, key);
    }
    this.map.set(key, { value, bytes });
    this.bytes += bytes;
    this._evict();
    return value;
  }

  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    this.bytes -= entry.bytes;
    this.dispose?.(entry.value, key);
    return true;
  }

  clear() {
    for (const [key, entry] of this.map) this.dispose?.(entry.value, key);
    this.map.clear();
    this.bytes = 0;
  }

  _evict() {
    while (
      this.map.size > this.max ||
      (this.bytes > this.maxBytes && this.map.size > 1)
    ) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) return;
      this.delete(oldest);
    }
  }
}

/** Approximate uploaded RGBA bytes for a 128x128 tile. */
export const SKY_TILE_BYTES = SKY_TILE_SIZE * SKY_TILE_SIZE * 4;

/**
 * Device-aware quality policy. The goal is to start on a cheap, predictable
 * path and let the engine lower the pixel ratio further if frames are slow.
 */
export function skyQualityProfile({
  deviceMemory = 8,
  hardwareConcurrency = 8,
  saveData = false,
  reducedMotion = false,
  mobile = false,
} = {}) {
  const low = mobile || saveData || deviceMemory <= 4 || hardwareConcurrency <= 4;
  return {
    tier: low ? 'low' : 'standard',
    pixelRatioCap: low ? 1.25 : 2,
    maxOrder: low ? 3 : SKY_MAX_ORDER,
    maxTextures: low ? 128 : 192,
    maxBytes: low ? 96 * 1024 * 1024 : 160 * 1024 * 1024,
    antialias: !low,
    workerCount: low ? 1 : 2,
    prefetch: !low && !reducedMotion,
    autoPlay: !reducedMotion,
    initialFov: 62,
  };
}
