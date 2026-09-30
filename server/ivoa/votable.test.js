// Unit tests for the IVOA VOTable parser.
//
//   node --test astro/../ivoa/votable.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVOTable,
  firstTableRows,
  parseTagAttributes,
  extractFields,
  extractRows,
  decodeBinaryRows,
  queryStatus,
} from './votable.js';

const SAMPLE = `<?xml version="1.0"?>
<VOTABLE version="1.4" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">
<RESOURCE name="demo">
<TABLE>
<FIELD name="ID" datatype="int" ucd="meta.id" unit="" />
<FIELD name="RA" datatype="double" unit="deg" ucd="pos.eq.ra"/>
<FIELD name="MAG" datatype="float" />
<DATA>
<TABLEDATA>
<TR><TD>1</TD><TD>10.5</TD><TD>18.2</TD></TR>
<TR><TD>2</TD><TD>10.6</TD><TD></TD></TR>
</TABLEDATA>
</DATA>
</TABLE>
</RESOURCE>
<VOTABLE>`;

test('parseTagAttributes handles quoted attributes', () => {
  const a = parseTagAttributes('<FIELD name="RA" datatype=\'double\' ucd="pos.eq.ra"/>');
  assert.equal(a.name, 'RA');
  assert.equal(a.datatype, 'double');
  assert.equal(a.ucd, 'pos.eq.ra');
});

test('extractFields reads field metadata in order', () => {
  const body = '<RESOURCE name="x"><TABLE><FIELD name="ID" datatype="int"/><FIELD name="RA" datatype="double" unit="deg"/></TABLE></RESOURCE>';
  const fields = extractFields(body);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].name, 'ID');
  assert.deepEqual(fields[1], { name: 'RA', datatype: 'double', unit: 'deg', ucd: null, arraysize: null, nullValue: null });
});

test('parseVOTable returns typed rows with typed (null) empties', () => {
  const resources = parseVOTable(SAMPLE);
  assert.equal(resources.length, 1);
  const [r] = resources;
  assert.equal(r.name, 'demo');
  assert.equal(r.fields.length, 3);
  assert.deepEqual(r.rows[0], { ID: 1, RA: 10.5, MAG: 18.2 });
  assert.deepEqual(r.rows[1], { ID: 2, RA: 10.6, MAG: null });
});

test('firstTableRows flattens across resources', () => {
  const rows = firstTableRows(SAMPLE);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].RA, 10.5);
});

test('no TABLEDATA means no rows', () => {
  const xml = '<VOTABLE><RESOURCE><TABLE><FIELD name="A" datatype="int"/></TABLE></RESOURCE></VOTABLE>';
  assert.deepEqual(extractRows('<TABLE><FIELD name="A" datatype="int"/></TABLE>', [{ name: 'A', datatype: 'int' }]), []);
  assert.equal(parseVOTable(xml)[0].rows.length, 0);
});

test('queryStatus extracts the VOTable QUERY_STATUS', () => {
  assert.equal(queryStatus('<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/></RESOURCE></VOTABLE>'), 'OK');
  assert.equal(queryStatus('<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="ERROR">bad</INFO></RESOURCE></VOTABLE>'), 'ERROR');
  assert.equal(queryStatus('<VOTABLE/>'), null);
});

test('decodeBinaryRows decodes BINARY2 (big-endian) fixed rows', () => {
  const fields = [
    { name: 'id', datatype: 'long', arraysize: null },
    { name: 'ra', datatype: 'double', arraysize: null },
    { name: 'dec', datatype: 'double', arraysize: null },
  ];
  const dv = new DataView(new ArrayBuffer(24));
  dv.setBigInt64 ? dv.setBigInt64(0, 9007199254740993n, false) : dv.setUint32(0, 1, false);
  dv.setFloat64(8, 90.5, false);
  dv.setFloat64(16, -20.25, false);
  const raw = new Uint8Array(dv.buffer);
  const b64 = Buffer.from(raw).toString('base64');
  const rows = decodeBinaryRows(b64, fields, 'be');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ra, 90.5);
  assert.equal(rows[0].dec, -20.25);
});

test('BINARY2 consumes row null flags and decodes 64-bit Gaia identifiers', () => {
  const fields = [
    { name: 'source_id', datatype: 'long', arraysize: null },
    { name: 'ra', datatype: 'double', arraysize: null },
    { name: 'pmra', datatype: 'double', arraysize: null },
    { name: 'ref_epoch', datatype: 'double', arraysize: null },
  ];
  const buffer = new ArrayBuffer(33);
  const bytes = new Uint8Array(buffer);
  bytes[0] = 1 << (7 - 2);
  const view = new DataView(buffer);
  view.setBigInt64(1, 1234567890123456789n, false);
  view.setFloat64(9, 84.25, false);
  view.setFloat64(17, 0, false);
  view.setFloat64(25, 2016, false);
  const rows = decodeBinaryRows(Buffer.from(bytes).toString('base64'), fields, 'be', true);
  assert.deepEqual(rows, [{ source_id: '1234567890123456789', ra: 84.25, pmra: null, ref_epoch: 2016 }]);
});

test('nested RESOURCE does not truncate the inner TABLE', () => {
  const xml = '<VOTABLE><RESOURCE type="results"><RESOURCE><COOSYS ID="c"/></RESOURCE>' +
    '<TABLE><FIELD name="x" datatype="int"/><DATA><TABLEDATA><TR><TD>7</TD></TR></TABLEDATA></DATA></TABLE>' +
    '</RESOURCE></VOTABLE>';
  const r = parseVOTable(xml);
  assert.ok(r.length >= 1);
  const table = r.find((x) => x.rows.length > 0);
  assert.ok(table, 'table resource parsed');
  assert.equal(table.rows[0].x, 7);
});