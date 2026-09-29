// Deterministic SED (spectral energy distribution) builder for Layer 4.
//
// Builds a physically-motivated, seeded synthetic spectrum + multi-band
// photometric set for a catalogue object. Deterministic per object id so the
// client can render stable curves across reloads, mirroring the `data.js`
// seeded-simulation philosophy. A real archive later supplies these points;
// the client contract stays the same.

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

/**
 * Build a deterministic SED for an object.
 * @param {object} obj  catalogue object with id/type/mag/bandIndex
 * @param {{n?: number}} [opts]
 * @returns {{object, photometry, spectrum, bands}}
 */
export function buildSpectrum(obj, { n = 200 } = {}) {
  const seed = (parseInt(String(obj.id).replace(/\D/g, ''), 10) || 7) * 7919 + 3;
  const rand = mulberry32(seed);
  const teff = TYPE_TEMP[obj.type] || 300;
  // normalisations: visible-driven reflected flux + IR thermal component
  const magFactor = Math.pow(10, (14 - (obj.mag || 18)) * 0.4);
  const refNorm = magFactor * (0.5 + rand());
  const scale = refNorm * (0.15 + rand() * 0.4);

  const spectrum = [];
  for (let i = 0; i < n; i++) {
    const w = 0.2 + (i / (n - 1)) * 4.9; // 0.2 -> 5.1 µm
    let flux = reflectedFlux(w, refNorm) + blackbodyFlux(w, teff, scale);
    // a shallow feature so the curve isn't perfectly smooth
    flux *= 1 + 0.05 * Math.sin(2 * Math.PI * (w / 0.5) + rand() * 0.2);
    spectrum.push({ lambda: +w.toFixed(4), flux: +Math.max(flux, 1e-3).toFixed(4) });
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
    bands: SPHEREX_BANDS,
  };
}