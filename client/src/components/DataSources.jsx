import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const SOURCES = [
  { code: 'SPHEREx', tag: 'NASA', name: 'Spectro-Photometer for the History of the Universe', role: 'Primary survey passes, 6-band NIR scan sequences, time-baseline for blink comparison.', status: 'PRIMARY' },
  { code: 'NEOWISE', tag: 'NASA', name: 'Near-Earth Object Wide-field Infrared Survey Explorer', role: 'Thermal-infrared positions of NEOs and cometary activity. Placeholder cross-correlation feed.', status: 'LINKED' },
  { code: 'Pan-STARRS', tag: 'Hawaii', name: 'Panoramic Survey Telescope & Rapid Response System', role: 'Optical astrometry of candidate TNOs to refine orbits after SPHEREx detection.', status: 'LINKED' },
  { code: 'GBOT', tag: 'ESO', name: 'GTC-Breakthrough observing programme', role: 'Targeted follow-up imaging to confirm and characterise exotic candidates.', status: 'STANDBY' },
  { code: 'JPL SBDB', tag: 'NASA', name: 'Small-Body Database', role: 'Orbital elements, close-approach and ephemeris service for confirmed asteroids.', status: 'API' },
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

export default function DataSources() {
  const [neo, setNeo] = useState(null);
  useEffect(() => {
    api.neo().then(setNeo).catch(() => {});
  }, []);

  return (
    <div className="sources-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>DATA SOURCES & PIPELINE</h2>
          <span className="tag">NASA ECO-SYSTEM</span>
        </div>
        <div className="source-cards">
          {SOURCES.map((s) => (
            <div className="source-card" key={s.code}>
              <div className="source-top">
                <span className="obj-type">{s.code}</span>
                <span className="pill">{s.status}</span>
              </div>
              <h3>{s.name}</h3>
              <p className="muted">{s.role}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-head">
          <h2>LIVE NASA NEO FEED</h2>
          <span className="tag">{neo ? neo.source.toUpperCase() : 'LOADING'}</span>
        </div>
        <p className="muted">
          Close-approach watch — pulls from the NASA NEO API when you set{' '}
          <code>NASA_API_KEY</code>. Without a key, a curated sample set is shown.
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