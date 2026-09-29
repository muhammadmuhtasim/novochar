// Novochar Processing & Matching layer.
//
// Reusable astronomy utilities for spatial indexing, coordinate conversion and
// source cross-matching. This maps to the "Processing & Matching Layer" and
// the "RA/Dec <-> Galactic <-> HEALPix" conversion step of the data-process
// network: sources from IRSA / MAST / HEASARC / VizieR / SIMBAD arrive in
// RA/Dec and are converted & cross-matched here before storage/visualisation.

export * from './coords.js';
export * from './healpix.js';
export * from './crossmatch.js';

// Re-exported convenience helpers the rest of the app can rely on.
import { raDecToGalactic, galacticToRaDec, angularSeparationArcsec } from './coords.js';
import { raDecToPixel, pix2angRaDec } from './healpix.js';

/**
 * One-stop converter used to normalise coordinates from heterogeneous
 * archives into a common frame and to a HEALPix cell.
 *
 * @param {number} ra  Right Ascension in degrees (ICRS/J2000)
 * @param {number} dec Declination in degrees
 * @param {number} [nside] HEALPix resolution to also assign a pixel
 * @returns {object} { ra, dec, galactic:{l,b}, healpix?:{pixel, ra, dec} }
 */
export function convertCoordinates(ra, dec, nside = 0) {
  const galactic = raDecToGalactic(ra, dec);
  const result = {
    ra,
    dec,
    galactic,
  };
  if (nside > 0) {
    const pixel = raDecToPixel(nside, ra, dec);
    result.healpix = {
      pixel,
      center: pix2angRaDec(nside, pixel),
    };
  }
  return result;
}

export { raDecToGalactic, galacticToRaDec, angularSeparationArcsec };
export { raDecToPixel, pix2angRaDec };

/**
 * Distance in arcsec between two (ra, dec) pairs - thin wrapper kept for
 * symmetry with crossmatch.
 */
export const separationArcsec = (
  ra1,
  dec1,
  ra2,
  dec2
) => angularSeparationArcsec(ra1, dec1, ra2, dec2);