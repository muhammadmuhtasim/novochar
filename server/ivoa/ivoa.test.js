// Unit tests for the IVOA clients (TAP / SIA2 / SSA / resolver).
//
// No network is touched: an injectable fetch returns canned VOTable / JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tapQuery, TAP_ENDPOINTS, resolveEndpoint } from './tap.js';
import { querySIA2 } from './sia2.js';
import { querySSA } from './ssa.js';
import { resolveObject, coordinatesFromRow, coordinatesFromSesameXML, coordinatesFromSesameAscii } from './resolver.js';
import { firstTableRows } from './votable.js';

const VOTABLE = `<?xml version="1.0"?>
<VOTABLE version="1.4">
<RESOURCE name="cats">
<INFO name="QUERY_STATUS" value="OK"/>
<TABLE>
<FIELD name="objID" datatype="long"/>
<FIELD name="ra" datatype="double" unit="deg"/>
<FIELD name="dec" datatype="double" unit="deg"/>
<FIELD name="gmag" datatype="float"/>
<DATA><TABLEDATA>
<TR><TD>123</TD><TD>83.6330</TD><TD>22.0145</TD><TD>15.2</TD></TR>
<TR><TD>456</TD><TD>83.7000</TD><TD>22.1000</TD><TD></TD></TR>
</TABLEDATA></DATA>
</TABLE>
</RESOURCE>
</VOTABLE>`;

// A tiny fetch stub.
function stubFetch(options) {
  return async (url, _init) => {
    if (options.url) assert.match(url, options.url);
    return {
      ok: true,
      status: 200,
      async text() {
        return options.body ?? VOTABLE;
      },
      async json() {
        return options.json ?? {};
      },
    };
  };
}

test('tapQuery parses a VOTable and issues a well-formed ADQL GET', async () => {
  const out = await tapQuery({
    endpoint: 'vizier',
    query: 'SELECT TOP 5 * FROM "I/345/gaia2"',
    limit: 20,
    fetchImpl: stubFetch({ url: /TAPVizieR/ }),
  });
  // fetch stub doesn't expose url, but the parsed rows are the point:
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.rows[0], { objID: 123, ra: 83.633, dec: 22.0145, gmag: 15.2 });
  assert.equal(out.rows[1].gmag, null);
  // firstTableRows helper agrees
  assert.equal(firstTableRows(VOTABLE).length, 2);
});

test('tapQuery prepends SELECT TOP when a limit is given', async () => {
  let capturedQuery = null;
  const fetchImpl = async (url) => {
    capturedQuery = url; // full GET URL
    return { ok: true, status: 200, text: async () => VOTABLE, json: async () => ({}) };
  };
  await tapQuery({ endpoint: 'vizier', query: 'SELECT * FROM "I/345/gaia2"', limit: 5, fetchImpl });
  const u = new URL(capturedQuery);
  assert.equal(u.searchParams.get('REQUEST'), 'doQuery');
  assert.equal(u.searchParams.get('LANG'), 'ADQL');
  assert.equal(u.searchParams.get('FORMAT'), 'votable');
  assert.equal(u.searchParams.get('QUERY'), 'SELECT TOP 5 * FROM "I/345/gaia2"');
});

test('resolveEndpoint resolves registry keys and passes URLs through', () => {
  assert.equal(resolveEndpoint('vizier', TAP_ENDPOINTS), TAP_ENDPOINTS.vizier);
  assert.equal(resolveEndpoint('https://example.org/tap', TAP_ENDPOINTS), 'https://example.org/tap');
  assert.throws(() => resolveEndpoint('nope', TAP_ENDPOINTS));
});

test('querySIA2 returns image-footprint rows and first record', async () => {
  const out = await querySIA2({
    endpoint: 'irsa',
    pos: '83.63 22.01',
    size: 0.05,
    fetchImpl: stubFetch({}),
  });
  assert.equal(out.rows.length, 2);
  assert.equal(out.first.ra, 83.633);
  assert.ok(out.resources.length >= 1);
});

test('querySSA returns spectrum rows', async () => {
  const out = await querySSA({ endpoint: 'mast', pos: '83.63 22.01', fetchImpl: stubFetch({}) });
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].objID, 123);
});

test('resolver: Sesame ASCII gives coordinates from %J line', () => {
  const body = '#=Sc=Simbad\n%J 83.63240000 +22.01740000 = 05 34 31.8 +22 01 03\n';
  assert.deepEqual(coordinatesFromSesameAscii(body), { ra: 83.6324, dec: 22.0174 });
  assert.equal(coordinatesFromSesameAscii('nothing here'), null);
});

test('resolver: resolveObject resolves a name via Sesame', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '#=Sc=Simbad\n%J 83.63240000 +22.01740000\n' });
  const r = await resolveObject('M1', { fetchImpl });
  assert.equal(r.found, true);
  assert.equal(r.service, 'sesame');
  assert.equal(r.ra, 83.6324);
  assert.equal(r.dec, 22.0174);
});

test('resolver: resolveObject graceful miss when Sesame has no coords', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '#! *** Nothing found ***' });
  const r = await resolveObject('not-a-real-object-xyz', { service: 'sesame', fetchImpl });
  assert.equal(r.found, false);
});

test('resolver: Sesame XML gives coordinates from jradeg/jdedeg', () => {
  assert.deepEqual(coordinatesFromSesameXML('<jradeg>83.633083</jradeg><jdedeg>22.0145</jdedeg>'), { ra: 83.633083, dec: 22.0145 });
  assert.equal(coordinatesFromSesameXML('<Sesame></Sesame>'), null);
  assert.equal(coordinatesFromSesameXML(''), null);
});

test('coordinatesFromRow extracts RA/Dec robustly', () => {
  assert.deepEqual(coordinatesFromRow({ RA: 12.3, DEC: -45.6 }), { ra: 12.3, dec: -45.6 });
  assert.equal(coordinatesFromRow({ foo: 1, bar: 2 }), null);
});
test('probeArchive returns truthful probe results for a stubbed archive', async () => {
  const { probeArchive } = await import('./probe.js');
  const out = await probeArchive('vizier', { fetchImpl: stubFetch({}) });
  assert.equal(out.key, 'vizier');
  assert.equal(out.protocols.tap.ok, true);
  assert.equal(out.protocols.tap.status, 'OK');
  assert.equal(out.protocols.tap.rows, 2);
  assert.equal(out.ok, true);
});

test('probeArchive does not count an empty TAP result as live data', async () => {
  const { probeArchive } = await import('./probe.js');
  const empty = '<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE><FIELD name="id" datatype="int"/><DATA><TABLEDATA></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  const out = await probeArchive('vizier', { fetchImpl: stubFetch({ body: empty }) });
  assert.equal(out.protocols.tap.status, 'OK');
  assert.equal(out.protocols.tap.rows, 0);
  assert.equal(out.protocols.tap.ok, false);
  assert.equal(out.ok, false);
});
