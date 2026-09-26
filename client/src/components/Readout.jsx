import React from 'react';

export default function Readout({ frames, idx, meta }) {
  const f0 = frames[0];
  const fc = frames[idx];
  const dRA = (fc.ra - f0.ra) * 3600000; // deg -> mas
  const dDec = (fc.dec - f0.dec) * 3600000;
  const last = frames[frames.length - 1];
  const total = frames.length > 1 ? Math.hypot((last.ra - f0.ra) * 3600000, (last.dec - f0.dec) * 3600000) : 0;
  return (
    <div className="target-info">
      <div className="target-title">
        <span className="obj-type">{meta.id}</span>
        <h3>{meta.name}</h3>
      </div>
      <dl className="kv stacked">
        <div><dt>ΔRA vs first pass</dt><dd className="mono">{dRA.toFixed(0)} mas</dd></div>
        <div><dt>ΔDEC vs first pass</dt><dd className="mono">{dDec.toFixed(0)} mas</dd></div>
        <div><dt>Total drift</dt><dd className="mono">{total.toFixed(0)} mas</dd></div>
        <div><dt>Model motion</dt><dd>{meta.motion} mas/day</dd></div>
        <div><dt>Current SNR</dt><dd>{frames[idx].snr}</dd></div>
        <div><dt>Flux (binned)</dt><dd>{frames[idx].flux} MJy/sr</dd></div>
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