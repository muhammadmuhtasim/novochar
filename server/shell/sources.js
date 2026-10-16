// Shell source registry for the spherical-shell explorer (Milestone 2).
//
// Each source declares what it can actually do (plan §8.1) and adapts its own
// records into the canonical shell row. Nothing downstream knows a source's raw
// schema, and no source is silently reinterpreted:
//
//   { id, name, ra, dec, frame, type, evidence, provenance, qualityNotes, mag }
//
// `evidence` is the input to the shared drift-free distance classifier
// (`classifyDistanceEvidence`); it is built here, at the ingestion boundary,
// where the source's own distance semantics are known. `mag` (and, for stars,
// `spectralType`) are display-only fields carried through unchanged so the
// renderers keep sizing and labelling records as the source published them.
//
// Two honesty rules are enforced here rather than left to chance:
//   * the frame policy is applied server-side exactly as the client applies it —
//     a non-ICRS catalogue is reported, never treated as ICRS;
//   * a parallax is converted to a distance, or — when its measurement error is
//     also published — to an asymmetric distance interval. It is never turned
//     into a symmetric uncertainty, and a distance carried without an uncertainty
//     is flagged so the UI cannot imply more than the source actually says.

import { LIGHT_YEARS_PER_PARSEC } from '@novochar/astro';
import { loadStarCatalog } from '../catalog/index.js';
import { generateSurvey } from '../data.js';

/** Canonical distance unit of the shell layer (matches the shared core). */
export const SHELL_DISTANCE_UNIT = 'ly';

const CANONICAL_FRAME = 'icrs';

function frameToken(frame) {
  return String(frame ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** The catalog frame policy, applied server-side exactly as the client does. */
export function isCanonicalFrame(frame) {
  return frameToken(frame) === CANONICAL_FRAME;
}

/**
 * Distance in light-years for a trigonometric parallax in milliarcseconds.
 * distance(pc) = 1 / parallax(arcsec) = 1000 / parallax(mas). Returns null for a
 * non-positive or non-finite parallax — a non-measurement is not a distance.
 */
export function parallaxMasToLightYears(parallaxMas) {
  if (typeof parallaxMas !== 'number' || !Number.isFinite(parallaxMas) || parallaxMas <= 0) {
    return null;
  }
  return (1000 / parallaxMas) * LIGHT_YEARS_PER_PARSEC;
}

function finitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Asymmetric distance interval from a parallax and its standard error, in
 * canonical light-years. Because distance varies as 1/parallax, the interval
 * runs from the distance at (parallax + error) up to the distance at
 * (parallax − error): the *larger* parallax is the *nearer* bound. If the lower
 * parallax is not positive the far side is unbounded, so the upper bound is
 * Infinity — said plainly rather than capped into a fake finite number.
 *
 * @returns {{low:number, high:number}|null}
 */
export function parallaxIntervalLightYears(parallaxMas, parallaxErrorMas) {
  if (!finitePositive(parallaxMas) || typeof parallaxErrorMas !== 'number'
    || !Number.isFinite(parallaxErrorMas) || parallaxErrorMas <= 0) {
    return null;
  }
  const low = parallaxMasToLightYears(parallaxMas + parallaxErrorMas);
  if (!finitePositive(low)) return null;
  const high = parallaxMas - parallaxErrorMas > 0
    ? parallaxMasToLightYears(parallaxMas - parallaxErrorMas)
    : Infinity;
  return { low, high };
}

/** Pick the best distance evidence a star artifact offers, with its caveat. */
function starEvidence(star) {
  if (finitePositive(star.distanceLy)) {
    return {
      evidence: { kind: 'point', value: star.distanceLy, unit: SHELL_DISTANCE_UNIT },
      notes: ['distance-without-uncertainty'],
    };
  }
  const interval = parallaxIntervalLightYears(star.parallaxMas, star.parallaxErrorMas);
  if (interval) {
    return {
      evidence: { kind: 'interval', low: interval.low, high: interval.high, unit: SHELL_DISTANCE_UNIT },
      notes: ['distance-from-parallax', 'distance-interval'],
    };
  }
  const derived = parallaxMasToLightYears(star.parallaxMas);
  if (finitePositive(derived)) {
    return {
      evidence: { kind: 'point', value: derived, unit: SHELL_DISTANCE_UNIT },
      notes: ['distance-from-parallax', 'distance-without-uncertainty'],
    };
  }
  return { evidence: { kind: 'missing', reason: 'no-distance' }, notes: ['directional-only'] };
}

/**
 * Adapt a published star artifact into shell rows.
 * A non-ICRS catalogue is rejected as a whole: every record is reported in
 * `skipped` with an `unsupported-frame:*` reason rather than converted here.
 *
 * @returns {{rows: object[], skipped: object[], frame: string|null}}
 */
export function starRows(catalog) {
  const stars = Array.isArray(catalog?.stars) ? catalog.stars : [];
  const frame = catalog?.frame ?? null;

  if (!isCanonicalFrame(frame)) {
    return {
      rows: [],
      skipped: stars.map((star) => ({
        id: typeof star?.id === 'string' ? star.id : null,
        reason: frame ? `unsupported-frame:${String(frame)}` : 'missing-frame',
      })),
      frame: frame ?? null,
    };
  }

  const rows = [];
  const skipped = [];
  for (const star of stars) {
    if (!star || typeof star.id !== 'string' || star.id === '') {
      skipped.push({ id: null, reason: 'missing-id' });
      continue;
    }
    if (!Number.isFinite(star.ra) || !Number.isFinite(star.dec)) {
      skipped.push({ id: star.id, reason: 'invalid-position' });
      continue;
    }
    const { evidence, notes } = starEvidence(star);
    rows.push({
      id: star.id,
      name: star.name || star.id,
      ra: star.ra,
      dec: star.dec,
      frame: CANONICAL_FRAME,
      type: star.type || 'STAR',
      mag: Number.isFinite(star.mag) ? star.mag : null,
      spectralType: star.spectralType ?? null,
      evidence,
      provenance: {
        source: 'stars',
        sourceId: star.id,
        catalog: catalog?.source?.catalog || catalog?.source?.id || 'stars',
      },
      qualityNotes: notes,
    });
  }
  return { rows, skipped, frame: catalog?.frame ?? null };
}

/** Adapt the simulated survey objects into shell rows (heliocentric distance). */
export function surveyRows(objects) {
  const list = Array.isArray(objects) ? objects : [];
  const rows = [];
  const skipped = [];
  for (const object of list) {
    if (!object || typeof object.id !== 'string' || object.id === '') {
      skipped.push({ id: null, reason: 'missing-id' });
      continue;
    }
    if (!Number.isFinite(object.ra) || !Number.isFinite(object.dec)) {
      skipped.push({ id: object.id, reason: 'invalid-position' });
      continue;
    }
    const evidence = finitePositive(object.distanceLy)
      ? { kind: 'point', value: object.distanceLy, unit: SHELL_DISTANCE_UNIT }
      : { kind: 'missing', reason: 'no-distance' };
    rows.push({
      id: object.id,
      name: object.name || object.id,
      ra: object.ra,
      dec: object.dec,
      frame: CANONICAL_FRAME,
      type: object.type || 'OBJECT',
      mag: Number.isFinite(object.mag) ? object.mag : null,
      evidence,
      provenance: { source: 'survey', sourceId: object.id, catalog: 'SPHEREx survey (simulated)' },
      qualityNotes: evidence.kind === 'point' ? ['heliocentric-distance', 'simulated'] : ['simulated'],
    });
  }
  return { rows, skipped, frame: CANONICAL_FRAME };
}

/**
 * The shell source registry. Each entry declares what it can actually do (plan
 * §8.1) and produces shell rows. `load(world)` receives data the caller has
 * already parsed, so a query never re-reads a catalogue from disk.
 */
export const SHELL_SOURCES = Object.freeze([
  Object.freeze({
    id: 'survey',
    label: 'SPHEREx survey candidates (simulated)',
    kind: 'simulated',
    capabilities: Object.freeze({
      distance: 'heliocentric-point',
      distanceUnit: SHELL_DISTANCE_UNIT,
      uncertainty: false,
      frame: CANONICAL_FRAME,
      query: 'local-index',
      note: 'Simulated detections with model heliocentric distances; not a real catalogue.',
    }),
    load: (world = {}) => surveyRows(world.objects ?? generateSurvey().objects),
  }),
  Object.freeze({
    id: 'stars',
    label: 'Bright-star catalogue',
    kind: 'catalogue',
    capabilities: Object.freeze({
      distance: 'parallax-and-interval-when-present',
      distanceUnit: SHELL_DISTANCE_UNIT,
      // The adapter carries an uncertainty whenever the catalogue publishes a
      // parallax error (as an asymmetric interval). The bundled CC0 fixture
      // publishes neither a parallax nor an error, so today this layer is empty
      // until a distance-bearing catalogue is enabled.
      uncertainty: true,
      frame: CANONICAL_FRAME,
      query: 'local-index',
      note: 'Distance from an adopted value, or a parallax (with its error as an interval) when present.',
    }),
    load: (world = {}) => starRows(world.stars ?? loadStarCatalog()),
  }),
]);

/** Look up a registry entry by id. */
export function findShellSource(id) {
  return SHELL_SOURCES.find((source) => source.id === id) ?? null;
}

/** Ids of every registered source, in registry order. */
export function shellSourceIds() {
  return SHELL_SOURCES.map((source) => source.id);
}
