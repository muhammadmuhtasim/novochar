# SPHEREx M2-B: bounded retrieval and caching

Milestone **M2-B** turns the validated M2-A dataset into a *reproducible, bounded*
retrieval path. Exit condition: **repeatable downloads with provenance and
offline tests**. No HTTP route is added here — wiring the viewer is M3.

## Modules

| Module | Layer | Responsibility |
| --- | --- | --- |
| `server/ivoa/spherex.js` | 1 (ingestion) | Normalise SIA rows, select an epoch pair, build a bounded cutout URL, read the FITS MEF header structure, extract validated metadata, fetch with a byte ceiling + timeout + SHA-256 |
| `server/store/spherex-cache.js` | 3 (storage) | On-disk cache: raw bytes plus a provenance sidecar, with hash verification |

Both sit on the existing IVOA layer: the adapter calls `querySIA` (which speaks
IRSA SIA2 via `ARCHIVES.irsa.protocols.sia`, `param:'COLLECTION'`), so no new
network client was introduced.

## What "bounded" means

- **Sky size ceiling** — `buildCutoutUrl` rejects `sizeDeg > SPHEREX_CUTOUT_MAX_SIZE_DEG`
  (1.0°). Larger regions must be paged.
- **Byte ceiling** — `fetchCutout` rejects a `content-length` over the ceiling,
  and cancels a streaming body that crosses it (`SPHEREX_MAX_CUTOUT_BYTES`, 64 MiB).
- **Timeout** — every request carries an `AbortSignal.timeout`.
- **Honest failure** — a non-2xx response, an oversize body, or an epoch set with
  no qualifying baseline throws; it never downgrades to a single-epoch "comparison".

## What "reproducible" means

- **Stable identity** — `(obs_id, detector)` is the real key; SIA repeats `obs_id`
  once per detector, and `energy_bandpassname` (`SPHEREx-D2`) carries the detector.
- **Deterministic URL** — the cutout query is appended with a literal comma in
  `center` (`?center=270,66.5&size=0.5`), matching the form verified byte-for-byte
  against the live service. `URLSearchParams` would emit `%2C`.
- **Checksums** — every fetch returns a SHA-256; `putCutout` records it and
  `getCutout` re-hashes, flagging `corrupt:true` instead of returning wrong pixels.
- **Provenance sidecar** — `<key>.provenance.json` records the source URL,
  `obs_id`, detector, size, collection, byte length, hash, and fetch timestamp.

## Offline tests

`server/ivoa/spherex.test.js` and `server/store/spherex-cache.test.js` touch no
network: retrieval takes an injected `fetchImpl`, and FITS fixtures are
synthesised in memory (no binary committed). Registered in `server/package.json`.

## Findings from live validation

Running the adapter against the live archive (not a stub) established:

- **The manifest is reproducible through code.** Fetching the two M1 epochs via
  `buildCutoutUrl` + `fetchCutout` reproduced both manifest SHA-256 values
  exactly (`9ceb7ec1…`, `bca6bf0d…`), and the cache round-trip verified them.
- **The shared SIA client needed a fix.** IRSA's `/SIA` is a **SIA2** service: it
  wants `POS=circle RA Dec r` plus `COLLECTION`, and it *rejects* the SIA1-only
  `SIZE` and `INTERSECT`. `querySIA` now emits the SIA2 form whenever a
  `collection` is supplied (and keeps the SIA1 form otherwise). This also closes
  the "irsa live-unverified" gap.
- **Pipeline version lives on the PRIMARY header**, not the science extensions,
  hence `fitsFileMetadata(hdus)`.
- **Baseline-maximising selection is not enough for science.** Picking the widest
  pair across all rows chose epochs with a **truncated cutout** (IMAGE shape
  `[294,181]`) and mixed pipeline versions. The curated manifest pair — one
  detector, one pipeline version, both full-frame — remains the demo dataset, and
  cutout-completeness validation belongs in M3-A.

## Minimal usage

```js
import { querySpherexField, selectEpochPair, buildCutoutUrl, fetchCutout, cutoutKey } from './server/ivoa/spherex.js';
import { putCutout, getCutout } from './server/store/spherex-cache.js';

const { epochs } = await querySpherexField({ ra: 270, dec: 66.5, size: 0.05, detector: 'D2' });
const { first, second, baselineDays } = selectEpochPair(epochs, { detector: 'D2', minBaselineDays: 30 });

const cacheDir = '.cache/spherex';
for (const epoch of [first, second]) {
  const key = cutoutKey({ obsId: epoch.obsId, detector: epoch.detector, sizeDeg: 0.5 });
  let hit = await getCutout(cacheDir, key);
  if (!hit) {
    const url = buildCutoutUrl(epoch.accessUrl, { ra: 270, dec: 66.5, sizeDeg: 0.5 });
    const fetched = await fetchCutout({ url });
    await putCutout(cacheDir, key, fetched.bytes, { ...epoch, sourceUrl: url, sizeDeg: 0.5 });
  }
}
```

## Deliberately out of scope (M3)

- No HTTP route and no viewer (M3-C).
- No WCS reprojection to a common grid (M3-B) — M2-B retrieves and validates, it
  does not yet compare. The M2-A finding stands: the two epochs need reprojection
  before any pixel differencing.
- No cutout-completeness check (M3-A): the IMAGE shape must be validated against
  the requested size before an epoch is trusted.
