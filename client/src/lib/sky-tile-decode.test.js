// The sky textures are encoded north-up. ImageBitmap uploads ignore
// UNPACK_FLIP_Y_WEBGL, so decodeSkyTile must flip during decode; otherwise the
// geography would be vertically mirrored. These tests pin that contract without
// needing a GPU or a real PNG.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSkyTile } from './sky-tile-decode.js';

function restore(name, previous) {
  if (previous === undefined) delete globalThis[name];
  else globalThis[name] = previous;
}

test('decodeSkyTile asks createImageBitmap for flipped rows', async () => {
  const previous = globalThis.createImageBitmap;
  const calls = [];
  const bitmap = { width: 2, height: 2 };
  globalThis.createImageBitmap = async (blob, options) => {
    calls.push({ blob, options });
    return bitmap;
  };
  try {
    const result = await decodeSkyTile({ size: 10 });
    assert.equal(result, bitmap);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].options, { imageOrientation: 'flipY' });
  } finally {
    restore('createImageBitmap', previous);
  }
});

test('decodeSkyTile flips explicitly when imageOrientation is unsupported', async () => {
  const previousBitmap = globalThis.createImageBitmap;
  const previousCanvas = globalThis.OffscreenCanvas;
  const calls = [];
  const bitmap = { width: 3, height: 2, closed: false, close() { this.closed = true; } };
  const output = { width: 3, height: 2, transferred: true };
  let canvasInstance = null;
  globalThis.createImageBitmap = async (_blob, options) => {
    calls.push(options);
    if (options) throw new Error('unsupported');
    return bitmap;
  };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.operations = [];
      canvasInstance = this;
    }
    getContext() {
      return {
        translate: (...args) => this.operations.push(['translate', ...args]),
        scale: (...args) => this.operations.push(['scale', ...args]),
        drawImage: (image) => this.operations.push(['drawImage', image]),
      };
    }
    transferToImageBitmap() {
      return output;
    }
  };
  try {
    const result = await decodeSkyTile({ size: 10 });
    assert.equal(result, output);
    assert.equal(calls.length, 2);
    assert.equal(bitmap.closed, true);
    assert.deepEqual(calls[0], { imageOrientation: 'flipY' });
    assert.equal(calls[1], undefined);
    assert.deepEqual(canvasInstance.operations, [
      ['translate', 0, 2],
      ['scale', 1, -1],
      ['drawImage', bitmap],
    ]);
  } finally {
    restore('createImageBitmap', previousBitmap);
    restore('OffscreenCanvas', previousCanvas);
  }
});
