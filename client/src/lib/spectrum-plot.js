// Shared spectrum plotting transform used by both the SVG plot and the PNG
// export renderer, so on-screen and downloaded graphics stay consistent.
//
// Coordinates: x = wavelength (µm or log(µm)), y = log10(flux). Returns pixel
// mapper closures plus the resolved bounds.

export const PAD = { l: 54, r: 16, t: 16, b: 42 };

export function spectrumTransform(spectrums, { xScale = 'linear', w = 740, h = 340, pad = PAD } = {}) {
  // Work only from finite samples; non-finite values must never leak into the
  // plot bounds or pixel coordinates.
  const xs = spectrums.flatMap((s) => (s.spectrum || []).map((p) => p.lambda)).filter(Number.isFinite);
  const ys = spectrums.flatMap((s) => (s.spectrum || []).map((p) => p.flux)).filter(Number.isFinite);
  const posYs = ys.filter((v) => v > 0);

  // Keep the axis bounds finite even for empty / all-zero / all-negative data so
  // downstream callers never see -Infinity or NaN ranges (clamps match the old
  // 1e-6 / 1e-3 floors for normal positive data).
  const wMin = xs.length ? Math.min(...xs) : 1e-3;
  const wMax = xs.length ? Math.max(...xs) : 1;
  const fLo = posYs.length ? Math.max(Math.min(...posYs), 1e-6) : 1e-6;
  const fHi = posYs.length ? Math.max(...posYs) : 1e-6;
  const fMax = Math.log10(fHi);
  const fMin = Math.log10(fLo);
  const logWMin = Math.log10(Math.max(wMin, 1e-3));
  const logWMax = Math.log10(Math.max(wMax, 1e-3));
  // Guard against a flat spectrum (zero flux range) producing NaN coordinates.
  const wSpan = wMax - wMin || 1e-9;
  const logWSpan = logWMax - logWMin || 1e-9;
  const fSpan = fMax - fMin || 1e-9;
  const spanW = w - pad.l - pad.r;
  const spanH = h - pad.t - pad.b;
  // A logarithmic coordinate is only defined for strictly positive, finite
  // input. Invalid samples map to NaN (never -Infinity), and callers decide how
  // to skip or display them.
  const X = (lambda) => {
    if (!Number.isFinite(lambda)) return NaN;
    if (xScale === 'log') return lambda <= 0 ? NaN : pad.l + ((Math.log10(lambda) - logWMin) / logWSpan) * spanW;
    return pad.l + ((lambda - wMin) / wSpan) * spanW;
  };
  const Y = (flux) => {
    if (!(Number.isFinite(flux) && flux > 0)) return NaN;
    return h - pad.b - ((Math.log10(flux) - fMin) / fSpan) * spanH;
  };
  return { X, Y, w, h, pad, wMin, wMax, fMin, fMax, xScale };
}

export function spectrumPoints(spectrum, tr) {
  const out = [];
  for (const p of spectrum.spectrum || []) {
    const x = tr.X(p.lambda);
    const y = tr.Y(p.flux);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

// nice decimal ticks for a linear or log axis.
export function niceTicks(min, max, count = 6) {
  const span = max - min;
  if (span <= 0) return [min];
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
