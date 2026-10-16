// Projection registry for Mode B — Observe.
//
// A projection is a pure object with a fixed contract so the renderer never
// needs to know which projection is active:
//
//   {
//     id, name, kind,                 // identity / metadata
//     aspectRatio,                     // width / height of the canonical extent
//     bounds: { xMin, xMax, yMin, yMax },
//     forward(lonRad, latRad, opts) -> { x, y } | null,
//     inverse(x, y, opts)           -> { lonRad, latRad } | null,
//     isValidLonLat(lonRad, latRad) -> boolean,
//     isInsideMap(x, y)             -> boolean,
//   }
//
// `opts` currently carries `centralMeridianRad`, which must be finite; a
// non-finite option makes forward/inverse return null rather than a NaN point.
// Because every projection owns its own forward/inverse/bounds, a regional
// projection can be added by exporting another descriptor here without touching
// the renderer.
//
// FRAME NEUTRALITY (contract): a projection consumes `(lonRad, latRad)` and
// knows nothing about which astronomical frame those coordinates are in. Callers
// must pass a single consistent frame — the catalog stores canonical ICRS, a
// frame adapter converts to the selected view frame, and only then are
// `(lonRad, latRad)` handed to `forward`/`inverse`. Projections must never
// assume equatorial or Galactic semantics.

import { mollweide } from './mollweide.js';

export const projections = Object.freeze({
  mollweide,
});

/** Look up a projection by id, throwing a useful error for unknown ids. */
export function getProjection(id) {
  const projection = projections[id];
  if (!projection) {
    throw new RangeError(
      `unknown projection "${id}"; known: ${Object.keys(projections).join(', ')}`,
    );
  }
  return projection;
}

/** Lightweight metadata list for UI menus. */
export function listProjections() {
  return Object.values(projections).map(({ id, name, kind }) => ({ id, name, kind }));
}

export { mollweide };
