// Simple plate carrée projection helpers for the sky viewer. The simulated
// SPHEREx field is a small ~28°x18° tract of sky, so a linear projection is a
// fine placeholder — swap for a gnomonic/TAN projection if you widen the field.
//
// RA is scaled by cos(decCenter) so the map is measured in *physical* angular
// distance on the sky. This keeps the marker layer registered 1:1 with the
// real DSS survey imagery drawn underneath it by the sky viewer.

// Guard against degenerate cos(Dec) near the pole.
function cosDec(dec) {
  return Math.max(0.12, Math.cos((dec * Math.PI) / 180));
}

export function raDecToNormalized(ra, dec, field) {
  const { raCenter, decCenter, raHalf, decHalf } = field;
  let dRA = raCenter - ra; // RA increases eastward; we show RA decreasing to the right
  if (dRA > 180) dRA -= 360;
  if (dRA < -180) dRA += 360;
  const c = cosDec(decCenter);
  const nx = (dRA * c / raHalf + 1) / 2; // 0..1 (physical RA)
  const ny = (dec - (decCenter - decHalf)) / (2 * decHalf); // 0..1
  return { nx, ny };
}

export function normalizedToRaDec(nx, ny, field) {
  const { raCenter, decCenter, raHalf, decHalf } = field;
  const c = cosDec(decCenter);
  const ra = raCenter - (nx - 0.5) * 2 * raHalf / c;
  const dec = decCenter - decHalf + ny * 2 * decHalf;
  return { ra: ((ra % 360) + 360) % 360, dec };
}

// Deterministic background star field for vignette depth.
export function starField(seed = 7, count = 900) {
  const stars = [];
  let a = seed;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) & 0xffffffff;
    return a / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const nx = rnd();
    const ny = rnd();
    const mag = 3 + Math.pow(rnd(), 2.6) * 16; // bright 3 -> faint 19
    const tw = rnd() > 0.9; // occasional twinkle flag
    stars.push({ nx, ny, mag, tw });
  }
  return stars;
}

// Loose RA/Dec parser for the coordinate-search box. Accepts:
//   - decimal degrees:   "84 -58"
//   - sexagesimal with units: "12h 30m 45s +12d 30m 00s"
//   - plain sexagesimal groups: "12 30 45 -12 30 00"  (RA h m s, Dec d m s)
// Returns { ra, dec } in degrees, or null when nothing valid is found.
export function parseCoordInput(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const toks = (raw.match(/([-−]?\d+(?:\.\d+)?)\s*[hHdDmMsS°'′"″]?/g) || [])
    .map((t) => {
      const m = t.match(/([-−]?\d+(?:\.\d+)?)\s*([hHdDmMsS°'′"″]?)/);
      if (!m) return null;
      return { v: Number(m[1].replace(/−/g, '-')), u: (m[2] || '').toLowerCase() };
    })
    .filter((t) => t !== null && !Number.isNaN(t.v));
  if (!toks.length) return null;

  const clamp = (d) => Math.max(-90, Math.min(90, d));
  const norm = (d) => (((d % 360) + 360) % 360);

  // Pure decimal degrees: exactly two unit-less numbers.
  if (toks.length === 2 && toks.every((t) => t.u === '')) {
    return { ra: norm(toks[0].v), dec: clamp(toks[1].v) };
  }

  // Sexagesimal. Split into RA and Dec parts — at the "d"/"°" marker if present,
  // otherwise by assuming plain groups are RA h m s then Dec d m s.
  let raToks; let decToks;
  const dIdx = toks.findIndex((t) => t.u === 'd' || t.u === '°');
  if (dIdx !== -1) {
    raToks = toks.slice(0, dIdx);
    decToks = toks.slice(dIdx);
  } else {
    const n = toks.length;
    const split = n === 4 ? 2 : 3; // 4 -> RA(2) Dec(2); 6 -> RA(3) Dec(3)
    raToks = toks.slice(0, split);
    decToks = toks.slice(split);
    if (decToks.length !== split) return null;
  }
  if (!raToks.length || !decToks.length) return null;

  // Convert each part: index 0 = hours/degrees, 1 = minutes, 2 = seconds.
  const sexag = (part, isRA) => {
    let out = 0; let sign = 1;
    part.forEach((t, i) => {
      if (t.v < 0) sign = -1;
      const v = Math.abs(t.v);
      const factor = isRA ? 15 : 1;
      if (i === 0) out += v * factor;
      else if (i === 1) out += (v / 60) * factor;
      else if (i === 2) out += (v / 3600) * factor;
    });
    return isRA ? norm(out) : clamp(sign * out);
  };

  return { ra: sexag(raToks, true), dec: sexag(decToks, false) };
}