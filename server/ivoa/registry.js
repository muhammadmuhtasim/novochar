// Data-driven registry of astronomical archives exposed to Novochar's Layer-1
// ingestion layer. Each entry records the archive's real, protocol-accurate
// endpoints plus a `status` that reflects what has actually been verified against
// the live service (see probe.js / GET /api/ivoa/probe).
//
// status meanings
//   verified   - a live request returned real rows (QUERY_STATUS OK) on the
//                standard protocol during validation.
//   configured - correct, documented endpoint/format; not reachable/parseable
//                from the validating network (throttled host, BINARY VOTable,
//                REST-only, or data-file download). Never faked.
//   registry   - no stable standalone endpoint; reachable only via IVOA
//                Registry discovery by IVOID.

export const ARCHIVES = {
  vizier: {
    name: 'VizieR',
    org: 'CDS',
    category: 'Cross-Match & Reference',
    domain: 'Published catalog tables (Gaia, 2MASS, SDSS, …) via TAP',
    protocols: {
      tap: { endpoint: 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap', style: 'ivoad' },
    },
    probeQuery: 'SELECT TOP 2 * FROM "I/345/gaia2"',
    status: 'verified',
  },
  simbad: {
    name: 'SIMBAD',
    org: 'CDS',
    category: 'Cross-Match & Reference',
    domain: 'Object identifiers, stellar types, name resolution',
    protocols: {
      tap: { endpoint: 'https://simbad.u-strasbg.fr/simbad/sim-tap', style: 'ivoad' },
      resolve: { endpoint: 'https://simbad.u-strasbg.fr/simbad/sim-tap', method: 'simbad-tap' },
    },
    probeQuery: 'SELECT TOP 2 main_id, ra, dec FROM basic',
    status: 'verified',
    note: 'Name resolution verified live via CDS Sesame; SIMBAD TAP itself serves BINARY/base64 VOTable rows.',
  },
  gaia: {
    name: 'Gaia (ESA/ESDC)',
    org: 'ESA',
    category: 'Space Agency Portals',
    domain: 'Gaia astrometry & photometry (Gaia EDR3; also via VizieR I/345)',
    protocols: {
      tap: { endpoint: 'https://gea.esac.esa.int/tap-server/tap', style: 'ivoad' },
    },
    probeQuery: 'SELECT TOP 2 source_id, ra, dec FROM gaiaedr3.gaia_source',
    status: 'configured',
    note: 'Gaia TAP serves BINARY2 (big-endian) VOTable rows; Gaia DR2 catalog rows are also verified live via VizieR TAP in TABLEDATA.',
  },
  noirlab: {
    name: 'NOIRLab Astro Data Lab',
    org: 'NOIRLab',
    category: 'Optical, UV & Exoplanets',
    domain: 'DES / DECaLS / LSST-era imaging (SIA imagery)',
    protocols: {
      sia: { endpoint: 'https://datalab.noirlab.edu/sia/coadd_all', style: 'siap1' },
      tap: { endpoint: 'https://datalab.noirlab.edu/tap', style: 'ivoad' },
    },
    probeQuery: 'SELECT TOP 2 * FROM TAP_SCHEMA.tables',
    status: 'verified',
  },
  eso: {
    name: 'ESO Science Archive',
    org: 'ESO',
    category: 'Space Agency Portals',
    domain: 'VLT / VISTA / ALMA raw data + SSA spectra',
    protocols: {
      tap: { endpoint: 'https://archive.eso.org/tap_obs', style: 'ivoad' },
      ssa: { endpoint: 'https://archive.eso.org/ssa', style: 'ivoad' },
    },
    probeQuery: 'SELECT TOP 2 * FROM dbo.raw',
    status: 'verified',
    note: 'Live-verified via TAP against dbo.raw (observations).',
  },
  irsa: {
    name: 'IRSA (NASA/IPAC)',
    org: 'NASA/IPAC',
    category: 'Infrared & Submillimeter',
    domain: 'SPHEREx / WISE / Spitzer / 2MASS / Herschel',
    protocols: {
      tap: { endpoint: 'https://irsa.ipac.caltech.edu/TAP', style: 'irsa' },
      sia: { endpoint: 'https://irsa.ipac.caltech.edu/SIA', style: 'siap1', param: 'COLLECTION' },
    },
    probeQuery: 'SELECT * FROM fp_psc WHERE CONTAINS(POINT(ra,dec),CIRCLE(66.76957,26.10453,0.01))=1',
    status: 'configured',
    note: 'Documented IRSA TAP/SIA format; host throttled/unreachable from the validating network.',
  },
  mast: {
    name: 'MAST (STScI)',
    org: 'STScI / NASA',
    category: 'Optical, UV & Exoplanets',
    domain: 'Hubble / JWST / Kepler / TESS',
    protocols: {
      rest: { endpoint: 'https://mast.stsci.edu/api/v0/', style: 'rest' },
      sia: { endpoint: 'https://archive.stsci.edu/ssap/search2.php', style: 'siap1' },
    },
    status: 'configured',
    note: 'Classic TAP retired by STScI; MAST REST + SIA endpoints registered.',
  },
  heasarc: {
    name: 'HEASARC (NASA)',
    org: 'NASA/GSFC',
    category: 'High Energy & CMB',
    domain: 'Chandra / Fermi / Swift / NuSTAR / XMM',
    protocols: {
      tap: { endpoint: 'https://heasarc.gsfc.nasa.gov/xamin/vo/tap', style: 'ivoad' },
    },
    status: 'configured',
    note: 'Serves BINARY/base64 VOTable; tables discoverable via TAP_SCHEMA.',
  },
  lambda: {
    name: 'LAMBDA (NASA)',
    org: 'NASA/GSFC',
    category: 'High Energy & CMB',
    domain: 'WMAP / Planck / ACT CMB maps (HEALPix FITS)',
    protocols: {
      file: { endpoint: 'https://lambda.gsfc.nasa.gov/data/', style: 'download' },
    },
    status: 'configured',
    note: 'Static HEALPix FITS downloads; no ADQL interface.',
  },
  darts: {
    name: 'DARTS (JAXA)',
    org: 'JAXA',
    category: 'Space Agency Portals',
    domain: 'Akari / Hayabusa (JAXA missions)',
    protocols: {
      rest: { endpoint: 'https://darts.isas.jaxa.jp/', style: 'rest' },
    },
    status: 'configured',
    note: 'SIAP / REST interface; no stable public TAP.',
  },
  ned: {
    name: 'NED (NASA/IPAC)',
    org: 'NASA/IPAC',
    category: 'Cross-Match & Reference',
    domain: 'Extragalactic redshifts, multi-wavelength fluxes',
    protocols: {
      rest: { endpoint: 'https://ned.ipac.caltech.edu/sieve/', style: 'rest' },
    },
    status: 'configured',
    note: 'NED-D REST; legacy name-resolver retired.',
  },
  esdc: {
    name: 'ESA Science Archive / ESDC',
    org: 'ESA',
    category: 'Space Agency Portals',
    domain: 'Euclid / XMM-Newton / Rosetta (registry-discovery)',
    protocols: {
      registry: { style: 'registry' },
    },
    status: 'registry',
    note: 'ESA/ESDC services are discoverable in the IVOA Registry by IVOID.',
  },
};

/** Convenience: list of archive keys. */
export const ARCHIVE_KEYS = Object.keys(ARCHIVES);

/** Human-readable protocol label map. */
export const PROTOCOL_LABEL = {
  tap: 'Table Access Protocol (ADQL)',
  sia: 'Simple Image Access',
  ssa: 'Simple Spectral Access',
  resolve: 'Object name resolution',
  rest: 'REST API',
  file: 'Data-file download',
  registry: 'IVOA Registry (VOResource)',
};
