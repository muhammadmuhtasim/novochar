// Unit tests for the canonical Observe catalog object model.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  buildCatalog,
  CATALOG_FRAME,
  CATALOG_PM_UNIT,
  CATALOG_SCHEMA_VERSION,
  normalizeRecord,
  validateRecord,
} from './catalog.js';

const validRow = (over = {}) => ({
  id: 'HD 1',
  name: 'HD 1',
  ra: 12.5,
  dec: -30.25,
  frame: 'icrs',
  ...over,
});

/** Small deterministic PRNG so the property tests are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('a valid ICRS row normalizes to the canonical model', () => {
  const rec = normalizeRecord(validRow({ mag: 5.2, extras: { note: 'x' } }));
  assert.equal(rec.schema, CATALOG_SCHEMA_VERSION);
  assert.equal(rec.id, 'HD 1');
  assert.equal(rec.name, 'HD 1');
  assert.equal(rec.ra, 12.5);
  assert.equal(rec.dec, -30.25);
  assert.equal(rec.mag, 5.2);
  assert.equal(rec.pmRa, null);
  assert.equal(rec.pmDec, null);
  assert.equal(rec.pmUnits, CATALOG_PM_UNIT);
  assert.equal(rec.frame, CATALOG_FRAME);
  assert.deepEqual(rec.extras, { note: 'x' });
});

test('name falls back to the id and extras default to an empty object', () => {
  const rec = normalizeRecord({ id: 'x', ra: 1, dec: 2, frame: 'icrs' });
  assert.equal(rec.name, 'x');
  assert.equal(rec.mag, null);
  assert.deepEqual(rec.extras, {});

  const blank = normalizeRecord(validRow({ name: '   ' }));
  assert.equal(blank.name, 'HD 1');
});

test('ids are required, trimmed and must be strings', () => {
  assert.equal(validateRecord(validRow({ id: '' })), 'missing-id');
  assert.equal(validateRecord(validRow({ id: '   ' })), 'missing-id');
  assert.equal(validateRecord(validRow({ id: 42 })), 'missing-id');
  assert.equal(normalizeRecord(validRow({ id: '  HD 42  ' })).id, 'HD 42');
  assert.equal(validateRecord(null), 'not-an-object');
  assert.equal(validateRecord(undefined), 'not-an-object');
});

test('coordinate ranges are validated at the edges', () => {
  assert.ok(normalizeRecord(validRow({ ra: 0, dec: -90 })));
  assert.ok(normalizeRecord(validRow({ ra: 359.999999, dec: 90 })));
  assert.equal(validateRecord(validRow({ ra: 360 })), 'invalid-ra');
  assert.equal(validateRecord(validRow({ ra: -0.001 })), 'invalid-ra');
  assert.equal(validateRecord(validRow({ dec: 90.0001 })), 'invalid-dec');
  assert.equal(validateRecord(validRow({ dec: -90.0001 })), 'invalid-dec');
  assert.equal(validateRecord(validRow({ ra: '10' })), 'invalid-ra');
  assert.equal(validateRecord(validRow({ dec: NaN })), 'invalid-dec');
});

test('optional magnitude must be finite when present', () => {
  assert.equal(normalizeRecord(validRow({ mag: 0 })).mag, 0);
  assert.equal(normalizeRecord(validRow({ mag: null })).mag, null);
  assert.equal(normalizeRecord(validRow()).mag, null);
  assert.equal(validateRecord(validRow({ mag: 'bright' })), 'invalid-mag');
  assert.equal(validateRecord(validRow({ mag: Infinity })), 'invalid-mag');
});

test('proper motion is converted to canonical mas/yr and units are validated', () => {
  const arcsec = normalizeRecord(validRow({ pmRa: 1.5, pmDec: -2.5, pmUnits: 'arcsec/yr' }));
  assert.equal(arcsec.pmRa, 1500);
  assert.equal(arcsec.pmDec, -2500);
  assert.equal(arcsec.pmUnits, 'mas/yr');

  const mas = normalizeRecord(validRow({ pmRa: 1.5, pmDec: -2.5, pmUnits: 'mas/year' }));
  assert.equal(mas.pmRa, 1.5);

  // Only one component is allowed; the other stays null.
  const one = normalizeRecord(validRow({ pmDec: 3, pmUnits: 'mas/yr' }));
  assert.equal(one.pmRa, null);
  assert.equal(one.pmDec, 3);

  assert.equal(validateRecord(validRow({ pmRa: 1, pmDec: 2 })), 'missing-pm-units');
  assert.equal(
    validateRecord(validRow({ pmRa: 1, pmDec: 2, pmUnits: 'pixels' })),
    'unsupported-pm-units:pixels',
  );
  assert.equal(validateRecord(validRow({ pmRa: 'x', pmDec: 2, pmUnits: 'mas/yr' })), 'invalid-pmRa');
  assert.equal(validateRecord(validRow({ pmRa: 2, pmDec: NaN, pmUnits: 'mas/yr' })), 'invalid-pmDec');
});

test('the source frame must be declared and must be ICRS', () => {
  assert.equal(validateRecord({ ...validRow(), frame: undefined }), 'missing-frame');
  assert.equal(validateRecord(validRow({ frame: 'fk5' })), 'unsupported-frame:fk5');
  assert.equal(validateRecord(validRow({ frame: 'galactic' })), 'unsupported-frame:galactic');

  // The frame option supplies a frame for rows that omit it (case-insensitive).
  assert.ok(normalizeRecord({ id: 'x', ra: 1, dec: 2 }, { frame: 'ICRS' }));
  // A non-ICRS option is a programming error, not a per-row data issue.
  assert.throws(() => normalizeRecord({ id: 'x', ra: 1, dec: 2 }, { frame: 'fk5' }), RangeError);
});

test('source-specific fields stay in extras and are never promoted', () => {
  const rec = normalizeRecord(validRow({ ra1950: 1, dec1950: 2, extras: { catalog: 'BSC5' } }));
  assert.deepEqual(rec.extras, { catalog: 'BSC5' });
  assert.ok(!('ra1950' in rec));
  assert.ok(!('dec1950' in rec));
});

test('normalization is idempotent', () => {
  const rec = normalizeRecord(validRow({ mag: 3.3, pmRa: 20, pmDec: -10, pmUnits: 'mas/yr', extras: { a: 1 } }));
  assert.deepEqual(normalizeRecord(rec), rec);
});

test('buildCatalog reports invalid and duplicate rows without losing the rest', () => {
  const cat = buildCatalog(
    [
      { id: 'a', ra: 1, dec: 1, frame: 'icrs' },
      { id: 'b', ra: -1, dec: 1, frame: 'icrs' }, // invalid RA
      { id: 'a', ra: 2, dec: 2, frame: 'icrs' }, // duplicate id
      { id: 'c', ra: 3, dec: 3 }, // missing frame
    ],
    { source: 'unit-test', meta: { version: 7 } },
  );

  assert.deepEqual(cat.records.map((r) => r.id), ['a']);
  assert.deepEqual(cat.issues, [
    { index: 1, id: 'b', reason: 'invalid-ra' },
    { index: 2, id: 'a', reason: 'duplicate-id:0' },
    { index: 3, id: 'c', reason: 'missing-frame' },
  ]);
  assert.deepEqual(cat.stats, { rows: 4, accepted: 1, rejected: 3 });
  assert.equal(cat.frame, CATALOG_FRAME);
  assert.deepEqual(cat.meta, { source: 'unit-test', version: 7 });
  assert.throws(() => buildCatalog('nope'), TypeError);
});

test('buildCatalog accepts exactly the individually valid rows (property)', () => {
  const rand = mulberry32(12345);
  for (let trial = 0; trial < 50; trial++) {
    const n = Math.floor(rand() * 30);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const row = validRow({ id: `r${trial}-${i}` });
      const roll = rand();
      if (roll < 0.2) row.ra = -1;
      else if (roll < 0.35) row.dec = 100;
      else if (roll < 0.45) row.mag = 'bright';
      else if (roll < 0.55) delete row.frame;
      rows.push(row);
    }
    const catalog = buildCatalog(rows);
    const expected = rows.filter((row) => validateRecord(row) === null).length;
    assert.equal(catalog.records.length, expected, `trial ${trial}`);
    assert.equal(catalog.stats.accepted + catalog.stats.rejected, catalog.stats.rows);
    for (const rec of catalog.records) {
      assert.deepEqual(normalizeRecord(rec), rec, `idempotent ${rec.id}`);
    }
  }
});
