// Plane-space picking for Mode B — Observe.
//
// Picking happens in the PROJECTION PLANE, not on the sphere. Whole-sky
// projections such as Mollweide are equal-area but not conformal, so screen
// distance is not proportional to angular distance; a pixel-accurate "nearest
// object under the cursor" query must use plane Euclidean distance.
//
// That is also why this module does NOT reuse the spherical HEALPix index:
// HEALPix buckets the sphere into equal-area cells, whose candidate-query
// behaviour does not fit a Euclidean radius in a projected plane. Instead we
// build a uniform grid over the projected points. A radius query visits every
// cell overlapping the [x-r, x+r] × [y-r, y+r] box, so no candidate within the
// radius can be missed regardless of the chosen cell size (completeness is
// independent of `cellSize`; the size only affects speed).
//
// Nothing here touches the DOM: the caller scales plane coordinates to pixels
// and converts its pixel tolerance into plane units before calling in.
import { viewLonLatRad } from './frame.js';

/**
 * Project canonical records into plane coordinates, dropping anything that is
 * invalid or off the map.
 * @returns {Array<{x:number, y:number, id:string, record:object}>}
 */
export function projectAll(
  records,
  projection,
  { viewFrame = 'icrs', centralMeridianRad = 0 } = {},
) {
  if (!projection || typeof projection.forward !== 'function') {
    throw new TypeError('projectAll: projection must expose forward()');
  }
  const points = [];
  for (const record of records ?? []) {
    if (!record) continue;
    const { lonRad, latRad } = viewLonLatRad(record, viewFrame);
    const p = projection.forward(lonRad, latRad, { centralMeridianRad });
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    points.push({ x: p.x, y: p.y, id: record.id, record });
  }
  return points;
}

function cellKey(ix, iy) {
  return `${ix}:${iy}`;
}

/**
 * Build a uniform-grid index over projected points.
 *
 * @param {Array<{x:number, y:number, id:string, record:object}>} points
 * @param {{cellSize?: number}} [options] `cellSize` is optional; when omitted a
 *   span/sqrt(n) default is used. Any positive finite value is correct.
 * @returns {{points, cellSize, minX, minY, cells: Map<string, Array>}}
 */
export function buildPlaneIndex(points, { cellSize } = {}) {
  const list = points ?? [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of list) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  let size = cellSize;
  if (size === undefined || size === null) {
    const span = Math.max(maxX - minX, maxY - minY);
    size = span > 0 ? span / Math.max(1, Math.round(Math.sqrt(list.length))) : 1;
  }
  if (!(typeof size === 'number' && Number.isFinite(size) && size > 0)) {
    throw new RangeError('buildPlaneIndex: cellSize must be a positive finite number');
  }

  const cells = new Map();
  for (const p of list) {
    const key = `${Math.floor((p.x - minX) / size)}:${Math.floor((p.y - minY) / size)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = [];
      cells.set(key, cell);
    }
    cell.push(p);
  }

  return { points: list, cellSize: size, minX, minY, cells };
}

/** Yield every point in a grid, in cells overlapping the given box. */
function* pointsInBox(index, minX, maxX, minY, maxY) {
  const { cellSize, minX: baseX, minY: baseY, cells } = index;
  // Pad the query by a sub-cell amount. Callers filter candidates exactly, so a
  // slightly wider sweep can only add candidates that are then rejected — it can
  // never include an out-of-range point — while ensuring a point sitting exactly
  // on a cell edge (possibly with rounding) is never dropped.
  const pad = cellSize * 1e-9;
  const ix0 = Math.floor((minX - pad - baseX) / cellSize);
  const ix1 = Math.floor((maxX + pad - baseX) / cellSize);
  const iy0 = Math.floor((minY - pad - baseY) / cellSize);
  const iy1 = Math.floor((maxY + pad - baseY) / cellSize);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      const cell = cells.get(`${ix}:${iy}`);
      if (cell) yield* cell;
    }
  }
}

/**
 * Nearest projected point to (x, y), if one lies within `radius`.
 *
 * `radius` is INCLUSIVE: a point exactly `radius` away qualifies. The tolerance
 * is measured in plane units. Ties are broken deterministically by brightness
 * (brighter first, missing magnitude last) and then by ascending id.
 *
 * @returns {{point:object, distance:number}|null} null when nothing is in range.
 */
export function pickNearest(index, x, y, { radius } = {}) {
  if (!index || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) return null;

  const r2 = radius * radius;
  let best = null;
  for (const p of pointsInBox(index, x - radius, x + radius, y - radius, y + radius)) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue; // radius is inclusive: accept d2 <= r2
    if (best === null || isBetter(p, d2, best.point, best.distance2)) {
      best = { point: p, distance2: d2 };
    }
  }
  return best ? { point: best.point, distance: Math.sqrt(best.distance2) } : null;
}

/** Deterministic ordering used by pickNearest's tie-break. */
function isBetter(pa, d2a, pb, d2b) {
  if (d2a !== d2b) return d2a < d2b;
  const ma = pa.record && Number.isFinite(pa.record.mag) ? pa.record.mag : Infinity;
  const mb = pb.record && Number.isFinite(pb.record.mag) ? pb.record.mag : Infinity;
  if (ma !== mb) return ma < mb;
  return String(pa.id) < String(pb.id);
}

/**
 * Every point inside a rectangle, inclusive on all edges. Bounds are normalized,
 * so a reversed drag (`xMin > xMax`) selects the same region. Output is ordered
 * deterministically by (x, y, id).
 *
 * @param {{xMin:number, xMax:number, yMin:number, yMax:number}} rect
 * @returns {Array<object>} matching points.
 */
export function pickInBox(index, { xMin, xMax, yMin, yMax } = {}) {
  if (!index) return [];
  if (![xMin, xMax, yMin, yMax].every((v) => Number.isFinite(v))) return [];

  const loX = Math.min(xMin, xMax);
  const hiX = Math.max(xMin, xMax);
  const loY = Math.min(yMin, yMax);
  const hiY = Math.max(yMin, yMax);

  const out = [];
  for (const p of pointsInBox(index, loX, hiX, loY, hiY)) {
    if (p.x >= loX && p.x <= hiX && p.y >= loY && p.y <= hiY) out.push(p);
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
