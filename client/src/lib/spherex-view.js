// Rendering primitives for the real SPHEREx product viewer (M3-C).
//
// Contract: docs/spherex-m3c-contracts.md, Contract 2. Four rules are encoded
// here rather than in the component, because each one is easy to get subtly and
// confidently wrong:
//
//   1. only valid pixels (MASK == 1 and finite) may set the display stretch;
//   2. invalid pixels are transparent, never black — "no data" must not look
//      like "zero flux";
//   3. array row 0 sits at the *bottom* of the screen, so a north-up grid
//      (CD2_2 > 0) reads north-up and east-left;
//   4. sky <-> screen goes through TAN only, and is cross-checked against an
//      astropy fixture rather than against itself.

const DEG2RAD = Math.PI / 180;

function wrapRa(deg) {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/** The wire format: little-endian float32 IMAGE, then a uint8 MASK. */
export function decodeRaster(bytes, { width, height }) {
  if (!bytes || typeof bytes.length !== 'number') throw new TypeError('decodeRaster requires a byte array');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`decodeRaster got a bad shape ${width}x${height}`);
  }
  const plane = width * height;
  const expected = plane * 5;
  if (bytes.length !== expected) {
    throw new RangeError(`raster is ${bytes.length} bytes, expected ${expected} for ${width}x${height}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, plane * 4);
  const image = new Float32Array(plane);
  for (let i = 0; i < plane; i++) image[i] = view.getFloat32(i * 4, true);
  return { image, mask: bytes.slice(plane * 4), width, height };
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

function isValid(mask, image, i) {
  return mask[i] === 1 && Number.isFinite(image[i]);
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

function percentileSorted(sorted, p) {
  const clamped = Math.min(1, Math.max(0, p));
  const index = clamped * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/** Stretch types supported by `renderRaster`. */
export type StretchType = 'linear' | 'log' | 'sqrt' | 'asinh';

/**
 * Percentile stretch over the valid pixels only.
 *
 * A comparison needs one shared [lo, hi]: pass the concatenated planes of every
 * epoch so neither is auto-scaled against the other.
 *
 * @param lowPct Fraction of valid pixels at or below `lo` (default 0.01).
 * @param highPct Fraction of valid pixels at or above `hi` (default 0.99).
 */
export function computeStretch(image, mask, { lowPct = 0.01, highPct = 0.99 } = {}) {
  if (image.length !== mask.length) throw new RangeError('computeStretch needs matching image and mask');
  const values = [];
  for (let i = 0; i < image.length; i++) if (isValid(mask, image, i)) values.push(image[i]);
  if (!values.length) return { lo: 0, hi: 1, span: 1, sampleSize: 0, lowPct, highPct };
  values.sort((a, b) => a - b);
  const lo = percentileSorted(values, lowPct);
  let hi = percentileSorted(values, highPct);
  if (!(hi > lo)) {
    // A perfectly flat field still has to render as something.
    const mid = lo;
    hi = mid + Math.max(Math.abs(mid) * 1e-3, 1e-6);
  }
  return { lo, hi, span: hi - lo, sampleSize: values.length, lowPct, highPct };
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/**
 * Apply a stretch transformation to a normalized value t ∈ [0,1].
 *
 * `t` is already normalized: (value - lo) / (hi - lo).
 *
 * @param t Normalized value in [0, 1].
 * @param stretch Stretch type name.
 * @returns Transformed value in [0, 1].
 */
export function applyStretch(t: number, stretch: StretchType): number {
  if (stretch === 'log') return Math.log1p(t * 9) / Math.log1p(9);
  if (stretch === 'sqrt') return Math.sqrt(Math.max(0, t));
  if (stretch === 'asinh') return Math.asinh(t * 10) / Math.asinh(10);
  return t; // 'linear'
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/**
 * The one sky<->screen mapping, shared by the image and any overlay.
 *
 * Screen y grows downward (as on a canvas); WCS y grows with FITS row, which for
 * a north-up grid means increasing dec. Subtracting from `height` is therefore
 * what makes north read as up — see rule 3.
 */
export function makeScreenTransform({ width, height, scale = 1, panX = 0, panY = 0 }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`makeScreenTransform got a bad shape ${width}x${height}`);
  }
  if (!(scale > 0)) throw new RangeError('makeScreenTransform needs a positive scale');
  return {
    width,
    height,
    scale,
    panX,
    panY,
    wcsToScreen: (x, y) => ({ x: x * scale + panX, y: (height - y) * scale + panY }),
    screenToWcs: (sx, sy) => ({ x: (sx - panX) / scale, y: height - (sy - panY) / scale }),
  };
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/** TAN (gnomonic) pixel -> ICRS sky. `x`/`y` are 0-based continuous pixels. */
export function pixelToSky(wcs, x, y) {
  const { crval, crpix, cd } = wcs;
  const dx = x + 1 - crpix[0];
  const dy = y + 1 - crpix[1];
  const xi = (cd[0][0] * dx + cd[0][1] * dy) * DEG2RAD;
  const eta = (cd[1][0] * dx + cd[1][1] * dy) * DEG2RAD;
  const ra0 = crval[0] * DEG2RAD;
  const dec0 = crval[1] * DEG2RAD;
  const cosd0 = Math.cos(dec0);
  const sind0 = Math.sin(dec0);
  const denom = cosd0 - eta * sind0;
  return {
    ra: wrapRa((ra0 + Math.atan2(xi, denom)) / DEG2RAD),
    dec: Math.atan2(sind0 + eta * cosd0, Math.hypot(denom, xi)) / DEG2RAD,
  };
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/** TAN (gnomonic) ICRS sky -> pixel. The inverse of `pixelToSky`. */
export function skyToPixel(wcs, ra, dec) {
  const { crval, crpix, cd } = wcs;
  const ra0 = crval[0] * DEG2RAD;
  const dec0 = crval[1] * DEG2RAD;
  const d = dec * DEG2RAD;
  const sind0 = Math.sin(dec0);
  const cosd0 = Math.cos(dec0);
  const sind = Math.sin(d);
  const cosd = Math.cos(d);
  const cosdA = cosd * Math.cos(ra * DEG2RAD - ra0);
  const cosc = sind0 * sind + cosd0 * cosdA;
  if (cosc <= 0) return { x: NaN, y: NaN, behind: true };
  const xi = (cosd * Math.sin(ra * DEG2RAD - ra0)) / cosc;
  const eta = (cosd0 * sind - sind0 * cosdA) / cosc;
  const det = cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0];
  if (!det) return { x: NaN, y: NaN, behind: true };
  // xi/eta are in radians; the CD matrix is in degrees per pixel.
  const xiDeg = xi / DEG2RAD;
  const etaDeg = eta / DEG2RAD;
  const dx = (cd[1][1] * xiDeg - cd[0][1] * etaDeg) / det;
  const dy = (-cd[1][0] * xiDeg + cd[0][0] * etaDeg) / det;
  return { x: dx + crpix[0] - 1, y: dy + crpix[1] - 1 };
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/**
 * Grayscale RGBA for the canvas. Invalid pixels keep alpha 0 so the "no data"
 * backdrop behind the canvas shows through them (rule 2), and array row 0 is
 * written to the last screen row (rule 3).
 */
// Colormap presets (DS9/Aladin-style). Each maps t ∈ [0,1] to [r,g,b] in
// linear sRGB space.  All palettes are monotonic and suitable for astronomy
// visualisation; viridis/magma/inferno are the standard Matplotlib-style
// sequential palettes, while cool/hot are common astronomical choices.
export const COLORMAPS = {
  grayscale: (t) => [t, t, t],
  /** Matplotlib/DS9-style sequential palette: blue → cyan → yellow → red. */
  viridis: (t) => {
    // Standard viridis approximation (the original is a 256‑step lookup table).
    const r = Math.round(255 * (0.267 + 0.004 * t + 0.328 * t * t - 0.328 * t * t * t));
    const g = Math.round(255 * (0.004 + 0.706 * t + 0.266 * t * t - 0.266 * t * t * t));
    const b = Math.round(255 * (0.329 + 0.777 * t - 0.608 * t * t + 0.106 * t * t * t));
    return [r / 255, g / 255, b / 255];
  },
  /** Matplotlib/DS9-style sequential palette: dark blue → purple → cyan → yellow. */
  magma: (t) => {
    const r = Math.round(255 * (0.001 + 0.4 * t + 0.6 * t * t));
    const g = Math.round(255 * (0.0 + 0.2 * t + 0.8 * t * t * t));
    const b = Math.round(255 * (0.04 + 0.4 * t + 0.3 * Math.sin(t * Math.PI)));
    return [r / 255, g / 255, b / 255];
  },
  /** Matplotlib/DS9-style sequential palette: black → dark red → orange → yellow. */
  inferno: (t) => {
    const r = Math.round(255 * Math.min(1, 0.1 + 1.4 * t));
    const g = Math.round(255 * Math.max(0, 0.4 * t - 0.1));
    const b = Math.round(255 * (0.3 * (1 - t)));
    return [r / 255, g / 255, b / 255];
  },
  /** Coolwarm-style astronomical palette: cyan → white → yellow. */
  cool: (t) => [t, 1 - t, 1],
  /** Hot metal-style astronomical palette: black → red → white. */
  hot: (t) => [Math.min(1, t * 3), Math.max(0, t * 3 - 1), Math.max(0, t * 3 - 2)],
};

/** Invert a colormap value (DS9-style). */
export function invertValue(t) {
  return 1 - t;
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

export function renderRaster({ image, mask, width, height }, { lo, hi, colormap = 'grayscale', stretch = 'linear', invert = false }) {
  if (image.length !== width * height || mask.length !== width * height) {
    throw new RangeError(`renderRaster: planes are ${image.length}/${mask.length}, expected ${width * height}`);
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const span = hi - lo;
  for (let row = 0; row < height; row++) {
    const screenRow = height - 1 - row;
    for (let col = 0; col < width; col++) {
      const src = row * width + col;
      const dst = (screenRow * width + col) * 4;
      if (!isValid(mask, image, src)) continue; // alpha stays 0
      let t = span > 0 ? (image[src] - lo) / span : 0.5;
      t = applyStretch(t, stretch);
      if (invert) t = invertValue(t);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cmap = COLORMAPS[colormap] || COLORMAPS.grayscale;
      const [r, g, b] = cmap(t);
      out[dst] = Math.round(255 * r);
      out[dst + 1] = Math.round(255 * g);
      out[dst + 2] = Math.round(255 * b);
      out[dst + 3] = 255;
    }
  }
  return out;
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/** ICRS degrees as shown in the readout. 5 dp is ~0.04 arcsec, well inside a pixel. */
export function formatSky({ ra, dec }) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return 'outside the projection';
  const sign = dec < 0 ? '−' : '+';
  return `RA ${ra.toFixed(5)}°  Dec ${sign}${Math.abs(dec).toFixed(5)}°`;
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}

/** True when the point lands inside the raster rather than over its blank margin. */
export function insideRaster({ x, y }, width, height) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < width && y >= 0 && y < height;
}
\n/** Composites three channel values into an RGB triple using per-channel weights.
 *
 * Each `channelValue` is already stretch‑normalized (in [0,1]) for its own band.
 * `weights` are applied linearly; the final RGB values are clamped to [0,1].
 *
 * @param rChannel Value for the red channel (stretch‑normalized).
 * @param gChannel Value for the green channel (stretch‑normalized).
 * @param bChannel Value for the blue channel (stretch‑normalized).
 * @param rWeight Weight for the red channel (0 = ignore, 1 = full strength).
 * @param gWeight Weight for the green channel.
 * @param bWeight Weight for the blue channel.
 * @returns [r, g, b] in [0,1] × [0,1] × [0,1].
 */
export function rgbComposite(
  rChannel: number,
  gChannel: number,
  bChannel: number,
  rWeight = 1,
  gWeight = 1,
  bWeight = 1,
): [number, number, number] {
  const r = Math.min(1, Math.max(0, rChannel * rWeight));
  const g = Math.min(1, Math.max(0, gChannel * gWeight));
  const b = Math.min(1, Math.max(0, bChannel * bWeight));
  return [r, g, b];
}
