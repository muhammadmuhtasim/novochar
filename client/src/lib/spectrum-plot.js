// Shared spectrum plotting transform used by both the SVG plot and the PNG
// export renderer, so on-screen and downloaded graphics stay consistent.
//
// Coordinates: x = wavelength (µm or log(µm)), y = log10(flux). Returns pixel
// mapper closures plus the resolved bounds.

export const PAD = { l: 54, r: 16, t: 16, b: 42 };

export function spectrumTransform(spectrums, { xScale = 'linear', w = 740, h = 340, pad = PAD } = {}) {
  const xs = spectrums.flatMap((s) => (s.spectrum || []).map((p) => p.lambda));
  const ys = spectrums.flatMap((s) => (s.spectrum || []).map((p) => p.flux));
  const wMin = Math.min(...xs);
  const wMax = Math.max(...xs);
  const fMax = Math.log10(Math.max(...ys));
  const fMin = Math.log10(Math.max(Math.min(...ys), 1e-6));
  const logWMin = Math.log10(Math.max(wMin, 1e-3));
  const logWMax = Math.log10(wMax);
  const spanW = w - pad.l - pad.r;
  const spanH = h - pad.t - pad.b;
  const X = (lambda) =>
    pad.l + (xScale === 'log' ? (Math.log10(lambda) - logWMin) / (logWMax - logWMin) : (lambda - wMin) / (wMax - wMin)) * spanW;
  const Y = (flux) => h - pad.b - ((Math.log10(flux) - fMin) / (fMax - fMin)) * spanH;
  return { X, Y, w, h, pad, wMin, wMax, fMin, fMax, xScale };
}

export function spectrumPoints(spectrum, tr) {
  return (spectrum.spectrum || []).map((p) => [tr.X(p.lambda), tr.Y(p.flux)]);
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
