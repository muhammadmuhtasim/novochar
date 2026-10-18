# M6 — Reproducible Case Study: North Ecliptic Pole SPHEREx Comparison

This document packages the M3–M5 investigation into a reproducible case study.
A judge or another developer can follow it from a clean application session,
reproduce the same observations, and understand exactly what the workflow
demonstrates and what it does not.

---

## 1. Investigation question

> Can two real SPHEREx observations of the same sky field be displayed on one
> common grid, with a fixed field of view and a shared intensity stretch, so
> that a reader can look at the same sky position in both and judge by eye
> whether anything looks different — without the application silently claiming
> that anything moved, changed brightness, or is a Planet X candidate?

The answer is **yes, with stated limits**. The application delivers spatially
aligned visualization. It does not deliver, and does not claim, a quantitative
difference, photometric variability measurement, or moving-object detection.

---

## 2. Field and observations

### Field

| Property | Value |
|---|---|
| Field ID | `nep` |
| Name | North Ecliptic Pole deep field |
| Centre (ICRS) | RA 270.0°, Dec 66.5° |
| Requested cutout | 0.5° × 0.5° |
| Mission | SPHEREx (Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer) |
| Data release | Quick Release 2 (QR2), DOI 10.26131/IRSA652 |
| Detector | D2 (band SPHEREx-D2, 1.10–1.65 μm, median wavelength 1.34 μm) |
| Pixel scale | 6.15″/px |
| Projection | RA---TAN / DEC--TAN (ICRS) |

### Epoch 1 — 2025-04-29

| Property | Value |
|---|---|
| Label | `epoch-1` |
| Observation ID | `2025W18_1B_0095_2` |
| Date (UTC) | 2025-04-29T03:50:28.360 |
| MJD | 60794.160050463 |
| Detector | 2 |
| Pipeline version | `6.4+psffix1` (build `l2b-v20-2025-240`) |
| Quality (L1/L2) | Pass / Pass |
| Exposure | 113.5826 s |
| Native cutout size | 293 × 293 px |
| Native CRPIX | (147.5, 27.5) |
| Native CRVAL | RA 270.280°, Dec 66.332° |
| Cutout SHA-256 | `9ceb7ec1f298c1e460aae8c20f95d15ce5a2a79d0acb511099d1b251cf887780` |
| Cutout bytes | 6,431,040 |
| Archive URL | `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W18_1B/l2b-v20-2025-240/2/level2_2025W18_1B_0095_2D2_spx_l2b-v20-2025-240.fits?center=270,66.5&size=0.5` |

### Epoch 2 — 2025-11-16

| Property | Value |
|---|---|
| Label | `epoch-2` |
| Observation ID | `2025W46_2A_0537_1` |
| Date (UTC) | 2025-11-16T02:07:55.367 |
| MJD | 60995.088835266 |
| Detector | 2 |
| Pipeline version | `6.4+psffix1` (build `l2b-v20-2025-321`) |
| Quality (L1/L2) | Pass / Pass |
| Exposure | 113.5826 s |
| Native cutout size | 293 × 293 px |
| Native CRPIX | (86.5, 168.5) |
| Native CRVAL | RA 270.639°, Dec 66.471° |
| Cutout SHA-256 | `bca6bf0d7f0d72924f8385681f40249295c3b881a273cf75953f67339ce33085` |
| Cutout bytes | 6,431,040 |
| Archive URL | `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W46_2A/l2b-v20-2025-321/2/level2_2025W46_2A_0537_1D2_spx_l2b-v20-2025-321.fits?center=270,66.5&size=0.5` |

### Baseline

| Property | Value |
|---|---|
| Baseline (days) | ~200.9 d (≈ 6.6 months) |
| Baseline (months) | ~6.6 |

---

## 3. Common grid

Both epochs are reprojected by the Python sidecar onto one deterministic tangent
plane:

| Property | Value |
|---|---|
| Grid ID | `nep-qr2-common` |
| Tangent point | RA 270.0°, Dec 66.5° (ICRS) |
| Projection | TAN (gnomonic) |
| Pixel scale | 6.15″/px |
| Shape | 294 × 294 (`[nx, ny]`, NAXIS1 first) |
| Rotation | 0.0° |
| Orientation | north-up, east-left (viewer convention; `det(CD) < 0`) |
| Validated by | sidecar M3-B gate (`ok = true`) |

The 294×294 extent is the size of the larger input cutout, so no input pixel is
dropped at the edges. Coverage is 0.834 / 0.846 (not 1.0) because the two
epochs are rotated differently on the sky (position angle 123.6° vs −29.1°)
even though both are centred on the requested position. The uncovered rim is
masked, never filled.

---

## 4. Spatial alignment (M3-B gate)

| Metric | Value |
|---|---|
| Spatial alignment | established (`true`) |
| Quantitative difference | disabled (`false`) |
| Integer-lag search | ±4 px |
| Measured lag | (0, 0) px |
| Offset | 0 px = below one pixel (6.15″) |
| Peak correlation | 0.6386 over 65,328 common pixels |
| Resolution | sub-pixel offsets are not resolved by this diagnostic |

**Acceptance rule (from the sidecar report):** matching output grids and
successful reprojection tests establish **spatial alignment — not scientific
comparability**. The scope is "spatial alignment only — not a flux or
variability measurement".

Still required before any comparison could be called quantitative:
- matching calibration and background subtraction
- identical observing conditions / photometric response
- uncertainty model validated against the variance extension
- data-quality flag policy reviewed against the Explanatory Supplement

---

## 5. Reprojection method (per extension)

| Extension | Method | Note |
|---|---|---|
| IMAGE | `reproject_interp` bilinear | the science image |
| FLAGS | `reproject_interp` nearest-neighbour (order 0) | copies existing bit values; a bitmask must never be interpolated into a pattern no input pixel ever had |
| VARIANCE | bilinear (assumption stated) | variance field varies smoothly on the pixel scale; per-pixel independent propagation is NOT applied because `reproject` does not expose interpolation weights |
| ZODI | not reprojected | a model, not a measurement; deferred |

Flag policy: bit numbers are read from the `MP_*` keywords in each product's
own FLAGS header (the archive embeds its definitions there). Only the roles
are fixed in code: `pathology` (13 bits) and `not_sky` → invalid;
`informational` (10 bits) → kept but reported.

---

## 6. Retrieval procedure

### Prerequisites

- Node.js (the server) and Python 3 with the pinned sidecar venv
  (`sidecar/.venv/`, `astropy==8.0.2`, `numpy==2.5.4`, `reproject==0.21.0`,
  `scipy==0.18.1`, `pyerfa==2.0.1.5`).
- No FITS file is committed; the app fetches on demand and records checksums.

### Steps

1. Clone the repository and install dependencies:
   ```sh
   npm install
   ```
2. Start the server (spawns the sidecar on demand):
   ```sh
   npm run dev          # or: npm run build -w client && npm start
   ```
3. Open `http://localhost:5173` (dev) or the production URL.
4. Click the **SPHEREx FIELD** tab.
5. The server fetches both cutouts from IRSA (or serves from `.cache/`),
   verifies the cutout SHA-256 against the manifest, runs the sidecar
   reprojection, and returns metadata + rasters. First load may take 10–30 s
   while the sidecar runs; subsequent loads are cached.
6. If the sidecar cannot start (e.g. on Vercel), the tab shows
   `503 sidecar_unavailable` as a retryable failure — never a blank picture.

### Verification of product identity

After loading, the "What is being shown" panel lists:

- Mission, release (QR2, DOI 10.26131/IRSA652), field, baseline
- Archive: obs id, date, detector, pipeline version, units, quality flags
- Derived: grid id, shape, pixel scale, orientation, wire format, raster size,
  sidecar versions, input/output SHA-256
- Scientific gate: spatial alignment ESTABLISHED, quantitative difference
  DISABLED
- Usage terms: IRSA public data, no usage restrictions (redistribution
  permitted)

The input SHA-256s must match the manifest values:
- epoch-1: `9ceb7ec1f298c1e460aae8c20f95d15ce5a2a79d0acb511099d1b251cf887780`
- epoch-2: `bca6bf0d7f0d72924f8385681f40249295c3b881a273cf75953f67339ce33085`

The output (reprojected) SHA-256s are:
- epoch-1: `7990fa39c27539d0aa85fe5470791643ea2cb3a93893dcc7d5c190c128dff45e`
- epoch-2: `451962d01512d8895cb269fadfa86b340d3563797cc72782517ab8d753104a8c`

---

## 7. Numbered user journey

Follow these steps from a clean browser session. At each step the expected
observation is given so the reader can verify the application is behaving as
documented.

### Step 1 — Load the field

1. Open the application and click **SPHEREx FIELD**.
2. Wait for "Loading SPHEREx products" to resolve (10–30 s on first load).
3. **Expected:** two side-by-side canvases appear, each showing a grayscale
   image of the NEP field. The header reads "SPHEREx · North Ecliptic Pole
   deep field" with a "REAL OBSERVATIONS" tag. The banner reads
   "Visualization — spatial alignment only. Two observations on one agreed
   grid, shown side by side."

### Step 2 — Verify the metadata

4. Scroll to "What is being shown" → "Archive".
5. **Expected:** mission SPHEREx, release "SPHEREx Quick Release Spectral
   Images - QR2", DOI 10.26131/IRSA652, field `nep`, centre 270°, 66.5°,
   baseline ~200.93 d, usage terms "IRSA public data, no usage restrictions".
6. Scroll to "Derived".
7. **Expected:** grid `nep-qr2-common`, shape `[294, 294] (nx, ny)`, pixel
   scale `6.15″/px`, orientation "north-up, east-left", wire format
   `novochar.spherex.raster/v1`, raster size 432180 bytes, sidecar
   `astropy 8.0.2 · reproject 0.1.0` (or the pinned versions), Python 3.14.7.
8. Scroll to "Scientific gate".
9. **Expected:** spatial alignment ESTABLISHED, quantitative difference
   DISABLED, integer-lag ±0 px, peak ρ 0.6386 over 65,328 px, offset 0″.
   The list of "still required before any comparison could be called
   quantitative" is shown (calibration, observing conditions, uncertainty
   model, flag policy).

### Step 3 — Inspect the stretch and coverage

10. Look at the legend below the frames.
11. **Expected:** one stretch bar, shared by both epochs: "stretch X → Y MJy/sr
    (1–99 pct, 69981 valid px, shared by both epochs)" (the exact count depends
    on the valid-pixel union). A "no data" swatch is shown next to it.
12. Look at the coverage note.
13. **Expected:** "Coverage is per observation — epoch-1 draws 81.0% of the grid,
    epoch-2 draws 82.0% of the grid. The remainder of the grid is outside
    that observation's footprint or masked by its quality flags: it stays
    transparent in every view mode and is never filled with zero."

### Step 4 — Move the cursor and read coordinates

14. Move the mouse over the left frame.
15. **Expected:** the readout shows RA / Dec (ICRS) and "pixel x, y (0-based)".
    Moving left-to-right increases RA; moving top-to-bottom decreases Dec
    (north-up, east-left). A pixel outside the footprint reads "no data"
    instead of a number.

### Step 5 — Toggle to a single epoch

16. Click **SINGLE**.
17. **Expected:** one canvas remains. A "DISPLAYING" strip appears naming
    epoch-1 · 2025W18_1B_0095_2, with date, MJD, pipeline version and units.
    The banner reads "One observation at a time on one agreed grid: switching
    changes only which observation is drawn, never the field of view or the
    stretch." The sky position, pixel readout and legend are unchanged.

### Step 6 — Switch epochs

18. Click **EPOCH-2**.
19. **Expected:** the canvas is repainted (same node, not remounted) with
    epoch-2's pixels. The strip now names epoch-2 · 2025W46_2A_0537_1. The
    sky position and legend are unchanged; the checksum of the canvas changes.

### Step 7 — Blink

20. Click **BLINK**.
21. **Expected:** the frame alternates between the two epochs at 500 ms
    (default). The strip updates each frame. **PAUSE** stops the alternation;
    **▶ BLINK** resumes it. Speed can be set to 250/500/1000/2000 ms.
    Clicking an epoch button while blinking pauses it.
22. **Expected banner:** "Two observations alternating on one agreed grid. A
    blink can suggest that something looks different; it cannot by itself
    establish motion or astrophysical variability."

### Step 8 — Select a pixel and inspect evidence

23. Click **SIDE BY SIDE** to return to the reference view.
24. Click a bright pixel in the left frame (e.g. near the centre).
25. **Expected:** a "Selected region" panel appears below the frames. It shows:
    - "Observed (Derived via WCS)" with RA/Dec in ICRS.
    - "Observed (grid)" with `pixel x, y (0-based, array row 0 = top)`.
    - One evidence block per epoch, each with: EVIDENCE LEVEL (Observed),
      OBSERVED (UTC), MJD, DETECTOR, EXPOSURE, QUALITY L1/L2, PIPELINE,
      UNITS, PIXEL VALUE (a number in MJy/sr, or "no data"), VALIDITY,
      COVERED, INPUT SHA-256, OUTPUT SHA-256.
    - A "Limitations" block listing: per-epoch validity, ~19%/~18% uncovered,
      uncorrected calibration, no source-disappearance claim, no motion/
      variability claim, single exposure, no centroid/flux/motion measurements.
26. Click **Clear selection** to remove the panel.

### Step 9 — Verify persistence

27. Select a pixel, then switch SINGLE → EPOCH-2 → BLINK → SIDE BY SIDE.
28. **Expected:** the selection panel survives every switch. The grid pixel
    does not change.
29. Click **↻ RELOAD**.
30. **Expected:** the data re-fetches; the selection panel is still present
    (selection is retained across RELOAD).
31. Reload the browser page (F5).
32. **Expected:** the selection is cleared (no panel); the field reloads fresh.

### Step 10 — Failure recovery

33. (If the sidecar is unavailable) the tab shows
    `sidecar_unavailable: ... — this is a transient environment failure, not a
    missing observation.` with a Retry button.
34. Click Retry.
35. **Expected:** both frames return; the comparison mode is preserved.

---

## 8. Scientific interpretation and limits

### What the view supports

- **Spatial alignment** — both epochs are on one TAN grid at 6.15″/px, 294×294,
  north-up/east-left. The integer-lag cross-correlation found (0, 0) px offset
  (below one pixel). A reader can look at the same sky position in both.
- **Shared display stretch** — one 1–99 percentile stretch over both epochs'
  valid pixels (80,963 pixels), so neither can auto-scale against the other.
- **Honest no-data** — ~19% / ~18% of the grid is uncovered per epoch (outside
  the footprint or masked). These pixels are transparent over a distinct
  backdrop, never zero-filled. A valid zero (0 MJy/sr) is drawn opaque black.
- **Traceable provenance** — every displayed value carries its evidence level
  (Observed / Derived / Hypothesis) and its source (archive metadata, sidecar
  report, WCS, or manifest). SHA-256 hashes link to the exact input and output
  files.
- **Blink as a viewing aid** — a blink can suggest that something looks
  different, but it cannot by itself establish motion or astrophysical
  variability.

### What the view does not support

- **No quantitative difference** — no subtraction, ratio, delta or variability
  statistic is computed anywhere (no route, no control, no client code).
- **No photometric comparison** — calibration and background subtraction are
  not matched between epochs (both share pipeline 6.4+psffix1, but a QR2 vs QR3
  comparison would additionally require flux corrections).
- **No motion detection** — the 6.6-month baseline and 6.15″/px scale are
  stated, but no centroid extraction or positional-difference measurement is
  performed. The lag diagnostic is an integer-pixel spatial-alignment check,
  not an astrometric measurement.
- **No source extraction** — no centroid, no aperture photometry, no
  variability index. These require validated methods not yet implemented.
- **Single exposure** — each epoch is one detector exposure (D2, 113.6 s), not
  a coadd. Variance is interpolated bilinearly with a stated assumption.
- **WCS-WAVE is visualization-grade** — the per-pixel wavelength lookup is
  not science-grade; the Spectral WCS product (CWAVE/CBAND) should be used
  for any scientific wavelength.

### Evidence levels

| Level | Meaning | Examples in this workflow |
|---|---|---|
| **Observed** | Read directly from a validated product | pixel value (MJy/sr), MASK bit, obs id, date, MJD, pipeline version, units, quality flags, SHA-256, coverage fraction |
| **Derived** | Calculated by Novochar using a documented method | sky coordinates (RA/Dec from WCS via `pixelToSky`), grid pixel (x, y), stretch percentiles |
| **Hypothesis** | A possible interpretation requiring further evidence | "a source appears in epoch 1 and not epoch 2 over this pixel's valid area" — always accompanied by the limitation that a blink cannot establish variability |

---

## 9. Clean-session reproducibility

### Environment

- OS: Linux (tested on the development machine)
- Node.js: server + Vite client
- Python: 3.14.7 with pinned sidecar venv (astropy 8.0.2, numpy 2.5.4,
  reproject 0.21.0, scipy 0.18.1, pyerfa 2.0.1.5)
- Browser: Chromium (system `/usr/bin/chromium`, `--no-sandbox`)
- No FITS files committed; `.cache/` and `sidecar/.venv/` are gitignored

### Reproduction steps (from a clean checkout)

```sh
git clone <repo>
cd novochar
npm install
npm run build -w client
npm run dev          # or: PORT=3000 node server/index.js
```

Then open `http://localhost:5173`, click **SPHEREx FIELD**, and follow the
numbered user journey in §7.

### Verification commands

```sh
npm test             # shared 60 + server 200 + client 181 = 441, 0 fail
npm run test:sidecar # 18 tests, OK
npm run check:data    # precomputed data OK
npm run check:spherex # 87 checks, 0 fail (desktop + mobile)
```

### Verification evidence (dated)

| Date | Check | Result |
|---|---|---|
| 2026-10-18 | `npm test` | 441 pass, 0 fail |
| 2026-10-18 | `npm run test:sidecar` | 18 pass, 0 fail |
| 2026-10-18 | `npm run check:data` | OK |
| 2026-10-18 | `npm run check:spherex` | 87 pass, 0 fail (desktop 1600×1000 + mobile 390×844) |
| 2026-10-18 | `npm run build -w client` | OK |
| 2026-10-18 | `check:shell` (Mode A) | pre-existing environment stall (software rendering on a loaded machine); reproduced at HEAD with original sources, not caused by M5 |

### Screenshots (to be captured)

- Desktop (1600×1000): side-by-side view with the evidence panel open on a
  selected pixel, showing both epochs' SHA-256 and the limitations block.
- Mobile (390×844): single-epoch view with the evidence panel and the
  collapsed navigation menu.
- Failure/recovery: the retryable `sidecar_unavailable` state and the
  recovered view.

### Independent reproduction

A second developer should be able to:
1. Clone, install, build and run without undocumented steps.
2. Load the SPHEREx FIELD tab and see the same two epochs with the same
   obs ids, dates and SHA-256 hashes.
3. Select the same pixel (e.g. 100, 143) and read the same pixel value,
   validity and sky coordinates.
4. Confirm that no control offers a difference, subtraction or variability
   measurement.
5. Confirm that the limitations block is present and accurate.

---

## 10. Alternative explanations and limitations

| Observation | Alternative explanation | Why it is not ruled out by this workflow |
|---|---|---|
| A source visible in epoch 1 but not epoch 2 | The pixel may be outside epoch 2's footprint (~18% uncovered) or masked by quality flags | The mask and coverage are reported per epoch; "no data" is never "zero flux" |
| A brightness difference between epochs | Uncorrected calibration differences, different observing conditions, or a real variable source | Calibration is not matched; no photometric comparison is performed |
| A positional shift | Sub-pixel alignment residual, WCS uncertainty, or a real moving object | The lag diagnostic is an integer-pixel check, not an astrometric measurement |
| A new point source in one epoch | An image artifact, a cosmic ray, or a real transient | No source extraction or centroiding is performed; the blink is a viewing aid |

---

## 11. Conclusion

The North Ecliptic Pole SPHEREx workflow demonstrates:

1. **Real data** — two genuine SPHEREx QR2 observations, fetched from IRSA,
   SHA-256 verified, reprojected by a pinned Python sidecar.
2. **Spatial alignment** — both epochs on one TAN grid, integer-lag (0, 0) px,
   shared display stretch, honest no-data handling.
3. **Comparison** — side-by-side, toggle and blink, with the field of view
   fixed through every switch.
4. **Evidence inspection** — per-pixel readout with Observed/Derived/
   Hypothesis labels, SHA-256 provenance, and an always-visible limitations
   block.
5. **Honest limits** — the gate reports `quantitative_difference_enabled:
   false`; no difference, flux, variability or motion claim is made anywhere.

What remains unproven and is explicitly out of scope: quantitative
comparability, photometric variability, astrometric motion, source extraction,
and any Planet X detection. Those require the calibration, uncertainty model
and validated methods that the gate withholds. The workflow is a visualization
and evidence-inspection tool, not a discovery claim.