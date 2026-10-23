// Regional archive sky for the 3D explorer.
//
// This is the bridge between the verified SPHEREx NEP products
// (`data/spherex/derived/`) and the Three.js sky. It deliberately does NOT
// generate a synthetic full-sky layer: the archive view contains exactly the
// two observations whose WCS, mask, units and checksums were verified by the
// product store, and the rest of the sphere is rendered as no-data by the
// client.
//
// Contract:
//
//   GET /api/spherex/sky/archive          index + provenance + shared stretch
//   GET /api/spherex/sky/archive/:id.png  one tangent-plane RGBA observation
//
// The PNG is north-up (row 0 is north), alpha 0 for every MASK=0 pixel, and
// uses one display stretch computed over BOTH epochs. Per-epoch auto-stretching
// would manufacture apparent brightness changes and is explicitly forbidden
// here.

import { createHash } from 'node:crypto';
import express from 'express';
import { encodePng } from './sky-tiles.js';

export const ARCHIVE_SKY_SCHEMA = 'novochar.spherex.sky-archive/v1';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const LOW_PCT = 0.01;
const HIGH_PCT = 0.99;

export class ArchiveSkyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArchiveSkyError';
    this.code = code;
  }
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = clamp(p, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function decodeRaster({ bytes, width, height }) {
  const plane = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ArchiveSkyError('archive_invalid', `archive raster has a bad shape ${width}x${height}`);
  }
  if (!bytes || bytes.length !== plane * 5) {
    throw new ArchiveSkyError(
      'archive_invalid',
      `archive raster is ${bytes?.length ?? 0} bytes, expected ${plane * 5} for ${width}x${height}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, plane * 4);
  const image = new Float32Array(plane);
  for (let i = 0; i < plane; i++) image[i] = view.getFloat32(i * 4, true);
  return { image, mask: bytes.subarray(plane * 4), width, height };
}

/**
 * Shared linear percentile stretch over valid pixels from every epoch.
 * `valid` follows the same rule as the FIELD viewer: MASK == 1 and finite.
 */
export function sharedStretch(rasters, { lowPct = LOW_PCT, highPct = HIGH_PCT } = {}) {
  const values = [];
  for (const raster of rasters) {
    const { image, mask } = raster;
    for (let i = 0; i < image.length; i++) {
      if (mask[i] === 1 && Number.isFinite(image[i])) values.push(image[i]);
    }
  }
  if (!values.length) {
    return { lo: 0, hi: 1, span: 1, sampleSize: 0, lowPct, highPct, method: 'shared-linear-percentile' };
  }
  values.sort((a, b) => a - b);
  const lo = percentile(values, lowPct);
  let hi = percentile(values, highPct);
  if (!(hi > lo)) hi = lo + Math.max(Math.abs(lo) * 1e-3, 1e-6);
  return {
    lo,
    hi,
    span: hi - lo,
    sampleSize: values.length,
    lowPct,
    highPct,
    method: 'shared-linear-percentile',
    note: 'One stretch is shared by every archive epoch; no epoch is auto-scaled independently.',
  };
}

/** RGBA PNG pixels for one observation. Invalid pixels keep alpha 0. */
export function renderArchivePixels(raster, stretch) {
  const { image, mask, width, height } = raster;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const span = stretch.hi - stretch.lo;
  for (let row = 0; row < height; row++) {
    // FITS row 0 is south for a north-up grid. The PNG contract (and the
    // existing HEALPix tiles) put north in row 0, so flip here once.
    const pngRow = height - 1 - row;
    for (let col = 0; col < width; col++) {
      const src = row * width + col;
      if (mask[src] !== 1 || !Number.isFinite(image[src])) continue;
      const t = span > 0 ? (image[src] - stretch.lo) / span : 0.5;
      const value = Math.round(255 * clamp(t, 0, 1));
      const dst = (pngRow * width + col) * 4;
      rgba[dst] = value;
      rgba[dst + 1] = value;
      rgba[dst + 2] = value;
      rgba[dst + 3] = 255;
    }
  }
  return rgba;
}

function epochId(role) {
  return role;
}

function epochLabel(epoch, index) {
  const date = epoch.archive?.date_obs_utc?.slice(0, 10) ?? `epoch ${index + 1}`;
  return date;
}

function epochNote(epoch, index) {
  const obs = epoch.archive ?? {};
  return [
    `Verified QR2 observation ${obs.obs_id ?? ''} of the NEP field.`,
    `Detector ${obs.detector ?? '—'}, ${obs.date_obs_utc ?? 'date unknown'}, pipeline ${obs.pipeline_version ?? 'unknown'}.`,
    index === 0
      ? 'First epoch of the pair; both epochs share one reprojection grid and display stretch.'
      : 'Second epoch of the pair; both epochs share one reprojection grid and display stretch.',
  ].join(' ');
}

/**
 * Create the archive service. The store is injected so tests never need Python
 * or network access; the production server passes the same verified store used
 * by the SPHEREx FIELD routes.
 */
export function createArchiveSkyService({ store } = {}) {
  if (!store || typeof store.metadata !== 'function' || typeof store.raster !== 'function') {
    throw new TypeError('createArchiveSkyService requires a product store');
  }

  let metadataPromise = null;
  let rastersPromise = null;
  let stretchPromise = null;
  const pngCache = new Map();
  const PNG_CACHE_LIMIT = 4;

  function metadata() {
    metadataPromise ??= store.metadata();
    return metadataPromise;
  }

  function rasters() {
    rastersPromise ??= (async () => {
      const meta = await metadata();
      const entries = await Promise.all(meta.epochs.map(async (epoch) => {
        const raw = await store.raster(epoch.role);
        return { role: epoch.role, raster: decodeRaster(raw), raw };
      }));
      return entries;
    })();
    return rastersPromise;
  }

  function stretch() {
    stretchPromise ??= rasters().then((entries) => sharedStretch(entries.map((entry) => entry.raster)));
    return stretchPromise;
  }

  function modelRevision(meta, display) {
    const digest = createHash('sha1')
      .update('archive-sky/v1')
      .update(meta.epochs.map((epoch) => epoch.derived?.output_sha256 ?? epoch.role).join(':'))
      .update(`:${display.lo}:${display.hi}:${display.lowPct}:${display.highPct}`)
      .digest('hex');
    return `archive-${digest.slice(0, 12)}`;
  }

  async function index() {
    const meta = await metadata();
    const display = await stretch();
    const revision = modelRevision(meta, display);
    const grid = meta.grid ?? {};
    const scaleArcsec = grid.pixel_scale_arcsec ?? 6.15;
    const [width, height] = grid.shape ?? [294, 294];
    const surface = {
      kind: 'regional-tan',
      center: { ra: grid.ra, dec: grid.dec, frame: grid.frame ?? 'ICRS' },
      shape: [width, height],
      pixel_scale_arcsec: scaleArcsec,
      angular_width_deg: (width * scaleArcsec) / 3600,
      angular_height_deg: (height * scaleArcsec) / 3600,
      orientation: 'north-up, east-left',
      x_axis_direction: 'west',
      y_axis_direction: 'north',
      projection: grid.projection ?? 'TAN',
      urlTemplate: '/api/spherex/sky/archive/{epoch}.png',
      initialFovDeg: 1.05,
      minFov: 0.18,
      maxFov: 12,
      textureRows: 'north-up',
      coverage: 'Only this tangent plane has archive pixels; the surrounding sphere is no-data.',
    };

    const epochs = meta.epochs.map((epoch, i) => ({
      id: epochId(epoch.role),
      role: epoch.role,
      index: i,
      label: `${String.fromCharCode(65 + i)} · ${epochLabel(epoch, i)}`,
      shortLabel: epochLabel(epoch, i),
      campaign: `${meta.release?.id ?? 'QR2'} · D${epoch.archive?.detector ?? '—'}`,
      dateLabel: epoch.archive?.date_obs_utc ?? null,
      status: 'archive',
      accent: i === 0 ? '#61e6ff' : '#ffb45c',
      coverage: epoch.derived?.stats?.valid_fraction ?? 0,
      gridCoverage: epoch.derived?.stats?.covered_fraction ?? 0,
      coverageLabel: 'valid NEP grid',
      coverageScope: 'NEP grid pixels',
      units: epoch.derived?.units ?? null,
      shape: epoch.derived?.shape ?? [width, height],
      note: epochNote(epoch, i),
      archive: epoch.archive,
      derived: {
        stats: epoch.derived?.stats ?? null,
        wcs: epoch.derived?.wcs ?? null,
        units: epoch.derived?.units ?? null,
        output_sha256: epoch.derived?.output_sha256 ?? null,
        arrays_sha256: epoch.derived?.arrays_sha256 ?? null,
        checks: epoch.derived?.checks ?? [],
      },
      raster: `/api/spherex/sky/archive/${epoch.role}.png`,
    }));

    return {
      schema: ARCHIVE_SKY_SCHEMA,
      mode: 'archive',
      modelRevision: revision,
      generatedAt: null,
      dataset: {
        id: 'nep-qr2-archive',
        label: 'SPHEREx NEP regional archive',
        field: meta.field?.name ?? 'North Ecliptic Pole',
        release: meta.release ?? null,
        mission: meta.mission ?? 'SPHEREx',
        product: meta.product?.type ?? null,
        baselineDays: meta.baseline_days ?? null,
        epochs: epochs.length,
        globalCoverage: false,
        regionOnly: true,
      },
      notice:
        'Regional archive view built from two verified QR2 NEP observations. ' +
        'Only the NEP tangent plane is observed here; the rest of the sphere is explicitly no-data. ' +
        'This is not a full-sky archive and it is not a quantitative difference product.',
      presentation: {
        eyebrow: 'SPHEREx / NEP ARCHIVE',
        title: 'Archive-backed regional 3D',
        badge: 'VERIFIED REGIONAL ARCHIVE',
        badgeTone: 'live',
        lede:
          'Two real SPHEREx QR2 observations of the North Ecliptic Pole, reprojected onto one agreed grid. ' +
          'Switch between them without moving the camera or changing the shared display stretch. ' +
          'No subtraction, variability statistic or motion claim is computed.',
        noDataLabel: 'NO ARCHIVE DATA',
        observedLabel: 'VERIFIED NEP PIXELS',
        coverageLabel: 'VALID GRID',
      },
      surface,
      grid: {
        ...grid,
        shape: [width, height],
        wcs: epochs[0]?.derived.wcs ?? null,
      },
      release: meta.release ?? null,
      rights: meta.rights ?? null,
      method: meta.method ?? null,
      display,
      comparison: {
        quantitativeDifferenceEnabled: Boolean(meta.gate?.quantitative_difference_enabled),
        gated: meta.gate ?? null,
        policy:
          'Each epoch may be inspected independently. No difference image or variability measurement is exposed.',
      },
      gate: meta.gate ?? null,
      caveats: meta.caveats ?? [],
      epochs,
      sources: {
        mode: 'archive',
        candidates: [],
        note: 'No change candidates are generated from archive pixels. Quantitative comparison is gated off.',
      },
      noData: {
        label: 'No archive coverage in this view',
        color: '#0a1118',
        note: 'Only the NEP field has been ingested. The rest of the sphere is deliberately rendered as no-data.',
      },
    };
  }

  async function render(role) {
    const meta = await metadata();
    const epoch = meta.epochs.find((entry) => entry.role === role);
    if (!epoch) throw new ArchiveSkyError('unknown_epoch', `unknown archive epoch "${role}"`);
    const display = await stretch();
    const revision = modelRevision(meta, display);
    const key = `${role}:${revision}`;
    const cached = pngCache.get(key);
    if (cached) {
      pngCache.delete(key);
      pngCache.set(key, cached);
      return { ...cached, cached: true };
    }

    const entries = await rasters();
    const entry = entries.find((item) => item.role === role);
    if (!entry) throw new ArchiveSkyError('archive_unavailable', `no raster for archive epoch "${role}"`);
    const { raster, raw } = entry;
    const png = encodePng(raster.width, raster.height, renderArchivePixels(raster, display));
    if (!PNG_SIGNATURE.equals(png.subarray(0, 8))) {
      throw new ArchiveSkyError('archive_invalid', 'archive PNG encoder produced an invalid signature');
    }
    const result = {
      png,
      etag: `"${createHash('sha1').update(`${revision}:${role}:${raw.sha256}`).digest('hex')}"`,
      mode: 'archive',
      revision,
      epoch: role,
      role,
      width: raster.width,
      height: raster.height,
      sourceSha256: raw.sha256,
      outputSha256: epoch.derived?.output_sha256 ?? null,
      stretch: display,
      cached: false,
    };
    if (pngCache.size >= PNG_CACHE_LIMIT) {
      const oldest = pngCache.keys().next().value;
      if (oldest !== undefined) pngCache.delete(oldest);
    }
    pngCache.set(key, result);
    return result;
  }

  function clearCache() {
    pngCache.clear();
    metadataPromise = null;
    rastersPromise = null;
    stretchPromise = null;
  }

  return { index, render, clearCache };
}

export function statusForArchiveError(error) {
  if (!(error instanceof ArchiveSkyError)) return 500;
  if (error.code === 'unknown_epoch') return 404;
  if (error.code === 'archive_invalid') return 500;
  return 503;
}

function sendArchiveError(res, error) {
  res.status(statusForArchiveError(error)).json({
    error: error?.message ?? 'unknown archive failure',
    code: error?.code ?? null,
  });
}

/** HTTP surface for the regional archive contract. */
export function createSpherexArchiveSkyRouter(service) {
  if (!service || typeof service.index !== 'function' || typeof service.render !== 'function') {
    throw new TypeError('createSpherexArchiveSkyRouter requires an archive service');
  }
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
      res.json(await service.index());
    } catch (error) {
      sendArchiveError(res, error);
    }
  });

  router.get('/:epoch.png', async (req, res) => {
    try {
      const result = await service.render(req.params.epoch);
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        ETag: result.etag,
        'X-Novochar-Sky-Mode': result.mode,
        'X-Novochar-Sky-Revision': result.revision,
        'X-Novochar-Sky-Epoch': result.epoch,
        'X-Novochar-Sky-Role': result.role,
        'X-Novochar-Sky-Width': String(result.width),
        'X-Novochar-Sky-Height': String(result.height),
        'X-Novochar-Sky-Source-Sha256': result.sourceSha256 ?? '',
        'X-Novochar-Sky-Output-Sha256': result.outputSha256 ?? '',
        'X-Novochar-Sky-Cached': result.cached ? '1' : '0',
      });
      if (req.headers['if-none-match'] === result.etag) return res.status(304).end();
      return res.status(200).send(result.png);
    } catch (error) {
      return sendArchiveError(res, error);
    }
  });

  return router;
}
