// Equatorial <-> Galactic frame tests. The reference points are definitional
// (Astropy's Galactic frame constants), so they must match to machine precision.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  raDecToGalactic,
  galacticToRaDec,
  equatorialToGalacticMatrix,
  galacticToEquatorialMatrix,
  matMul3,
  transpose3,
  RA_NGP_DEG,
  DEC_NGP_DEG,
  GAL_LON_OF_NCP_DEG,
} from './frames.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('galactic north pole maps to b = +90 (astropy _ngp_J2000)', () => {
  const g = raDecToGalactic(RA_NGP_DEG, DEC_NGP_DEG);
  assert.ok(close(g.b, 90, 1e-9), `b ${g.b}`);
});

test('NCP galactic longitude equals astropy _lon0_J2000', () => {
  const g = raDecToGalactic(0, 90);
  assert.ok(close(g.l, GAL_LON_OF_NCP_DEG, 1e-9), `l ${g.l}`);
  assert.ok(close(g.b, DEC_NGP_DEG, 1e-9), `b ${g.b}`);
});

test('galactic centre (l=0,b=0) is Sagittarius A* direction (IAU 1958)', () => {
  const { ra, dec } = galacticToRaDec(0, 0);
  assert.ok(close(ra, 266.405, 1e-3), `ra ${ra}`);
  assert.ok(close(dec, -28.936, 1e-3), `dec ${dec}`);
  const back = raDecToGalactic(ra, dec);
  assert.ok(close(back.l, 0, 1e-3) && close(back.b, 0, 1e-3));
});

test('forward/reverse round-trips are lossless across the sky', () => {
  let worst = 0;
  for (let i = 0; i < 5000; i++) {
    const ra = (i * 67.1) % 360;
    const dec = ((i % 17) - 8) * 2.5 + Math.sin(i);
    const g = raDecToGalactic(ra, dec);
    const eq = galacticToRaDec(g.l, g.b);
    const dRa = Math.abs(eq.ra - ra) % 360;
    worst = Math.max(worst, Math.min(dRa, 360 - dRa), Math.abs(eq.dec - dec));
  }
  assert.ok(worst < 1e-9, `worst round-trip error ${worst}`);
});

test('the rotation matrix is orthonormal with determinant +1', () => {
  const r = equatorialToGalacticMatrix;
  const shouldBeI = matMul3(r, transpose3(r));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(shouldBeI[i][j] - (i === j ? 1 : 0)) < 1e-12, `R*R^T [${i}][${j}]`);
    }
  }
  const det =
    r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
    r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
    r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  assert.ok(Math.abs(det - 1) < 1e-12, `det ${det}`);
});

test('galacticToEquatorialMatrix is the transpose (R^-1 = R^T)', () => {
  const t = transpose3(equatorialToGalacticMatrix);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) assert.equal(galacticToEquatorialMatrix[i][j], t[i][j]);
  }
});
