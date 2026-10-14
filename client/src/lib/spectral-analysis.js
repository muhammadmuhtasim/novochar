// Spectral-analysis helpers for the SPECTRA workbench.
//
// Pure, dependency-free functions so they can be unit-tested in Node and reused
// by the plot, the readouts and the exports. Everything here operates on the
// server SED contract:
//
//   sed = {
//     spectrum: [{ lambda (µm, observed), flux, continuum? }],
//     photometry: [{ band, lambda, flux, error, snr }],
//     lines: [{ label, rest (µm), kind: 'em'|'abs' }],
//     ...
//   }
//
// All fluxes are synthetic arbitrary units ("a.u."); the methods below measure
// *relative* quantities (slopes, residuals, line contrast) which are invariant
// under the unknown normalisation, exactly as one would on real relative
// spectrophotometry.

/** Linear interpolation of y at x over a monotonic (x, y) table. */
export function interpolate(samples, x) {
  if (!samples || samples.length === 0) return NaN;
  if (x <= samples[0].x) return samples[0].y;
  const last = samples[samples.length - 1];
  if (x >= last.x) return last.y;
  // binary search for the bracketing interval
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const t = (x - a.x) / (b.x - a.x || 1);
  return a.y + t * (b.y - a.y);
}

/** Continuum model: the per-sample `continuum` if present, else the flux itself.
 *  Returning the flux as its own continuum yields zero residual (honest "no
 *  model" behaviour) rather than a fabricated baseline. */
export function continuumOf(sed) {
  if (!sed || !Array.isArray(sed.spectrum)) return [];
  return sed.spectrum.map((p) => ({
    x: p.lambda,
    y: Number.isFinite(p.continuum) && p.continuum > 0 ? p.continuum : p.flux,
  }));
}

/** Fractional residual (flux − continuum) / continuum, sampled on the same grid. */
export function residualSpectrum(sed) {
  const cont = continuumOf(sed);
  return (sed.spectrum || []).map((p, i) => {
    const c = cont[i].y;
    const r = c > 0 ? (p.flux - c) / c : 0;
    return { x: p.lambda, y: r };
  });
}

/**
 * Rest-frame spectral index α for F_λ ∝ λ^α, from an ordinary least-squares fit
 * of log10(flux) vs log10(λ) over the continuum (line-free) samples. This is the
 * standard "spectral slope" descriptor used to classify red vs blue SEDs.
 *
 * @returns {{alpha:number, n:number, r2:number}} (alpha=NaN when under-constrained)
 */
export function spectralIndex(sed, { lambdaMin = 0.45, lambdaMax = 4.5 } = {}) {
  const pts = [];
  const cont = continuumOf(sed);
  for (let i = 0; i < (sed.spectrum || []).length; i++) {
    const { lambda } = sed.spectrum[i];
    const f = cont[i].y;
    if (lambda < lambdaMin || lambda > lambdaMax) continue;
    if (!(f > 0)) continue;
    pts.push([Math.log10(lambda), Math.log10(f)]);
  }
  const n = pts.length;
  if (n < 3) return { alpha: NaN, n, r2: NaN };
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  const mx = sx / n; const my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx; const dy = y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const slope = sxx > 0 ? sxy / sxx : NaN;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : NaN;
  return { alpha: slope, n, r2 };
}

/**
 * Cross-correlation score of the rest-frame line template (shifted to redshift z)
 * against the observed line residuals. Emission lines contribute their positive
 * residual, absorption lines the magnitude of their negative residual, so a
 * correct alignment maximises the score. Normalised to the number of in-window
 * lines, giving a mean fractional line contrast (dimensionless).
 */
export function alignmentScore(sed, z, lines = (sed && sed.lines) || []) {
  const residual = residualSpectrum(sed);
  if (residual.length === 0) return 0;
  const lam0 = residual[0].x;
  const lam1 = residual[residual.length - 1].x;
  let sum = 0;
  let used = 0;
  for (const l of lines) {
    const obs = l.rest * (1 + z);
    if (obs < lam0 || obs > lam1) continue;
    const r = interpolate(residual, obs);
    if (!Number.isFinite(r)) continue;
    sum += (l.kind === 'abs' ? -1 : 1) * r;
    used += 1;
  }
  return used ? sum / used : 0;
}

/**
 * Best-fit redshift by scanning `alignmentScore` over a grid, then refining the
 * peak with a 3-point parabolic interpolation for sub-step accuracy.
 *
 * @returns {{z:number, score:number, curve:Array<{z:number,score:number}>}}
 */
export function estimateRedshift(sed, lines = (sed && sed.lines) || [], { min = 0, max = 1.2, step = 0.002 } = {}) {
  const curve = [];
  let best = { z: min, score: -Infinity };
  for (let z = min; z <= max + 1e-9; z += step) {
    const score = alignmentScore(sed, z, lines);
    const zp = +z.toFixed(6);
    curve.push({ z: zp, score });
    if (score > best.score) best = { z: zp, score };
  }
  // parabolic refinement around the discrete maximum
  const i = curve.findIndex((p) => p.z === best.z);
  if (i > 0 && i < curve.length - 1) {
    const y0 = curve[i - 1].score;
    const y1 = curve[i].score;
    const y2 = curve[i + 1].score;
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) {
      const delta = (0.5 * (y0 - y2)) / denom;
      if (Math.abs(delta) <= 1) {
        const zRef = best.z + delta * step;
        best = { z: +zRef.toFixed(4), score: alignmentScore(sed, zRef, lines) };
      }
    }
  }
  return { ...best, curve };
}

/**
 * Peak line contrast: max/min of the observed flux over the band. A quick
 * "are there real features?" figure used in the readout.
 */
export function lineContrast(sed) {
  const f = (sed.spectrum || []).map((p) => p.flux).filter((v) => v > 0 && Number.isFinite(v));
  if (f.length < 2) return NaN;
  return Math.max(...f) / Math.min(...f);
}

/** Nearest catalogue line (at the given redshift) to an observed wavelength. */
export function nearestLine(lines, observedLambda, z) {
  let best = null;
  let bd = Infinity;
  for (const l of lines) {
    const obs = l.rest * (1 + z);
    const d = Math.abs(obs - observedLambda);
    if (d < bd) { bd = d; best = { ...l, observed: obs, deltaLambda: observedLambda - obs }; }
  }
  return best;
}
