import { dartsFileUrl, lambdaFileUrl, mastProductUrl, queryArchiveSource } from './source-adapters.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('MAST cone adapter posts documented CAOM request and normalizes rows', async () => {
  let sent;
  const result = await queryArchiveSource({
    archive: 'mast',
    operation: 'cone',
    params: { ra: 10, dec: -20, radius: 0.1, page: 2, pagesize: 25 },
    fetchImpl: async (url, init) => {
      sent = { url, init, body: new URLSearchParams(init.body).get('request') };
      return { ok: true, json: async () => ({ status: 'COMPLETE', fields: [{ name: 'obsid' }], data: [{ obsid: 1 }] }) };
    },
  });
  assert.equal(sent.url, 'https://mast.stsci.edu/api/v0/invoke');
  assert.equal(sent.init.method, 'POST');
  const request = JSON.parse(sent.body);
  assert.equal(request.service, 'Mast.Caom.Cone');
  assert.deepEqual(request.params, { ra: 10, dec: -20, radius: 0.1 });
  assert.equal(request.page, 2);
  assert.equal(request.pagesize, 25);
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].obsid, 1);
});

test('MAST adapter rejects invalid coordinate queries before network access', async () => {
  await assert.rejects(
    () => queryArchiveSource({ archive: 'mast', operation: 'cone', params: { ra: 400, dec: 0 } }),
    /ra must be between/
  );
});

test('NED adapter returns live SRS preferred object as a row', async () => {
  let requested;
  const result = await queryArchiveSource({
    archive: 'ned',
    operation: 'name',
    params: { name: 'M31' },
    fetchImpl: async (url) => {
      requested = new URL(url);
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ Preferred: { Name: 'Messier 031', Position: { RA: 10.68, Dec: 41.27 } } }),
      };
    },
  });
  assert.equal(requested.searchParams.get('name'), 'M31');
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].Position.RA, 10.68);
});

test('LAMBDA redirects stay rooted in public data paths', () => {

  test('DARTS redirects stay rooted in the official public data host', () => {
    assert.equal(dartsFileUrl('akari/catalog/source.fits'), 'https://data.darts.isas.jaxa.jp/pub/akari/catalog/source.fits');
    assert.throws(() => dartsFileUrl('../outside.fits'), /valid relative/);
  });
  assert.equal(lambdaFileUrl('/planck/data/file.fits'), 'https://lambda.gsfc.nasa.gov/data/planck/data/file.fits');
  assert.throws(() => lambdaFileUrl('../private/file'), /valid relative/);
  assert.throws(() => lambdaFileUrl('https://attacker.example/file'), /valid relative/);
});

test('DARTS index adapter fetches the official public data root', async () => {
  let requested;
  const result = await queryArchiveSource({
    archive: 'darts',
    operation: 'index',
    fetchImpl: async (url) => {
      requested = url;
      return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<a href="akari/">akari</a>' };
    },
  });
  assert.equal(requested, 'https://data.darts.isas.jaxa.jp/pub/');
  assert.equal(result.archive, 'darts');
  assert.match(result.content, /akari/);
});

test('MAST download URL accepts only provider-issued MAST URIs', () => {
  assert.equal(mastProductUrl('mast:JWST/product/file.fits'), 'https://mast.stsci.edu/api/v0.1/Download/file?uri=mast%3AJWST%2Fproduct%2Ffile.fits');
  assert.throws(() => mastProductUrl('https://attacker.example/file'), /valid MAST dataURI/);
});

test('registry discovery query returns a uniform archive envelope', async () => {
  let queryUrl;
  const xml = '<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE><FIELD name="ivoid" datatype="char"/><FIELD name="access_url" datatype="char"/><DATA><TABLEDATA><TR><TD>ivo://example/service</TD><TD>https://example.org/tap</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  const result = await queryArchiveSource({
    archive: 'darts',
    operation: 'discover',
    params: { term: 'DARTS' },
    fetchImpl: async (url) => {
      queryUrl = new URL(url);
      return { ok: true, text: async () => xml };
    },
  });
  assert.match(queryUrl.searchParams.get('QUERY'), /ivo_hasword/);
  assert.equal(result.status, 'OK');
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].access_url, 'https://example.org/tap');
});

test('ESA TAP query resolves the IVOID from RegTAP before querying it', async () => {
  const requested = [];
  const registryVotable = '<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE><FIELD name="ivoid" datatype="char"/><FIELD name="standard_id" datatype="char"/><FIELD name="access_url" datatype="char"/><DATA><TABLEDATA><TR><TD>ivo://esavo/psa/epntap</TD><TD>ivo://ivoa.net/std/tap</TD><TD>https://psa.esa.int/psa-tap/tap</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  const rowsVotable = '<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE><FIELD name="table_name" datatype="char"/><DATA><TABLEDATA><TR><TD>epn_core</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  const result = await queryArchiveSource({
    archive: 'esdc',
    operation: 'tap',
    params: { ivoid: 'ivo://esavo/psa/epntap', query: 'SELECT TOP 1 * FROM TAP_SCHEMA.tables' },
    fetchImpl: async (url) => {
      requested.push(new URL(url));
      return { ok: true, text: async () => requested.length === 1 ? registryVotable : rowsVotable };
    },
  });
  assert.equal(requested.length, 2);
  assert.equal(requested[0].hostname, 'dc.g-vo.org');
  assert.equal(requested[1].hostname, 'psa.esa.int');
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].table_name, 'epn_core');
});

test('registry-backed TAP rejects endpoints outside the archive domain allowlist', async () => {
  const registryVotable = '<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE><FIELD name="ivoid" datatype="char"/><FIELD name="standard_id" datatype="char"/><FIELD name="access_url" datatype="char"/><DATA><TABLEDATA><TR><TD>ivo://esavo/psa/epntap</TD><TD>ivo://ivoa.net/std/tap</TD><TD>https://attacker.example/tap</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>';
  await assert.rejects(
    () => queryArchiveSource({
      archive: 'esdc', operation: 'tap',
      params: { ivoid: 'ivo://esavo/psa/epntap', query: 'SELECT TOP 1 * FROM x' },
      fetchImpl: async () => ({ ok: true, text: async () => registryVotable }),
    }),
    /no registered HTTPS TAP endpoint/
  );
});