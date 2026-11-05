// Pure geometry builders for the inside-out sky sphere.
//
// The illustrative all-sky base is a Mollweide equal-area map, not an
// equirectangular image. Putting that texture on a sphere therefore needs the
// inverse of the image layout: for each sky direction we project RA/Dec into
// Mollweide plane coordinates and use those coordinates as the UV. Sampling a
// rectangular plane grid instead (the old behaviour) left the ellipse corners
// as fake geometry near RA=0 and pinched the poles.
//
// Keeping the grid builder here (rather than inline in the Three.js engine)
// makes the UV contract testable without WebGL.

import {
  MOLLWEIDE_X_MAX,
  MOLLWEIDE_X_MIN,
  MOLLWEIDE_Y_MAX,
  MOLLWEIDE_Y_MIN,
  raDecToMollweidePlane,
} from '@novochar/astro';
import { skyRenderDirection } from './sky3d-orientation.js';

const PLANE_WIDTH = MOLLWEIDE_X_MAX - MOLLWEIDE_X_MIN; // 4√2
const PLANE_HEIGHT = MOLLWEIDE_Y_MAX - MOLLWEIDE_Y_MIN; // 2√2

function normalizeDegrees(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * UV for a sky direction on the Mollweide base texture.
 *
 * The map is centred on RA 0: u=0 and u=1 are the two sides of the ±180°
 * meridian, and v=0/1 are the south/north poles. At the exact +180° seam the
 * shared forward projection wraps to the −180° edge, so callers that build a
 * closed sphere should mirror that final column (see buildSkySphereGrid).
 */
export function mollweideUv(raDeg, decDeg) {
  const plane = raDecToMollweidePlane(raDeg, decDeg);
  if (!plane) return null;
  return {
    u: (plane.x - MOLLWEIDE_X_MIN) / PLANE_WIDTH,
    v: (plane.y - MOLLWEIDE_Y_MIN) / PLANE_HEIGHT,
  };
}

/**
 * Build a lat/lon sphere grid whose UVs match either an equirectangular or a
 * Mollweide base texture.
 *
 * The position grid is always a normal sphere: u advances longitude and v
 * advances latitude. Only the texture coordinates differ. For Mollweide the
 * longitude runs from −180° at the left edge to +180° at the right edge so the
 * UV is continuous across the map; the final column is mirrored to the right
 * edge because the shared projection normalises +180° back to −180°.
 *
 * @returns {{positions:number[], uvs:number[], indices:number[]}}
 */
export function buildSkySphereGrid({
  radius = 1,
  lonSegments = 96,
  latSegments = 48,
  projection = 'equirectangular',
} = {}) {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new TypeError('buildSkySphereGrid requires a positive radius');
  }
  if (!Number.isInteger(lonSegments) || lonSegments < 3) {
    throw new TypeError('buildSkySphereGrid requires at least 3 longitude segments');
  }
  if (!Number.isInteger(latSegments) || latSegments < 2) {
    throw new TypeError('buildSkySphereGrid requires at least 2 latitude segments');
  }
  const mollweide = projection === 'mollweide';
  if (!mollweide && projection !== 'equirectangular') {
    throw new TypeError(`unknown sky projection "${projection}"`);
  }

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let j = 0; j <= latSegments; j++) {
    const v = j / latSegments; // 0 = south, 1 = north
    const dec = -90 + v * 180;
    for (let i = 0; i <= lonSegments; i++) {
      const u = i / lonSegments;
      let ra;
      let uvU;
      let uvV;
      if (mollweide) {
        // Longitude, not RA, parameterises the map seam: the image's left edge
        // is −180° and its right edge is +180°, both the same sky meridian.
        const lon = -180 + u * 360;
        ra = normalizeDegrees(lon);
        const uv = mollweideUv(ra, dec);
        if (!uv) {
          throw new RangeError(`cannot project sky direction ${ra},${dec} onto the Mollweide map`);
        }
        uvU = uv.u;
        uvV = uv.v;
        // raDecToMollweidePlane normalises +180° to −180°. Mirror the last
        // column so the right edge of the ellipse is sampled, not the left
        // edge again. At the poles both map to u=0.5, which is unchanged.
        if (i === lonSegments) uvU = 1 - uvU;
      } else {
        ra = u * 360;
        uvU = u;
        uvV = v;
      }

      const dir = skyRenderDirection(ra, dec);
      positions.push(dir[0] * radius, dir[1] * radius, dir[2] * radius);
      uvs.push(uvU, uvV);
    }
  }

  for (let j = 0; j < latSegments; j++) {
    for (let i = 0; i < lonSegments; i++) {
      const a = j * (lonSegments + 1) + i;
      const b = a + 1;
      const c = a + lonSegments + 1;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  return { positions, uvs, indices };
}

/** True when a Mollweide UV lies inside (or on) the map ellipse. */
export function isInsideMollweideUv(u, v) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return false;
  const x = (u - 0.5) * 2;
  const y = (v - 0.5) * 2;
  return x * x + y * y <= 1 + 1e-9;
}
