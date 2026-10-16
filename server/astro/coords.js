// Coordinate conversion utilities for the Processing/Matching layer.
//
// The authoritative implementation now lives in the shared @novochar/astro
// package so the server, tests, and client share one equatorial (RA/Dec, ICRS)
// <-> Galactic (l, b) transform and one angular-separation convention. See
// shared/astro/frames.js for the IAU ICRS-native Galactic rotation matrix,
// constants, and rotation-convention notes.
//
// This module is kept as the server-facing entry point with a stable import
// path; it re-exports the shared implementation unchanged, so existing callers
// remain unaffected.

export {
  DEG2RAD,
  RAD2DEG,
  rotZ,
  rotY,
  matMul3,
  transpose3,
  raDecToVector,
  vectorToRaDec,
  raDecToGalactic,
  galacticToRaDec,
  angularSeparationDeg,
  angularSeparationArcsec,
  ARCSEC_PER_DEG,
} from '@novochar/astro';
