// Layer 3 - Storage & Indexing: on-disk cutout cache with provenance.
//
// The retrieval adapter (server/ivoa/spherex.js) is deliberately pure — it takes
// an injected fetch and returns bytes. This module owns the one side effect the
// demo needs: a reproducible local cache of fetched cutouts.
//
// Layout, per entry:
//   <dir>/<key>.fits              the raw FITS bytes, unmodified
//   <dir>/<key>.provenance.json   source URL, obs_id, detector, size, sha256,
//                                 byte length, fetch timestamp
//
// `getCutout` re-hashes the bytes and reports corruption rather than returning
// silently-wrong pixels — the same discipline the M2-A validation applied to the
// archive itself.

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { sha256Hex } from '../ivoa/spherex.js';

export function cutoutFileName(key) {
  return `${key}.fits`;
}

export function provenanceFileName(key) {
  return `${key}.provenance.json`;
}

function isMissing(err) {
  return err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}

/**
 * Write a cutout plus its provenance sidecar. Bytes are stored verbatim; the
 * sidecar records how they were obtained so a later reader can re-verify them.
 */
export async function putCutout(dir, key, bytes, provenance = {}) {
  if (!dir) throw new TypeError('putCutout requires a directory');
  if (!key) throw new TypeError('putCutout requires a key');
  if (!bytes || typeof bytes.length !== 'number') throw new TypeError('putCutout requires a byte array');
  await mkdir(dir, { recursive: true });
  const record = {
    ...provenance,
    key,
    byteLength: bytes.length,
    sha256: provenance.sha256 || (await sha256Hex(bytes)),
    fetchedAt: provenance.fetchedAt || new Date().toISOString(),
  };
  await writeFile(join(dir, cutoutFileName(key)), bytes);
  await writeFile(join(dir, provenanceFileName(key)), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * Read a cached cutout. Returns null when absent. When present, the bytes are
 * re-hashed; a mismatch is surfaced as `corrupt:true` (never thrown, so callers
 * can decide to refetch).
 */
export async function getCutout(dir, key, { verify = true } = {}) {
  if (!dir || !key) throw new TypeError('getCutout requires a directory and key');
  let bytes;
  let provenance;
  try {
    bytes = new Uint8Array(await readFile(join(dir, cutoutFileName(key))));
    provenance = JSON.parse(await readFile(join(dir, provenanceFileName(key)), 'utf8'));
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  if (verify && provenance.sha256) {
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== provenance.sha256) {
      return { bytes, provenance, corrupt: true, actualSha256 };
    }
    return { bytes, provenance, corrupt: false, actualSha256 };
  }
  return { bytes, provenance, corrupt: false, actualSha256: null };
}

/** True when a key is cached (bytes present). Does not verify the hash. */
export async function hasCutout(dir, key) {
  const hit = await getCutout(dir, key, { verify: false });
  return hit !== null;
}

/** List cached keys (from provenance sidecars), sorted for determinism. */
export async function listCutouts(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  return names
    .filter((n) => n.endsWith('.provenance.json'))
    .map((n) => n.slice(0, -'.provenance.json'.length))
    .sort();
}

/** Remove one cached entry (bytes + sidecar). Returns true if anything existed. */
export async function removeCutout(dir, key) {
  let removed = false;
  for (const name of [cutoutFileName(key), provenanceFileName(key)]) {
    try {
      await rm(join(dir, name));
      removed = true;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  return removed;
}
