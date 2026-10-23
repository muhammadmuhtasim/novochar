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
import { createArchiveSkyService } from '../server/spherex/archive-sky.js';

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

  // The 3D explorer's archive mode is a second consumer of the same bundle.
  // Verify it here so a broken regional route fails the build, not production.
  const archive = createArchiveSkyService({ store });
  const archiveIndex = await archive.index();
  if (archiveIndex.mode !== 'archive') throw new Error('archive sky index is not in archive mode');
  if (archiveIndex.dataset?.globalCoverage !== false) throw new Error('archive sky must not claim full-sky coverage');
  if (archiveIndex.dataset?.regionOnly !== true) throw new Error('archive sky must declare its regional scope');
  if (archiveIndex.epochs?.length !== 2) throw new Error(`archive sky has ${archiveIndex.epochs?.length ?? 0} epochs`);
  if (archiveIndex.comparison?.quantitativeDifferenceEnabled !== false) {
    throw new Error('archive sky must keep quantitative differences disabled');
  }
  if (archiveIndex.surface?.x_axis_direction !== 'west') {
    throw new Error('archive sky must declare east-left image columns');
  }
  for (const epoch of archiveIndex.epochs) {
    const raster = await archive.render(epoch.id);
    if (raster.png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error(`${epoch.id} archive image is not a PNG`);
    }
    const [width, height] = epoch.shape;
    if (raster.width !== width || raster.height !== height) {
      throw new Error(`${epoch.id} archive PNG is ${raster.width}x${raster.height}`);
    }
    console.log(`  archive ${epoch.id}: ${raster.width}x${raster.height}, ${raster.png.length} bytes, ${raster.etag.slice(0, 14)}…`);
  }
  console.log(`Archive sky verified: ${archiveIndex.epochs.length} real epochs, shared stretch, no global coverage claim.`);
} catch (err) {
  fail(err?.message ?? String(err));
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
