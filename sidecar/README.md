# SPHEREx sidecar (Python + astropy)

A deliberately small Python process that does the astronomy the Node server
should not hand-roll. The boundary is one-way and narrow:

```
validated local FITS paths  +  a target-grid spec   ->   reprojected arrays
                                                         + WCS + mask + provenance
```

The Node server keeps ownership of **bounded retrieval, caching, checksums and
API behaviour**. It never sends live archive URLs across the boundary — only
local files it has already fetched, hashed and verified.

## Why Python here

Reprojection is TAN-SIP projection, distortion, pixel conventions and
interpolation. A plausible-looking image is not evidence of a correct
reprojection, so we use the established libraries (`astropy.wcs`) rather than a
custom implementation. See `docs/spherex-m3-plan.md`.

## Environment

The interpreter and every astronomy library are pinned in `requirements.txt`.
Set up an isolated environment:

```sh
python3 -m venv sidecar/.venv
sidecar/.venv/bin/python -m pip install -r sidecar/requirements.txt
```

`sidecar/.venv/` is git-ignored. Do not install the sidecar dependencies into the
system interpreter; the point of pinning is that the tested environment is the
deployed one.

## Running

```sh
# M3-A: validate source products (WCS, footprint, coverage) -> JSON on stdout
sidecar/.venv/bin/python sidecar/validate_products.py --request request.json

# tests (stdlib unittest, no extra dependency)
sidecar/.venv/bin/python -m unittest discover -s sidecar/tests
```

From the repo root the same commands are `npm run sidecar:setup` and
`npm run test:sidecar`. The sidecar suite is **deliberately separate from
`npm test`**, which stays Python-free; M3-B gates on both.

## Contract rules

- Inputs are **local, already-verified** FITS paths plus explicit expectations.
- The sidecar reports what it checked and why, never a bare boolean.
- A reprojected pixel difference is a **spatial-alignment** result; it is not a
  calibrated detection. The sidecar must not imply otherwise.
