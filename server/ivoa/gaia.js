import { tapQuery } from './tap.js';

const MAS_TO_RAD = Math.PI / (180 * 3600 * 1000);

export function projectGaiaRow(row, targetEpoch) {
  if (row.ra == null || row.dec == null) {
    throw new TypeError('Gaia row requires non-null ra and dec');
  }
  const ra = Number(row.ra);
  const dec = Number(row.dec);
  const pmra = Number(row.pmra);
  const pmdec = Number(row.pmdec);
  const referenceEpoch = Number(row.ref_epoch ?? 2016.0);
  if (![ra, dec, targetEpoch, referenceEpoch].every(Number.isFinite) || Math.abs(dec) > 90) {
    throw new TypeError('Gaia row requires finite ra, dec, ref_epoch and target epoch');
  }

  const years = targetEpoch - referenceEpoch;
  const eastMas = Number.isFinite(pmra) ? pmra * years : 0;
  const northMas = Number.isFinite(pmdec) ? pmdec * years : 0;
  const east = eastMas * MAS_TO_RAD;
  const north = northMas * MAS_TO_RAD;
  const distance = Math.hypot(east, north);
  const raRad = ra * Math.PI / 180;
  const decRad = dec * Math.PI / 180;
  const position = [Math.cos(decRad) * Math.cos(raRad), Math.cos(decRad) * Math.sin(raRad), Math.sin(decRad)];
  const eastBasis = [-Math.sin(raRad), Math.cos(raRad), 0];
  const northBasis = [-Math.sin(decRad) * Math.cos(raRad), -Math.sin(decRad) * Math.sin(raRad), Math.cos(decRad)];
  const factor = distance === 0 ? 0 : Math.sin(distance) / distance;
  const moved = position.map((value, i) =>
    Math.cos(distance) * value + factor * (east * eastBasis[i] + north * northBasis[i])
  );
  const projectedRa = (Math.atan2(moved[1], moved[0]) * 180 / Math.PI + 360) % 360;
  const projectedDec = Math.atan2(moved[2], Math.hypot(moved[0], moved[1])) * 180 / Math.PI;

  return {
    ...row,
    raAtEpoch: projectedRa,
    decAtEpoch: projectedDec,
    referenceEpoch,
    targetEpoch,
    displacementMas: Math.hypot(eastMas, northMas),
  };
}

function finiteInRange(value, name, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
  return number;
}

export async function queryGaiaMotion({
  ra,
  dec,
  radius = 0.1,
  targetEpoch = 2025.0,
  fetchImpl = globalThis.fetch,
} = {}) {
  const centerRa = finiteInRange(ra, 'ra', 0, 360);
  const centerDec = finiteInRange(dec, 'dec', -90, 90);
  const coneRadius = finiteInRange(radius, 'radius', 0.001, 1);
  const epoch = finiteInRange(targetEpoch, 'targetEpoch', 1900, 2200);
  const query = `SELECT TOP 500 source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag, ref_epoch FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${centerRa}, ${centerDec}, ${coneRadius}))`;
  const result = await tapQuery({ archive: 'gaia', query, fetchImpl, timeout: 45000 });
  return {
    endpoint: result.endpoint,
    status: result.status,
    count: result.rows.length,
    center: { ra: centerRa, dec: centerDec },
    radius: coneRadius,
    targetEpoch: epoch,
    rows: result.rows.map((row) => projectGaiaRow(row, epoch)),
  };
}