// Deterministic SED (spectral energy distribution) builder for Layer 4.
//
// Builds a physically-motivated, seeded synthetic spectrum + multi-band
// photometric set for a catalogue object. Deterministic per object id so the
// client can render stable curves across reloads, mirroring the `data.js`
// seeded-simulation philosophy. A real archive later supplies these points;
// the client contract stays the same.
//
// v2 additions (spectral analysis tooling):
//   - `spectrum` now has real injected spectral features (not just a sine
//     ripple) so absorption / emission signatures are visible in the plot.
//   - `lines` is the rest-frame line catalog (client shifts with (1+z)).
//   - `meta` carries SNR, integration time, filter/grating + resolution.
//   - `z` is the (rest, z=0) reference the redshift slider starts from.

import { SPHEREX_BANDS } from './data.js';

// Guide wavelengths (µm) chosen to reach across UV/optical/NIR, echoing the
// plan's "102-band SPHEREx alongside Gaia/SDSS" styling with a handful of
// representative anchors.
const PHOTOMETRIC_POINTS = [
  { band: 'Gaia G', lambda: 0.585, wave: 0.585 },
  { band: 'SDSS r', lambda: 0.623, wave: 0.623 },
  { band: 'SDSS z', lambda: 0.893, wave: 0.893 },
  { band: 'SPHEREx B1', lambda: 0.93, wave: 0.93 },
  { band: 'SPHEREx B2', lambda: 1.375, wave: 1.375 },
  { band: 'SPHEREx B3', lambda: 2.03, wave: 2.03 },
  { band: 'SPHEREx B4', lambda: 3.12, wave: 3.12 },
  { band: 'SPHEREx B5', lambda: 4.12, wave: 4.12 },
  { band: 'SPHEREx B6', lambda: 4.71, wave: 4.71 },
].map((p) => ({ ...p, wave: p.wave ?? p.lambda }));

// Rest-frame spectral line catalog (wavelengths in µm) spanning the observed
// 0.2–5.1 µm window, so every class shows a visible chemical signature.
const SPECTRAL_LINES = [
  { label: 'Mg II', rest: 0.2798, kind: 'em' },
  { label: '[O II]', rest: 0.3727, kind: 'em' },
  { label: 'Ca II K', rest: 0.3934, kind: 'abs' },
  { label: 'Ca II H', rest: 0.3968, kind: 'abs' },
  { label: 'Hγ', rest: 0.4340, kind: 'abs' },
  { label: 'Hβ', rest: 0.4861, kind: 'em' },
  { label: '[O III]', rest: 0.4959, kind: 'em' },
  { label: '[O III]', rest: 0.5007, kind: 'em' },
  { label: 'Na I', rest: 0.5893, kind: 'abs' },
  { label: 'Hα', rest: 0.6563, kind: 'em' },
  { label: '[S II]', rest: 0.6725, kind: 'em' },
  { label: 'Paβ', rest: 1.2818, kind: 'em' },
  { label: 'Brγ', rest: 2.1655, kind: 'em' },
];

export { SPECTRAL_LINES };

// rough effective temperatures by class (K)
const TYPE_TEMP = {
  TNO: 90, // cold distant body -> peak in the mid-IR
  AST: 260, // main-belt thermal bump
  HPM: 1600, // brown-dwarf-like, peak in the NIR
};

function mulberry32(seed) {
  let a = seed;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blackbodyFlux(lambdaMicron, teff, scale) {
  // B_lambda in arbitrary flux units; dominant in the IR for cold bodies.
  const A = 1.4387769e4; // = hc/kB in µm·K (≈14387.77 µm·K)
  const w = lambdaMicron;
  const l5 = Math.pow(w, 5);
  const bb = l5 > 0 ? 1 / (l5 * (Math.exp(A / (w * teff)) - 1)) : 0;
  return bb * scale;
}

// Reflected-sunlight component (power-law in wavelength) so the SED stays
// non-zero in the optical/UV for every type, with the thermal bump on top.
function reflectedFlux(lambdaMicron, norm) {
  const REF = 0.55; // µm reference (≈ V band)
  return norm * Math.pow(REF / lambdaMicron, 2);
}

// v2: inject a single Gaussian spectral feature (abs or em) into a flux value.
function injectFeature(w, flux, feature) {
  const d = (w - feature.obs) / feature.sigma;
  const g = Math.exp(-0.5 * d * d);
  const factor = feature.kind === 'abs' ? 1 - feature.strength * g : 1 + feature.strength * g;
  return Math.max(flux * factor, 1e-3);
}

/**
 * Build a deterministic SED for an object.
 * @param {object} obj  catalogue object with id/type/mag/bandIndex
 * @param {{n?: number}} [opts]
 * @returns {{object, photometry, spectrum, lines, bands, meta, z}}
 */
export function buildSpectrum(obj, { n = 200 } = {}) {
  const seed = (parseInt(String(obj.id).replace(/\D/g, ''), 10) || 7) * 7919 + 3;
  const rand = mulberry32(seed);
  const teff = TYPE_TEMP[obj.type] || 300;
  // normalisations: visible-driven reflected flux + IR thermal component
  const magFactor = Math.pow(10, (14 - (obj.mag || 18)) * 0.4);
  const refNorm = magFactor * (0.5 + rand());
  const scale = refNorm * (0.15 + rand() * 0.4);

  // Build the (rest, z=0) features that fall inside the observed window.
  const features = SPECTRAL_LINES.filter((l) => l.rest >= 0.2 && l.rest <= 5.1).map((l) => ({
    label: l.label,
    kind: l.kind,
    rest: l.rest,
    obs: l.rest, // z = 0 reference spectrum
    sigma: 0.0035 + rand() * 0.004,
    strength: l.kind === 'abs' ? 0.16 + rand() * 0.2 : 0.3 + rand() * 0.45,
  }));

  const spectrum = [];
  for (let i = 0; i < n; i++) {
    const w = 0.2 + (i / (n - 1)) * 4.9; // 0.2 -> 5.1 µm
    let flux = reflectedFlux(w, refNorm) + blackbodyFlux(w, teff, scale);
    // a shallow continuum modulation so the curve isn't perfectly smooth
    flux *= 1 + 0.04 * Math.sin(2 * Math.PI * (w / 0.5) + rand() * 0.2);
    for (const f of features) flux = injectFeature(w, flux, f);
    spectrum.push({ lambda: +w.toFixed(4), flux: +flux.toFixed(4) });
  }

  const photometry = PHOTOMETRIC_POINTS.map((p) => {
    const exact = reflectedFlux(p.wave, refNorm) + blackbodyFlux(p.wave, teff, scale);
    const err = exact * (0.03 + rand() * 0.05);
    return {
      band: p.band,
      lambda: p.wave,
      flux: +Math.max(exact, 1e-3).toFixed(4),
      error: +err.toFixed(4),
      snr: Math.round((2 + rand() * 9) * 10) / 10,
    };
  });

  const snr = +(photometry.reduce((s, p) => s + p.snr, 0) / photometry.length).toFixed(1);
  // SPHEREx uses a low-resolution prism/grism over six NIR bands.
  const resolution = Math.round(60 + 40 * rand());

  return {
    object: {
      id: obj.id,
      name: obj.name,
      type: obj.type,
      typeLabel: obj.typeLabel || obj.type,
      ra: obj.ra,
      dec: obj.dec,
      mag: obj.mag,
      band: obj.band,
      teff,
    },
    photometry,
    spectrum,
    lines: SPECTRAL_LINES.map((l) => ({ label: l.label, rest: l.rest, kind: l.kind })),
    bands: SPHEREX_BANDS,
    meta: {
      snr,
      integrationSec: Math.round(Math.max(60, 300 - (obj.mag || 18) * 8)),
      filter: obj.band || 'SPHEREx 6-band',
      grating: `Prism · R ≈ ${resolution}`,
      resolution,
      units: { wavelength: 'µm', flux: 'Jy', rend: 'reflected + thermal' },
    },
    z: 0,
  };
}

