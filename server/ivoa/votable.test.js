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

test('BINARY defaults to network byte order and parses signed integers, floats, and unsigned bytes', () => {
  const fields = [
    { name: 'signed_int', datatype: 'int' },
    { name: 'signed_short', datatype: 'short' },
    { name: 'flux', datatype: 'float' },
    { name: 'identifier', datatype: 'long' },
    { name: 'flag', datatype: 'unsignedByte' },
  ];
  const bytes = new ArrayBuffer(19);
  const view = new DataView(bytes);
  view.setInt32(0, -123456, false);
  view.setInt16(4, -321, false);
  view.setFloat32(6, 1.25, false);
  view.setBigInt64(10, 9007199254740993n, false);
  view.setUint8(18, 255);
  const b64 = Buffer.from(bytes).toString('base64');
  assert.deepEqual(decodeBinaryRows(b64, fields), [{
    signed_int: -123456,
    signed_short: -321,
    flux: 1.25,
    identifier: '9007199254740993',
    flag: 255,
  }]);

  const xml = `<VOTABLE><RESOURCE><TABLE>
    ${fields.map((f) => `<FIELD name="${f.name}" datatype="${f.datatype}"/>`).join('')}
    <DATA><BINARY><STREAM encoding="base64">${b64}</STREAM></BINARY></DATA>
  </TABLE></RESOURCE></VOTABLE>`;
  assert.deepEqual(parseVOTable(xml)[0].rows[0].flag, 255, 'VOTable BINARY parser uses network byte order and unsigned-byte conversion');
});

test('TABLEDATA converts unsignedByte after datatype normalization', () => {
  const xml = '<VOTABLE><RESOURCE><TABLE><FIELD name="u" datatype="unsignedByte"/><DATA><TABLEDATA><TR><TD>255</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  assert.equal(parseVOTable(xml)[0].rows[0].u, 255);
});

test('TABLEDATA preserves VOTable 64-bit integers beyond JavaScript safe precision', () => {
  const xml = '<VOTABLE><RESOURCE><TABLE><FIELD name="id" datatype="long"/><DATA><TABLEDATA><TR><TD>9007199254740993</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  assert.equal(parseVOTable(xml)[0].rows[0].id, '9007199254740993');
});

test('BINARY booleans decode their specified ASCII values rather than any nonzero byte', () => {
  const fields = [{ name: 'yes', datatype: 'boolean' }, { name: 'no', datatype: 'boolean' }, { name: 'missing', datatype: 'boolean' }];
  const bytes = Buffer.from([0x54, 0x30, 0x3f]).toString('base64'); // T, 0, ?
  assert.deepEqual(decodeBinaryRows(bytes, fields), [{ yes: true, no: false, missing: null }]);
});

test('BINARY fixed numeric arrays decode every element and keep following fields aligned', () => {
  const fields = [
    { name: 'flux', datatype: 'float', arraysize: '3' },
    { name: 'marker', datatype: 'int' },
  ];
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  [1, 2, 3].forEach((value, index) => view.setFloat32(index * 4, value, false));
  view.setInt32(12, 42, false);
  [-1, -2, -3].forEach((value, index) => view.setFloat32(16 + index * 4, value, false));
  view.setInt32(28, 7, false);
  const b64 = Buffer.from(buffer).toString('base64');
  assert.deepEqual(decodeBinaryRows(b64, fields), [
    { flux: [1, 2, 3], marker: 42 },
    { flux: [-1, -2, -3], marker: 7 },
  ]);
  const xml = `<VOTABLE><RESOURCE><TABLE>
    <FIELD name="flux" datatype="float" arraysize="3"/><FIELD name="marker" datatype="int"/>
    <DATA><BINARY><STREAM encoding="base64">${b64}</STREAM></BINARY></DATA>
  </TABLE></RESOURCE></VOTABLE>`;
  assert.deepEqual(parseVOTable(xml)[0].rows[1], { flux: [-1, -2, -3], marker: 7 });
});

test('BINARY variable numeric arrays use the element-count prefix and preserve row alignment', () => {
  const fields = [
    { name: 'samples', datatype: 'short', arraysize: '4*' },
    { name: 'marker', datatype: 'int' },
  ];
  const bytes = new Uint8Array([
    0, 0, 0, 3, 0, 10, 0, 20, 0, 30, 0, 0, 0, 99,
    0, 0, 0, 2, 255, 254, 0, 5, 255, 255, 255, 252,
  ]);
  const b64 = Buffer.from(bytes).toString('base64');
  assert.deepEqual(decodeBinaryRows(b64, fields), [
    { samples: [10, 20, 30], marker: 99 },
    { samples: [-2, 5], marker: -4 },
  ]);
});

test('BINARY rejects malformed and truncated arrays instead of returning corrupted rows', () => {
  assert.throws(
    () => decodeBinaryRows(Buffer.from([0, 0, 0, 1]).toString('base64'), [{ name: 'x', datatype: 'float', arraysize: '0' }]),
    /Invalid VOTable arraysize/,
  );
  assert.throws(
    () => decodeBinaryRows(Buffer.from([0x3f, 0x80, 0]).toString('base64'), [{ name: 'x', datatype: 'float', arraysize: '2' }]),
    /Truncated VOTable binary value/,
  );
});

test('BINARY decodes fixed char and Unicode character arrays as strings', () => {
  const fields = [
    { name: 'label', datatype: 'char', arraysize: '6' },
    { name: 'unicode', datatype: 'unicodeChar', arraysize: '4' },
    { name: 'n', datatype: 'int' },
  ];
  const bytes = new Uint8Array(18);
  bytes.set([0x41, 0x42, 0x43, 0x44, 0x20, 0x20], 0);
  const view = new DataView(bytes.buffer);
  [0x00c5, 0x6c34, 0x0020, 0x0020].forEach((code, index) => view.setUint16(6 + index * 2, code, false));
  view.setInt32(14, 7, false);
  const b64 = Buffer.from(bytes).toString('base64');
  const xml = `<VOTABLE><RESOURCE><TABLE>
    <FIELD name="label" datatype="char" arraysize="6"/>
    <FIELD name="unicode" datatype="unicodeChar" arraysize="4"/>
    <FIELD name="n" datatype="int"/>
    <DATA><BINARY><STREAM encoding="base64">${b64}</STREAM></BINARY></DATA>
  </TABLE></RESOURCE></VOTABLE>`;
  assert.deepEqual(parseVOTable(xml)[0].rows, [{ label: 'ABCD  ', unicode: 'Å水  ', n: 7 }]);
});

test('BINARY2 decodes fixed char and Unicode character arrays and keeps trailing spaces', () => {
  const bytes = new Uint8Array(19);
  bytes[0] = 0; // no BINARY2 null flags set
  bytes.set([0x41, 0x42, 0x43, 0x44, 0x20, 0x20], 1);
  const view = new DataView(bytes.buffer);
  [0x00c5, 0x6c34, 0x0020, 0x0020].forEach((code, index) => view.setUint16(7 + index * 2, code, false));
  view.setInt32(15, 9, false);
  const b64 = Buffer.from(bytes).toString('base64');
  const xml = `<VOTABLE><RESOURCE><TABLE>
    <FIELD name="label" datatype="char" arraysize="6"/>
    <FIELD name="unicode" datatype="unicodeChar" arraysize="4"/>
    <FIELD name="n" datatype="int"/>
    <DATA><BINARY2><STREAM encoding="base64">${b64}</STREAM></BINARY2></DATA>
  </TABLE></RESOURCE></VOTABLE>`;
  assert.deepEqual(parseVOTable(xml)[0].rows, [{ label: 'ABCD  ', unicode: 'Å水  ', n: 9 }]);
});

test('TABLEDATA preserves character-array leading and trailing whitespace', () => {
  const xml = '<VOTABLE><RESOURCE><TABLE><FIELD name="label" datatype="char" arraysize="8"/><DATA><TABLEDATA><TR><TD>ABCD    </TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  assert.equal(parseVOTable(xml)[0].rows[0].label, 'ABCD    ');
});

test('TABLEDATA decodes fixed and variable numeric arrays as typed lists', () => {
  const xml = `<VOTABLE><RESOURCE><TABLE>
    <FIELD name="fixed" datatype="float" arraysize="3"/>
    <FIELD name="variable" datatype="int" arraysize="4*"/>
    <DATA><TABLEDATA>
      <TR><TD>1.5 2.5 3.5</TD><TD>10 20</TD></TR>
      <TR><TD>-1 0 1</TD><TD>-7 8 9 10</TD></TR>
    </TABLEDATA></DATA>
  </TABLE></RESOURCE></VOTABLE>`;
  assert.deepEqual(parseVOTable(xml)[0].rows, [
    { fixed: [1.5, 2.5, 3.5], variable: [10, 20] },
    { fixed: [-1, 0, 1], variable: [-7, 8, 9, 10] },
  ]);
});

test('TABLEDATA rejects arrays whose declared shape does not match their values', () => {
  const xml = '<VOTABLE><RESOURCE><TABLE><FIELD name="v" datatype="float" arraysize="3"/><DATA><TABLEDATA><TR><TD>1 2</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  assert.throws(() => parseVOTable(xml), /arraysize is "3"/);
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
