# SPHEREx M3 plan and sidecar decision

## Decision (recorded 2026-10-17)

Reprojection (M3-B) is done by a **Python + astropy sidecar**, not by a
JavaScript implementation, behind a **narrow one-way interface**:

> validated local FITS inputs + a target-grid specification -> reprojected
> arrays + WCS + mask + provenance metadata.

Rationale: TAN-SIP is not a rotation and a translation. A correct reprojection
must handle the projection, the SIP distortion terms, pixel-coordinate
conventions and interpolation; a plausible-looking image is not evidence of a
correct one. Scientifically defensible reprojection matters more here than
avoiding a small, isolated dependency.

The pure-JavaScript route remains a **fallback only** if the deployment
environment makes Python impractical.

The Node server is **not** migrated to Python. Node keeps bounded retrieval,
caching, checksums and API behaviour.

## The reproducibility / comparability separation (must be preserved)

M2 proved the two cutouts are the **same files** (matching SHA-256). That is
reproducibility. It says nothing about whether the cutouts are **complete** or
**scientifically comparable**. M3 keeps these separate:

| Claim | Evidence required | Milestone |
| --- | --- | --- |
| Same bytes as the manifest | matching SHA-256 | done (M2) |
| Complete coverage of the requested region | dimensions **and** footprint/WCS check | M3-A |
| Spatially aligned | a validated reprojection, round-trip tested | M3-B |
| Photometrically comparable / a calibrated change | matching calibration, background, noise, uncertainty | **not yet claimed** |

The comparison view is labelled a **visualization** until photometric
comparability and uncertainty handling are validated.

## Two implementation rules

1. Pin the Python and astronomy-library versions, and test the exact environment
   used in deployment (`sidecar/requirements.txt`, `sidecar/.venv`).
2. Do not silently treat a reprojected pixel difference as a calibrated
   scientific detection. Reprojection addresses spatial alignment only.

Additional caution: the same pipeline version is a useful control, but it does
not by itself guarantee identical photometric response or observing conditions.

## Sequence

- **M3-A — validate the source products.** Expected dimensions, complete
  coverage, usable celestial WCS, compatible extensions; check the actual sky
  footprints, not dimensions alone. *(complete — `docs/spherex-m3a-validation.md`)*
- **Gate** before reprojection.
- **M3-B — reproject to a common grid.** Same tangent-plane projection, pixel
  scale and dimensions; preserve masks and variance; record the target WCS,
  interpolation method, software versions and input hashes. Validate with
  coordinate round trips, source-position alignment, output footprints,
  NaN/masked edges, and synthetic images with known positions.
  *(complete — `docs/spherex-m3b-reprojection.md`)*
- **M3-C — viewer.** Epoch A, epoch B and a comparison view, with dates,
  observation IDs, pipeline version, units, WCS, masks and provenance; the
  comparison labelled a visualization.
- **M3-D — 3I/ATLAS**, separately, reusing the validated pipeline only after
  confirming the comet products' coverage and metadata.
