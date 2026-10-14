// Plain-language interpretation helpers for the SPECTRA workbench.
//
// These turn the numeric residual spectrum into an answer a non-specialist can
// read: "what colour is it?", "which lines did we actually detect?", "how big
// is the shift?". They reuse the analysis primitives in spectral-analysis.js so
// the numbers shown here always agree with the plot and the exports.

import { residualSpectrum, nearestLine } from './spectral-analysis.js';

/** Human colour reading of a spectral index α (F_λ ∝ λ^α). */
export function colourReading(alpha) {
  if (!Number.isFinite(alpha)) return { key: 'unknown', label: 'Not enough continuum', cls: '' };
  if (alpha <= -1.2) return { key: 'red', label: 'Strongly red / dusty', cls: 'red' };
  if (alpha <= -0.4) return { key: 'red', label: 'Reddish (cool)', cls: 'red' };
  if (alpha < 0.4) return { key: 'flat', label: 'Grey / flat continuum', cls: '' };
  if (alpha < 1.2) return { key: 'blue', label: 'Bluish (warm)', cls: 'blue' };
  return { key: 'blue', label: 'Strongly blue / energetic', cls: 'blue' };
}

/** Plain description of a redshift, avoiding any lookback/distance claims. */
export function redshiftReading(z) {
  if (!Number.isFinite(z) || z <= 0.0005) {
    return { label: 'Rest frame', note: 'No shift — the lines sit at their laboratory wavelengths.', pct: 0 };
  }
  const pct = z * 100;
  const word = z < 0.05 ? 'a small' : z < 0.3 ? 'a moderate' : 'a large';
  return {
    label: `z = ${z.toFixed(3)}`,
    note: `Features are stretched ${word} ${pct.toFixed(1)}% toward longer wavelengths.`,
    pct,
  };
}

function localExtrema(res, threshold) {
  const peaks = [];
  for (let i = 1; i < res.length - 1; i++) {
    const y = res[i].y;
    if (!Number.isFinite(y) || Math.abs(y) < threshold) continue;
    const rising = y >= res[i - 1].y;
    const falling = y >= res[i + 1].y;
    const trough = y <= res[i - 1].y && y <= res[i + 1].y;
    if ((y > 0 && rising && falling) || (y < 0 && trough)) {
      peaks.push({ x: res[i].x, y });
    }
  }
  return peaks;
}

/**
 * Detect the strongest line-like features in the observed residual spectrum and
 * identify each with the nearest template line at the given redshift.
 *
 * @param {object} sed  SED (see spectral-analysis.js contract)
 * @param {number} z    current template redshift (λ_obs = λ_rest·(1+z))
 * @param {{limit?:number, threshold?:number, tol?:number, merge?:number}} [opts]
 * @returns {Array<{lambda:number, strength:number, kind:'em'|'abs', label:string,
 *                  matched:boolean, deltaLambda:number|null, rest:number|null}>}
 */
export function detectFeatures(sed, z, { limit = 6, threshold = 0.05, tol = 0.035, merge = 0.02 } = {}) {
  const res = residualSpectrum(sed).filter((p) => Number.isFinite(p.y));
  if (res.length < 3) return [];

  // Merge nearby extrema of the same sign so a broad feature isn't counted twice.
  const raw = localExtrema(res, threshold).sort((a, b) => a.x - b.x);
  const merged = [];
  for (const p of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.sign(last.y) === Math.sign(p.y) && Math.abs(p.x - last.x) < merge) {
      if (Math.abs(p.y) > Math.abs(last.y)) merged[merged.length - 1] = p;
    } else {
      merged.push(p);
    }
  }

  const lines = (sed && sed.lines) || [];
  const features = merged.map((p) => {
    const kind = p.y >= 0 ? 'em' : 'abs';
    const near = lines.length ? nearestLine(lines, p.x, z) : null;
    const matched = Boolean(near) && Math.abs(near.deltaLambda) <= tol;
    return {
      lambda: p.x,
      strength: p.y,
      kind,
      matched,
      label: matched ? near.label : 'unidentified',
      rest: matched ? near.rest : null,
      deltaLambda: near ? near.deltaLambda : null,
    };
  });

  return features.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength)).slice(0, limit);
}

/**
 * Compact, non-expert summary of a spectrum.
 * @returns {{colour, shift, features, detected, verdict}}
 */
export function interpretSpectrum(sed, z, { alpha = NaN, limit = 5 } = {}) {
  const colour = colourReading(alpha);
  const shift = redshiftReading(z);
  const features = detectFeatures(sed, z, { limit });
  const matched = features.filter((f) => f.matched);
  const em = matched.filter((f) => f.kind === 'em').length;
  const abs = matched.filter((f) => f.kind === 'abs').length;

  let verdict;
  if (!features.length) verdict = 'No strong line features above the continuum noise floor.';
  else if (em && !abs) verdict = 'Emission-dominated: gas is glowing above a smooth continuum.';
  else if (abs && !em) verdict = 'Absorption-dominated: a cooler atmosphere is carving dips out of the continuum.';
  else verdict = 'A mix of emission and absorption features.';

  return { colour, shift, features, detected: matched.length, emission: em, absorption: abs, verdict };
}
