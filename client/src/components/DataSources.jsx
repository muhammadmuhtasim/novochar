import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const SURVEY_FEEDS = [
  {
    code: 'SPHEREx', tag: 'NASA', status: 'PRIMARY',
    name: 'Spectro-Photometer for the History of the Universe',
    domain: 'Primary simulated survey telemetry (this build) — 6-band NIR scan passes.',
    rows: 'Simulated `generateSurvey()`: 24 scan passes + 40 tracked candidates (deterministic placeholder for real SPHEREx telemetry).',
    cols: [
      'passes: id, code, name, index, epochISO, epochJD, band, bandIndex, ra, dec, fov, expTime, status, completion',
      'objects: id, name, type, typeLabel, bandIndex, band, ra, dec, mag, motion, motionUnits, discovered, flags, orbit{a,e,i}, note, status',
    ],
  },
  {
    code: 'NEOWISE', tag: 'NASA', status: 'LINKED',
    name: 'Near-Earth Object Wide-field Infrared Survey Explorer',
    domain: 'Thermal-infrared positions of NEOs and cometary activity (placeholder cross-correlation feed).',
    rows: 'Cross-match candidates against WISE/NEOWISE positions by RA/Dec.',
    cols: ['source_id, ra, dec, WISE 3.4/4.6/12/22 µm magnitudes (w1–w4), motion'],
  },
  {
    code: 'Pan-STARRS', tag: 'Hawaii', status: 'LINKED',
    name: 'Panoramic Survey Telescope & Rapid Response System',
    domain: 'Optical astrometry of candidate TNOs to refine orbits after SPHEREx detection.',
    rows: 'Precise optical positions/magnitudes used for orbital refinement.',
    cols: ['objID, ra, dec, g/r/i/z/y photometry, epoch'],
  },
  {
    code: 'GBOT', tag: 'ESO', status: 'STANDBY',
    name: 'GTC-Breakthrough observing programme',
    domain: 'Targeted follow-up imaging to confirm and characterise exotic candidates.',
    rows: 'Follow-up image frames for candidate confirmation.',
    cols: ['target_id, ra, dec, epoch, filter, exposure, S/N'],
  },
  {
    code: 'JPL SBDB', tag: 'NASA', status: 'API',
    name: 'Small-Body Database',
    domain: 'Orbital elements, close-approach and ephemeris service for confirmed asteroids.',
    rows: 'Orbit solution + close-approach records per small body.',
    cols: ['spkid, designation, e/a/i/node/peri/epoch, H, G, close_approach: date, distance (lunar/AU), velocity'],
  },
];
const IMAGE_ARCHIVES = [
  {
    code: 'DSS', tag: 'STScI / MAST / IRSA', status: 'LIVE',
    name: 'Digitized Sky Survey (real sky pixels)',
    domain: 'Genuine survey plates served by IRSA/STScI/MAST; fetched as FITS and rendered to a browser-safe grayscale PNG.',
    rows: 'One image cutout per view (≤ 2° / 120 arcmin side), already WCS-registered to the viewer projection.',
    cols: ['Returns: image PNG + WCS corners (raLeft, raRight, decTop, decBottom), survey, band, size, aspect'],
  },
];

const REFERENCE_SERVICES = [
  {
    code: 'Sesame', tag: 'CDS', status: 'VERIFIED',
    name: 'CDS Sesame name resolver',
    domain: 'Resolves an object name ("M1", "NGC 1952") to equatorial coordinates.',
    rows: 'One resolved position per name.',
    cols: ['name, service, found, ra, dec, aliases'],
  },
  {
    code: 'GAVO RegTAP', tag: 'GAVO', status: 'VERIFIED',
    name: 'IVOA Registry (dc.g-vo.org)',
    domain: 'Service discovery used to find TAP/SSA endpoints by IVOID (DARTS, ESDC).',
    rows: 'Capability/interface records describing discoverable services.',
    cols: ['ivoid, short_name, res_title, reference_url, standard_id, access_url, intf_type'],
  },
];
const IVOA_ARCHIVES = [
  {
    key: 'vizier', tag: 'CDS', status: 'verified',
    name: 'VizieR', category: 'Cross-Match & Reference',
    domain: 'Published catalogue tables (Gaia, 2MASS, SDSS, …) via TAP.',
    rows: 'Typed rows from whichever catalogue table is queried (up to 5000 rows returned per call).',
    cols: ['e.g. Gaia DR2 "I/345/gaia2": source_id, ra, dec, pmra, pmdec, G/BP/RP magnitudes'],
  },
  {
    key: 'simbad', tag: 'CDS', status: 'verified',
    name: 'SIMBAD', category: 'Cross-Match & Reference',
    domain: 'Object identifiers, stellar types, name resolution (TAP + resolve).',
    rows: 'Identifier/coordinate rows; name lookup returns a resolved position.',
    cols: ['basic: main_id, ra, dec', 'ident: identifiers', 'resolve: ra, dec, aliases'],
  },
  {
    key: 'gaia', tag: 'ESA', status: 'configured',
    name: 'Gaia (ESA / ESDC) — DR3 astrometry', category: 'Space Agency Portals',
    domain: 'Gaia astrometry & photometry (also via VizieR I/345).',
    rows: '≤ 500 sources in a cone; proper motion projected to a chosen epoch.',
    cols: ['source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag, ref_epoch', 'computed: raAtEpoch, decAtEpoch, displacementMas'],
  },
  {
    key: 'noirlab', tag: 'NOIRLab', status: 'verified',
    name: 'NOIRLab Astro Data Lab', category: 'Optical, UV & Exoplanets',
    domain: 'DES / DECaLS / LSST-era imaging (SIA imagery) + TAP tables.',
    rows: 'Image footprint records overlapping a sky position.',
    cols: ['TAP_SCHEMA.tables (schema introspection)', 'SIA rows: access_url (FITS cutout), position, format, naxes, size'],
  },
  {
    key: 'eso', tag: 'ESO', status: 'verified',
    name: 'ESO Science Archive', category: 'Space Agency Portals',
    domain: 'VLT / VISTA / ALMA raw data + SSA spectra.',
    rows: 'Observation records (dbo.raw) and spectrum footprints.',
    cols: ['dbo.raw: dp_id, target_name, ra, dec, exptime, filter, obs_date, instrument', 'SSA: access_url, spectral coverage'],
  },
  {
    key: 'irsa', tag: 'NASA/IPAC', status: 'configured',
    name: 'IRSA (NASA/IPAC)', category: 'Infrared & Submillimeter',
    domain: 'SPHEREx / WISE / Spitzer / 2MASS / Herschel.',
    rows: 'Point-source catalogue rows in a cone (fp_psc).',
    cols: ['source_id, ra, dec, WISE w1–w4 magnitudes, photometric quality flags'],
  },
  {
    key: 'mast', tag: 'STScI', status: 'configured',
    name: 'MAST (STScI)', category: 'Optical, UV & Exoplanets',
    domain: 'Hubble / JWST / Kepler / TESS (REST + SIA).',
    rows: 'CAOM observation metadata per cone / name / products call (page size up to 5000).',
    cols: ['cone: obsid, target_name, ra, dec, instrument, filters, dataproduct_type, t_min/t_max', 'products: dataURI / download URL'],
  },
  {
    key: 'heasarc', tag: 'NASA/GSFC', status: 'configured',
    name: 'HEASARC (NASA)', category: 'High Energy & CMB',
    domain: 'Chandra / Fermi / Swift / NuSTAR / XMM.',
    rows: 'High-energy catalogue rows (tables discovered via TAP_SCHEMA).',
    cols: ['mission-dependent: source name, ra, dec, flux, exposure, photon index'],
  },
  {
    key: 'lambda', tag: 'NASA/GSFC', status: 'configured',
    name: 'LAMBDA (NASA)', category: 'High Energy & CMB',
    domain: 'WMAP / Planck / ACT CMB maps (HEALPix FITS).',
    rows: 'No tabular rows — exposes data-file downloads (index listing + buildable file URLs).',
    cols: ['index listing (HTML)', 'file → HEALPix FITS map URL'],
  },
  {
    key: 'darts', tag: 'JAXA', status: 'configured',
    name: 'DARTS (JAXA)', category: 'Space Agency Portals',
    domain: 'Akari / Hayabusa (JAXA missions) — REST/file + registry discovery.',
    rows: 'Index listing + discovered service records; TAP via Registry-resolved endpoint.',
    cols: ['file → data URL', 'registry: ivoid, short_name, access_url, standard_id'],
  },
  {
    key: 'ned', tag: 'NASA/IPAC', status: 'configured',
    name: 'NED (NASA/IPAC)', category: 'Cross-Match & Reference',
    domain: 'Extragalactic redshifts, multi-wavelength fluxes (NED-D SRS).',
    rows: 'One object-lookup result per name (object "Preferred" record).',
    cols: ['name, ra, dec, redshift, velocity, type/class, bib-refs'],
  },
  {
    key: 'esdc', tag: 'ESA', status: 'registry',
    name: 'ESA Science Archives / ESDC', category: 'Space Agency Portals',
    domain: 'Euclid / XMM-Newton / Rosetta — Registry discovery + TAP.',
    rows: 'Discovered endpoints → TAP rows (query against resolved ESDC TAP).',
    cols: ['eng/tel-dependent source/event tables', 'registry: ivoid, access_url, standard_id'],
  },
];

// Robustly pulls a close-approach distance from either the fallback sample or
// the real NASA NEO API response shape.
function closeApproachDist(o) {
  const ca = o.close_approach;
  if (Array.isArray(ca)) {
    const first = ca[0];
    return first ? `${first.distance_lunar ?? '—'} LD` : '—';
  }
  if (ca && typeof ca === 'object') return ca.distance_lunar ? `${ca.distance_lunar} LD` : '—';
  return '—';
}
function Card({ s }) {
  return (
    <div className="source-card">
      <div className="source-top">
        <span className="obj-type">{s.code || s.key}</span>
        <span className="pill">{s.status}</span>
      </div>
      <h3>{s.name}{s.category ? <span className="src-cat"> · {s.category}</span> : null}</h3>
      <p className="muted">{s.domain}</p>
      <p className="src-row"><span className="src-label">ROWS</span> {s.rows}</p>
      {s.cols && s.cols.map((c) => (
        <p className="src-col" key={c}><span className="src-label">COL</span>{c}</p>
      ))}
    </div>
  );
}

export default function DataSources() {
  const [neo, setNeo] = useState(null);
  useEffect(() => {
    api.neo().then(setNeo).catch(() => {});
  }, []);

  const keyedIVOA = IVOA_ARCHIVES.map((a) => ({ ...a, code: a.key }));

  return (
    <div className="sources-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>SURVEY & SCIENCE FEEDS</h2>
          <span className="tag">MISSION DATA</span>
        </div>
        <div className="source-cards">
          {SURVEY_FEEDS.map((s) => <Card key={s.code} s={s} />)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>REAL SKY IMAGERY & REFERENCE</h2>
          <span className="tag">PIXELS + RESOLVERS</span>
        </div>
        <div className="source-cards">
          {IMAGE_ARCHIVES.map((s) => <Card key={s.code} s={s} />)}
          {REFERENCE_SERVICES.map((s) => <Card key={s.code} s={s} />)}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-head">
          <h2>IVOA ARCHIVE REGISTRY</h2>
          <span className="tag">LAYER 1 · INGESTION</span>
        </div>
        <p className="muted">
          Live clients speaking the standard IVOA protocols (TAP · SIA · SSA · Registry ·
          Sesame). Status reflects real probes: <strong>verified</strong> returned live rows,
          <strong> configured</strong> is a correct documented endpoint (host throttled, or serves
          binary BINARY/base64 VOTable), <strong>registry</strong> is reachable via IVOA Registry
          discovery. The full registry is also served by <code>GET /api/ivoa</code> and probed live
          by <code>/api/ivoa/probe</code>.
        </p>
        <div className="source-cards">
          {keyedIVOA.map((s) => <Card key={s.key} s={s} />)}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-head">
          <h2>LIVE NASA NEO FEED</h2>
          <span className="tag">{neo ? neo.source.toUpperCase() : 'LOADING'}</span>
        </div>
        <p className="muted">
          Close-approach watch — pulls from the NASA NEO API when you set{' '}
          <code>NASA_API_KEY</code>. Returns rows with{' '}
          <code>neo_reference_id, name, absolute_magnitude_h, estimated_diameter_max,
          is_potentially_hazardous_asteroid, close_approach.distance_lunar</code>. Without a key, a
          curated sample set is shown.
        </p>
        {neo && (
          <table className="neo-table">
            <thead>
              <tr>
                <th>Designation</th>
                <th>Ref ID</th>
                <th>Abs. mag H</th>
                <th>Diameter (km)</th>
                <th>Hazardous?</th>
                <th>Distance (LD)</th>
              </tr>
            </thead>
            <tbody>
              {neo.near_earth_objects.map((o) => (
                <tr key={o.neo_reference_id || o.name}>
                  <td className="mono">{o.name}</td>
                  <td className="mono">{o.neo_reference_id}</td>
                  <td>{o.absolute_magnitude_h}</td>
                  <td>{(o.estimated_diameter_max ?? '—')}</td>
                  <td>{o.is_potentially_hazardous_asteroid ? '⚠ YES' : 'no'}</td>
                  <td>{closeApproachDist(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}