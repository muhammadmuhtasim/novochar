import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitToSpherical } from '@novochar/astro';

import {
  createObserveScene,
  findRecord,
  pickAt,
  pickWithin,
  projectRecord,
  resolveSelection,
  selectionViews,
  skyDirectionOf,
  viewLonLatOf,
  withCentralMeridian,
  withProjection,
  withViewFrame,
} from './scene.js';

const ROWS = [
  { id: 'a', name: 'Alpha', ra: 0, dec: 0, frame: 'icrs', mag: 1 },
  { id: 'b', name: 'Beta', ra: 90, dec: 45, frame: 'icrs', mag: 2 },
  { id: 'c', name: 'Gamma', ra: 180, dec: -45, frame: 'icrs', mag: 3 },
  { id: 'd', name: 'Delta', ra: 270, dec: 80, frame: 'icrs', mag: 4 },
  { id: 'e', name: 'Epsilon', ra: 45, dec: -80, frame: 'icrs', mag: 5 },
];

function scene(options) {
  return createObserveScene(ROWS.map((r) => ({ ...r })), options);
}

test('a scene binds the catalog, projection and picking index once', () => {
  const s = scene();
  assert.equal(s.catalog.records.length, 5);
  assert.equal(s.catalog.stats.accepted, 5);
  assert.equal(s.projectionId, 'mollweide');
  assert.equal(s.viewFrame, 'icrs');
  assert.equal(s.points.length, 5);
  assert.equal(s.index.points.length, 5);
  // One point per stable id, keyed for O(1) identity lookups.
  assert.equal(s.pointById.size, 5);
  assert.equal(s.recordById.size, 5);
});

test('picking resolves a plane position back to the canonical record', () => {
  const s = scene();
  for (const point of s.points) {
    const hit = pickAt(s, point.x, point.y, 1e-9);
    assert.ok(hit, `no hit at the projected ${point.id}`);
    assert.equal(hit.id, point.id);
  }
  // Outside every point by a wide margin.
  assert.equal(pickAt(s, 1e6, 1e6, 1), null);
});

test('a box selection returns the records inside it', () => {
  const s = scene();
  const xs = s.points.map((p) => p.x);
  const ys = s.points.map((p) => p.y);
  const all = pickWithin(s, {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  });
  assert.deepEqual(all.map((r) => r.id).sort(), ['a', 'b', 'c', 'd', 'e']);

  // A reversed drag selects the same region.
  const reversed = pickWithin(s, {
    xMin: Math.max(...xs),
    xMax: Math.min(...xs),
    yMin: Math.max(...ys),
    yMax: Math.min(...ys),
  });
  assert.deepEqual(reversed.map((r) => r.id), all.map((r) => r.id));
});

test('identity is the stable id: resolution is consistent and total', () => {
  const s = scene();
  for (const row of ROWS) {
    const record = findRecord(s, row.id);
    assert.equal(record.id, row.id);
    const resolved = resolveSelection(s, row.id);
    assert.equal(resolved.record, record);
    assert.ok(resolved.point);
    assert.deepEqual(resolved.lonLat, { lonDeg: row.ra, latDeg: row.dec });
    assert.equal(projectRecord(s, record), resolved.point);
  }
  assert.equal(findRecord(s, 'nope'), null);
  assert.equal(resolveSelection(s, null), null);
  assert.equal(resolveSelection(s, 'nope'), null);
});

test('changing the view frame reuses the same canonical records', () => {
  const icrs = scene();
  const galactic = withViewFrame(icrs, 'galactic');

  // Same catalog object and same record objects — only the projection differs.
  assert.equal(galactic.catalog, icrs.catalog);
  assert.equal(galactic.catalog.records[1], icrs.catalog.records[1]);
  assert.equal(findRecord(galactic, 'b'), findRecord(icrs, 'b'));
  assert.equal(galactic.viewFrame, 'galactic');

  // View-frame coordinates differ; identity does not.
  const before = viewLonLatOf(icrs, findRecord(icrs, 'b'));
  const after = viewLonLatOf(galactic, findRecord(galactic, 'b'));
  assert.notDeepEqual(after, before);
  assert.equal(resolveSelection(galactic, 'b').record, resolveSelection(icrs, 'b').record);
});

test('changing the central meridian re-projects without touching the catalog', () => {
  const base = scene();
  const shifted = withCentralMeridian(base, Math.PI / 2);
  assert.equal(shifted.catalog, base.catalog);
  const before = projectRecord(base, findRecord(base, 'a'));
  const after = projectRecord(shifted, findRecord(shifted, 'a'));
  assert.notDeepEqual({ x: after.x, y: after.y }, { x: before.x, y: before.y });
  // Picking follows the projection: the same plane coordinates still hit 'a'.
  assert.equal(pickAt(shifted, after.x, after.y, 1e-9).id, 'a');
});

test('swapping the projection keeps the catalog and view frame', () => {
  const base = scene({ viewFrame: 'galactic' });
  const swapped = withProjection(base, 'mollweide');
  assert.equal(swapped.catalog, base.catalog);
  assert.equal(swapped.viewFrame, 'galactic');
  assert.equal(swapped.projectionId, 'mollweide');
});

test('a non-ICRS source frame is reported, never reinterpreted', () => {
  const s = createObserveScene([
    { id: 'x', ra: 10, dec: 20, frame: 'fk5' },
    { id: 'y', ra: 30, dec: 40, frame: 'icrs' },
  ]);
  assert.deepEqual(s.catalog.records.map((r) => r.id), ['y']);
  assert.deepEqual(s.catalog.issues, [{ index: 0, id: 'x', reason: 'unsupported-frame:fk5' }]);
  // Only the accepted record is projected, indexed and pickable.
  assert.equal(s.points.length, 1);
  assert.equal(findRecord(s, 'x'), null);
  assert.equal(findRecord(s, 'y').id, 'y');
});

test('catalog provenance flows into the scene meta', () => {
  const s = createObserveScene(ROWS.map((r) => ({ ...r })), {
    source: 'stars',
    meta: { equinox: 'J2000' },
  });
  assert.equal(s.catalog.meta.source, 'stars');
  assert.equal(s.catalog.meta.equinox, 'J2000');
});

test('the 2D point and 3D direction describe the same selection', () => {
  const s = scene();

  for (const row of ROWS) {
    const views = selectionViews(s, row.id);
    const direct = resolveSelection(s, row.id);
    // Both views resolve the SAME canonical record, hence the same identity.
    assert.equal(views.record, direct.record);

    // 2D: the plane point is the one the picker returns.
    assert.ok(views.map);
    assert.equal(pickAt(s, views.map.x, views.map.y, 1e-9).id, row.id);

    // 3D: a unit direction whose spherical angles recover the view position.
    assert.ok(Math.abs(Math.hypot(...views.direction) - 1) < 1e-12);
    const round = unitToSpherical(views.direction);
    assert.ok(Math.abs(round.raDeg - views.sky.lonDeg) < 1e-9);
    assert.ok(Math.abs(round.decDeg - views.sky.latDeg) < 1e-9);
    assert.deepEqual(skyDirectionOf(s, views.record), views.direction);
  }

  assert.equal(selectionViews(s, 'nope'), null);
  assert.equal(selectionViews(s, null), null);
});

test('switching the view frame moves both views together, keeping identity', () => {
  const icrs = scene();
  const galactic = withViewFrame(icrs, 'galactic');
  const id = 'b';

  const a = selectionViews(icrs, id);
  const b = selectionViews(galactic, id);

  assert.equal(a.record, b.record); // identity is frame-independent
  assert.notDeepEqual(a.sky, b.sky); // both views re-derive from the new frame
  assert.notDeepEqual(a.direction, b.direction);
  assert.notDeepEqual({ x: a.map.x, y: a.map.y }, { x: b.map.x, y: b.map.y });
});
