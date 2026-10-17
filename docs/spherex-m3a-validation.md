# SPHEREx M3-A: source-product validation

Milestone **M3-A** validates the two selected cutouts before any reprojection:
expected dimensions, complete coverage, usable celestial WCS, and compatible
extensions — checked against the actual sky footprints, not dimensions alone.
Exit condition: **gate passed**.

Run with the pinned environment (`sidecar/requirements.txt`):

```sh
sidecar/.venv/bin/python sidecar/validate_products.py --request request.json
sidecar/.venv/bin/python -m unittest discover -s sidecar/tests   # 6 tests
```

Environment actually used: **Python 3.14.7, astropy 8.0.2, numpy 2.5.4** (a
`cp311-abi3` astropy wheel on this interpreter). The report records its own
versions so a stale environment cannot masquerade as the tested one.

## What was checked

Per product (8 checks), all via `astropy.wcs`:

1. `extensions_present` — IMAGE, FLAGS, VARIANCE, ZODI.
2. `dimensions_match` — image shape vs `size_deg / pixel_scale` (±2 px).
3. `extension_grids_consistent` — all science HDUs share one grid.
4. `wcs_celestial` — a solvable celestial WCS exists.
5. `wcs_invertible` — the projection matrix is not singular.
6. `center_matches_request` — WCS image centre lands on the requested position.
7. `footprint_corners_finite` — all four corners map to finite sky coordinates.
8. `coverage_complete` — finite-pixel fraction of IMAGE (≥ 0.98).

Across products (2 checks):

- `common_pixel_grid` — do the epochs share a pixel grid?
- `pipeline_version_matches` — is the pipeline version the same?

A differing grid **warns** rather than fails: each product can be complete and
correctly WCS-solved while still not sharing a grid. That is precisely the case
M3-B exists to resolve.

## Results (both manifest cutouts)

| | epoch-a `2025W18_1B_0095_2` | epoch-b `2025W46_2A_0537_1` |
| --- | --- | --- |
| IMAGE shape | **293 × 293** | **294 × 293** |
| BUNIT | `MJy / sr` | `MJy / sr` |
| pipeline (PRIMARY `VERSION`) | `6.4+psffix1` | `6.4+psffix1` |
| WCS | `RA---TAN-SIP` / `DEC--TAN-SIP`, SIP present | same |
| singular | false | false |
| centre (deg) | 270.00139, 66.50000 | 269.99791, 66.50013 |
| centre offset from request | **1.99″** | **3.04″** |
| pixel scale (″) | 6.133 / 6.146 | 6.132 / 6.146 |
| finite-pixel fraction | 1.0000 | 1.0000 |
| FLAGS nonzero fraction | 0.434 | 0.432 |

**Gate: passed.** All 8 per-product checks pass on both epochs, and
`ok = true`. Footprint corners are finite for both, and both centres land within
half a pixel (~3″) of the requested position — the expected quantisation, not an
error.

## Findings

1. **The epochs do not share a pixel grid** (293×293 vs 294×293). They are
   therefore **not pixel-comparable**. Reprojection onto a common tangent plane
   is mandatory before any differencing — which is exactly what `common_pixel_grid`
   warns about and what M3-B does.
2. **Identical pipeline version** is a genuine control, but per the recorded rule
   it does *not* by itself establish identical photometric response or observing
   conditions.
3. **~43% of pixels carry nonzero FLAGS.** Reported, not gated: the bitmask's
   meaning must be interpreted from the Explanatory Supplement before any
   difference view relies on it. A high flag fraction is not on its own a defect.
4. **Completeness ≠ comparability.** Both products are complete, correctly
   WCS-solved and match their manifest hashes (M2). None of that makes the fluxes
   comparable — calibration, background and uncertainty are still open, and the
   comparison view stays labelled a **visualization** until they are validated.

## Status

- M3-A: **complete, gate passed.**
- Next: **M3-B — reproject to a common grid** (`docs/spherex-m3-plan.md`).
