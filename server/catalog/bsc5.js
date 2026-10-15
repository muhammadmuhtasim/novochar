// Parser + normalizer for the Yale Bright Star Catalogue, 5th Revised Edition
// (preliminary), as distributed by CDS/VizieR as V/50 (fixed 197-column records).
//
// This module is pure — no filesystem, no network — so the exact same code runs
// in the build-time precompute (scripts/precompute-data.mjs) and in the API
// route (server/index.js). Source, retrieval and licensing are recorded in
// data/catalog/bsc5/PROVENANCE.json.
//
// Column layout is taken verbatim from V/50/ReadMe (byte ranges are 1-based,
// inclusive). Notable conventions:
//   * RA/Dec are FK5, equinox J2000, epoch J2000.0.
//   * pmRA is the *projected* motion cos(dec)·dRA/dt (arcsec/yr) — it already
//     includes the cos(dec) factor — and pmDE is dDec/dt (arcsec/yr).
//   * Parallax is in arcsec (not mas); we normalize to mas and derive distance.
//   * Missing values are explicit: photometry we cannot supply stays null and is
//     never zero-filled.

export const J2000_JD = 2451545.0;

export const BSC5_SOURCE = Object.freeze({
  catalog: 'V/50',
  name: 'Bright Star Catalogue, 5th Revised Ed. (preliminary)',
  authors: 'Hoffleit D., Warren Jr. W.H. (1991)',
  bibcode: '1991bsc..book.....H',
  source: 'CDS/VizieR FTP',
  sourceUrl: 'https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz',
  attribution: 'Hoffleit & Warren (1991), Bright Star Catalogue 5th ed., CDS/VizieR V/50',
  // The redistribution terms are NOT confirmed. The V/50 page states no explicit
  // licence; the CDS general terms suggest CC-BY for public-information datasets,
  // but that has not been confirmed for V/50 specifically. Do not redistribute
  // until verified — hence this source is not the default and is not vendored.
  license: 'UNRESOLVED',
  licenseNote:
    'Redistribution terms unconfirmed. V/50 carries no explicit licence; CDS general ' +
    'terms suggest CC-BY with attribution, but this has not been confirmed for V/50. ' +
    'Treat as not cleared for redistribution until verified in writing.',
  frame: 'FK5',
  equinox: 'J2000',
  referenceEpochJD: J2000_JD,
});

const ARCSEC_PER_MAS = 1000;      // 1 arcsec = 1000 mas
const ARCSEC_TO_LIGHT_YEARS = 3.26156; // 1/parallax(arcsec) is parsecs → ly

function num(raw) {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// RA bytes 76-83, Dec bytes 84-90 (1-based, inclusive).
function parseRaDec(line) {
  const rah = num(line.slice(75, 77));
  const ram = num(line.slice(77, 79));
  const ras = num(line.slice(79, 83));
  const decSign = line.slice(83, 84);
  const ded = num(line.slice(84, 86));
  const dem = num(line.slice(86, 88));
  const des = num(line.slice(88, 90));

  const ra = rah !== null && ram !== null && ras !== null
    ? (rah + ram / 60 + ras / 3600) * 15
    : null;
  const dec = ded !== null && dem !== null && des !== null
    ? (decSign === '-' ? -1 : 1) * (ded + dem / 60 + des / 3600)
    : null;
  return { ra, dec };
}

function buildAliases({ hr, dm, hd, sao, fk5, varId, name, displayName }) {
  const aliases = [`HR ${hr}`];
  if (dm) aliases.push(dm);
  if (hd !== null) aliases.push(`HD ${hd}`);
  if (sao !== null) aliases.push(`SAO ${sao}`);
  if (fk5 !== null) aliases.push(`FK5 ${fk5}`);
  if (varId) aliases.push(varId);
  if (name && name !== displayName) aliases.push(name);
  return Array.from(new Set(aliases.filter(Boolean)));
}

/**
 * Normalize one fixed-width V/50 `catalog` record into the Novochar star
 * contract. Returns null when the record has no usable identity/position.
 */
export function normalizeBsc5Record(line) {
  const hr = num(line.slice(0, 4));
  const { ra, dec } = parseRaDec(line);
  if (hr === null || ra === null || dec === null) return null;

  const name = line.slice(4, 14).trim();
  const dm = line.slice(14, 25).trim();
  const hd = num(line.slice(25, 31));
  const sao = num(line.slice(31, 37));
  const fk5 = num(line.slice(37, 41));
  const varId = line.slice(51, 60).trim();
  const vmag = num(line.slice(102, 107));
  const bv = num(line.slice(109, 114));
  const spectralType = line.slice(127, 147).trim() || null;
  const pmRaArcsec = num(line.slice(148, 154));
  const pmDecArcsec = num(line.slice(154, 160));
  const parallaxArcsec = num(line.slice(161, 166));

  const displayName = name || varId || `HR ${hr}`;
  const hasDistance = parallaxArcsec !== null && parallaxArcsec > 0;

  return {
    id: `BSC-HR${String(hr).padStart(4, '0')}`,
    hr,
    name: displayName,
    aliases: buildAliases({ hr, dm, hd, sao, fk5, varId, name, displayName }),
    type: 'STAR',
    ra,
    dec,
    refEpochJD: J2000_JD,
    // Normalize arcsec/yr → mas/yr. Missing proper motion stays null (never 0).
    pmRaMasYr: pmRaArcsec === null ? null : pmRaArcsec * ARCSEC_PER_MAS,
    pmDecMasYr: pmDecArcsec === null ? null : pmDecArcsec * ARCSEC_PER_MAS,
    mag: vmag,
    bv,
    spectralType,
    // Parallax is arcsec in the source; normalize to mas and derive distance.
    parallaxMas: hasDistance ? parallaxArcsec * ARCSEC_PER_MAS : null,
    distanceLy: hasDistance ? (1 / parallaxArcsec) * ARCSEC_TO_LIGHT_YEARS : null,
  };
}

/**
 * Build the versioned star-catalog artifact from raw V/50 `catalog` text.
 * Deterministic: identical input → identical output (sorted by HR number).
 */
export function buildStarCatalog(text) {
  const stars = [];
  let dropped = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const star = normalizeBsc5Record(line);
    if (star) stars.push(star);
    // Records with blank positions belong to stars the catalogue marks as
    // removed (ReadMe note 1); they are counted, never fabricated.
    else dropped++;
  }
  stars.sort((a, b) => a.hr - b.hr);
  return {
    schema: 'novochar.stars/v1',
    source: BSC5_SOURCE,
    frame: BSC5_SOURCE.frame,
    equinox: BSC5_SOURCE.equinox,
    referenceEpochJD: BSC5_SOURCE.referenceEpochJD,
    count: stars.length,
    dropped,
    stars,
  };
}
