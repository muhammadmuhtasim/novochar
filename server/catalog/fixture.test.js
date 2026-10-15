// Tests for the committed, explicitly redistributable star fixture and the
// source registry that defaults to it while the production catalogue is on hold.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixtureCatalog } from './fixture.js';
import { DEFAULT_STAR_SOURCE, loadStarCatalog, starSourceIds, validateStarCatalog } from './index.js';

test('fixture builds the versioned star contract', () => {
  const catalog = buildFixtureCatalog();
  assert.equal(catalog.schema, 'novochar.stars/v1');
  assert.equal(catalog.source.kind, 'fixture');
  assert.equal(catalog.source.license, 'CC0-1.0');
  assert.equal(catalog.frame, 'ICRS');
  assert.equal(catalog.referenceEpochJD, 2451545.0);
  assert.ok(catalog.count >= 5);
});

test('fixture stars carry identity and photometry but explicit nulls for astrometry', () => {
  const sirius = buildFixtureCatalog().stars.find((s) => s.id === 'star-sirius');
  assert.ok(sirius);
  assert.equal(sirius.name, 'Sirius');
  assert.equal(sirius.type, 'STAR');
  assert.equal(sirius.mag, -1.46);
  assert.equal(sirius.bv, 0);
  assert.equal(sirius.spectralType, 'A1V');
  assert.ok(sirius.aliases.includes('HR 2491'));
  // The fixture has no proper motion or parallax; they must stay null.
  assert.equal(sirius.pmRaMasYr, null);
  assert.equal(sirius.pmDecMasYr, null);
  assert.equal(sirius.parallaxMas, null);
  assert.equal(sirius.distanceLy, null);
});

test('the default source is the redistributable fixture, not a third-party catalogue', () => {
  assert.equal(DEFAULT_STAR_SOURCE, 'fixture');
  assert.ok(starSourceIds().includes('fixture'));
  const catalog = loadStarCatalog();
  assert.equal(catalog.source.kind, 'fixture');
});

test('unknown sources are rejected explicitly', () => {
  assert.throws(() => loadStarCatalog('does-not-exist'), /Unknown star catalog source/);
});

test('validateStarCatalog accepts a good artifact and rejects malformed ones', () => {
  const catalog = buildFixtureCatalog();
  assert.equal(validateStarCatalog(catalog), true);

  assert.throws(() => validateStarCatalog({ ...catalog, schema: 'nope' }), /schema/);
  assert.throws(() => validateStarCatalog({ ...catalog, stars: [] }), /count/);
  assert.throws(
    () => validateStarCatalog({ ...catalog, stars: [catalog.stars[0], catalog.stars[0]], count: 2 }),
    /duplicate/,
  );
  const badRa = { ...catalog.stars[0], ra: 400 };
  assert.throws(
    () => validateStarCatalog({ ...catalog, stars: [badRa], count: 1 }),
    /RA out of range/,
  );
  const badMag = { ...catalog.stars[0], mag: 'bright' };
  assert.throws(
    () => validateStarCatalog({ ...catalog, stars: [badMag], count: 1 }),
    /mag must be null or a finite number/,
  );
});
