// Source registry for the star catalogue.
//
// Catalogue *data* and Novochar *code* are separated on purpose:
//   * the adapters below are our own code and stay open;
//   * the raw third-party files they can read live under data/catalog/raw/,
//     which is git-ignored and only populated once redistribution terms for that
//     catalogue are confirmed (see data/catalog/PROVENANCE.md).
//
// The default source is therefore the small, explicitly redistributable fixture.
// Switching to a real catalogue is a one-line change here plus vendoring its raw
// file — the contract, precompute step, API route and renderer stay unchanged.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureCatalog } from './fixture.js';
import { buildStarCatalog as buildBsc5Catalog } from './bsc5.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, '..', '..', 'data', 'catalog', 'raw');

export const DEFAULT_STAR_SOURCE = 'fixture';

const ADAPTERS = {
  fixture: {
    id: 'fixture',
    build: () => buildFixtureCatalog(),
  },
  // Candidate production source. Its raw file is not committed while terms are
  // pending; drop V/50 catalog.gz into data/catalog/raw/bsc5/ to enable it.
  bsc5: {
    id: 'bsc5',
    build: () => {
      const file = path.join(RAW_DIR, 'bsc5', 'catalog.gz');
      const text = gunzipSync(readFileSync(file)).toString('utf8');
      return buildBsc5Catalog(text);
    },
  },
};

const cache = new Map();

/** Parse (once per source) and return the versioned star-catalog artifact. */
export function loadStarCatalog(sourceId = DEFAULT_STAR_SOURCE) {
  if (cache.has(sourceId)) return cache.get(sourceId);
  const adapter = ADAPTERS[sourceId];
  if (!adapter) throw new Error(`Unknown star catalog source: ${sourceId}`);
  const catalog = adapter.build();
  cache.set(sourceId, catalog);
  return catalog;
}

/**
 * Validate a built star-catalog artifact against the published contract. Throws
 * on the first structural problem, so a broken or empty catalogue fails the
 * build instead of silently shipping a blank sky. Kept separate from parsing so
 * it can also guard any future adapter.
 */
export function validateStarCatalog(catalog) {
  const fail = (message) => { throw new Error(`Invalid star catalog: ${message}`); };
  if (!catalog || typeof catalog !== 'object') fail('not an object');
  if (catalog.schema !== 'novochar.stars/v1') fail(`unexpected schema "${catalog.schema}"`);
  if (!Number.isFinite(catalog.referenceEpochJD)) fail('referenceEpochJD must be finite');
  if (!Array.isArray(catalog.stars)) fail('stars must be an array');
  if (catalog.count !== catalog.stars.length) {
    fail(`count ${catalog.count} does not match stars.length ${catalog.stars.length}`);
  }
  if (catalog.stars.length === 0) fail('catalogue contains no stars');
  const seen = new Set();
  for (const star of catalog.stars) {
    if (typeof star.id !== 'string' || star.id === '') fail('star is missing an id');
    if (seen.has(star.id)) fail(`duplicate star id ${star.id}`);
    seen.add(star.id);
    if (star.type !== 'STAR') fail(`${star.id}: type must be "STAR"`);
    if (!Number.isFinite(star.ra) || star.ra < 0 || star.ra >= 360) fail(`${star.id}: RA out of range`);
    if (!Number.isFinite(star.dec) || star.dec < -90 || star.dec > 90) fail(`${star.id}: Dec out of range`);
    if (!Number.isFinite(star.refEpochJD)) fail(`${star.id}: refEpochJD must be finite`);
    for (const key of ['mag', 'bv', 'pmRaMasYr', 'pmDecMasYr', 'parallaxMas', 'distanceLy']) {
      const value = star[key];
      if (value !== null && value !== undefined && !Number.isFinite(value)) {
        fail(`${star.id}: ${key} must be null or a finite number`);
      }
    }
  }
  return true;
}

export function starSourceIds() {
  return Object.keys(ADAPTERS);
}

export { buildFixtureCatalog } from './fixture.js';
export { buildStarCatalog } from './bsc5.js';
