import React, { useEffect, useState } from 'react';
import { api, fmtRA, fmtDec } from '../lib/api.js';

const OBJECT_TYPES = [
  { key: 'TNO', countKey: 'tno', label: 'Trans-Neptunian Objects', blurb: 'Kuiper Belt & scattered disk members of the distant Solar System.' },
  { key: 'AST', countKey: 'asteroid', label: 'Asteroids', blurb: 'Main-belt and near-Earth candidates with measurable parallax.' },
  { key: 'HPM', countKey: 'hpm', label: 'High Proper-Motion Stars', blurb: 'Local stellar movers crossing the field at high angular rate.' },
];

export default function Home({ stats, health, onNavigate }) {
  const [field, setField] = useState(null);
  useEffect(() => {
    api
      .survey()
      .then((d) => setField(d.survey.field))
      .catch(() => {});
  }, []);

  const completed = stats ? stats.completedPasses : 0;
  const total = stats ? stats.passes : 1;
  const pct = Math.round((completed / total) * 100);

  return (
    <div className="home grid">
      <section className="panel hero">
        <div className="hero-eyebrow">SPHEREx SURVEY OPERATIONS · SEASON 1</div>
        <h1 className="hero-title">
          <span className="accent">NOVOCHAR</span> · নভোচার
        </h1>
        <p className="hero-sub">
          An interactive sky viewer and time-series <em>blink comparator</em> to track
          candidate trans-Neptunian objects, asteroids and high proper-motion stars
          across SPHEREx&rsquo;s 6-month survey passes.
        </p>
        <div className="hero-actions">
          <button className="btn primary" onClick={() => onNavigate('sky')}>
            OPEN SKY VIEWER
          </button>
          <button className="btn" onClick={() => onNavigate('blink')}>
            LAUNCH BLINK COMPARATOR
          </button>
        </div>
      </section>

      <section className="panel hud">
        <div className="panel-head">
          <h2>MISSION TELEMETRY</h2>
          <span className="tag live">LIVE</span>
        </div>
        <dl className="kv">
          <div>
            <dt>Object watchlist</dt>
            <dd>{stats ? stats.totals.objects : '—'}</dd>
          </div>
          <div>
            <dt>Fast movers</dt>
            <dd>{stats ? stats.fastMovers : '—'}</dd>
          </div>
          <div>
            <dt>Survey passes</dt>
            <dd>{stats ? stats.passes : '—'}</dd>
          </div>
          <div>
            <dt>UTC / JD</dt>
            <dd>{health ? health.utc.jd.toFixed(3) : '—'}</dd>
          </div>
        </dl>
        <div className="progress-row">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-label">
            {pct}% · {completed}/{total} passes captured
          </span>
        </div>
      </section>

      {field && (
        <section className="panel">
          <div className="panel-head">
            <h2>SURVEY FIELD</h2>
            <span className="tag">PATCH</span>
          </div>
          <p className="muted">
            Nominal overlapping passes centered on the southern ecliptic approach.
            Coordinates shown at pass center of mass.
          </p>
          <div className="coord-chips">
            <div className="chip">
              <span className="chip-label">RA center</span>
              <strong>{fmtRA(field.raCenter)}</strong>
            </div>
            <div className="chip">
              <span className="chip-label">DEC center</span>
              <strong>{fmtDec(field.decCenter)}</strong>
            </div>
            <div className="chip">
              <span className="chip-label">Coverage</span>
              <strong>
                {field.raHalf * 2}° × {field.decHalf * 2}°
              </strong>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>TRACKED OBJECT CLASSES</h2>
          <span className="tag">{stats ? stats.totals.objects : '…'} TOTAL</span>
        </div>
        <div className="object-cards">
          {OBJECT_TYPES.map((t) => (
            <div className={`obj-card ${t.key.toLowerCase()}`} key={t.key}>
              <div className="obj-card-top">
                <span className="obj-type">{t.key}</span>
                <strong>{stats ? stats.totals[t.countKey] : '—'}</strong>
              </div>
              <p className="muted">{t.blurb}</p>
            </div>
          ))}
        </div>
      </section>
<section className="panel wide">
        <div className="panel-head">
          <h2>ABOUT THE MISSION</h2>
          <span className="tag">NASA</span>
        </div>
        <p className="muted">
          The <strong>SPHEREx</strong> mission is a NASA infrared all-sky surveyor mapping
          hundreds of millions of galaxies and stars in near-infrared light across
          six spectral bands. Its repeated scan passes create an ideal time baseline
          for blink-comparison: the same tract of sky is revisited over months,
          letting small apparent motions — distant trans-Neptunian candidates, near-Earth
          asteroids and high proper-motion stars — be teased apart from static background
          sources. <em>Novochar</em> (&ldquo;spacefarer&rdquo; in Bengali) turns those passes into an
          interactive detection console. This build ships with simulated placeholder
          telemetry; wire it to real SPHEREx/GBOT streams by editing the data layer.
        </p>
      </section>

      <section className="panel wide cold-start">
        <div className="panel-head">
          <h2>QUICK INTEGRATION</h2>
          <span className="tag">CUSTOMIZE</span>
        </div>
        <p className="muted">
          Real NASA data hooks are already stubbed in. Set a free NASA API key as
          <code>NASA_API_KEY</code> on the server to unlock the live NEO endpoint, and point the
          data generators in <code>server/data.js</code> at your target telemetry feed.
        </p>
        <div className="code-block">
          NASA_API_KEY=your_key_here npm run dev
        </div>
      </section>
    </div>
  );
}