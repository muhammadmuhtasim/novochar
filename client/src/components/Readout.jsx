import React from 'react';
import { eastWestMas, northSouthMas, classifyMotion } from '../lib/astrometry.js';

// Compact angle formatter: mas -> arcsec -> degrees, whichever reads best.
function fmtMas(mas) {
  if (!Number.isFinite(mas)) return '—';
  const a = Math.abs(mas);
  if (a < 1000) return `${mas.toFixed(0)} mas`;
  if (a < 600_000) return `${(mas / 1000).toFixed(2)}″`;
  return `${(mas / 3.6e6).toFixed(3)}°`;
}

// RA/Dec differences are NOT on-sky angular distances (an east-west offset
// shrinks with cos(dec), and RA wraps across 0/360). eastWestMas/northSouthMas
// project onto the local tangent plane before degrees -> milli-arcsec.
export default function Readout({ frames, idx, meta, stats }) {
  const f0 = frames[0];
  const fc = frames[idx];
  const dRA = eastWestMas(fc.ra, fc.dec, f0.ra, f0.dec);
  const dDec = northSouthMas(fc.dec, f0.dec);
  const total = stats ? stats.totalMas : 0;
  const days = stats ? stats.spanDays : 0;
  const cls = classifyMotion(meta.motion);
  const flagged = frames.filter((f) => f.flagged).length;
  return (
    <div className="target-info">
      <div className="target-title">
        <span className="obj-type">{meta.id}</span>
        <h3>{meta.name}</h3>
      </div>

      <div className={`verdict ${cls.key}`}>
        <span className="verdict-badge">{cls.label}</span>
        <p className="verdict-blurb">{cls.blurb}</p>
      </div>

      <dl className="kv stacked">
        <div><dt>ΔRA (E–W) · this pass</dt><dd className="mono">{fmtMas(dRA)}</dd></div>
        <div><dt>ΔDEC (N–S) · this pass</dt><dd className="mono">{fmtMas(dDec)}</dd></div>
        <div><dt>Total drift · first→last</dt><dd className="mono">{fmtMas(total)}</dd></div>
        <div><dt>Over</dt><dd className="mono">{days.toFixed(0)} days</dd></div>
        <div><dt>Model motion</dt><dd className="mono">{meta.motion} mas/day</dd></div>
        <div><dt>Current SNR</dt><dd>{frames[idx].snr}</dd></div>
        <div><dt>Flux (binned)</dt><dd>{frames[idx].flux} MJy/sr (sim.)</dd></div>
        <div><dt>Quality</dt><dd>{frames[idx].quality}</dd></div>
      </dl>
      <div className="flags">
        {flagged > 0 && <span className="tag warn">{flagged} flagged frame(s)</span>}
      </div>
      <p className="muted note">
        True on-sky centroid motion across survey passes. Faster movers are nearer:
        a target that drifts many arcseconds is either close by or a high-proper-motion star.
      </p>
    </div>
  );
}
