// Verify the committed SPHEREx deployment bundle without Python or network.
//
// This runs the same store path a Vercel function uses: an empty cache, no
// usable interpreter, no archive access. The bundle must verify against the
// manifest, the agreed grid and its own output SHA-256s, and both rasters must
// decode at the declared wire length.
//
// Run with: npm run check:spherex-bundle

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProductStore } from '../server/store/spherex-products.js';

const cacheDir = await mkdtemp(path.join(tmpdir(), 'novochar-spherex-bundle-'));

function fail(message) {
  console.error(`check:spherex-bundle FAILED: ${message}`);
  process.exitCode = 1;
}

try {
  const store = createProductStore({
    cacheDir,
    pythonBin: path.join(cacheDir, 'no-python-here'),
    fetchImpl: async () => {
      throw new Error('the deployment bundle must not need the archive');
    },
  });

  const meta = await store.metadata();
  if (meta.epochs?.length !== 2) throw new Error(`expected 2 epochs, got ${meta.epochs?.length ?? 0}`);
  if (meta.schema !== 'novochar.spherex.derived/v1') throw new Error(`unexpected schema ${meta.schema}`);
  if (meta.gate?.spatial_alignment !== true) throw new Error('the bundle did not establish spatial alignment');
  if (meta.gate?.quantitative_difference_enabled !== false) {
    throw new Error('the bundle must keep quantitative differences disabled');
  }

  for (const epoch of meta.epochs) {
    const raster = await store.raster(epoch.role);
    const [width, height] = epoch.derived.shape;
    if (raster.width !== width || raster.height !== height) {
      throw new Error(`${epoch.role} raster is ${raster.width}x${raster.height}, metadata says ${width}x${height}`);
    }
    if (raster.bytes.length !== width * height * 5) {
      throw new Error(`${epoch.role} raster is ${raster.bytes.length} bytes, wire format requires ${width * height * 5}`);
    }
    console.log(`  ${epoch.role}: ${width}x${height}, ${raster.bytes.length} bytes, sha256 ${raster.sha256.slice(0, 12)}…`);
  }

  console.log(`SPHEREx deployment bundle verified: ${meta.epochs.length} epochs, no Python, no network.`);
} catch (err) {
  fail(err?.message ?? String(err));
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
