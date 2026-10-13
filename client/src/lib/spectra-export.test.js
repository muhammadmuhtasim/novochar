// Client unit tests for the spectrum export / FITS writer.
//
//   node --test src/lib/spectra-export.test.js   (from client/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { spectrumFITS, spectrumCSV, spectrumJSON } from './spectra-export.js';

const sed = {
  object: { id: 'NC-0001', name: 'Test Object' },
  meta: { snr: 12.5 },
  spectrum: Array.from({ length: 200 }, (_, i) => ({
    lambda: +(0.2 + (i / 199) * 4.9).toFixed(6),
    flux: +(1 + i * 0.01).toFixed(4),
  })),
};

// Read the first (2880-byte) header block into { keyword: trimmedValue }.
function readHeader(buf) {
  const text = new TextDecoder().decode(buf.subarray(0, 2880));
  const cards = new Map();
  for (let i = 0; i < 36; i++) {
    const raw = text.slice(i * 80, i * 80 + 80);
    const kw = raw.slice(0, 8).trim();
    if (!kw) continue;
    if (kw === 'END') break;
    cards.set(kw, raw.slice(10).trim());
  }
  return cards;
}

test('FITS header: NAXIS1 is the element count and values are correctly quoted', async () => {
  const blob = spectrumFITS(sed);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const cards = readHeader(buf);

  assert.equal(Number(cards.get('BITPIX')), -64);
  assert.equal(Number(cards.get('NAXIS')), 1);
  // THE regression: NAXIS1 must be 200 elements, not 200*8 bytes.
  assert.equal(Number(cards.get('NAXIS1')), 200);
  assert.equal(cards.get('SIMPLE'), 'T');
  assert.equal(cards.get('BUNIT'), "'--'");
  assert.equal(cards.get('CTYPE1'), "'WAVE'");
  assert.equal(cards.get('CUNIT1'), "'um'");
  assert.equal(cards.get('TELESCOP'), "'SPHEREx'");
  assert.ok(cards.get('OBJECT').startsWith("'"), `OBJECT quoted: ${cards.get('OBJECT')}`);
  assert.ok(cards.get('COMMENT').includes('synthetic'), 'COMMENT labels synthetic');

  // Data block: 200 doubles (1600 bytes) padded to a 2880 multiple.
  assert.equal(buf.length, 2880 + 2880);
  const dv = new DataView(buf.buffer, buf.byteOffset + 2880, 200 * 8);
  assert.ok(Math.abs(dv.getFloat64(0, false) - sed.spectrum[0].flux) < 1e-3, 'first flux round-trips');
  assert.ok(Math.abs(dv.getFloat64(199 * 8, false) - sed.spectrum[199].flux) < 1e-3, 'last flux round-trips');
});

test('FITS header WCS reconstructs the sample wavelengths from CRVAL1/CDELT1', async () => {
  const blob = spectrumFITS(sed);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const cards = readHeader(buf);
  const crval = Number(cards.get('CRVAL1'));
  const cdelt = Number(cards.get('CDELT1'));
  const crpix = Number(cards.get('CRPIX1'));
  assert.equal(crpix, 1);
  assert.ok(Math.abs(crval - 0.2) < 1e-9, `CRVAL1 ${crval}`);
  const tol = 1e-4; // µm — far tighter than the old 4-dp rounding mismatch
  for (const [i, p] of sed.spectrum.entries()) {
    const recon = crval + (i - (crpix - 1)) * cdelt;
    assert.ok(Math.abs(recon - p.lambda) < tol, `pixel ${i + 1}: ${recon} vs ${p.lambda}`);
  }
});

test('CSV and JSON exports use arbitrary units and round-trip sample count', () => {
  const csv = spectrumCSV(sed);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'lambda_um,flux_au');
  assert.equal(lines.length, sed.spectrum.length + 1);
  assert.ok(lines.every((l) => l.split(',').length === 2), 'two columns per row');

  const parsed = JSON.parse(spectrumJSON(sed));
  assert.equal(parsed.spectrum.length, sed.spectrum.length);
});

test('spectrumFITS rejects degenerate single-point input', () => {
  assert.throws(
    () => spectrumFITS({ object: {}, spectrum: [{ lambda: 1, flux: 1 }] }),
    /at least 2 spectrum samples/
  );
});