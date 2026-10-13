import React from 'react';

// Raw RA/Dec differences are NOT on-sky angular distances (an east-west offset
// shrinks with cos(dec), and RA wraps across 0/360). These readouts project onto
// the local tangent plane before converting degrees -> milli-arcsec.
function dRADegWrapped(raTo, raFrom) {
  return ((((raTo - raFrom) % 360) + 540) % 360) - 180;
}

function eastWestMas(raTo, decTo, raFrom, decFrom) {
  const decMid = (((decTo + decFrom) / 2) * Math.PI) / 180;
  return dRADegWrapped(raTo, raFrom) * Math.cos(decMid) * 3.6e6;
}

function northSouthMas(decTo, decFrom) {
  return (decTo - decFrom) * 3.6e6;
}

export default function Readout({ frames, idx, meta }) {
  const f0 = frames[0];
  const fc = frames[idx];
  const dRA = eastWestMas(fc.ra, fc.dec, f0.ra, f0.dec);
  const dDec = northSouthMas(fc.dec, f0.dec);
  const last = frames[frames.length - 1];
  const total =
    frames.length > 1
      ? Math.hypot(eastWestMas(last.ra, last.dec, f0.ra, f0.dec), northSouthMas(last.dec, f0.dec))
      : 0;
  return (
    <div className="target-info">
      <div className="target-title">
        <span className="obj-type">{meta.id}</span>
        <h3>{meta.name}</h3>
      </div>
      <dl className="kv stacked">
        <div><dt>ΔRA (E–W arc) vs first pass</dt><dd className="mono">{dRA.toFixed(0)} mas</dd></div>
        <div><dt>ΔDEC (N–S) vs first pass</dt><dd className="mono">{dDec.toFixed(0)} mas</dd></div>
        <div><dt>Total drift</dt><dd className="mono">{total.toFixed(0)} mas</dd></div>
        <div><dt>Model motion</dt><dd>{meta.motion} mas/day</dd></div>
        <div><dt>Current SNR</dt><dd>{frames[idx].snr}</dd></div>
        <div><dt>Flux (binned)</dt><dd>{frames[idx].flux} MJy/sr (sim.)</dd></div>
        <div><dt>Quality</dt><dd>{frames[idx].quality}</dd></div>
      </dl>
      <div className="flags">
        {frames.filter((f) => f.flagged).length > 0 && (
          <span className="tag warn">
            {frames.filter((f) => f.flagged).length} flagged frame(s)
          </span>
        )}
      </div>
      <p className="muted note">
        Differential centroid motion across survey passes. Objects with sustained
        drift outpace the reference grid and register as movers.
      </p>
    </div>
  );
}