// Unit tests for the Layer-4 data builders (spectra / heatmap).
//
//   node --test astro/../spectra.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateSurvey } from './data.js';
import { buildSpectrum } from './spectra.js';
import { buildHeatmap } from './heatmap.js';
import { nside2npix, nside2resol } from './astro/healpix.js';

const { objects } = generateSurvey();

test('buildSpectrum is deterministic and complete for every object', () => {
  for (const o of objects) {
    const a = buildSpectrum(o, { n: 200 });
    const b = buildSpectrum(o, { n: 200 });
    assert.deepEqual(a, b, `deterministic per object ${o.id}`);

    assert.equal(a.object.id, o.id);
    assert.ok(Number.isFinite(a.object.teff));
    assert.equal(a.photometry.length, 9);
    assert.equal(a.spectrum.length, 200);

    // all fluxes positive finite
    for (const p of a.photometry) {
      assert.ok(p.flux > 0 && Number.isFinite(p.flux), `photo flux ${p.band}`);
      assert.ok(p.error >= 0 && Number.isFinite(p.error));
      assert.ok(p.lambda > 0);
      assert.ok(p.snr > 0);
    }
    for (const s of a.spectrum) {
      assert.ok(s.flux > 0 && Number.isFinite(s.flux));
    }
    // photometry covers UV/optical/NIR range
    const lams = a.photometry.map((p) => p.lambda);
    assert.ok(Math.min(...lams) < 0.7 && Math.max(...lams) > 3.0);
  }
});

test('buildSpectrum includes spectral line catalog and observing metadata', () => {
  const o = objects[0];
  const s = buildSpectrum(o);
  // rest-frame line catalog present, with both absorption and emission kinds
  assert.ok(Array.isArray(s.lines) && s.lines.length > 0);
  assert.ok(s.lines.some((l) => l.kind === 'abs'));
  assert.ok(s.lines.some((l) => l.kind === 'em'));
  for (const l of s.lines) {
    assert.ok(l.rest > 0 && l.rest <= 5.1, `line ${l.label} rest in window`);
    assert.ok(l.label && typeof l.label === 'string');
  }
  // metadata + redshift reference
  assert.ok(s.meta.snr > 0);
  assert.ok(s.meta.integrationSec > 0);
  assert.ok(s.meta.filter && s.meta.grating);
  assert.ok(s.meta.resolution > 0);
  assert.equal(s.z, 0);
  assert.equal(s.spectrum.length, 200);
});

test('buildSpectrum injects spectral features producing real line contrast', () => {
  // Emission features should push flux up relative to the local continuum and
  // absorption features push it down, so the curve is clearly non-smooth.
  for (const o of objects) {
    const s = buildSpectrum(o);
    const flats = s.spectrum.map((p) => p.flux);
    const max = Math.max(...flats);
    const min = Math.min(...flats);
    // With several injected lines the peak-to-valley range must be substantive
    // (guard against a perfectly smooth continuum).
    assert.ok(max / min > 1.4, `line contrast present for ${o.id}`);
  }
});

test('buildSpectrum shapes differ by class (Teff ordering)', () => {
  const tno = objects.find((o) => o.type === 'TNO');
  const ast = objects.find((o) => o.type === 'AST');
  const hpm = objects.find((o) => o.type === 'HPM');
  const teff = (o) => buildSpectrum(o).object.teff;
  // brown-dwarf / star-like HPM should be hottest, TNO coldest
  assert.ok(teff(hpm) > teff(ast));
  assert.ok(teff(ast) > teff(tno));
});

test('buildHeatmap bins all objects into HEALPix cells', () => {
  const nside = 32;
  const hm = buildHeatmap(objects, nside);
  assert.equal(hm.nside, nside);
  assert.equal(hm.npix, nside2npix(nside));
  const total = hm.bins.reduce((s, b) => s + b.count, 0);
  assert.equal(total, objects.length);
  assert.ok(hm.bins.length > 0 && hm.bins.length <= objects.length);
  for (const b of hm.bins) {
    assert.ok(Number.isInteger(b.pixel) && b.pixel >= 0 && b.pixel < hm.npix);
    assert.ok(b.count >= 1);
    assert.ok(Math.abs(b.ra) <= 360 && Math.abs(b.dec) <= 90);
  }
  // resolution matches the engine
  assert.ok(Math.abs(hm.resolArcsec - nside2resol(nside) * 206264.8) < 1);
});

test('buildHeatmap is deterministic', () => {
  assert.deepEqual(buildHeatmap(objects, 64), buildHeatmap(objects, 64));
});