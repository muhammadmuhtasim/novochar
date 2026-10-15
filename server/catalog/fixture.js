// Adapter for the committed star fixture (data/catalog/fixture/stars.json).
//
// The fixture is deliberately small, authored for Novochar and dedicated to the
// public domain (CC0). It exists so the deterministic preprocessing pipeline and
// the renderer can be built and tested while the production catalogue choice is
// on hold pending redistribution terms (see data/catalog/PROVENANCE.md).
//
// This adapter is our own code: it maps the fixture's simple record shape onto
// the published star contract. Missing values (proper motion, parallax) are kept
// as explicit nulls — never zero-filled — so downstream code must handle them.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = path.resolve(
  __dirname, '..', '..', 'data', 'catalog', 'fixture', 'stars.json'
);

function normalizeFixtureRecord(record, source) {
  return {
    id: record.id,
    name: record.name || record.id,
    aliases: Array.isArray(record.aliases) ? record.aliases.slice() : [],
    type: 'STAR',
    ra: record.ra,
    dec: record.dec,
    refEpochJD: source.referenceEpochJD,
    // The fixture intentionally carries no astrometric motion or parallax; keep
    // them null so the pipeline exercises the "missing stays missing" path.
    pmRaMasYr: null,
    pmDecMasYr: null,
    mag: record.mag ?? null,
    bv: record.bv ?? null,
    spectralType: record.spectralType ?? null,
    parallaxMas: null,
    distanceLy: null,
  };
}

/** Build the versioned star-catalog artifact from the fixture (or raw JSON). */
export function buildFixtureCatalog(raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))) {
  const source = raw.source || {};
  const stars = (Array.isArray(raw.records) ? raw.records : [])
    .map((record) => normalizeFixtureRecord(record, source));
  return {
    schema: 'novochar.stars/v1',
    source,
    frame: source.frame || 'ICRS',
    equinox: source.equinox || 'J2000',
    referenceEpochJD: source.referenceEpochJD ?? 2451545.0,
    count: stars.length,
    dropped: 0,
    stars,
  };
}
