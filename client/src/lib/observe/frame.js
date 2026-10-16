// View-frame adapter for Mode B — Observe.
//
// The catalog stores canonical ICRS coordinates. The user may view the sky in a
// different frame; this module is the ONLY place in Observe that knows about
// view frames. It converts a canonical record into view-frame longitude and
// latitude so the projection layer stays frame-agnostic (see
// `./projections/index.js`, "FRAME NEUTRALITY").
//
// All astronomy is delegated to the shared @novochar/astro core — including the
// ICRS-native Galactic transform — so the client never re-implements frames.
// This module is pure: no DOM, no renderer, no state.
import { DEG2RAD, galacticToRaDec, raDecToGalactic } from '@novochar/astro';

/** Frames the sky can be viewed in. */
export const VIEW_FRAMES = Object.freeze({
  ICRS: 'icrs',
  GALACTIC: 'galactic',
});

const VIEW_FRAME_IDS = new Set(Object.values(VIEW_FRAMES));

/** True when `frame` is a known view frame. */
export function isViewFrame(frame) {
  return VIEW_FRAME_IDS.has(frame);
}

function assertViewFrame(frame) {
  if (!isViewFrame(frame)) {
    throw new RangeError(
      `unknown view frame "${frame}"; known: ${[...VIEW_FRAME_IDS].join(', ')}`,
    );
  }
}

/**
 * Canonical ICRS record -> view-frame spherical coordinates in DEGREES.
 * @returns {{lonDeg:number, latDeg:number}}
 */
export function viewLonLat(record, viewFrame = VIEW_FRAMES.ICRS) {
  assertViewFrame(viewFrame);
  if (viewFrame === VIEW_FRAMES.ICRS) {
    return { lonDeg: record.ra, latDeg: record.dec };
  }
  const { l, b } = raDecToGalactic(record.ra, record.dec);
  return { lonDeg: l, latDeg: b };
}

/**
 * Same as {@link viewLonLat} but in RADIANS — the units the projection contract
 * consumes. Callers must pass a single consistent frame to the projection.
 * @returns {{lonRad:number, latRad:number}}
 */
export function viewLonLatRad(record, viewFrame = VIEW_FRAMES.ICRS) {
  const { lonDeg, latDeg } = viewLonLat(record, viewFrame);
  return { lonRad: lonDeg * DEG2RAD, latRad: latDeg * DEG2RAD };
}

/**
 * Inverse of {@link viewLonLat}: view-frame degrees -> canonical ICRS degrees.
 * Useful when turning a picked sky position back into catalog coordinates.
 * @returns {{ra:number, dec:number}}
 */
export function viewLonLatToIcrs(lonDeg, latDeg, viewFrame = VIEW_FRAMES.ICRS) {
  assertViewFrame(viewFrame);
  if (viewFrame === VIEW_FRAMES.ICRS) return { ra: lonDeg, dec: latDeg };
  return galacticToRaDec(lonDeg, latDeg);
}
