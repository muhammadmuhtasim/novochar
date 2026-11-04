import test from 'node:test';
import assert from 'node:assert/strict';
import { raDecToSkyDirection } from './sky-coordinates.js';
import {
  cameraForward,
  cameraRight,
  raToYaw,
  skyRenderDirection,
  skyTangentBasis,
  yawToRa,
} from './sky3d-orientation.js';

const DEG = Math.PI / 180;
const CASES = [[0, 0], [90, 0], [270, 66.5], [45, -30], [359.9, 12.3]];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const close = (a, b, tolerance = 1e-12) => {
  assert.ok(Math.abs(a[0] - b[0]) < tolerance, `${a} vs ${b}`);
  assert.ok(Math.abs(a[1] - b[1]) < tolerance, `${a} vs ${b}`);
  assert.ok(Math.abs(a[2] - b[2]) < tolerance, `${a} vs ${b}`);
};

test('the render direction is the deliberate X mirror of the shared field direction', () => {
  for (const [ra, dec] of CASES) {
    const shared = raDecToSkyDirection(ra, dec);
    const render = skyRenderDirection(ra, dec);
    close(render, [-shared[0], shared[1], shared[2]]);
  }
});

test('yaw is the right ascension the camera faces', () => {
  for (const [ra, dec] of CASES) {
    const forward = cameraForward(raToYaw(ra), dec * DEG);
    close(forward, skyRenderDirection(ra, dec));
    assert.ok(Math.abs(yawToRa(raToYaw(ra)) - ra) < 1e-9);
  }
});

test('the tangent basis is orthonormal and right-handed at the view direction', () => {
  for (const [ra, dec] of CASES) {
    const direction = skyRenderDirection(ra, dec);
    const { east, north } = skyTangentBasis(ra, dec);
    assert.ok(Math.abs(dot(east, east) - 1) < 1e-12);
    assert.ok(Math.abs(dot(north, north) - 1) < 1e-12);
    assert.ok(Math.abs(dot(east, north)) < 1e-12);
    assert.ok(Math.abs(dot(east, direction)) < 1e-12);
    assert.ok(Math.abs(dot(north, direction)) < 1e-12);
    close(cross(east, north), direction);
  }
});

test('east is screen-left, so rasters read north-up and east-left', () => {
  for (const [ra, dec] of CASES) {
    const { east } = skyTangentBasis(ra, dec);
    const right = cameraRight(raToYaw(ra));
    assert.ok(dot(east, right) < -0.99, 'east must project to the left edge');
  }
});

test('archive column 0 (east) draws on the left and tile column 0 (west) on the right', () => {
  const center = { ra: 270, dec: 66.5 };
  const direction = skyRenderDirection(center.ra, center.dec);
  const { east } = skyTangentBasis(center.ra, center.dec);
  const right = cameraRight(raToYaw(center.ra));
  // createRegionalGeometry uses uAxis = west for x_axis_direction "west",
  // so texture u=0 sits half a field toward +east.
  const archiveColumn0 = add(direction, scale(east, 0.5));
  assert.ok(dot(archiveColumn0, right) < 0);
  // createTileGeometry maps u=-1 (texture column 0) half a tile toward -east.
  const tileColumn0 = add(direction, scale(east, -0.5));
  assert.ok(dot(tileColumn0, right) > 0);
});
