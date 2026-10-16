// Equatorial <-> Galactic frame tests.
//
// Two layers are checked separately:
//   * the classic FK5(J2000) rotation, whose pole/longitude relationships are
//     definitional and must hold to machine precision, and
//   * the ICRS-native transform actually exported by the core, which composes the
//     FK5 rotation with the ICRS->FK5 frame bias and therefore reproduces
//     Astropy's default ICRS->Galactic results (spot values hard-coded from
//     Astropy 8.0.2; broad coverage lives in reference.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  raDecToGalactic,
  galacticToRaDec,
  equatorialToGalacticMatrix,
  fk5EquatorialToGalacticMatrix,
  galacticToEquatorialMatrix,
  matMul3,
  transpose3,
  RA_NGP_DEG,
  DEC_NGP_DEG,
  GAL_LON_OF_NCP_DEG,
} from './frames.js';
import { sphericalToUnit, unitToSpherical } from './vector.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

function applyMatrix(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Apply a rotation matrix to (ra, dec) and read back the resulting (l, b). */
function applyToSpherical(matrix, lonDeg, latDeg) {
  const { raDeg, decDeg } = unitToSpherical(applyMatrix(matrix, sphericalToUnit(lonDeg, latDeg)));
  return { l: raDeg, b: decDeg };
}

test('classic FK5(J2000) rotation maps the galactic north pole to b = +90 (definitional)', () => {
  const pole = applyToSpherical(fk5EquatorialToGalacticMatrix, RA_NGP_DEG, DEC_NGP_DEG);
  assert.ok(close(pole.b, 90, 1e-9), `b ${pole.b}`);

  const ncp = applyToSpherical(fk5EquatorialToGalacticMatrix, 0, 90);
  assert.ok(close(ncp.l, GAL_LON_OF_NCP_DEG, 1e-9), `l ${ncp.l}`);
  assert.ok(close(ncp.b, DEC_NGP_DEG, 1e-9), `b ${ncp.b}`);
});

test('ICRS-native transform reproduces Astropy ICRS galactic coordinates', () => {
  // Away from the galactic poles (l, b) are well-conditioned, so spot values from
  // Astropy 8.0.2 (`SkyCoord(..., frame='icrs').galactic`) must match tightly.
  const ncp = raDecToGalactic(0, 90);
  assert.ok(close(ncp.l, 122.93192525541662, 1e-9), `ncp l ${ncp.l}`);
  assert.ok(close(ncp.b, 27.128252414968, 1e-9), `ncp b ${ncp.b}`);

  // The FK5(J2000) galactic pole now maps to b = +90 only up to the ICRS frame
  // bias. Near a galactic pole arcsin is ill-conditioned, so assert the offset
  // magnitude rather than the exact coordinate. A non-zero offset (~3.2e-6 deg)
  // proves the frame-bias step is actually applied: a bare FK5 rotation would
  // give b = 90 to machine precision.
  const pole = raDecToGalactic(RA_NGP_DEG, DEC_NGP_DEG);
  const offset = 90 - pole.b;
  assert.ok(offset > 1e-7 && offset < 1e-5, `pole b offset ${offset}`);
});

test('galactic centre (l=0,b=0) is the Sgr A* direction (ICRS)', () => {
  const { ra, dec } = galacticToRaDec(0, 0);
  assert.ok(close(ra, 266.4049882865447, 1e-6), `ra ${ra}`);
  assert.ok(close(dec, -28.936177761791473, 1e-6), `dec ${dec}`);
  const back = raDecToGalactic(ra, dec);
  assert.ok(close(back.l, 0, 1e-6) && close(back.b, 0, 1e-6));
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
