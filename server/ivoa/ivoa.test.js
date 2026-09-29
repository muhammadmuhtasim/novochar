// Unit tests for the IVOA clients (TAP / SIA2 / SSA / resolver).
//
// No network is touched: an injectable fetch returns canned VOTable / JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tapQuery, TAP_ENDPOINTS, resolveEndpoint } from './tap.js';
import { querySIA2 } from './sia2.js';
import { querySSA } from './ssa.js';
import { resolveObject, coordinatesFromRow } from './resolver.js';
import { firstTableRows } from './votable.js';

const VOTABLE = `<?xml version="1.0"?>
<VOTABLE version="1.4">
<RESOURCE name="cats">
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

test('resolver: SIMBAD JSON gives typed coordinates + aliases', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => '{}',
    json: async () => ({
      id: ['M 1', 'NGC 1952', '3C 144'],
      ra: '83.633083',
      dec: '22.014500',
      types: ['Rad'],
      errorcode: 'No',
    }),
  });
  const r = await resolveObject('M1', { fetchImpl });
  assert.equal(r.found, true);
  assert.equal(r.ra, 83.633083);
  assert.equal(r.dec, 22.0145);
  assert.equal(r.types[0], 'Rad');
  assert.ok(r.aliases.includes('NGC 1952'));
});

test('resolver: SIMBAD not-found returns a graceful miss', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => '{}',
    json: async () => ({ errorcode: 'id-not-found' }),
  });
  const r = await resolveObject('not-a-real-object-xyz', { fetchImpl });
  assert.equal(r.found, false);
  assert.equal(r.reason, 'id-not-found');
});

test('resolver: Sesame VOTable gives coordinates from its main row', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => VOTABLE, json: async () => ({}) });
  const r = await resolveObject('M1', { service: 'sesame', fetchImpl });
  assert.equal(r.found, true);
  assert.equal(r.ra, 83.633);
  assert.equal(r.dec, 22.0145);
});

test('coordinatesFromRow extracts RA/Dec robustly', () => {
  assert.deepEqual(coordinatesFromRow({ RA: 12.3, DEC: -45.6 }), { ra: 12.3, dec: -45.6 });
  assert.equal(coordinatesFromRow({ foo: 1, bar: 2 }), null);
});