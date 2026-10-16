// Shared observe scene for Mode B — the single source of truth for the linked
// 2D map and 3D sphere.
//
// A scene binds a validated canonical catalog (`./catalog.js`) to a projection
// and a view frame, and pre-computes the projection-plane points and the picking
// index. Both renderers consume the SAME scene object, so object identity is the
// stable catalog id and selection can never drift between views. Re-projecting
// for a different view frame or central meridian returns a new scene over the
// same canonical records — the catalog is never re-derived and no astronomy is
// duplicated here.
import { sphericalToUnit } from '@novochar/astro';
import { buildCatalog } from './catalog.js';
import { viewLonLat as frameViewLonLat } from './frame.js';
import { buildPlaneIndex, pickInBox, pickNearest, projectAll } from './picking.js';
import { getProjection } from './projections/index.js';

/** Accept either a projection id or a descriptor. */
function resolveProjection(projection) {
  return typeof projection === 'string' ? getProjection(projection) : projection;
}

/** Immutable-ish core: catalog + projection + frame -> derived points and index. */
function compose(catalog, projection, viewFrame, centralMeridianRad) {
  const points = projectAll(catalog.records, projection, { viewFrame, centralMeridianRad });
  return {
    catalog,
    projection,
    projectionId: projection.id,
    viewFrame,
    centralMeridianRad,
    points,
    index: buildPlaneIndex(points),
    pointById: new Map(points.map((point) => [point.id, point])),
    recordById: new Map(catalog.records.map((record) => [record.id, record])),
  };
}

/**
 * Build a scene from raw source rows. `frame` (when given) is the DECLARED
 * source frame passed through to `buildCatalog`; omit it when each row declares
 * its own frame.
 */
export function createObserveScene(
  rows,
  { frame, projection = 'mollweide', viewFrame = 'icrs', centralMeridianRad = 0, meta, source } = {},
) {
  const catalog = buildCatalog(rows, { frame, meta, source });
  return compose(catalog, resolveProjection(projection), viewFrame, centralMeridianRad);
}

/** Re-project the same catalog in a different view frame. */
export function withViewFrame(scene, viewFrame) {
  return compose(scene.catalog, scene.projection, viewFrame, scene.centralMeridianRad);
}

/** Re-project the same catalog about a different central meridian. */
export function withCentralMeridian(scene, centralMeridianRad) {
  return compose(scene.catalog, scene.projection, scene.viewFrame, centralMeridianRad);
}

/** Swap the projection, keeping the catalog and view frame. */
export function withProjection(scene, projection) {
  return compose(scene.catalog, resolveProjection(projection), scene.viewFrame, scene.centralMeridianRad);
}

/** The canonical record for a stable id, or null. */
export function findRecord(scene, id) {
  return id === null || id === undefined ? null : scene.recordById.get(id) ?? null;
}

/** The projection-plane point for a record, or null when it is off-map. */
export function projectRecord(scene, record) {
  return record ? scene.pointById.get(record.id) ?? null : null;
}

/** View-frame longitude/latitude (degrees) for a record. */
export function viewLonLatOf(scene, record) {
  return frameViewLonLat(record, scene.viewFrame);
}

/** Pick the nearest record to plane coordinates within `radius` (plane units). */
export function pickAt(scene, x, y, radius) {
  const hit = pickNearest(scene.index, x, y, { radius });
  return hit ? hit.point.record : null;
}

/** Every record whose projected point lies inside the rectangle. */
export function pickWithin(scene, rect) {
  return pickInBox(scene.index, rect).map((point) => point.record);
}

/**
 * Resolve a selection id into the shared view state both renderers need: the
 * canonical record, its plane point (if on-map) and its view-frame position.
 * Returns null for an unknown or cleared id.
 */
export function resolveSelection(scene, id) {
  const record = findRecord(scene, id);
  if (!record) return null;
  return { record, point: projectRecord(scene, record), lonLat: viewLonLatOf(scene, record) };
}

/**
 * Unit direction on the celestial sphere for a record, in the scene's view
 * frame. This is the 3D renderer's counterpart to the 2D plane point: both come
 * from the same scene and the same view-frame coordinates. The spherical ->
 * Cartesian step reuses the shared core's `sphericalToUnit`, so it is the same
 * transform the rest of Novochar uses.
 * @returns {[number, number, number]} unit vector.
 */
export function skyDirectionOf(scene, record) {
  const { lonDeg, latDeg } = viewLonLatOf(scene, record);
  return sphericalToUnit(lonDeg, latDeg);
}

/**
 * The linkage point for the linked 2D/3D view: everything both renderers need
 * for one selection, all derived from one scene. `map` is the 2D plane point,
 * `direction` the 3D unit direction, and both share the record's identity and
 * `sky` position. Returns null for an unknown or cleared id.
 */
export function selectionViews(scene, id) {
  const record = findRecord(scene, id);
  if (!record) return null;
  const sky = viewLonLatOf(scene, record);
  return {
    record,
    map: projectRecord(scene, record),
    sky,
    direction: sphericalToUnit(sky.lonDeg, sky.latDeg),
  };
}

/** Ids of every accepted record, in catalog order (stable identity). */
export function sceneIds(scene) {
  return scene.catalog.records.map((record) => record.id);
}
