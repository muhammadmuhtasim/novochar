// SPHEREx four-epoch sky-tile service.
//
// This module owns the *contract* between the precomputed sky products and the
// 3D client:
//
//   * a HEALPix NEST pixel pyramid (order 1 = 48 tiles, order 4 = 3,072);
//   * one RGBA tile per (epoch, order, pixel), rendered as a tangent-plane
//     patch by the browser;
//   * a low-resolution equirectangular base per epoch, so the sphere is always
//     covered while the finer tiles stream in;
//   * a source-measurement endpoint for the GPU-instanced change layer.
//
// IMPORTANT — data status
// -----------------------
// The repository currently contains two real reprojected SPHEREx observations
// of the North Ecliptic Pole (see data/spherex/derived/). It does NOT contain a
// four-epoch all-sky archive. The global layer below is therefore an explicitly
// labelled deterministic *visualization prototype*. It is not a measurement and
// must never be presented as one. The real NEP products remain the validated
// detail layer in the SPHEREx FIELD tab.
//
// The tile contract is production-shaped: replace `renderTile`/`renderBase` with
// a reader for precomputed archive tiles, keep the same index and URLs, and the
// client does not change.

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  nestChildren,
  nside2npix,
  nside2resolRad,
  order2nside,
  pixelCenterRaDec,
  tileHalfAngleRad,
} from '@novochar/astro';

export const SKY_INDEX_SCHEMA = 'novochar.spherex.sky-index/v1';
export const SKY_SOURCES_SCHEMA = 'novochar.spherex.sky-sources/v1';
export const SKY_MODEL_REVISION = 'illustrative-2026-10-23.1';

export const BASE_ORDER = 1;
export const MIN_ORDER = 1;
export const MAX_ORDER = 4;
export const TILE_SIZE = 128;
export const BASE_WIDTH = 512;
export const BASE_HEIGHT = 256;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

/**
 * Four epoch identities. The status is deliberately `illustrative`: these are
 * not archive dates or archive coverage. The two real NEP observations are
 * advertised separately (`realDetail`) so the UI can link to them without
 * implying that this global layer is their equal.
 */
export const SKY_EPOCHS = Object.freeze([
  {
    id: 'epoch-1',
    index: 0,
    label: 'EPOCH 1',
    shortLabel: 'E1',
    campaign: 'CYCLE 1',
    dateLabel: 'illustrative',
    status: 'illustrative',
    realDetail: true,
    realDetailLabel: 'NEP 2025-04-29',
    accent: '#61e6ff',
    note: 'Prototype epoch. The validated detail is the real NEP observation in SPHEREx FIELD.',
  },
  {
    id: 'epoch-2',
    index: 1,
    label: 'EPOCH 2',
    shortLabel: 'E2',
    campaign: 'CYCLE 2',
    dateLabel: 'illustrative',
    status: 'illustrative',
    realDetail: true,
    realDetailLabel: 'NEP 2025-11',
    accent: '#ffb45c',
    note: 'Prototype epoch. The validated detail is the real NEP observation in SPHEREx FIELD.',
  },
  {
    id: 'epoch-3',
    index: 2,
    label: 'EPOCH 3',
    shortLabel: 'E3',
    campaign: 'CYCLE 3',
    dateLabel: 'illustrative',
    status: 'illustrative',
    realDetail: false,
    realDetailLabel: null,
    accent: '#c79bff',
    note: 'Prototype epoch; no archive product is bundled for this campaign.',
  },
  {
    id: 'epoch-4',
    index: 3,
    label: 'EPOCH 4',
    shortLabel: 'E4',
    campaign: 'CYCLE 4',
    dateLabel: 'illustrative',
    status: 'illustrative',
    realDetail: false,
    realDetailLabel: null,
    accent: '#7dffb2',
    note: 'Prototype epoch; no archive product is bundled for this campaign.',
  },
]);

// --- deterministic pseudo-random model ----------------------------------------

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 2246822519) ^
    Math.imul(seed | 0, 69069);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Grain is a function of sky direction, not texture pixel coordinates. Two
// tiles that overlap, or a base pixel and a detail pixel at the same direction,
// therefore see the same grain value instead of revealing a tile/LOD seam.
function directionGrain(dir, epochIndex) {
  const scale = 32768;
  return hash3(
    Math.round(dir[0] * scale),
    Math.round(dir[1] * scale),
    Math.round(dir[2] * scale),
    0x9e37 + epochIndex * 977,
  );
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function normalizeRa(ra) {
  return ((ra % 360) + 360) % 360;
}

// Scientific-basis unit vector (the shared @novochar/astro convention).
function sciDir(raDeg, decDeg) {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  const cd = Math.cos(d);
  return [cd * Math.cos(a), cd * Math.sin(a), Math.sin(d)];
}

function sciDirToRaDec([x, y, z]) {
  return {
    ra: normalizeRa(Math.atan2(y, x) * RAD),
    dec: Math.asin(clamp(z, -1, 1)) * RAD,
  };
}

function normalize3([x, y, z]) {
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
}

const GAL_POLE = sciDir(192.8594812065348, 27.12825118085622);

const STAR_COUNT = 5200;
const STARS = (() => {
  const rand = mulberry32(0x51ce2026);
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const ra = rand() * 360;
    const dec = Math.asin(rand() * 2 - 1) * RAD;
    const mag = 2.2 + 5.4 * Math.pow(rand(), 0.62);
    const kind = i % 29 === 0 ? 'mover' : i % 23 === 0 ? 'variable' : i % 241 === 0 ? 'transient' : 'field';
    stars.push({
      id: i,
      ra,
      dec,
      mag,
      kind,
      speed: 0.12 + rand() * 0.42, // degrees per epoch for the illustrative movers
      pa: rand() * TWO_PI,
      phase: rand() * TWO_PI,
      amplitude: 0.3 + rand() * 0.55,
      activeEpoch: i % 4,
      warm: rand(),
    });
  }
  return stars;
})();

// A few large, diffuse illustrative transients. They are deliberately obvious
// so the timeline demonstrates a change layer; they are not astrophysical
// claims and the UI labels them as prototype candidates.
const TRANSIENTS = [
  {
    id: 'DEMO-FLARE-1',
    name: 'Prototype flare 1',
    kind: 'transient',
    color: [255, 140, 92],
    epochs: [
      { ra: 142.2, dec: 18.4, flux: 0.9, radius: 0.55 },
      { ra: 142.4, dec: 18.5, flux: 1.0, radius: 0.75 },
      { ra: 142.7, dec: 18.6, flux: 0.45, radius: 0.5 },
      { ra: 143.0, dec: 18.8, flux: 0.0, radius: 0.4 },
    ],
  },
  {
    id: 'DEMO-FLARE-2',
    name: 'Prototype flare 2',
    kind: 'transient',
    color: [124, 228, 255],
    epochs: [
      { ra: 302.1, dec: -24.7, flux: 0.0, radius: 0.4 },
      { ra: 302.3, dec: -24.5, flux: 0.55, radius: 0.55 },
      { ra: 302.6, dec: -24.2, flux: 1.0, radius: 0.8 },
      { ra: 302.9, dec: -23.9, flux: 0.35, radius: 0.5 },
    ],
  },
  {
    id: 'DEMO-MOVER-3',
    name: 'Prototype mover 3',
    kind: 'mover',
    color: [214, 168, 255],
    epochs: [
      { ra: 48.0, dec: 54.0, flux: 0.8, radius: 0.4 },
      { ra: 48.8, dec: 54.4, flux: 0.9, radius: 0.4 },
      { ra: 49.7, dec: 54.8, flux: 0.9, radius: 0.4 },
      { ra: 50.7, dec: 55.3, flux: 0.85, radius: 0.4 },
    ],
  },
];

const NEBULAE = [
  { ra: 78, dec: -4, radius: 12, color: [38, 72, 132], strength: 0.42 },
  { ra: 168, dec: 22, radius: 8, color: [118, 58, 44], strength: 0.32 },
  { ra: 250, dec: -18, radius: 15, color: [36, 78, 106], strength: 0.38 },
  { ra: 312, dec: 34, radius: 10, color: [92, 48, 96], strength: 0.3 },
  { ra: 22, dec: -36, radius: 7, color: [58, 96, 116], strength: 0.26 },
  { ra: 205, dec: 62, radius: 9, color: [82, 66, 126], strength: 0.28 },
];

function starAtEpoch(star, epochIndex) {
  if (star.kind === 'transient' && epochIndex !== star.activeEpoch) {
    return { ra: star.ra, dec: star.dec, mag: star.mag, visible: false, color: [255, 255, 255] };
  }
  let ra = star.ra;
  let dec = star.dec;
  let mag = star.mag;
  if (star.kind === 'mover') {
    const angle = star.speed * epochIndex;
    const dDec = angle * Math.sin(star.pa);
    const dRa = angle * Math.cos(star.pa) / Math.max(0.15, Math.cos(star.dec * DEG));
    ra = normalizeRa(ra + dRa);
    dec = clamp(dec + dDec, -89.5, 89.5);
  } else if (star.kind === 'variable') {
    const fluxScale = clamp(1 + star.amplitude * Math.sin(epochIndex * 2.1 + star.phase), 0.08, 3);
    mag -= 2.5 * Math.log10(fluxScale);
  } else if (star.kind === 'transient') {
    mag -= 1.4;
  }
  const color = star.warm > 0.72
    ? [255, 198, 148]
    : star.warm > 0.42
      ? [242, 240, 255]
      : [178, 208, 255];
  return { ra, dec, mag, visible: true, color };
}

// Epoch-specific coverage. The gaps are illustrative, but they are real gaps in
// the rendered product: alpha is 0, never a filled zero. The UI reports the
// sampled sky fraction per epoch.
function isCovered(raDeg, decDeg, epochIndex) {
  if (epochIndex === 0) return true;
  if (epochIndex === 1) {
    return !(raDeg > 194 && raDeg < 238 && decDeg > -1 && decDeg < 23);
  }
  if (epochIndex === 2) {
    return decDeg > -66;
  }
  if (epochIndex === 3) {
    return !(raDeg > 16 && raDeg < 55);
  }
  return true;
}

const coverageCache = new Map();
function coverageForEpoch(epochIndex) {
  if (coverageCache.has(epochIndex)) return coverageCache.get(epochIndex);
  let covered = 0;
  let total = 0;
  // Equal-area sampling: weight each latitude ring by cos(dec).
  for (let dec = -89; dec <= 89; dec += 2) {
    const weight = Math.cos(dec * DEG);
    for (let ra = 0; ra < 360; ra += 2) {
      total += weight;
      if (isCovered(ra + 1, dec + 1, epochIndex)) covered += weight;
    }
  }
  const value = total ? covered / total : 0;
  coverageCache.set(epochIndex, value);
  return value;
}

// --- diffuse sky + star splatting --------------------------------------------

function diffuseColor(ra, dec, epochIndex) {
  const dir = sciDir(ra, dec);
  const sinLat = dir[0] * GAL_POLE[0] + dir[1] * GAL_POLE[1] + dir[2] * GAL_POLE[2];
  const band = Math.exp(-((sinLat / 0.145) ** 2));
  const dust = Math.exp(-(((sinLat - 0.035) / 0.075) ** 2));

  const a = ra * DEG;
  const d = dec * DEG;
  const broad = 0.5 + 0.5 * Math.sin(a * 2.4 + Math.sin(d * 3.1) * 2.2);
  const fine = 0.5 + 0.5 * Math.sin(a * 7.3 - d * 5.1 + 1.4);
  const filament = 0.5 + 0.5 * Math.sin(a * 17.0 + d * 11.0 + Math.sin(a * 3.0) * 2.0);
  const noise = clamp(0.55 * broad + 0.3 * fine + 0.15 * filament, 0, 1);
  const grain = directionGrain(dir, epochIndex);

  let r = 5 + 34 * band + 88 * dust + 12 * noise + 7 * grain;
  let g = 8 + 50 * band + 44 * dust + 14 * noise + 8 * grain;
  let b = 18 + 88 * band + 26 * dust + 19 * noise + 10 * grain;
  b += 20 * band;
  r += 26 * dust * (0.55 + 0.45 * noise);

  for (const nebula of NEBULAE) {
    const dRa = (((ra - nebula.ra + 540) % 360) - 180) * Math.cos(dec * DEG);
    const dDec = dec - nebula.dec;
    const blob = Math.exp(-((dRa * dRa + dDec * dDec) / (2 * nebula.radius * nebula.radius))) * nebula.strength;
    if (blob > 0.002) {
      r += nebula.color[0] * blob;
      g += nebula.color[1] * blob;
      b += nebula.color[2] * blob;
    }
  }

  // A very small epoch-dependent tilt keeps the four frames from being
  // byte-identical even in the empty parts of the sky. It is visualization
  // texture, not a measured calibration change.
  const tilt = 1 + (epochIndex - 1.5) * 0.012;
  return [
    clamp(Math.round(r * tilt), 0, 255),
    clamp(Math.round(g * tilt), 0, 255),
    clamp(Math.round(b * tilt), 0, 255),
  ];
}

export function splatGaussian(rgba, width, height, x, y, radius, color, intensity, wrapX) {
  const sigma = Math.max(0.55, radius);
  const reach = Math.ceil(sigma * 2.6);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  for (let dy = -reach; dy <= reach; dy++) {
    const py = y0 + dy;
    if (py < 0 || py >= height) continue;
    for (let dx = -reach; dx <= reach; dx++) {
      let px = x0 + dx;
      if (wrapX) px = ((px % width) + width) % width;
      else if (px < 0 || px >= width) continue;
      // On the equirectangular base, distance must be measured on the circle.
      // A star at RA ~0 has an unwrapped x near -0.5; using the wrapped column
      // index directly would move its flux to the opposite edge of the map.
      let deltaX = px - x;
      if (wrapX) {
        deltaX = ((deltaX + width / 2) % width + width) % width - width / 2;
      }
      const distance2 = deltaX * deltaX + (py - y) * (py - y);
      const weight = Math.exp(-distance2 / (2 * sigma * sigma));
      if (weight < 0.008) continue;
      const o = (py * width + px) * 4;
      const add = intensity * weight;
      rgba[o] = clamp(Math.round(rgba[o] + color[0] * add), 0, 255);
      rgba[o + 1] = clamp(Math.round(rgba[o + 1] + color[1] * add), 0, 255);
      rgba[o + 2] = clamp(Math.round(rgba[o + 2] + color[2] * add), 0, 255);
    }
  }
}

function starIntensity(mag) {
  // A presentation ramp, not photometry: bright catalogue stars saturate,
  // faint ones remain visible against the diffuse sky.
  const flux = 10 ** (-0.4 * (mag - 4));
  return clamp(0.22 + 0.78 * Math.min(1, flux ** 0.55), 0.18, 1.0);
}

// The synthetic stars have a fixed angular size. At the coarse base a resolved
// star is smaller than a pixel, so a one-pixel floor keeps it visible; as the
// HEALPix order increases the same angular size maps to more pixels instead of
// the star shrinking by an order of magnitude between LODs.
function starAngularRadiusDeg(mag) {
  return clamp(0.082 + (6.4 - mag) * 0.037, 0.082, 0.235);
}

function splatStars(rgba, width, height, epochIndex, project, angularPixelScale) {
  for (const star of STARS) {
    const at = starAtEpoch(star, epochIndex);
    if (!at.visible || !isCovered(at.ra, at.dec, epochIndex)) continue;
    const p = project(at.ra, at.dec);
    if (!p) continue;
    const radius = clamp(starAngularRadiusDeg(at.mag) / angularPixelScale, 0.8, 12);
    splatGaussian(rgba, width, height, p.x, p.y, radius, at.color, starIntensity(at.mag), Boolean(p.wrapX));
  }
}

function splatTransients(rgba, width, height, epochIndex, project, angularPixelScale) {
  for (const transient of TRANSIENTS) {
    const state = transient.epochs[epochIndex];
    if (!state || state.flux <= 0) continue;
    if (!isCovered(state.ra, state.dec, epochIndex)) continue;
    const p = project(state.ra, state.dec);
    if (!p) continue;
    // The blob has a fixed angular size in the model. Convert it to pixels so
    // it stays physically consistent across LODs; clamp so it is still visible
    // at the coarse base layer.
    const radius = clamp(state.radius / angularPixelScale, 1.1, 26);
    splatGaussian(rgba, width, height, p.x, p.y, radius, transient.color, 0.5 * state.flux, Boolean(p.wrapX));
  }
}

// --- base equirectangular texture ---------------------------------------------

function renderBasePixels(epochIndex, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const angularPixelScale = 180 / height;
  for (let py = 0; py < height; py++) {
    const dec = 90 - ((py + 0.5) / height) * 180;
    for (let px = 0; px < width; px++) {
      const ra = ((px + 0.5) / width) * 360;
      const [r, g, b] = diffuseColor(ra, dec, epochIndex);
      const o = (py * width + px) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = isCovered(ra, dec, epochIndex) ? 255 : 0;
    }
  }
  const project = (ra, dec) => ({
    x: (ra / 360) * width - 0.5,
    y: ((90 - dec) / 180) * height - 0.5,
    wrapX: true,
  });
  splatStars(rgba, width, height, epochIndex, project, angularPixelScale);
  splatTransients(rgba, width, height, epochIndex, project, angularPixelScale);
  return rgba;
}

// --- HEALPix tangent-plane tile ------------------------------------------------

function renderTilePixels(epochIndex, order, ipix, size) {
  const nside = order2nside(order);
  const center = pixelCenterRaDec(order, ipix);
  const centerDir = sciDir(center.ra, center.dec);
  const raRad = center.ra * DEG;
  const decRad = center.dec * DEG;

  // Local east/north basis in the scientific frame. These are the same
  // directions the client reconstructs from the renderer's basis.
  const east = [-Math.sin(raRad), Math.cos(raRad), 0];
  const north = [
    -Math.sin(decRad) * Math.cos(raRad),
    -Math.sin(decRad) * Math.sin(raRad),
    Math.cos(decRad),
  ];
  const half = tileHalfAngleRad(order);
  // Both star and transient radii are expressed in degrees; convert the
  // tangent-plane pixel scale from radians so the LOD sizing is consistent.
  const angularPixelScale = ((2 * half) / size) * RAD;

  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    const v = 1 - ((py + 0.5) / size) * 2;
    for (let px = 0; px < size; px++) {
      const u = ((px + 0.5) / size) * 2 - 1;
      const dir = normalize3([
        centerDir[0] + east[0] * u * half + north[0] * v * half,
        centerDir[1] + east[1] * u * half + north[1] * v * half,
        centerDir[2] + east[2] * u * half + north[2] * v * half,
      ]);
      const { ra, dec } = sciDirToRaDec(dir);
      const [r, g, b] = diffuseColor(ra, dec, epochIndex);
      const o = (py * size + px) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = isCovered(ra, dec, epochIndex) ? 255 : 0;
    }
  }

  const project = (ra, dec) => {
    const dir = sciDir(ra, dec);
    const denom = dir[0] * centerDir[0] + dir[1] * centerDir[1] + dir[2] * centerDir[2];
    if (denom <= 0.02) return null;
    const u = (dir[0] * east[0] + dir[1] * east[1] + dir[2] * east[2]) / denom / half;
    const v = (dir[0] * north[0] + dir[1] * north[1] + dir[2] * north[2]) / denom / half;
    if (Math.abs(u) > 1.3 || Math.abs(v) > 1.3) return null;
    return {
      x: ((u + 1) / 2) * size - 0.5,
      y: ((1 - v) / 2) * size - 0.5,
      wrapX: false,
    };
  };

  splatStars(rgba, size, size, epochIndex, project, angularPixelScale);
  splatTransients(rgba, size, size, epochIndex, project, angularPixelScale);
  return rgba;
}

// --- minimal PNG encoder (RGBA8) ----------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Encode an RGBA8 pixel array as a PNG buffer. */
export function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('encodePng requires positive integer dimensions');
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError(`encodePng expected ${width * height * 4} bytes, got ${rgba.length}`);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const source = y * stride;
    const target = y * (stride + 1);
    raw[target] = 0; // filter: none
    raw.set(rgba.subarray(source, source + stride), target + 1);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- cache + public API --------------------------------------------------------

const TILE_CACHE_LIMIT = 320;
const BASE_CACHE_LIMIT = 8;
const tileCache = new Map();
const baseCache = new Map();

function cacheGet(map, key) {
  const value = map.get(key);
  if (value) {
    map.delete(key);
    map.set(key, value);
  }
  return value;
}

function cacheSet(map, key, value, limit) {
  if (map.size >= limit) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

export class SkyTileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SkyTileError';
    this.code = code;
  }
}

export function resolveEpoch(epochId) {
  const epoch = SKY_EPOCHS.find((item) => item.id === epochId);
  if (!epoch) {
    throw new SkyTileError('unknown_epoch', `unknown epoch "${epochId}"`);
  }
  return epoch;
}

function parseInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseOrder(value) {
  const order = parseInteger(value);
  if (order === null || order < MIN_ORDER || order > MAX_ORDER) {
    throw new SkyTileError('bad_tile', `order must be an integer in [${MIN_ORDER}, ${MAX_ORDER}]`);
  }
  return order;
}

function parseIpix(value, npix) {
  const ipix = parseInteger(value);
  if (ipix === null || ipix < 0 || ipix >= npix) {
    throw new SkyTileError('bad_tile', `ipix must be an integer in [0, ${npix})`);
  }
  return ipix;
}

function etagFor(kind, epochId, order = '', ipix = '') {
  const digest = createHash('sha1')
    .update(`${SKY_MODEL_REVISION}:${kind}:${epochId}:${order}:${ipix}`)
    .digest('hex');
  return `"${digest}"`;
}

/** Serve one equirectangular base texture for an epoch. */
export function renderBase({ epoch, width = BASE_WIDTH, height = BASE_HEIGHT }) {
  const resolved = resolveEpoch(epoch);
  if (!Number.isInteger(width) || width <= 0 || width > 2048 || !Number.isInteger(height) || height <= 0 || height > 1024) {
    throw new SkyTileError('bad_request', 'base dimensions must be positive integers within 2048x1024');
  }
  const key = `${resolved.id}:${width}x${height}`;
  const hit = cacheGet(baseCache, key);
  if (hit) return { ...hit, cached: true };
  const png = encodePng(width, height, renderBasePixels(resolved.index, width, height));
  const result = {
    png,
    etag: etagFor('base', resolved.id, `${width}x${height}`),
    mode: 'illustrative',
    revision: SKY_MODEL_REVISION,
    epoch: resolved.id,
    width,
    height,
    cached: false,
  };
  cacheSet(baseCache, key, result, BASE_CACHE_LIMIT);
  return result;
}

/** Serve one HEALPix NEST tile as a tangent-plane RGBA PNG. */
export function renderTile({ epoch, order, ipix }) {
  const resolved = resolveEpoch(epoch);
  const orderValue = parseOrder(order);
  const nside = order2nside(orderValue);
  const npix = nside2npix(nside);
  const ipixValue = parseIpix(ipix, npix);
  const key = `${resolved.id}:${orderValue}:${ipixValue}`;
  const hit = cacheGet(tileCache, key);
  if (hit) return { ...hit, cached: true };

  const png = encodePng(TILE_SIZE, TILE_SIZE, renderTilePixels(resolved.index, orderValue, ipixValue, TILE_SIZE));
  const result = {
    png,
    etag: etagFor('tile', resolved.id, orderValue, ipixValue),
    mode: 'illustrative',
    revision: SKY_MODEL_REVISION,
    epoch: resolved.id,
    order: orderValue,
    ipix: ipixValue,
    size: TILE_SIZE,
    cached: false,
  };
  cacheSet(tileCache, key, result, TILE_CACHE_LIMIT);
  return result;
}

/** Drop the in-process tile cache (tests, maintenance, future archive swap). */
export function clearSkyTileCache() {
  tileCache.clear();
  baseCache.clear();
}

/** The public index the client boots from. */
export function skyIndex() {
  const levels = [];
  for (let order = MIN_ORDER; order <= MAX_ORDER; order++) {
    const nside = order2nside(order);
    levels.push({
      order,
      nside,
      npix: nside2npix(nside),
      resolutionDeg: +(nside2resolRad(nside) * RAD).toFixed(4),
      initial: order === BASE_ORDER,
    });
  }
  const initialTileCount = nside2npix(order2nside(BASE_ORDER));
  return {
    schema: SKY_INDEX_SCHEMA,
    mode: 'illustrative',
    modelRevision: SKY_MODEL_REVISION,
    notice:
      'The global four-epoch layer is a deterministic visualization prototype, not an archive measurement. ' +
      'Real validated SPHEREx NEP products remain available in the SPHEREx FIELD tab and in the regional archive mode.',
    presentation: {
      eyebrow: 'SPHEREx / GLOBAL SKY',
      title: 'Four-epoch illustrative sky',
      badge: 'ILLUSTRATIVE GLOBAL LAYER',
      badgeTone: 'warn',
      lede:
        'A real-time sphere with four illustrative epoch layers, driven by the timeline below. ' +
        'The whole sky is covered at low resolution first; finer HEALPix patches stream in only around the view. ' +
        'Dark hatched regions are no-data, not unobserved sky rendered as black flux.',
      noDataLabel: 'NO-DATA REGION',
      observedLabel: 'ILLUSTRATIVE MODEL SKY',
      coverageLabel: 'MODEL SKY',
    },
    generatedAt: null,
    epochs: SKY_EPOCHS.map((epoch) => ({
      ...epoch,
      coverage: +coverageForEpoch(epoch.index).toFixed(4),
      coverageLabel: 'model sky',
      coverageScope: 'whole sky',
    })),
    tiles: {
      scheme: 'healpix-nest',
      ordering: 'NEST',
      baseOrder: BASE_ORDER,
      minOrder: MIN_ORDER,
      maxOrder: MAX_ORDER,
      textureSize: TILE_SIZE,
      base: {
        width: BASE_WIDTH,
        height: BASE_HEIGHT,
        urlTemplate: '/api/spherex/sky/base/{epoch}.png',
      },
      urlTemplate: '/api/spherex/sky/tile/{epoch}/{order}/{ipix}.png',
      levels,
    },
    sources: {
      url: '/api/spherex/sky/sources',
      schema: SKY_SOURCES_SCHEMA,
      note: 'Illustrative change candidates. Not a variability catalogue.',
    },
    performance: {
      initialTileCount,
      maxVisibleTileCount: initialTileCount + 32 + 16 + 12,
      maxTextureUnits: 192,
      textureBytesApprox: TILE_SIZE * TILE_SIZE * 4,
      workerDecode: true,
      detailOrders: [2, 3, 4],
    },
    real: {
      fieldTab: 'spherex',
      note: 'Two real reprojected NEP observations are available in SPHEREx FIELD.',
    },
  };
}

/** GPU-instanced source measurements for the four epochs. */
export function skySources() {
  const pick = (kind, count) => STARS
    .filter((star) => star.kind === kind)
    .sort((a, b) => a.mag - b.mag)
    .slice(0, count);
  // A deliberate mix: the timeline demonstrates motion, brightness change and
  // appearing/disappearing candidates. All are prototype labels, never
  // detections.
  const significant = [
    ...pick('mover', 3),
    ...pick('variable', 3),
    ...pick('transient', 2),
  ];

  const candidates = significant.map((star, index) => ({
    id: `DEMO-SRC-${String(index + 1).padStart(2, '0')}`,
    name: `${star.kind === 'mover' ? 'Prototype mover' : star.kind === 'variable' ? 'Prototype variable' : 'Prototype transient'} ${index + 1}`,
    kind: star.kind,
    color: star.kind === 'mover' ? '#7fd8ff' : star.kind === 'variable' ? '#ffd27a' : '#ff9b7a',
    epochs: SKY_EPOCHS.map((epoch) => {
      const at = starAtEpoch(star, epoch.index);
      return {
        epoch: epoch.id,
        index: epoch.index,
        ra: +at.ra.toFixed(5),
        dec: +at.dec.toFixed(5),
        mag: +at.mag.toFixed(3),
        visible: at.visible && isCovered(at.ra, at.dec, epoch.index),
      };
    }),
  }));

  for (const transient of TRANSIENTS) {
    candidates.push({
      id: transient.id,
      name: transient.name,
      kind: transient.kind,
      color: `rgb(${transient.color.join(',')})`,
      epochs: SKY_EPOCHS.map((epoch) => {
        const state = transient.epochs[epoch.index];
        return {
          epoch: epoch.id,
          index: epoch.index,
          ra: +state.ra.toFixed(5),
          dec: +state.dec.toFixed(5),
          mag: null,
          visible: state.flux > 0 && isCovered(state.ra, state.dec, epoch.index),
        };
      }),
    });
  }

  return {
    schema: SKY_SOURCES_SCHEMA,
    mode: 'illustrative',
    notice:
      'These are deterministic prototype candidates rendered to exercise the change-investigation layer. ' +
      'They are not measurements and must not be cited as variability or motion detections.',
    epochs: SKY_EPOCHS.map((epoch) => ({ id: epoch.id, label: epoch.label, index: epoch.index })),
    candidates,
  };
}

/** Child addresses for a tile, retained as a server-side contract export. */
export function tileChildren(order, ipix) {
  const orderValue = parseOrder(order);
  if (orderValue >= MAX_ORDER) return [];
  const npix = nside2npix(order2nside(orderValue));
  parseIpix(ipix, npix);
  return nestChildren(ipix);
}
