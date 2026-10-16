import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createObserveScene } from './scene.js';
import { starArtifactMeta, starArtifactToRows } from './source.js';

/** A minimal published `novochar.stars/v1` artifact, shaped like the server's. */
function artifact(overrides = {}) {
  return {
    schema: 'novochar.stars/v1',
    source: { id: 'fixture', name: 'Novochar fixture' },
    frame: 'ICRS',
    equinox: 'J2000',
    referenceEpochJD: 2451545,
    count: 2,
    stars: [
      {
        id: 'star-sirius',
        name: 'Sirius',
        aliases: ['Alp CMa', 'HR 2491'],
        type: 'STAR',
        ra: 101.2872,
        dec: -16.7161,
        refEpochJD: 2451545,
        pmRaMasYr: -546.01,
        pmDecMasYr: -1223.07,
        mag: -1.46,
        bv: 0,
        spectralType: 'A1V',
        parallaxMas: 379.21,
        distanceLy: 8.6,
      },
      {
        id: 'star-vega',
        name: 'Vega',
        type: 'STAR',
        ra: 279.2347,
        dec: 38.7837,
        refEpochJD: 2451545,
        pmRaMasYr: null,
        pmDecMasYr: null,
        mag: 0.03,
        bv: 0,
        spectralType: 'A0V',
        parallaxMas: 128.93,
        distanceLy: 25.3,
      },
    ],
    ...overrides,
  };
}

test('an ICRS artifact maps onto canonical rows and is accepted', () => {
  const rows = starArtifactToRows(artifact());
  assert.equal(rows.length, 2);

  // The artifact's declared frame is forwarded verbatim onto every row.
  assert.equal(rows[0].frame, 'ICRS');

  const scene = createObserveScene(starArtifactToRows(artifact()), { source: 'stars' });
  assert.deepEqual(scene.catalog.records.map((r) => r.id).sort(), ['star-sirius', 'star-vega']);
  assert.equal(scene.catalog.records[0].pmUnits, 'mas/yr');
});

test('the declared frame is forwarded and enforced by the catalog', () => {
  const rows = starArtifactToRows(artifact());
  assert.equal(rows[0].frame, 'ICRS');

  // Everything an ICRS artifact needs to be accepted.
  const accepted = createObserveScene(rows);
  assert.equal(accepted.catalog.records.length, 2);

  // An FK5 artifact is reported per row, never silently treated as ICRS.
  const fk5 = createObserveScene(starArtifactToRows(artifact({ frame: 'FK5' })));
  assert.equal(fk5.catalog.records.length, 0);
  assert.deepEqual(
    fk5.catalog.issues.map((i) => i.reason),
    ['unsupported-frame:FK5', 'unsupported-frame:FK5'],
  );

  // A missing frame is reported, not assumed.
  const none = createObserveScene(starArtifactToRows(artifact({ frame: undefined })));
  assert.deepEqual(
    none.catalog.issues.map((i) => i.reason),
    ['missing-frame', 'missing-frame'],
  );
});

test('proper motion is carried only when present, in mas/yr', () => {
  const rows = starArtifactToRows(artifact());
  const [sirius, vega] = rows;

  assert.equal(sirius.pmRa, -546.01);
  assert.equal(sirius.pmDec, -1223.07);
  assert.equal(sirius.pmUnits, 'mas/yr');

  // Vega has no motion in the artifact: the fields stay absent, not zero.
  assert.equal('pmRa' in vega, false);
  assert.equal('pmDec' in vega, false);
  assert.equal('pmUnits' in vega, false);

  const scene = createObserveScene(rows);
  const vegaRecord = scene.catalog.records.find((r) => r.id === 'star-vega');
  assert.equal(vegaRecord.pmRa, null);
  assert.equal(vegaRecord.pmDec, null);
});

test('source-specific fields are preserved under extras, not promoted', () => {
  const [sirius] = starArtifactToRows(artifact());
  assert.deepEqual(sirius.extras.aliases, ['Alp CMa', 'HR 2491']);
  assert.equal(sirius.extras.spectralType, 'A1V');
  assert.equal(sirius.extras.bv, 0);
  assert.equal(sirius.extras.parallaxMas, 379.21);
  assert.equal(sirius.extras.distanceLy, 8.6);
  assert.equal(sirius.extras.refEpochJD, 2451545);
});

test('name falls back to the id, and provenance is exposed', () => {
  const rows = starArtifactToRows(
    artifact({ stars: [{ id: 'star-x', ra: 1, dec: 2, mag: null }] }),
  );
  assert.equal(rows[0].name, 'star-x');

  const meta = starArtifactMeta(artifact());
  assert.equal(meta.schema, 'novochar.stars/v1');
  assert.equal(meta.sourceFrame, 'ICRS');
  assert.equal(meta.equinox, 'J2000');
  assert.equal(meta.referenceEpochJD, 2451545);
});
