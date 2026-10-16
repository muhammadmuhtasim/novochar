// Graticule path assembly for Mode B — Observe.
//
// A graticule line is sampled in view-frame longitude/latitude and handed to the
// projection's `forward` one point at a time. Whole-sky projections wrap
// longitude at a seam, so two consecutive samples can land on opposite edges of
// the map (e.g. λ = +π then λ = −π). If those two points were joined by a single
// path, a canvas renderer would draw a chord straight across the map.
//
// This module groups a sampled line into seam-split polylines so the renderer can
// stroke each piece without ever connecting across the seam. It is pure and
// frame-neutral: it consumes view-frame radians and the projection's own
// `forward`, and knows nothing about astronomy, the canvas or the DOM.

const TWO_PI = 2 * Math.PI;

/**
 * Wrap a longitude difference into the whole-sky seam interval [-π, π),
 * matching the convention documented in `./projections/mollweide.js`.
 */
export function wrapPi(angleRad) {
  return ((((angleRad + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

/**
 * Project a sampled graticule line into one or more seam-split polylines.
 *
 * A new polyline starts wherever the wrapped longitude jumps by more than
 * `seamToleranceRad` (a seam crossing), or the projection drops a sample
 * (`project` returns null). A line that crosses no seam and is never dropped
 * comes back as a single polyline.
 *
 * @param {Array<[number, number]>} sample ordered [lonRad, latRad] samples
 * @param {(lonRad:number, latRad:number)=>({x:number,y:number}|null)} project
 *   the projection's forward transform
 * @param {{centralMeridianRad?:number, seamToleranceRad?:number}} [options]
 * @returns {Array<Array<{x:number,y:number}>>} plane-space polylines
 */
export function projectGraticuleLine(
  sample,
  project,
  { centralMeridianRad = 0, seamToleranceRad = Math.PI } = {},
) {
  const polylines = [];
  let current = null;
  let previousWrapped = null;

  for (const [lonRad, latRad] of sample) {
    const wrapped = wrapPi(lonRad - centralMeridianRad);
    const crossesSeam = previousWrapped !== null && Math.abs(wrapped - previousWrapped) > seamToleranceRad;
    previousWrapped = wrapped;

    const point = project(lonRad, latRad);
    if (!point || crossesSeam) {
      // Start a fresh polyline so nothing is drawn across the seam, and skip a
      // sample the projection dropped.
      current = null;
      if (!point) continue;
    }
    if (!current) {
      current = [];
      polylines.push(current);
    }
    current.push(point);
  }

  return polylines;
}
