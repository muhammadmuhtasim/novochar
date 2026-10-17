# Store & Indexing Layer (Layer 3)

This directory is the home of the **Storage & Indexing** layer described in
`docs/ARCHITECTURE.md §3.3`.

`spherex-cache.js` is the first concrete piece: a byte-exact FITS cutout cache
with a provenance sidecar and hash verification (see
`docs/spherex-m2b-retrieval.md`). The spatial-index and catalog stores below
remain unbuilt.

## Intended responsibilities

- **Spatial indexes:** PostGIS / DuckDB with HEALPix (or H3) keys. The HEALPix
  keys are already produced upstream by `server/astro/healpix.js`
  (`ang2pixLonLat` / `raDecToPixel`).
- **Binary cache:** Redis for fast retrieval of FITS cutouts and PNG tiles.
- **Catalog storage:** imported archive row-sets (RA/Dec + attributes) ready
  for cross-matching against survey detections.

## Suggested surface (so callers can target it)

```js
store.putPixelBins(nsides, bins)         // upsert { key, counts, flux, ids }
store.query(bounds, { nside, radius })   // spatial range/cone query -> bins
store.crossReference(catalogue, rows)    // rows -> matched catalogue ids
store.binCache(key, blob)                // TTL cache for cutouts/PNGs
```

Interfaces intentionally mirror the seams used by `server/index.js` and the
`SPECTRA` / `SKY VIEWER` routes so switching from memory to a real store is a
low-friction follow-up.