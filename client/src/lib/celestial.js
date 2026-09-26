// Simple plate carrée projection helpers for the sky viewer. The simulated
// SPHEREx field is a small ~28°x18° tract of sky, so a linear projection is a
// fine placeholder — swap for a gnomonic/TAN projection if you widen the field.

export function raDecToNormalized(ra, dec, { raCenter, decCenter, raHalf, decHalf }) {
  let dRA = raCenter - ra; // RA increases eastward; we show RA decreasing to the right
  if (dRA > 180) dRA -= 360;
  if (dRA < -180) dRA += 360;
  const nx = (dRA / raHalf + 1) / 2; // 0..1
  const ny = (dec - (decCenter - decHalf)) / (2 * decHalf); // 0..1
  return { nx, ny };
}

export function normalizedToRaDec(nx, ny, { raCenter, decCenter, raHalf, decHalf }) {
  const ra = raCenter - (nx - 0.5) * 2 * raHalf;
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