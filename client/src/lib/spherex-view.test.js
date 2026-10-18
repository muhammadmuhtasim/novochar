// Unit tests for the SPHEREx product viewer's rendering primitives (M3-C).
//
// The TAN implementation is checked against an astropy-generated fixture
// (sidecar/make_tan_fixture.py), not against itself: a projection sign error
// would round-trip perfectly and still put the sky in the wrong place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  computeStretch,
  decodeRaster,
  formatSky,
  insideRaster,
  makeScreenTransform,
  pixelToSky,
  renderRaster,
  skyToPixel,
} from './spherex-view.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/spherex-nep-tan.json', import.meta.url), 'utf8'),
);

const DEG2RAD = Math.PI / 180;

/** The grid WCS exactly as the sidecar's build_target_grid constructs it. */
function gridWcs(grid) {
  const [nx, ny] = grid.shape;
  const step = grid.pixel_scale_arcsec / 3600;
  const theta = (grid.rotation_deg ?? 0) * DEG2RAD;
  return {
    crpix: [(nx + 1) / 2, (ny + 1) / 2],
    crval: [grid.ra, grid.dec],
    cd: [
      [-step * Math.cos(theta), step * Math.sin(theta)],
      [step * Math.sin(theta), step * Math.cos(theta)],
    ],
  };
}

function rasterFixture({ width = 4, height = 3, values, mask } = {}) {
  const plane = width * height;
  const image = Float32Array.from(values ?? Array.from({ length: plane }, (_, i) => i));
  const bytes = new Uint8Array(plane * 5);
  const view = new DataView(bytes.buffer);
  image.forEach((v, i) => view.setFloat32(i * 4, v, true));
  bytes.set(mask ?? Uint8Array.from({ length: plane }, () => 1), plane * 4);
  return { bytes, width, height, image, mask: mask ?? Uint8Array.from({ length: plane }, () => 1) };
}

// --- wire format --------------------------------------------------------------

test('decodeRaster reads a little-endian float32 plane plus a uint8 mask', () => {
  const { bytes, width, height, image } = rasterFixture({ width: 2, height: 2, values: [-1.5, 0, 2.25, 1000] });
  const decoded = decodeRaster(bytes, { width, height });
  assert.deepEqual([...decoded.image], [...image]);
  assert.deepEqual([...decoded.mask], [1, 1, 1, 1]);
});

test('decodeRaster refuses a raster whose byte length does not match the shape', () => {
  const { bytes } = rasterFixture();
  assert.throws(() => decodeRaster(bytes, { width: 4, height: 2 }), /expected 40/);
  assert.throws(() => decodeRaster(bytes, { width: 0, height: 3 }), /bad shape/);
  assert.throws(() => decodeRaster(bytes, { width: 2.5, height: 3 }), /bad shape/);
});

// --- stretch ------------------------------------------------------------------

test('computeStretch uses only valid pixels, never invalid ones', () => {
  const image = Float32Array.from([1, 2, 3, 4, 1e9]);
  const mask = Uint8Array.from([1, 1, 1, 1, 0]);
  const stretch = computeStretch(image, mask, { lowPct: 0, highPct: 1 });
  assert.equal(stretch.lo, 1);
  assert.equal(stretch.hi, 4, 'the masked 1e9 pixel must not widen the stretch');
  assert.equal(stretch.sampleSize, 4);
});

test('computeStretch ignores non-finite values even inside a valid mask', () => {
  const image = Float32Array.from([1, NaN, Infinity, 3]);
  const mask = Uint8Array.from([1, 1, 1, 1]);
  const stretch = computeStretch(image, mask, { lowPct: 0, highPct: 1 });
  assert.equal(stretch.sampleSize, 2);
  assert.equal(stretch.lo, 1);
  assert.equal(stretch.hi, 3);
});

test('computeStretch interpolates percentiles and survives a flat or empty field', () => {
  const image = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const mask = Uint8Array.from({ length: 10 }, () => 1);
  const stretch = computeStretch(image, mask, { lowPct: 0.25, highPct: 0.75 });
  assert.equal(stretch.lo, 2.25);
  assert.equal(stretch.hi, 6.75);

  const flat = computeStretch(Float32Array.from([2, 2, 2]), Uint8Array.from([1, 1, 1]), { lowPct: 0, highPct: 1 });
  assert.ok(flat.hi > flat.lo, 'a flat field still gets a window to render into');

  const empty = computeStretch(Float32Array.from([1, 2]), Uint8Array.from([0, 0]));
  assert.equal(empty.sampleSize, 0);
  assert.equal(empty.span, 1);
});

// --- screen transform ---------------------------------------------------------

test('the screen transform puts array row 0 at the bottom of the screen', () => {
  const t = makeScreenTransform({ width: 10, height: 4 });
  // Array row 0 is the lowest WCS y; on screen it must be the lowest row.
  assert.deepEqual(t.wcsToScreen(0, 0), { x: 0, y: 4 });
  assert.deepEqual(t.wcsToScreen(0, 4), { x: 0, y: 0 });
  assert.deepEqual(t.screenToWcs(0, 4), { x: 0, y: 0 });
  assert.deepEqual(t.screenToWcs(0, 0), { x: 0, y: 4 });

  // Inverse everywhere, including with zoom and pan applied.
  const zoomed = makeScreenTransform({ width: 10, height: 4, scale: 2.5, panX: 12, panY: -3 });
  for (const [x, y] of [[0, 0], [3.75, 1.5], [10, 4]]) {
    const s = zoomed.wcsToScreen(x, y);
    const back = zoomed.screenToWcs(s.x, s.y);
    assert.ok(Math.abs(back.x - x) < 1e-12, `x round-trip at ${x},${y}`);
    assert.ok(Math.abs(back.y - y) < 1e-12, `y round-trip at ${x},${y}`);
  }
  assert.throws(() => makeScreenTransform({ width: 1, height: 1, scale: 0 }), /positive scale/);
});

// --- rendering ----------------------------------------------------------------

test('renderRaster leaves invalid pixels transparent rather than black', () => {
  const { width, height, image, mask } = rasterFixture({
    width: 4,
    height: 1, // single row, so the vertical flip in the renderer is a no-op
    values: [10, 20, 30, 40],
    mask: [1, 1, 0, 1],
  });
  const rgba = renderRaster({ image, mask, width, height }, { lo: 0, hi: 40 });

  // Column 2 is masked out: fully transparent, not a black pixel.
  assert.equal(rgba[2 * 4 + 3], 0, 'invalid pixels carry no alpha');
  assert.equal(rgba[2 * 4], 0, 'and carry no colour either');
  assert.equal(rgba[0 * 4 + 3], 255, 'valid pixels are opaque');
  assert.equal(rgba[3 * 4 + 3], 255, 'including the last one');
});

test('renderRaster writes array row 0 to the bottom of the screen (north-up)', () => {
  // Two bright markers: the first array pixel (index 0) and the last (index 8).
  // ImageData rows grow downward, so a north-up grid must land first-pixel at
  // the bottom-left and last-pixel at the top-right.
  const width = 3;
  const height = 3;
  const image = Float32Array.from([100, 0, 0, 0, 0, 0, 0, 0, 50]);
  const mask = Uint8Array.from({ length: 9 }, () => 1);
  const rgba = renderRaster({ image, mask, width, height }, { lo: 0, hi: 100 });

  const at = (row, col) => [...rgba.slice((row * width + col) * 4, (row * width + col) * 4 + 4)];
  assert.deepEqual(at(height - 1, 0), [255, 255, 255, 255], 'the first array pixel is drawn at the bottom-left');
  assert.deepEqual(at(0, width - 1), [128, 128, 128, 255], 'the last array pixel is drawn at the top-right');
  // Faint-but-real data stays opaque: black is a value here, not an absence.
  assert.deepEqual(at(0, 0), [0, 0, 0, 255], 'faint data is opaque, distinct from "no data"');
});

test('renderRaster clamps out-of-range values and rejects mismatched planes', () => {
  const { width, height, image, mask } = rasterFixture({ width: 2, height: 1, values: [-50, 500] });
  const rgba = renderRaster({ image, mask, width, height }, { lo: 0, hi: 100 });
  assert.equal(rgba[0], 0, 'below the stretch floor renders black, not wrapped');
  assert.equal(rgba[4], 255, 'above the stretch ceiling renders white');
  assert.throws(
    () => renderRaster({ image, mask, width, height: 2 }, { lo: 0, hi: 1 }),
    /planes are/,
  );
});

// --- the astropy cross-check --------------------------------------------------

test('pixelToSky matches the astropy fixture for the real NEP grid', () => {
  const wcs = gridWcs(FIXTURE.grid);
  for (const row of FIXTURE.pixel_to_sky) {
    const got = pixelToSky(wcs, row.x, row.y);
    assert.ok(
      Math.abs(got.ra - row.ra) < 1e-9,
      `ra at pixel ${row.x},${row.y}: got ${got.ra}, astropy says ${row.ra}`,
    );
    assert.ok(
      Math.abs(got.dec - row.dec) < 1e-9,
      `dec at pixel ${row.x},${row.y}: got ${got.dec}, astropy says ${row.dec}`,
    );
  }
});

test('skyToPixel matches the astropy fixture for the real NEP grid', () => {
  const wcs = gridWcs(FIXTURE.grid);
  for (const row of FIXTURE.sky_to_pixel) {
    const got = skyToPixel(wcs, row.ra, row.dec);
    assert.ok(Math.abs(got.x - row.x) < 1e-7, `x at ${row.ra},${row.dec}: got ${got.x}, astropy says ${row.x}`);
    assert.ok(Math.abs(got.y - row.y) < 1e-7, `y at ${row.ra},${row.dec}: got ${got.y}, astropy says ${row.y}`);
  }
});

test('pixelToSky and skyToPixel are inverses away from the reference point', () => {
  const wcs = gridWcs(FIXTURE.grid);
  for (const [x, y] of [[0, 0], [293, 0], [0, 293], [146.5, 146.5], [41.25, 280.5]]) {
    const sky = pixelToSky(wcs, x, y);
    const back = skyToPixel(wcs, sky.ra, sky.dec);
    assert.ok(Math.abs(back.x - x) < 1e-9, `x round-trip at ${x},${y} -> ${back.x}`);
    assert.ok(Math.abs(back.y - y) < 1e-9, `y round-trip at ${x},${y} -> ${back.y}`);
  }
});

test('the agreed grid reads north-up and east-left', () => {
  const wcs = gridWcs(FIXTURE.grid);
  const [nx, ny] = FIXTURE.grid.shape;

  // Increasing WCS y (larger FITS row) must increase dec: north is up.
  const up = pixelToSky(wcs, 146.5, 200);
  const down = pixelToSky(wcs, 146.5, 100);
  assert.ok(up.dec > down.dec, 'north is up');

  // Increasing WCS x must *decrease* RA: east is to the left.
  const right = pixelToSky(wcs, 200, 146.5);
  const left = pixelToSky(wcs, 100, 146.5);
  assert.ok(right.ra < left.ra, 'east is left');

  // The reference pixel is the field centre.
  const centre = pixelToSky(wcs, (nx - 1) / 2, (ny - 1) / 2);
  assert.ok(Math.abs(centre.ra - FIXTURE.grid.ra) < 1e-12);
  assert.ok(Math.abs(centre.dec - FIXTURE.grid.dec) < 1e-12);
});

test('a point behind the gnomonic horizon is reported rather than faked', () => {
  const wcs = gridWcs(FIXTURE.grid);
  const got = skyToPixel(wcs, 90, -66.5);
  assert.equal(got.behind, true);
  assert.ok(Number.isNaN(got.x));
  assert.equal(formatSky(got), 'outside the projection');
});

// --- readout helpers ----------------------------------------------------------

test('insideRaster and formatSky describe the readout honestly', () => {
  assert.equal(insideRaster({ x: 0, y: 0 }, 294, 294), true);
  assert.equal(insideRaster({ x: 293.5, y: 1 }, 294, 294), true, 'a position inside the last pixel still reads out');
  assert.equal(insideRaster({ x: 294, y: 1 }, 294, 294), false);
  assert.equal(insideRaster({ x: -1, y: 0 }, 294, 294), false);
  assert.equal(insideRaster({ x: NaN, y: 0 }, 294, 294), false);

  assert.equal(formatSky({ ra: 270, dec: 66.5 }), 'RA 270.00000°  Dec +66.50000°');
  assert.equal(formatSky({ ra: 10.5, dec: -3.25 }), 'RA 10.50000°  Dec −3.25000°');
});
