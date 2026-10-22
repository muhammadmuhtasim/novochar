# M3-C contracts: sidecar ↔ Node ↔ viewer

Written **before** the viewer code, so the boundary is decided once and reviewed
rather than discovered during implementation. M3-B's gate is the constraint:
spatial alignment is validated, `quantitative_difference_enabled` is `false`, and
M3-C must not blur that line.

## Scope

**In:** render the two real reprojected NEP products, shared WCS navigation and
coordinate readout, honest footprints/invalid pixels, full metadata, the
comparison labelled a visualization.

**Out (deliberately, this milestone):** 3I/ATLAS (stays a separate M3-D dataset),
M5 indexing/LOD/inspection, Gaia DR3, BSC5, any 3D redesign, and any control that
enables differencing. One trustworthy NEP workflow first.

---

## Contract 1 — sidecar ↔ Node

Node never parses Python output structurally. It hands the sidecar a file and
treats two things as its contract: **one FITS per product** and **one JSON report
on stdout**.

### Node → sidecar (request file, JSON)

```json
{
  "grid":    { "ra", "dec", "pixel_scale_arcsec", "shape", "rotation_deg" },
  "method":  "bilinear",
  "products": [ { "role", "path", "sha256" } ],
  "outputs": { "dir": "<path>", "write": true }
}
```

- `grid` is read from `data/spherex/common-grid.json` — never assembled ad hoc, so
  what is served is what M3-B validated. `shape` is `[nx, ny]` (NAXIS1 first),
  the order `build_target_grid` reads it in; the metadata the viewer gets back
  uses the same order.
- Every `product` carries its manifest SHA-256. The sidecar verifies it and fails
  the product on mismatch.
- `role` is **our** vocabulary (`epoch-a`, `epoch-b`), mapped to
  `manifest.observations[0..1]` in order. The manifest's `label` (`epoch-1/2`) is
  archive-side text and is preserved verbatim inside metadata.

### Sidecar → Node

**FITS** `<role>_reprojected.fits`, HDUs in fixed order:

| # | EXTNAME | BITPIX | Contents |
|---|---------|--------|----------|
| 0 | *(primary)* | — | `ORIGIN METHOD INPUTSHA ASTROPY REPROJ TCRV1 TCRV2 TCRPX1 TCRPX2 COMMENT` |
| 1 | `IMAGE` | −32 | reprojected flux, `BUNIT = MJy / sr` |
| 2 | `VARIANCE` | −32 | bilinear, assumptions stated in the report |
| 3 | `FLAGS` | 32 | nearest-neighbour, original bit values |
| 4 | `MASK` | 8 | `1` = usable (covered ∧ finite ∧ no invalid flag) |
| 5 | `FOOTPRINT` | −32 | reprojection weight, `> 0.5` = covered |

All five image HDUs carry the **same** plain TAN WCS (no SIP).

**Report** (stdout JSON): `sidecar` versions, `grid`, `products[]`
(`input.sha256`, `output.sha256`, `arrays_sha256`, `stats`, `flag_policy`,
`checks`), `checks`, `alignment`, `gate`, `ok`.

### Rules

1. Node re-hashes every sidecar output FITS with its own SHA-256 and compares it
   to `report.products[].output.sha256`. Node owns checksums; the sidecar's claim
   is never trusted on its own.
2. Nothing is exposed unless `report.ok === true`; otherwise the route returns an
   error carrying the failed check ids.
3. The sidecar process is **injected**. Production defaults to spawning
   `sidecar/.venv/bin/python` (overridable by `SIDECAR_PYTHON`); tests inject a
   fake runner, so `npm test` never requires Python. This preserves the existing
   separation: Node stays Python-free.
4. Cutouts come from the existing bounded cache (`putCutout`/`getCutout`, hashes
   re-verified on read). Raw cutouts are never committed; `.cache/` stays
   gitignored.
5. **Deployment bundle (no Python).** A host that cannot spawn the sidecar can
   ship the pre-generated outputs under `data/spherex/derived/`. The store tries
   the local cache first, then the bundle, and uses the same verification for
   both: report schema, `ok === true`, `gate.spatial_alignment === true`, the
   committed grid, each manifest input hash and each output SHA-256. Only the
   script-hash check is skipped for a bundle, because the interpreter that wrote
   it is not part of the deployment. A bundle that exists but fails verification
   is refused rather than silently replaced. `npm run spherex:bundle` regenerates
   it from a local sidecar run and `npm run check:spherex-bundle` verifies the
   committed copy with no Python and no network. This is a fixed-dataset path:
   a new observation or grid requires a new bundle.

---

## Contract 2 — Node ↔ viewer

### Wire format (`GET /api/spherex/products/:role/raster`)

`application/octet-stream`, little-endian, two planes:

```
bytes [0,        4·W·H)   Float32  IMAGE, row-major, row 0 first
bytes [4·W·H,    5·W·H)   Uint8    MASK   (1 = usable)
```

5 bytes/pixel ≈ 432 KB per epoch at 294². Shape, WCS and `sha256` arrive with the
metadata endpoint; the client rejects a raster whose byte length is not exactly
`5·W·H` rather than rendering a plausible-looking misalignment.

*Why FITS is not shipped to the browser:* Node decodes the sidecar FITS (it owns
the API), the browser gets a format it can map without a FITS parser, and the
FITS remains the single scientific artifact a person can download for M6.

FLAGS/VARIANCE are **not** in the raster at M3-C — `MASK` already carries every
flag-driven invalidity decision. The wire format is versioned in the metadata so
M5 can add a flags plane without a silent format change.

### Rendering

1. **Intensity.** Only pixels with `MASK == 1` **and** a finite value may
   contribute to the stretch. Linear percentile stretch (default 1–99), and for a
   comparison **one shared `[lo, hi]` is computed once and applied to both
   epochs** — per-image auto-scaling would make two epochs visually incomparable.
2. **Invalid pixels** are drawn fully transparent over a distinct "no data"
   backdrop. Never black: zero flux and no data must not look alike.
3. **Orientation.** The transform is fixed in one place and tested:
   `screenY = (H − wy) · scale + panY`, i.e. array row 0 sits at the **bottom** of
   the screen. With the north-up target grid this puts north at the top and east
   to the left. Image and graticule use the same function — orientation cannot
   drift between layers.
4. **Coordinates.** The output grid is plain TAN, so the client implements TAN
   only (no SIP). `screenToSky` and `skyToScreen` are inverses, checked by
   round-trip **and** against an astropy-generated fixture
   (`client/src/lib/fixtures/tan-grid-epj.json`), so a JS formula error cannot
   silently produce confident, wrong readouts.
5. **Readout.** Cursor → WCS pixel → TAN → ICRS RA/Dec, plus the pixel index and
   validity. Both epochs share one grid, so readout and navigation are identical
   across them.

`display` state (stretch, zoom, pan) lives in the client and is **never** sent to
the server or stored in provenance.

---

## Contract 3 — metadata

Three namespaces, never merged:

| Namespace | Source | Examples |
|---|---|---|
| `archive` | manifest / IRSA | `obs_id`, `date_obs_utc`, detector, exposure, `quality`, `pipeline_version` + build, cutout URL, SHA-256, bytes, release DOI, terms, acknowledgement |
| `derived` | sidecar report | target grid, per-extension method + variance assumption, software versions, input/output/arrays SHA-256, covered/valid/flag statistics, checks, alignment, `gate` |
| `display` | client only | stretch percentiles, zoom, pan, orientation |

Rendering rules:

- Provenance panels show `archive` + `derived` only, in separate blocks, so a
  viewer can see at a glance *what the archive says* versus *what we did to it*.
- `display` renders in its own panel, worded as a viewer setting.
- Display settings are never persisted into any provenance or report.
- Nothing derived is ever presented with an archive-looking label.

---

## Contract 4 — the scientific gate

`quantitative_difference_enabled` is read from the **sidecar report**, not
re-declared by the client.

1. **No route** computes, exposes or approximates an epoch-to-epoch difference,
   photometry or variability. Enforced by a test that enumerates registered routes
   and fails on `difference|subtract|delta|photometr|variab` for SPHEREx paths.
2. **No control** enables a difference mode. A test asserts the client's viewer
   exposes no such control and that no interactive affordance is gated only by a
   hidden flag.
3. The comparison surface is labelled *"Visualization — spatial alignment only,
   quantitative differences disabled"* and shows the gate object verbatim.
4. With `gate.spatial_alignment` false or absent, the viewer must not claim
   alignment: it shows the failed checks instead of an image comparison.
5. Client code that *would* difference two arrays is not written at M3-C. Later
   milestones must first flip the gate in the sidecar, where the reasons are
   recorded — not in the UI.

---

## Vertical slices

| Slice | Deliverable | Proof |
|---|---|---|
| **1** | one real epoch: sidecar orchestration → metadata + raster routes → client renders with correct orientation, WCS readout, metadata panel | Playwright: pixel non-blank, readout changes with cursor, north-up orientation |
| **2** | both epochs + shared stretch + masked rim + comparison labelled a visualization | Playwright: both render, identical grid declared, label present, gate false |
| **3** | metadata completeness + error/retry states | route tests + acceptance |

M3-C exit gate: *real observations display correctly, with validated coordinates
and metadata.*

---

## As built — how each contract is checked

Run `npm run check:spherex` for the browser half and `npm test` /
`npm run test:sidecar` for the rest. All figures below are from the two real
epochs selected in M2 (`2025W18_1B_0095_2`, `2025W46_2A_0537_1`), reprojected
by the sidecar onto the committed 294×294 grid.

| Contract | Check | Result |
|---|---|---|
| 1 — sidecar → Node | `server/store/spherex-products.test.js`: request shape, output hashes re-verified, `report.ok && gate.spatial_alignment` required, idempotency on grid + script hash, changed script invalidates, checksum mismatch refused, sidecar cannot start | 16 tests, offline (no Python needed) |
| 1 — shape order | store sends `gridSpec.shape` verbatim; `productFacts` reads NAXIS back and reports `[NAXIS1, NAXIS2]`; `shape_order` field documents it | caught by a real end-to-end run before it reached a screen |
| 2 — wire format | route tests: `novochar.spherex.raster/v1`, LE float32 + uint8, 5 B/px, wrong length rejected | 6 route tests, closed-set enumeration of the SPHEREx routes |
| 2 — rendering | client unit tests: `decodeRaster`, `computeStretch`, `makeScreenTransform`, TAN, `renderRaster` | 15 tests, incl. **astropy fixture cross-check** (`spherex-nep-tan.json`, round-trip through `sidecar/make_tan_fixture.py`) |
| 2 — orientation | acceptance compares the canvas against the served bytes | 0 alpha mismatches over 86,436 px per frame; 0 gray mismatches out of ~1,880 sampled px; readout Dec span 0.350° over 70% of the 0.502° field (east-left, north-up confirmed) |
| 2 — invalid pixels | acceptance | 16,455 / 15,531 px transparent = the rim the sidecar masked; drawn pixels 81.0% / 82.0% — the sidecar's valid fractions 0.8096 / 0.8203 reaching the screen unchanged |
| 3 — metadata | store test asserts `archive` / `derived` / `display` keys never merge; `display` block is built client-side only | covered by the no-difference-surface key scan |
| 4 — gate | acceptance asserts the banner text, the gate flags, and that **no control** matches `difference|subtract|delta|photometr|variab` (only "Usage terms" exists); a forced `503 sidecar_unavailable` must render as a retryable failure, then one retry must restore both frames | 29/29 checks pass |
| — honest failure | the viewer's own error state was what caught the first integration bug (`api.getJSON` missing) during development | reported as `code: …`, with a Retry button, never a blank picture |

**What this proves:** real observations reach the screen with their
coordinates, footprints and validity masks intact, on one agreed grid.

**What it does not prove:** that the epochs are scientifically comparable. That
remains gated (`quantitative_difference_enabled: false`) pending calibration
and data-quality handling — deliberately out of scope for M3-C.
