import React from 'react';
import { fmtRA, fmtDec } from '../lib/api.js';

export default function TargetInfo({ o }) {
  const rows = [
    ['Classification', o.typeLabel],
    ['RA', fmtRA(o.ra)],
    ['DEC', fmtDec(o.dec)],
    ['Apparent mag', `${o.mag} mag`],
    ['Motion', `${o.motion} ${o.motionUnits}`],
    ['Discovered', o.discovered],
    ['Status', o.status],
    ['Semi-major axis', `${o.orbit.a} au`],
    ['Eccentricity', String(o.orbit.e)],
    ['Inclination', `${o.orbit.i}°`],
  ];
  return (
    <div className="target-info">
      <div className="target-title">
        <span className="obj-type">{o.type}</span>
        <h3>{o.name}</h3>
      </div>
      <dl className="kv stacked">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="muted note">{o.note}</p>
      <div className="flags">
        {o.flags.map((f) => (
          <span className="tag" key={f}>{f}</span>
        ))}
      </div>
    </div>
  );
}