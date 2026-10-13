import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectGaiaRow, queryGaiaMotion } from './gaia.js';

test('Gaia proper motion projects coordinates to the requested epoch', () => {
  const moved = projectGaiaRow({ ra: 10, dec: 20, pmra: 1000, pmdec: -500, ref_epoch: 2016 }, 2026);
  assert.ok(moved.raAtEpoch > 10);
  assert.ok(moved.decAtEpoch < 20);
  assert.equal(moved.displacementMas, Math.hypot(10000, -5000));
  assert.equal(moved.referenceEpoch, 2016);
});

test('Gaia motion projection wraps right ascension and handles zero motion', () => {
  const moved = projectGaiaRow({ ra: 359.999, dec: 0, pmra: 0, pmdec: 0, ref_epoch: 2016 }, 2025);
  assert.equal(moved.raAtEpoch, 359.999);
  assert.equal(moved.decAtEpoch, 0);
});

test('Gaia projection flags missing proper motion instead of faking a zero solution', () => {
  // complete astrometry
  const full = projectGaiaRow({ ra: 10, dec: 20, pmra: 1000, pmdec: -500, ref_epoch: 2016 }, 2026);
  assert.equal(full.hasProperMotion, true);
  // missing components stay in place but are marked as lacking data
  const noPm = projectGaiaRow({ ra: 10, dec: 20, pmra: null, pmdec: null, ref_epoch: 2016 }, 2026);
  assert.equal(noPm.hasProperMotion, false);
  assert.equal(noPm.displacementMas, 0);
  assert.equal(noPm.raAtEpoch, 10);
  assert.equal(noPm.decAtEpoch, 20);
  // *measured* zero motion is legitimate data, distinct from "no data"
  const measuredZero = projectGaiaRow({ ra: 10, dec: 20, pmra: 0, pmdec: 0, ref_epoch: 2016 }, 2026);
  assert.equal(measuredZero.hasProperMotion, true);
  assert.equal(measuredZero.displacementMas, 0);
  // a single missing component is still flagged as incomplete
  const partial = projectGaiaRow({ ra: 10, dec: 20, pmra: 1000, pmdec: null, ref_epoch: 2016 }, 2026);
  assert.equal(partial.hasProperMotion, true);
  assert.ok(partial.displacementMas > 0);
});

test('Gaia motion projection rejects null sky coordinates', () => {
  assert.throws(() => projectGaiaRow({ ra: null, dec: 20 }, 2025), /non-null ra and dec/);
});

test('Gaia cone query builds bounded ADQL and returns epoch-projected rows', async () => {
  let requestedUrl;
  const votable = `<?xml version="1.0"?>
    <VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE>
    <FIELD name="source_id" datatype="long"/><FIELD name="ra" datatype="double"/>
    <FIELD name="dec" datatype="double"/><FIELD name="pmra" datatype="double"/>
    <FIELD name="pmdec" datatype="double"/><FIELD name="parallax" datatype="double"/>
    <FIELD name="phot_g_mean_mag" datatype="double"/><FIELD name="ref_epoch" datatype="double"/>
    <DATA><TABLEDATA><TR><TD>123</TD><TD>10</TD><TD>20</TD><TD>1000</TD><TD>-500</TD><TD>1</TD><TD>14</TD><TD>2016</TD></TR></TABLEDATA></DATA>
    </TABLE></RESOURCE></VOTABLE>`;
  const result = await queryGaiaMotion({
    ra: 10,
    dec: 20,
    radius: 0.2,
    targetEpoch: 2026,
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return { ok: true, text: async () => votable };
    },
  });
  const adql = requestedUrl.searchParams.get('QUERY');
  assert.match(adql, /TOP 500/);
  assert.match(adql, /gaiadr3\.gaia_source/);
  assert.match(adql, /CIRCLE\('ICRS', 10, 20, 0\.2\)/);
  assert.equal(result.status, 'OK');
  assert.equal(result.count, 1);
  assert.ok(result.rows[0].raAtEpoch > 10);
});

test('Gaia cone query rejects invalid coordinates and oversized radius', async () => {
  await assert.rejects(() => queryGaiaMotion({ ra: 361, dec: 20 }), /ra must be between/);
  await assert.rejects(() => queryGaiaMotion({ ra: 10, dec: 20, radius: 2 }), /radius must be between/);
});