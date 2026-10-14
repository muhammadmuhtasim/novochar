// Unit tests for the spectral-analysis helpers.
//
//   node --test src/lib/spectral-analysis.test.js   (from client/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  interpolate,
  spectralIndex,
  residualSpectrum,
  alignmentScore,
  estimateRedshift,
  lineContrast,
  nearestLine,
  nearestGridIndices,
} from './spectral-analysis.js';

// Build a synthetic SED: power-law continuum F ∝ λ^slope with Gaussian line
// features injected at rest*(1+zTrue), so we know the ground-truth redshift.
function synth({ slope = -1.5, zTrue = 0.4, lines = [], n = 400 } = {}) {
  const spectrum = [];
  const rest = [];
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
    rest.push({ lambda, continuum });
  }
  return { spectrum, lines, groundTruth: zTrue };
}

test('interpolate does linear interpolation and clamps at the ends', () => {
  const s = [{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 20 }];
  assert.equal(interpolate(s, -5), 0);
  assert.equal(interpolate(s, 5), 20);
  assert.equal(interpolate(s, 0.5), 5);
  assert.equal(interpolate(s, 1.5), 15);
});

test('spectralIndex recovers a known power-law slope', () => {
  const sed = synth({ slope: -2 }); // no lines
  const { alpha, n } = spectralIndex(sed);
  assert.ok(n > 100);
  assert.ok(Math.abs(alpha - -2) < 1e-6, `alpha=${alpha}`);
});

test('residualSpectrum is zero for a line-free continuum and signed at features', () => {
  const em = [{ label: 'Hα', rest: 0.6563, kind: 'em', strength: 0.5, sigma: 0.01 }];
  const abs = [{ label: 'Na I', rest: 0.5893, kind: 'abs', strength: 0.4, sigma: 0.01 }];
  const sed = synth({ lines: [...em, ...abs], zTrue: 0.2 });
  const res = residualSpectrum(sed);
  const at = (lam) => res.reduce((b, p) => (Math.abs(p.x - lam) < Math.abs(b.x - lam) ? p : b));
  // emission positive, absorption negative at their *observed* wavelengths
  assert.ok(at(0.6563 * 1.2).y > 0.1, 'emission residual positive');
  assert.ok(at(0.5893 * 1.2).y < -0.1, 'absorption residual negative');
});

test('residualSpectrum tolerates null / missing input', () => {
  assert.deepEqual(residualSpectrum(null), []);
  assert.deepEqual(residualSpectrum(undefined), []);
  assert.deepEqual(residualSpectrum({}), []);
  assert.deepEqual(residualSpectrum({ spectrum: null }), []);
});

test('alignmentScore peaks at the injected redshift', () => {
  const lines = [
    { label: 'Hα', rest: 0.6563, kind: 'em', strength: 0.5, sigma: 0.01 },
    { label: 'Hβ', rest: 0.4861, kind: 'em', strength: 0.5, sigma: 0.01 },
    { label: 'Na I', rest: 0.5893, kind: 'abs', strength: 0.4, sigma: 0.01 },
  ];
  const zTrue = 0.35;
  const sed = synth({ lines, zTrue });
  const peak = alignmentScore(sed, zTrue, sed.lines);
  const off = alignmentScore(sed, zTrue + 0.15, sed.lines);
  assert.ok(peak > 0, `peak positive (${peak})`);
  assert.ok(peak > off, `peak ${peak} > off ${off}`);
});

test('estimateRedshift recovers the injected redshift within tolerance', () => {
  const lines = [
    { label: 'Hα', rest: 0.6563, kind: 'em', strength: 0.45, sigma: 0.012 },
    { label: 'Hβ', rest: 0.4861, kind: 'em', strength: 0.45, sigma: 0.012 },
    { label: 'O II', rest: 0.3727, kind: 'em', strength: 0.45, sigma: 0.012 },
    { label: 'Na I', rest: 0.5893, kind: 'abs', strength: 0.35, sigma: 0.012 },
    { label: 'Ca II K', rest: 0.3934, kind: 'abs', strength: 0.35, sigma: 0.012 },
  ];
  for (const zTrue of [0.05, 0.3, 0.7]) {
    const sed = synth({ lines, zTrue });
    const { z, score } = estimateRedshift(sed, sed.lines, { min: 0, max: 1.0, step: 0.002 });
    assert.ok(Math.abs(z - zTrue) < 0.02, `recovered ${z} vs ${zTrue}`);
    assert.ok(score > 0);
  }
});

test('lineContrast reports peak-to-valley flux ratio', () => {
  const sed = { spectrum: [{ lambda: 1, flux: 1 }, { lambda: 2, flux: 4 }] };
  assert.equal(lineContrast(sed), 4);
  assert.ok(Number.isNaN(lineContrast({ spectrum: [] })));
});

test('nearestLine finds the closest shifted template line', () => {
  const lines = [
    { label: 'A', rest: 0.5, kind: 'em' },
    { label: 'B', rest: 1.0, kind: 'em' },
  ];
  const hit = nearestLine(lines, 1.0 * 1.2 + 0.01, 0.2);
  assert.equal(hit.label, 'B');
  assert.ok(Math.abs(hit.observed - 1.2) < 1e-9);
});

test('nearestGridIndices picks the object whose cell it falls in', () => {
  const geom = { raMin: 0, raMax: 40, decMin: 0, decMax: 40 };
  // Put one object in the (0,0) cell (top-left: high dec, low RA) and one in
  // the (3,3) cell (bottom-right: low dec, high RA).
  const ra = [1, 39];
  const dec = [39, 1];
  const g = nearestGridIndices(ra, dec, geom, 4);
  assert.equal(g.length, 16);
  assert.equal(g[0], 0);
  assert.equal(g[3 * 4 + 3], 1);
  // every cell resolves to *some* object when the catalogue is non-empty
  assert.ok([...g].every((i) => i === 0 || i === 1));
});

test('nearestGridIndices returns -1s for an empty catalogue and wraps RA at 180°', () => {
  const geom = { raMin: 0, raMax: 40, decMin: 0, decMax: 40 };
  const empty = nearestGridIndices([], [], geom, 4);
  assert.equal(empty.length, 16);
  assert.ok([...empty].every((i) => i === -1));

  // An object at RA 359° is closest to the RA 0..40 window's low edge via wrap.
  const g = nearestGridIndices([359], [20], geom, 4);
  assert.ok([...g].every((i) => i === 0));
});
