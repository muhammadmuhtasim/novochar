// Client unit tests for the free-flight controls' movement math.
//
//   node --test src/lib/controls3d.test.js   (from client/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { FreeFlightControls } from './controls3d.js';

// Bring up minimal DOM stubs before constructing the class (Node has none).
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  pointerLockElement: null,
};
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  blur: () => {},
};

function makeControls() {
  const camera = new THREE.PerspectiveCamera();
  const dom = {
    addEventListener: () => {},
    removeEventListener: () => {},
    requestPointerLock: () => {},
  };
  const controls = new FreeFlightControls(camera, dom);
  controls.enabled = true; // pointer-lock is a browser concern; unlock math here
  return { camera, controls };
}

function identityState(camera) {
  camera.position.set(0, 0, 0);
  camera.quaternion.set(0, 0, 0, 1);
}

test('forward movement uses the heading vector', () => {
  const { camera, controls } = makeControls();
  identityState(camera);
  controls.keys.clear();
  controls.keys.add('w');
  controls.update(1);
  // base speed 16 over dt=1 => displacement length 16 along -Z (heading)
  assert.ok(Math.abs(camera.position.length() - 16) < 1e-9, `distance ${camera.position.length()}`);
  assert.ok(camera.position.z < 0, `moved backward along -Z: ${camera.position.z}`);
});

test('diagonals travel at the same rate as single axes (normalized direction)', () => {
  const { camera, controls } = makeControls();
  identityState(camera);
  controls.keys.clear();
  controls.keys.add('w');
  controls.keys.add('a');
  controls.update(1);
  assert.ok(Math.abs(camera.position.length() - 16) < 1e-9, `diagonal ${camera.position.length()}`);

  // w+shift+space (boosted, vertical) — same normalization property
  identityState(camera);
  controls.keys.clear();
  controls.keys.add('w');
  controls.keys.add('shift');
  controls.keys.add(' ');
  controls.update(1);
  assert.ok(Math.abs(camera.position.length() - 64) < 1e-9, `boosted ${camera.position.length()}`);
});

test('movement scales linearly with delta time (frame-rate independence)', () => {
  const { camera, controls } = makeControls();
  identityState(camera);
  controls.keys.clear();
  controls.keys.add('w');
  controls.update(0.5);
  assert.ok(Math.abs(camera.position.length() - 8) < 1e-9, `half-frame ${camera.position.length()}`);
});

test('no movement keys leaves the camera exactly in place', () => {
  const { camera, controls } = makeControls();
  identityState(camera);
  controls.keys.clear();
  controls.update(1);
  assert.equal(camera.position.length(), 0);
});

test('movement and roll are both disabled outside pointer lock', () => {
  const { camera, controls } = makeControls();
  identityState(camera);
  controls.enabled = false;
  controls.keys.add('w');
  controls.keys.add('e');
  controls.update(1);
  assert.equal(camera.position.length(), 0);
  assert.deepEqual(camera.quaternion.toArray(), [0, 0, 0, 1]);
});

test('dispose prevents any later keyboard movement', () => {
  const { camera, controls } = makeControls();
  identityState(camera);
  controls.keys.add('w');
  controls.dispose();
  controls.update(1);
  assert.equal(camera.position.length(), 0);
  assert.equal(controls.keys.size, 0);
});

test('scroll/activation keys are swallowed only while flight is engaged', () => {
  // Capture the global keydown handler the controls register.
  const handlers = {};
  const realWindow = globalThis.window;
  globalThis.window = {
    addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
    removeEventListener: () => {},
    blur: () => {},
  };
  try {
    const dom = {
      addEventListener: () => {},
      removeEventListener: () => {},
      requestPointerLock: () => {},
    };
    const controls = new FreeFlightControls(new THREE.PerspectiveCamera(), dom);
    const prevented = [];
    const press = (key) => handlers.keydown.forEach((fn) => fn({ key, preventDefault: () => prevented.push(key) }));

    press('ArrowDown');
    press(' ');
    assert.deepEqual(prevented, [], 'outside flight the page keeps arrow/space behaviour');
    assert.ok(controls.keys.has('arrowdown'), 'keys are still tracked so key-up is observed');
    assert.ok(controls.keys.has(' '), 'keys are still tracked so key-up is observed');

    controls.enabled = true;
    press('ArrowDown');
    assert.deepEqual(prevented, ['ArrowDown'], 'while flying the browser default is suppressed');
  } finally {
    globalThis.window = realWindow;
  }
});
