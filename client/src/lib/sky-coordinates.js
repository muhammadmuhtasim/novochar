/**
 * Convert equatorial ICRS/J2000 RA/Dec (degrees) into the sky-view renderer's
 * right-handed unit direction. RA=0h, Dec=0° points down camera -Z; positive
 * RA rotates toward +X and positive declination points toward +Y. This is a
 * rendering-axis mapping, not a replacement for astro/coords.js frame transforms.
 */
export function raDecToSkyDirection(raDeg, decDeg) {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
    throw new TypeError('RA and Dec must be finite numbers in degrees');
  }
  if (decDeg < -90 || decDeg > 90) {
    throw new RangeError('Declination must be between -90 and +90 degrees');
  }
  const ra = ((raDeg % 360) + 360) % 360 * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.sin(ra), Math.sin(dec), -cosDec * Math.cos(ra)];
}