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
  assert.deepEqual(fields[1], { name: 'RA', datatype: 'double', unit: 'deg', ucd: null, arraysize: null });
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