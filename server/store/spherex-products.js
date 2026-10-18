// Layer 4 - Products: turn the two cached NEP cutouts into reprojected,
// viewer-ready products by deleging the pixel work to the Python sidecar.
//
// Responsibility split (docs/spherex-m3c-contracts.md, Contract 1):
//
//   Node     retrieval, cache, the target grid, every checksum, HTTP exposure
//   Sidecar  reprojection, and nothing else — it gets a request file and a list
//            of already-verified local FITS paths
//
// Nothing the sidecar claims is trusted on its own: Node re-hashes each output
// FITS, refuses to expose anything unless the sidecar's own gate passed, and
// records the request and report next to the outputs so the run is repeatable.
//
// The sidecar process is injected (`runSidecar`), so `npm test` never needs
// Python — the same separation the retrieval adapter already keeps with fetch.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cutoutKey,
  fetchCutout,
  normalizeFitsWcs,
  readFitsImage,
  readFitsStructure,
  sha256Hex,
} from '../ivoa/spherex.js';
import { getCutout, putCutout } from './spherex-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Stable roles for the demo pair. The manifest's own `label` is archive text. */
export const SIDECAR_ROLES = ['epoch-a', 'epoch-b'];

export const DERIVED_SCHEMA = 'novochar.spherex.derived/v1';
export const WIRE_FORMAT = 'novochar.spherex.raster/v1';

const METHOD = 'bilinear';
const SIDECAR_TIMEOUT_MS = 120_000;

// FITS is big-endian on disk; the wire format is little-endian. Every realistic
// deployment is little-endian, but the conversion is asserted rather than
// assumed so the payload can never be silently byte-swapped.
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x12345678]).buffer)[0] === 0x78;

/** A failure with a stable `code` the client can render honestly. */
export class ProductError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ProductError';
    this.code = code;
    this.detail = detail;
  }
}

const FAILED_CODES = {
  CUTOUT: 'cutout_unavailable',
  SIDECAR: 'sidecar_unavailable',
  REPROJECTION: 'reprojection_failed',
  PRODUCT: 'product_unavailable',
};

function isMissing(err) {
  return err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}

async function loadJson(file, what) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (isMissing(err)) {
      throw new ProductError('product_unavailable', `${what} is missing at ${file}`);
    }
    throw err;
  }
}

function requireFields(obj, fields, what) {
  for (const field of fields) {
    if (obj == null || obj[field] == null) {
      throw new ProductError('product_unavailable', `${what} is missing "${field}"`);
    }
  }
}

/**
 * Start the sidecar and collect its report. A non-zero exit, a timeout or an
 * unstartable binary all surface as `sidecar_unavailable`, which the client
 * shows as a retryable state rather than an empty image.
 */
function spawnSidecar({ pythonBin, script, requestPath, timeout = SIDECAR_TIMEOUT_MS, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(pythonBin, [script, '--request', requestPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new ProductError(FAILED_CODES.SIDECAR, `could not start the sidecar (${pythonBin}): ${err.message}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ProductError(FAILED_CODES.SIDECAR, `sidecar timed out after ${timeout} ms`));
    }, timeout);
    if (child.stdout) child.stdout.setEncoding('utf8');
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk; });
    if (child.stderr) child.stderr.setEncoding('utf8');
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ProductError(FAILED_CODES.SIDECAR, `sidecar failed to run: ${err.message}`, stderr.slice(-2000)));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new ProductError(
          FAILED_CODES.SIDECAR,
          `sidecar exited with code ${code}`,
          stderr.slice(-2000),
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Create the product store. Every dependency is injectable so the whole path is
 * testable offline.
 */
export function createProductStore({
  rootDir = REPO_ROOT,
  dataDir = path.join(rootDir, 'data', 'spherex'),
  cacheDir = process.env.VERCEL
  ? path.join('/tmp', 'novochar', 'spherex')
  : path.join(rootDir, '.cache', 'spherex'),
  sidecarScript = path.join(rootDir, 'sidecar', 'reproject_common.py'),
  pythonBin = process.env.SIDECAR_PYTHON || path.join(rootDir, 'sidecar', '.venv', 'bin', 'python'),
  runSidecar = spawnSidecar,
  fetchImpl = globalThis.fetch,
} = {}) {
  const derivedDir = path.join(cacheDir, 'derived');

  let manifestPromise = null;
  let gridPromise = null;
  let productsPromise = null;

  async function manifest() {
    if (!manifestPromise) {
      manifestPromise = (async () => {
        const m = await loadJson(path.join(dataDir, 'demo-manifest.json'), 'the SPHEREx demo manifest');
        requireFields(m, ['schema', 'field', 'product', 'observations', 'rights'], 'the SPHEREx demo manifest');
        if (!Array.isArray(m.observations) || m.observations.length !== SIDECAR_ROLES.length) {
          throw new ProductError(
            'product_unavailable',
            `the manifest must describe exactly ${SIDECAR_ROLES.length} observations, found ${m.observations?.length ?? 0}`,
          );
        }
        for (const obs of m.observations) {
          requireFields(obs, ['obs_id', 'detector', 'date_obs_utc', 'cutout_url', 'cutout_sha256', 'cutout_bytes'], 'an observation');
        }
        return m;
      })();
    }
    return manifestPromise;
  }

  async function grid() {
    if (!gridPromise) {
      gridPromise = (async () => {
        const g = await loadJson(path.join(dataDir, 'common-grid.json'), 'the common grid');
        requireFields(g, ['id', 'ra', 'dec', 'pixel_scale_arcsec', 'shape', 'rotation_deg'], 'the common grid');
        if (!Array.isArray(g.shape) || g.shape.length !== 2) {
          throw new ProductError('product_unavailable', 'the common grid must declare a 2D shape');
        }
        return g;
      })();
    }
    return gridPromise;
  }

  async function sidecarScriptSha256() {
    try {
      return await sha256Hex(new Uint8Array(await readFile(sidecarScript)));
    } catch (err) {
      if (isMissing(err)) {
        throw new ProductError(FAILED_CODES.SIDECAR, `the sidecar script is missing at ${sidecarScript}`);
      }
      throw err;
    }
  }

  /**
   * Make sure both cutouts are in the local cache with the manifest's checksums,
   * fetching on demand. Never trusts a cached copy on its own.
   */
  async function ensureCutouts() {
    const m = await manifest();
    await mkdir(cacheDir, { recursive: true });
    const entries = [];
    for (const [index, obs] of m.observations.entries()) {
      const role = SIDECAR_ROLES[index];
      const key = cutoutKey({
        obsId: obs.obs_id,
        detector: obs.detector,
        sizeDeg: m.field.requested_cutout_deg,
      });
      const file = path.join(cacheDir, `${key}.fits`);
      const cached = await getCutout(cacheDir, key);
      if (cached && !cached.corrupt && cached.actualSha256 === obs.cutout_sha256) {
        entries.push({ role, file });
        continue;
      }
      let fetched;
      try {
        fetched = await fetchCutout({ url: obs.cutout_url, fetchImpl });
      } catch (err) {
        throw new ProductError(
          FAILED_CODES.CUTOUT,
          `could not retrieve ${role} from the archive: ${err.message}`,
          obs.cutout_url,
        );
      }
      if (fetched.sha256 !== obs.cutout_sha256) {
        throw new ProductError(
          FAILED_CODES.CUTOUT,
          `${role} checksum differs from the manifest, so the archive is not reproducible for this cutout`,
          { expected: obs.cutout_sha256, actual: fetched.sha256 },
        );
      }
      await putCutout(cacheDir, key, fetched.bytes, {
        sourceUrl: obs.cutout_url,
        obsId: obs.obs_id,
        detector: obs.detector,
        sizeDeg: m.field.requested_cutout_deg,
        collection: m.release?.id ?? null,
        sha256: fetched.sha256,
      });
      entries.push({ role, file });
    }
    return entries;
  }

  /** A cached report is reusable only if it still describes exactly this run. */
  async function reportIsCurrent(report, { gridSpec, scriptSha }) {
    if (!report || report.schema !== DERIVED_SCHEMA) return false;
    if (report.grid?.id !== gridSpec.id) return false;
    if (report.grid?.pixel_scale_arcsec !== gridSpec.pixel_scale_arcsec) return false;
    if (report.grid?.rotation_deg !== gridSpec.rotation_deg) return false;
    if (report.grid?.ra !== gridSpec.ra || report.grid?.dec !== gridSpec.dec) return false;
    if (JSON.stringify(report.grid?.shape) !== JSON.stringify(gridSpec.shape)) return false;
    if (report.sidecar?.script_sha256 !== scriptSha) return false;
    if (!Array.isArray(report.products) || report.products.length !== SIDECAR_ROLES.length) return false;
    const m = await manifest();
    for (const [index, entry] of report.products.entries()) {
      if (entry.role !== SIDECAR_ROLES[index]) return false;
      if (entry.input?.sha256 !== m.observations[index].cutout_sha256) return false;
      if (!entry.output?.sha256) return false;
      try {
        const onDisk = await sha256Hex(new Uint8Array(await readFile(path.join(derivedDir, `${entry.role}_reprojected.fits`))));
        if (onDisk !== entry.output.sha256) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Run (or reuse) the reprojection for the demo pair.
   *
   * Idempotent: the request and report are stored beside the outputs, and a
   * cached run is reused only while the manifest hashes, the grid and the
   * sidecar script itself are unchanged.
   */
  async function ensureProducts() {
    if (productsPromise) return productsPromise;
    productsPromise = (async () => {
      const gridSpec = await grid();
      const scriptSha = await sidecarScriptSha256();
      const reportPath = path.join(derivedDir, 'report.json');

      try {
        const cached = await loadJson(reportPath, 'the cached reprojection report');
        if (await reportIsCurrent(cached, { gridSpec, scriptSha })) {
          return { report: cached, derivedDir, gridSpec };
        }
      } catch {
        // No usable cached run: fall through and reproject.
      }

      const m = await manifest();
      const cutouts = await ensureCutouts();
      await mkdir(derivedDir, { recursive: true });

      const request = {
        // `shape` is [nx, ny] — NAXIS1 first, as `build_target_grid` reads it
        // (`nx, ny = spec["shape"][0], spec["shape"][1]`). common-grid.json
        // records it in that same order, so nothing has to translate.
        grid: {
          ra: gridSpec.ra,
          dec: gridSpec.dec,
          pixel_scale_arcsec: gridSpec.pixel_scale_arcsec,
          shape: gridSpec.shape,
          rotation_deg: gridSpec.rotation_deg,
        },
        method: METHOD,
        products: cutouts.map((entry, index) => ({
          role: entry.role,
          path: entry.file,
          sha256: m.observations[index].cutout_sha256,
        })),
        outputs: { dir: derivedDir, write: true },
      };
      const requestPath = path.join(derivedDir, 'request.json');
      await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);

      const { stdout } = await runSidecar({
        pythonBin,
        script: sidecarScript,
        requestPath,
        timeout: SIDECAR_TIMEOUT_MS,
      });

      let report;
      try {
        report = JSON.parse(stdout);
      } catch (err) {
        throw new ProductError(
          FAILED_CODES.SIDECAR,
          'the sidecar did not print a JSON report',
          stdout.slice(-2000),
        );
      }

      if (!report || report.ok !== true) {
        const failed = (report?.checks || []).filter((c) => c.status === 'fail').map((c) => c.id);
        throw new ProductError(
          FAILED_CODES.REPROJECTION,
          'the sidecar did not pass its own gate',
          { failedChecks: failed, report },
        );
      }
      if (!report.gate || report.gate.spatial_alignment !== true) {
        throw new ProductError(
          FAILED_CODES.REPROJECTION,
          'the sidecar did not establish spatial alignment, so no image comparison is exposed',
          report.gate ?? null,
        );
      }

      // Node owns checksums: re-hash every output rather than trusting the claim.
      for (const entry of report.products || []) {
        const outPath = path.join(derivedDir, `${entry.role}_reprojected.fits`);
        let actual;
        try {
          actual = await sha256Hex(new Uint8Array(await readFile(outPath)));
        } catch (err) {
          throw new ProductError(FAILED_CODES.REPROJECTION, `the sidecar did not write ${entry.role}`, err.message);
        }
        if (actual !== entry.output?.sha256) {
          throw new ProductError(
            FAILED_CODES.REPROJECTION,
            `${entry.role} output checksum differs from the sidecar report`,
            { expected: entry.output?.sha256, actual },
          );
        }
      }

      const persisted = {
        schema: DERIVED_SCHEMA,
        ...report,
        // The sidecar echoes the grid it was given, but without the identity we
        // hold the agreement under — so the persisted record carries the agreed
        // spec itself, which is what decides whether this run may be reused.
        grid: { ...gridSpec },
        sidecar: {
          ...(report.sidecar || {}),
          script_sha256: scriptSha,
          script: path.relative(rootDir, sidecarScript),
        },
        request: path.relative(rootDir, requestPath),
      };
      await writeFile(reportPath, `${JSON.stringify(persisted, null, 2)}\n`);
      return { report: persisted, derivedDir, gridSpec };
    })().catch((err) => {
      productsPromise = null; // allow a retry after the cause is fixed
      throw err;
    });
    return productsPromise;
  }

  /**
   * Facts about one reprojected artifact: its own WCS (normalised to a single CD
   * matrix), its shape and its units.
   *
   * The WCS is read back out of the FITS rather than reconstructed from the grid
   * spec, so what the viewer navigates by is what the sidecar actually wrote —
   * and a stale or mis-gridded artifact fails loudly instead of rendering
   * confidently wrong coordinates.
   */
  async function productFacts(role) {
    const { derivedDir: dir, gridSpec } = await ensureProducts();
    let bytes;
    try {
      bytes = new Uint8Array(await readFile(path.join(dir, `${role}_reprojected.fits`)));
    } catch (err) {
      if (isMissing(err)) throw new ProductError(FAILED_CODES.PRODUCT, `no reprojected product for "${role}"`);
      throw err;
    }
    const hdus = readFitsStructure(bytes);
    const imageHdu = hdus.find((h) => h.keywords.EXTNAME === 'IMAGE');
    if (!imageHdu) throw new ProductError(FAILED_CODES.PRODUCT, `the reprojected ${role} has no IMAGE extension`);
    const wcs = normalizeFitsWcs(imageHdu.keywords);
    if (!wcs) throw new ProductError(FAILED_CODES.PRODUCT, `the reprojected ${role} has no usable WCS`);
    // Shape is [nx, ny] — NAXIS1 first, the same order common-grid.json uses.
    const shape = [imageHdu.keywords.NAXIS1 ?? null, imageHdu.keywords.NAXIS2 ?? null];
    const onAgreedGrid =
      shape[0] === gridSpec.shape[0] &&
      shape[1] === gridSpec.shape[1] &&
      Math.abs(wcs.crval[0] - gridSpec.ra) < 1e-9 &&
      Math.abs(wcs.crval[1] - gridSpec.dec) < 1e-9;
    if (!onAgreedGrid) {
      throw new ProductError(
        FAILED_CODES.PRODUCT,
        `the reprojected ${role} does not sit on the agreed grid`,
        { shape, crval: wcs.crval, gridId: gridSpec.id },
      );
    }
    return { wcs, shape, units: imageHdu.keywords.BUNIT ?? null };
  }

  /** Metadata only: archive facts, derived facts, and the gate — never pixels. */
  async function metadata() {
    const m = await manifest();
    const { report, gridSpec } = await ensureProducts();
    const byRole = new Map((report.products || []).map((p) => [p.role, p]));

    const epochs = [];
    for (const [index, role] of SIDECAR_ROLES.entries()) {
      const obs = m.observations[index];
      const derived = byRole.get(role) || {};
      const facts = await productFacts(role);
      epochs.push({
        role,
        archive: {
          label: obs.label,
          obs_id: obs.obs_id,
          detector: obs.detector,
          date_obs_utc: obs.date_obs_utc,
          mjd_obs: obs.mjd_obs,
          exposure_sec: obs.exposure_sec,
          quality: obs.quality,
          pipeline_version: obs.pipeline_version,
          pipeline_build: obs.pipeline_build,
          archive_url: obs.archive_url,
          cutout_url: obs.cutout_url,
          cutout_bytes: obs.cutout_bytes,
          cutout_sha256: obs.cutout_sha256,
          cutout_wcs_reference: obs.cutout_wcs_reference,
        },
        derived: {
          input_sha256: derived.input?.sha256 ?? null,
          output_sha256: derived.output?.sha256 ?? null,
          arrays_sha256: derived.arrays_sha256 ?? null,
          stats: derived.stats ?? null,
          flag_policy: derived.flag_policy ?? null,
          checks: derived.checks ?? [],
          units: facts.units,
          shape: facts.shape,
          wcs: facts.wcs,
        },
        raster: `/api/spherex/products/${role}/raster`,
      });
    }

    return {
      schema: DERIVED_SCHEMA,
      mission: m.mission,
      field: m.field,
      product: m.product,
      release: m.release,
      rights: m.rights,
      caveats: m.caveats,
      baseline_days: m.baseline_days,
      grid: gridSpec,
      method: report.method ?? null,
      sidecar: report.sidecar ?? null,
      checks: report.checks ?? [],
      alignment: report.alignment ?? null,
      gate: report.gate ?? null,
      wire: {
        format: WIRE_FORMAT,
        byteLength: gridSpec.shape[0] * gridSpec.shape[1] * 5,
        planes: [
          { name: 'IMAGE', dtype: 'float32', offsetBytes: 0 },
          {
            name: 'MASK',
            dtype: 'uint8',
            offsetBytes: gridSpec.shape[0] * gridSpec.shape[1] * 4,
            note: '1 = usable pixel (covered, finite, no invalid flag)',
          },
        ],
        wcs: {
          crpix: 'FITS 1-based pixel coordinates',
          cd: 'single CD matrix (CDELT*PC collapsed)',
          frame: gridSpec.frame ?? 'ICRS',
        },
      },
      epochs,
    };
  }

  /** The display-ready raster: IMAGE as little-endian float32 + MASK as uint8. */
  async function raster(role) {
    if (!SIDECAR_ROLES.includes(role)) {
      throw new ProductError(FAILED_CODES.PRODUCT, `unknown product role "${role}"`);
    }
    const { derivedDir: dir } = await ensureProducts();
    let bytes;
    try {
      bytes = new Uint8Array(await readFile(path.join(dir, `${role}_reprojected.fits`)));
    } catch (err) {
      if (isMissing(err)) {
        throw new ProductError(FAILED_CODES.PRODUCT, `no reprojected product for "${role}"`);
      }
      throw err;
    }
    const hdus = readFitsStructure(bytes);
    const imageHdu = hdus.find((h) => h.keywords.EXTNAME === 'IMAGE');
    const maskHdu = hdus.find((h) => h.keywords.EXTNAME === 'MASK');
    if (!imageHdu || !maskHdu) {
      throw new ProductError(FAILED_CODES.PRODUCT, `the reprojected ${role} has no IMAGE or MASK extension`);
    }
    let image;
    let mask;
    try {
      image = readFitsImage(bytes, imageHdu);
      mask = readFitsImage(bytes, maskHdu);
    } catch (err) {
      throw new ProductError(FAILED_CODES.PRODUCT, `could not decode ${role}: ${err.message}`);
    }
    if (image.nx !== mask.nx || image.ny !== mask.ny) {
      throw new ProductError(
        FAILED_CODES.PRODUCT,
        `IMAGE ${image.nx}x${image.ny} and MASK ${mask.nx}x${mask.ny} disagree in ${role}`,
      );
    }
    const plane = image.nx * image.ny;
    const wire = new Uint8Array(plane * 5);
    const imageBytes = new Uint8Array(image.data.buffer, image.data.byteOffset, plane * 4);
    if (HOST_IS_LITTLE_ENDIAN) {
      wire.set(imageBytes, 0);
    } else {
      const view = new DataView(wire.buffer, 0, plane * 4);
      for (let i = 0; i < plane; i++) view.setFloat32(i * 4, image.data[i], true);
    }
    wire.set(mask.data, plane * 4);
    return { bytes: wire, width: image.nx, height: image.ny, sha256: await sha256Hex(wire) };
  }

  return { manifest, grid, ensureProducts, metadata, raster, cacheDir, derivedDir };
}
