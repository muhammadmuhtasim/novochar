import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const dist = join(import.meta.dirname, '..', 'client', 'dist');
const html = await readFile(join(dist, 'index.html'), 'utf8');
const assetDir = join(dist, 'assets');
const assetNames = await readdir(assetDir);
const initialScripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const initialPreloads = [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
const initialJavaScript = [...initialScripts, ...initialPreloads].filter((src) => /\.m?js(?:\?|$)/.test(src));

assert.equal(initialScripts.length, 1, 'expected one initial JavaScript entry');
assert.equal(initialJavaScript.length, 1, 'heavy JavaScript must remain out of initial HTML');
assert.ok(!/three\.module|SkyViewer|CelestialExplore|Space3DCanvas/.test(initialJavaScript.join(' ')), '3D feature code must stay deferred');

const entryPath = join(dist, initialJavaScript[0].replace(/^\//, ''));
const entry = await readFile(entryPath);
const entrySize = entry.byteLength;
const gzipSize = gzipSync(entry).byteLength;
assert.ok(entrySize <= 200_000, `entry bundle ${entrySize} exceeds 200,000-byte budget`);
assert.ok(gzipSize <= 60_000, `gzip entry ${gzipSize} exceeds 60,000-byte budget`);

for (const feature of ['SkyViewer-', 'CelestialExplore-', 'Space3DCanvas-', 'Catalogue-', 'BlinkComparator-', 'SpectraView-', 'IvoaLab-', 'DataSources-', 'three.module-']) {
  assert.ok(assetNames.some((name) => name.startsWith(feature)), `missing deferred output chunk: ${feature}`);
}

const markupRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((src) => src.startsWith('/'));
assert.ok(markupRefs.every((src) => src.startsWith('/assets/')), 'initial document references an unexpected local asset');
assert.ok(!markupRefs.some((src) => src.includes('objects.json')), 'catalogue data must not be fetched by the landing document');

const objectData = join(dist, 'data', 'objects.json');
const objectDataSize = (await stat(objectData)).size;
console.log(JSON.stringify({
  entry: initialJavaScript[0],
  entryBytes: entrySize,
  gzipBytes: gzipSize,
  budgetsBytes: { entry: 200_000, gzip: 60_000 },
  deferredChunks: ['SkyViewer', 'CelestialExplore', 'Space3DCanvas', 'Catalogue', 'BlinkComparator', 'SpectraView', 'IvoaLab', 'DataSources', 'Three.js'],
  catalogueJsonBytes: objectDataSize,
  initialHtmlHasCatalogueRequest: false,
}, null, 2));
