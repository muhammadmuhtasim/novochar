// Small-angle astrometry helpers shared by the blink comparator's readouts and
// charts.
//
// Raw RA/Dec differences are NOT on-sky angular distances: an east-west offset
// shrinks with cos(dec), and RA wraps across 0/360. Everything here therefore
// projects onto the local tangent plane (a "gnomonic-ish" small-angle frame
// centred on the first epoch) before converting degrees -> milli-arcsec.
//
// Pure and dependency-free so it can be unit-tested in Node and reused by the
// canvas, the SVG charts and the text readouts alike.

/** Signed difference raTo − raFrom in degrees, wrapped to (−180, 180]. */
export function dRADegWrapped(raTo, raFrom) {
  return ((((raTo - raFrom) % 360) + 540) % 360) - 180;
}

/** East-west separation (mas) between two RA/Dec positions at the mid declination. */
export function eastWestMas(raTo, decTo, raFrom, decFrom) {
  const decMid = (((decTo + decFrom) / 2) * Math.PI) / 180;
  return dRADegWrapped(raTo, raFrom) * Math.cos(decMid) * 3.6e6;
}

/** North-south separation (mas) between two declinations. */
export function northSouthMas(decTo, decFrom) {
  return (decTo - decFrom) * 3.6e6;
}

/**
 * Tangent-plane offset of every frame relative to the first epoch, in mas.
 * @returns {Array<{east:number, north:number, mag:number, epochISO?:string, epochJD?:number, passCode?:string, flagged?:boolean}>}
 */
export function motionPath(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const f0 = frames[0];
  return frames.map((f) => ({
    east: eastWestMas(f.ra, f.dec, f0.ra, f0.dec),
    north: northSouthMas(f.dec, f0.dec),
    mag: f.measuredMag,
    epochISO: f.epochISO,
    epochJD: f.epochJD,
    passCode: f.passCode,
    flagged: Boolean(f.flagged),
  }));
}

/** Elapsed time across the frame series, in days (from the Julian-Date clock). */
export function spanDays(frames) {
  if (!Array.isArray(frames) || frames.length < 2) return 0;
  const j0 = frames[0].epochJD;
  const j1 = frames[frames.length - 1].epochJD;
  if (Number.isFinite(j0) && Number.isFinite(j1) && j1 !== j0) return Math.abs(j1 - j0);
  const d0 = Date.parse(frames[0].epochISO);
  const d1 = Date.parse(frames[frames.length - 1].epochISO);
  return Number.isFinite(d0) && Number.isFinite(d1) ? Math.abs(d1 - d0) / 86_400_000 : 0;
}

/**
 * Summary of the apparent motion of a frame series.
 * @returns {{path:Array, totalMas:number, spanDays:number, masPerDay:number,
 *            paDeg:number, maxSep:number, magMin:number, magMax:number}}
 */
export function motionStats(frames) {
  const path = motionPath(frames);
  if (path.length === 0) {
    return { path, totalMas: 0, spanDays: 0, masPerDay: 0, paDeg: NaN, maxSep: 0, magMin: NaN, magMax: NaN };
  }
  let maxSep = 0;
  for (const p of path) maxSep = Math.max(maxSep, Math.hypot(p.east, p.north));
  const end = path[path.length - 1];
  const totalMas = Math.hypot(end.east, end.north);
  const days = spanDays(frames);
  const masPerDay = days > 0 ? totalMas / days : 0;
  // Position angle measured east of north (the astronomical convention).
  // Undefined when there is no net displacement (e.g. a single frame).
  let paDeg = NaN;
  if (totalMas > 0) {
    paDeg = (Math.atan2(end.east, end.north) * 180) / Math.PI;
    if (paDeg < 0) paDeg += 360;
  }
  const mags = path.map((p) => p.mag).filter((m) => Number.isFinite(m));
  return {
    path,
    totalMas,
    spanDays: days,
    masPerDay,
    paDeg,
    maxSep,
    magMin: mags.length ? Math.min(...mags) : NaN,
    magMax: mags.length ? Math.max(...mags) : NaN,
  };
}

// Motion classes mirror the simulated populations in the catalogue
// (TNO 0.2–2.5, AST 8–60, HPM 60–900 mas/day) so the wording stays consistent
// with the CATALOGUE / SKY VIEWER labels.
export const MOTION_CLASSES = [
  {
    key: 'tno',
    max: 5,
    label: 'Slow — distant',
    blurb: 'Barely moves between passes, like a trans-Neptunian object far beyond Neptune.',
  },
  {
    key: 'ast',
    max: 60,
    label: 'Main-belt pace',
    blurb: 'A steady migrator — typical of a main-belt asteroid a few AU from the Sun.',
  },
  {
    key: 'neo',
    max: 300,
    label: 'Fast mover',
    blurb: 'Sweeps across the field quickly — the signature of a nearby object or a fast star.',
  },
  {
    key: 'hpm',
    max: Infinity,
    label: 'Very fast — nearby',
    blurb: 'Large angular drift means it is close to us: a high-proper-motion star or NEO.',
  },
];

/** Classify an apparent motion (mas/day) into a plain-language band. */
export function classifyMotion(motion) {
  if (!Number.isFinite(motion)) {
    return { key: 'unknown', label: 'Unknown', blurb: 'No motion model available for this target.' };
  }
  return MOTION_CLASSES.find((c) => motion < c.max) || MOTION_CLASSES[MOTION_CLASSES.length - 1];
}
