// Bundle the already-verified SPHEREx products for deployment.
//
// Vercel's Node functions cannot spawn the Python sidecar (`sidecar/.venv` is
// git-ignored and is not part of a deployment). Instead of reprojecting at
// request time, commit the outputs of a local sidecar run under
// `data/spherex/derived/`; `vercel.json` includes `data/spherex/**` in the
// function bundle, and the product store verifies the bundle with the same
// manifest hashes, grid checks and output SHA-256s before serving it.
//
// Run a local request first so `.cache/spherex/derived/` exists:
//
//   npm run sidecar:setup
//   npm run dev            # open SPHEREx FIELD once, or let the acceptance do it
//   npm run spherex:bundle
//
// Re-run this whenever the demo manifest, the common grid or the sidecar
// changes, then commit `data/spherex/derived/`.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = process.env.SPHEREX_DERIVED_SOURCE
  ? path.resolve(process.env.SPHEREX_DERIVED_SOURCE)
  : path.join(root, '.cache', 'spherex', 'derived');
const outDir = path.join(root, 'data', 'spherex', 'derived');
const ROLES = ['epoch-a', 'epoch-b'];

function fail(message) {
  console.error(`spherex:bundle FAILED: ${message}`);
  process.exit(1);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const reportPath = path.join(sourceDir, 'report.json');
if (!existsSync(reportPath)) {
  fail(`no reprojection report at ${reportPath}. Run the SPHEREx field locally first.`);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (report.schema !== 'novochar.spherex.derived/v1') fail(`unexpected report schema "${report.schema}"`);
if (report.ok !== true) fail('the source report did not pass the sidecar gate');
if (report.gate?.spatial_alignment !== true) {
  fail('the source report did not establish spatial alignment, so it must not be bundled');
}

const products = new Map((report.products || []).map((entry) => [entry.role, entry]));
for (const role of ROLES) {
  if (!products.has(role)) fail(`the source report is missing role "${role}"`);
}

mkdirSync(outDir, { recursive: true });

for (const role of ROLES) {
  const entry = products.get(role);
  const file = path.join(sourceDir, `${role}_reprojected.fits`);
  if (!existsSync(file)) fail(`missing product ${file}`);
  const bytes = readFileSync(file);
  const actual = sha256(bytes);
  if (actual !== entry.output?.sha256) {
    fail(`${role} output hash ${actual} does not match the report's ${entry.output?.sha256}`);
  }
  writeFileSync(path.join(outDir, `${role}_reprojected.fits`), bytes);

  // Absolute developer paths must not leak into a committed artifact. Neither
  // field is used to locate the bundle at runtime (the role decides that).
  entry.input = { ...entry.input, path: `cutout-cache/${path.basename(entry.input?.path ?? `${role}.fits`)}` };
  entry.output = {
    ...entry.output,
    path: `data/spherex/derived/${role}_reprojected.fits`,
  };
  console.log(`  ${role}: ${actual} (${bytes.length} bytes)`);
}

const requestPath = path.join(sourceDir, 'request.json');
if (existsSync(requestPath)) {
  const request = JSON.parse(readFileSync(requestPath, 'utf8'));
  request.products = (request.products || []).map((product) => ({
    ...product,
    path: `cutout-cache/${path.basename(product.path ?? 'cutout.fits')}`,
  }));
  request.outputs = { ...request.outputs, dir: 'data/spherex/derived' };
  writeFileSync(path.join(outDir, 'request.json'), `${JSON.stringify(request, null, 2)}\n`);
  report.request = 'data/spherex/derived/request.json';
} else {
  delete report.request;
}

writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Bundled 2 verified products -> ${path.relative(root, outDir)}`);
