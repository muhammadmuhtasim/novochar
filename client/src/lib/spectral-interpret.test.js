// Unit tests for the plain-language spectral interpretation helpers.
//
//   node --test src/lib/spectral-interpret.test.js   (from client/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colourReading, redshiftReading, detectFeatures, interpretSpectrum } from './spectral-interpret.js';

// Same synthetic-SED convention as spectral-analysis.test.js: a power-law
// continuum with Gaussian features injected at rest*(1+zTrue).
function synth({ slope = -1.5, zTrue = 0.4, lines = [], n = 400 } = {}) {
  const spectrum = [];
  for (let i = 0; i < n; i++) {
    const lambda = 0.2 + (i / (n - 1)) * 4.9;
    const continuum = Math.pow(lambda, slope);
    let flux = continuum;
    for (const l of lines) {
      const obs = l.rest * (1 + zTrue);
      const d = (lambda - obs) / (l.sigma || 0.01);
      const g = Math.exp(-0.5 * d * d);
      flux *= l.kind === 'abs' ? 1 - l.strength * g : 1 + l.strength * g;
    }
    spectrum.push({ lambda: +lambda.toFixed(6), flux, continuum });
  }
  return { spectrum, lines };
}

const HA = { label: 'Hα', rest: 0.6563, kind: 'em', strength: 0.5, sigma: 0.01 };
const NAI = { label: 'Na I', rest: 0.5893, kind: 'abs', strength: 0.45, sigma: 0.01 };

test('colourReading buckets the spectral index', () => {
  assert.equal(colourReading(-2).cls, 'red');
  assert.equal(colourReading(0).cls, '');
  assert.equal(colourReading(2).cls, 'blue');
  assert.equal(colourReading(NaN).key, 'unknown');
});

test('redshiftReading describes magnitude without making distance claims', () => {
  assert.equal(redshiftReading(0).pct, 0);
  assert.match(redshiftReading(0.5).note, /50\.0% toward longer wavelengths/);
  assert.match(redshiftReading(0.2).note, /moderate/);
});

test('detectFeatures finds and identifies injected emission and absorption lines', () => {
  const z = 0.4;
  const sed = synth({ zTrue: z, lines: [HA, NAI] });
  const feats = detectFeatures(sed, z);
  assert.ok(feats.length >= 2, `expected >=2 features, got ${feats.length}`);
  const em = feats.find((f) => f.kind === 'em');
  const abs = feats.find((f) => f.kind === 'abs');
  assert.ok(em && em.matched && em.label === 'Hα', `emission matched: ${JSON.stringify(em)}`);
  assert.ok(abs && abs.matched && abs.label === 'Na I', `absorption matched: ${JSON.stringify(abs)}`);
  // the feature should sit within a sample or two of the true observed centre
  assert.ok(Math.abs(em.lambda - HA.rest * (1 + z)) < 0.03);
});

test('detectFeatures leaves features unidentified when the template is misaligned', () => {
  const sed = synth({ zTrue: 0.4, lines: [HA] });
  // Query at a very different z: the Hα peak no longer coincides with any template line.
  const feats = detectFeatures(sed, 0, { tol: 0.01 });
  const peak = feats.find((f) => f.kind === 'em');
  assert.ok(peak, 'peak still detected');
  assert.equal(peak.matched, false);
  assert.equal(peak.label, 'unidentified');
});

test('interpretSpectrum summarises an emission-line source', () => {
  const z = 0.3;
  const sed = synth({ slope: 0.5, zTrue: z, lines: [HA] });
  const summary = interpretSpectrum(sed, z, { alpha: 0.5 });
  assert.equal(summary.colour.cls, 'blue');
  assert.ok(summary.detected >= 1);
  assert.match(summary.verdict, /Emission-dominated/);
});

test('interpretSpectrum degrades gracefully with no features', () => {
  const sed = synth({ zTrue: 0.3, lines: [] });
  const summary = interpretSpectrum(sed, 0.3, { alpha: -0.1 });
  assert.equal(summary.features.length, 0);
  assert.equal(summary.detected, 0);
  assert.match(summary.verdict, /No strong line features/);
});
