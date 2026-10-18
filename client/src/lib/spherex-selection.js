// M5 — candidate selection for the SPHEREx FIELD viewer.
//
// The selection is stored in grid coordinates (x, y) on the agreed 294×294
// grid. It is independent of the active epoch, mode, zoom, pan and stretch:
// the screen position is derived from the current view, never stored. This
// makes selection persistence a property of the data model rather than a
// visual coincidence — blinking cannot move a selection.
//
// Three evidence levels are used throughout the inspection panel:
//
//   * Observed — read directly from a validated product (raster pixel value,
//     MASK bit, archive metadata, quality flags). Provenance: the product's
//     output SHA-256, the sidecar report, the archive obs id.
//   * Derived — calculated by Novochar using a documented method (sky
//     coordinates from WCS, coverage fraction). Provenance: method name + inputs.
//   * Hypothesis — a possible interpretation that requires further evidence.
//     Never a number in M5.

import { insideRaster, pixelToSky } from './spherex-view.js';

/** Map a screen click to array coordinates on the agreed grid. */
export function selectionFromScreen(screenX, screenY, rect, width, height) {
  if (!rect || !rect.width || !rect.height) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const sx = (screenX - rect.left) * (width / rect.width);
  const sy = (screenY - rect.top) * (height / rect.height);
  // Array row 0 is at the top of the image; screen y grows downward, so the
  // array y is height minus the screen y (same convention as screenToWcs).
  const x = Math.floor(sx);
  const y = Math.floor(height - sy);
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return { x, y };
}

/** Derive sky coordinates (ICRS) from a grid selection through the WCS. */
export function selectionToSky(wcs, selection) {
  if (!wcs || !selection) return null;
  if (!Number.isInteger(selection.x) || !Number.isInteger(selection.y)) return null;
  return pixelToSky(wcs, selection.x + 0.5, selection.y + 0.5);
}

/** Validity of a grid pixel in one epoch's raster. */
export function pixelValidity(mask, image, x, y, width, height) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { valid: false, reason: 'invalid coordinate' };
  if (x < 0 || x >= width || y < 0 || y >= height) return { valid: false, reason: 'outside grid' };
  const i = y * width + x;
  if (!mask || mask[i] !== 1) return { valid: false, reason: 'quality-masked (MASK = 0)' };
  if (!image || !Number.isFinite(image[i])) return { valid: false, reason: 'not finite' };
  return { valid: true, reason: null };
}

/** Read the float32 IMAGE value at a grid pixel (Observed). */
export function pixelValue(image, x, y, width) {
  if (!image || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || width <= 0) return null;
  const i = y * width + x;
  if (i < 0 || i >= image.length) return null;
  return image[i];
}

/** Whether a selection still names a pixel inside the grid. */
export function selectionInBounds(selection, width, height) {
  if (!selection) return false;
  return Number.isInteger(selection.x) && Number.isInteger(selection.y)
    && selection.x >= 0 && selection.x < width
    && selection.y >= 0 && selection.y < height;
}

/** Human-readable reason for an invalid pixel, for the evidence panel. */
export function validityReason(mask, image, x, y, width, height) {
  const v = pixelValidity(mask, image, x, y, width, height);
  if (v.valid) return 'valid';
  return v.reason;
}

/** Whether a selection's grid is the one the products declare. */
export function selectionMatchesGrid(selection, gridShape) {
  if (!selection || !gridShape || !Array.isArray(gridShape) || gridShape.length < 2) return false;
  const [nx, ny] = gridShape;
  return selection.x >= 0 && selection.x < nx && selection.y >= 0 && selection.y < ny;
}