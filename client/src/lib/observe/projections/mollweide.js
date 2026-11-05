// Mollweide equal-area whole-sky projection for Mode B — Observe.
//
// The implementation lives in the shared scientific core
// (`@novochar/astro`, `shared/astro/mollweide.js`) so the server texture
// generators, the 3D sky renderer and this projection registry all consume one
// authoritative kernel. This module keeps the Mode B projection-registry API:
//
//   {
//     id, name, kind,
//     aspectRatio, bounds,
//     forward(lonRad, latRad, { centralMeridianRad }) -> { x, y } | null,
//     inverse(x, y, { centralMeridianRad }) -> { lonRad, latRad } | null,
//     isValidLonLat, isInsideMap,
//   }
//
// FRAME NEUTRALITY (contract): the projection consumes a longitude/latitude
// pair in RADIANS and has no notion of frame; callers supply one consistent
// frame (canonical ICRS via the frame adapter, Galactic via the galactic
// adapter) before calling forward/inverse.

export {
  MOLLWEIDE_EXTENT,
  MOLLWEIDE_ASPECT_RATIO,
  MOLLWEIDE_NAME,
  MOLLWEIDE_X_MAX,
  MOLLWEIDE_X_MIN,
  MOLLWEIDE_Y_MAX,
  MOLLWEIDE_Y_MIN,
  mollweide,
  forward,
  inverse,
  solveTheta,
  isValidLonLat,
  isInsideMap,
  raDecToMollweidePlane,
  mollweidePlaneToRaDec,
} from '@novochar/astro';
