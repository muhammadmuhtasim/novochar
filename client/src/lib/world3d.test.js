// Client unit tests for the procedural-world sector engine.
//
//   node --test src/lib/world3d.test.js   (from client/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { ProceduralWorld } from './world3d.js';

test('sector coordinates floor correctly for negative positions', () => {
  const world = new ProceduralWorld(new THREE.Scene(), { sectorSize: 72 });
  assert.equal(world.coord(0), 0);
  assert.equal(world.coord(71.9), 0);
  assert.equal(world.coord(72), 1);
  // negative handling must floor, not truncate toward zero (audit: negative coords)
  assert.equal(world.coord(-0.1), -1);
  assert.equal(world.coord(-72), -1);
  assert.equal(world.coord(-72.1), -2);
});

test('revisiting a sector regenerates identical geometry (deterministic)', () => {
  const scene = new THREE.Scene();
  const world = new ProceduralWorld(scene, { sectorSize: 72, viewRadius: 1 });
  const size1 = world.update({ x: -80, y: 12, z: -5 });
  const first = [...world.sectors.entries()]
    .map(([key, g]) => [key, g.userData.sector])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  assert.equal(size1, 27);

  const size2 = world.update({ x: -80, y: 12, z: -5 });
  assert.equal(size2, 27); // no churn on revisit

  const second = [...world.sectors.entries()]
    .map(([key, g]) => [key, g.userData.sector])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  assert.deepEqual(first, second, 'identical keys + sector data on revisit');

  // crossing a sector boundary keeps the overlapping set and loads new sectors
  const size3 = world.update({ x: -79, y: 12, z: -5 });
  assert.ok(size3 >= 27, `moved set size ${size3}`);
});

test('hash keys stay strings even at extreme negative coordinates', () => {
  const world = new ProceduralWorld(new THREE.Scene(), { sectorSize: 72 });
  const a = world.key(-1234, 567, -8901);
  const b = world.key(-1234, 567, -8901);
  assert.equal(a, b);
  assert.equal(typeof a, 'string');
});

test('sectors share one grid material and world disposal releases it once', () => {
  const scene = new THREE.Scene();
  const world = new ProceduralWorld(scene, { sectorSize: 72, viewRadius: 1 });
  world.update({ x: 0, y: 0, z: 0 });
  const gridMaterial = world.gridMaterial;
  let disposeEvents = 0;
  gridMaterial.addEventListener('dispose', () => { disposeEvents += 1; });
  for (const group of world.sectors.values()) {
    const grid = group.children.find((child) => child.isLineSegments && child.geometry.attributes.position.count === 84);
    assert.ok(grid, 'sector has its grid lines');
    assert.equal(grid.material, gridMaterial);
  }

  world.update({ x: 1000, y: 1000, z: 1000 });
  assert.equal(disposeEvents, 0, 'removing sectors keeps the shared material alive');
  world.dispose();
  world.dispose();
  assert.equal(disposeEvents, 1, 'world disposal releases the shared material once');
  assert.equal(world.update({ x: 0, y: 0, z: 0 }), 0, 'disposed worlds do not allocate sectors again');
});
