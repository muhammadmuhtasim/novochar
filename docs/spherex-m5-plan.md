# M5 — Evidence-Based Candidate Inspection (plan)

Written **before** the inspection code, so the contract, the evidence levels and
the scientific limits are decided once and reviewed rather than discovered
during implementation. M4 completed the aligned, real-data comparison workflow
and left the scientific gate closed; M5 must not open it.

## Objective

Let a user select a region in the North Ecliptic Pole SPHEREx field and inspect
the evidence available for that region across the two observations — without
overstating what the observations prove. M5 is **not** an automatic Planet X
detector. It is an evidence-inspection workflow that separates measured data,
derived measurements, user annotations and hypotheses.

---

## Scope

**In:** coordinate-level selection (pixel or sky region), per-epoch evidence
panel (coords, dates, obs ids, units, quality-mask status, provenance), a
three-level evidence taxonomy (Observed / Derived / Hypothesis), explicit
limitations, desktop + mobile acceptance, unit tests.

**Out (deliberately, this milestone):** astrometric positional-difference
claims, photometric variability claims, flux measurements, differencing,
source extraction beyond a centroid, M6 case-study packaging, M7 competition
packaging. A measurement may only be added once its method, coordinate frame,
uncertainty and time baseline are validated and its eligibility gate is open.

---

## Contract 1 — Selection

### What is selectable

A single pixel (and, later, a small sky region) on the displayed raster. The
selection is expressed in **array coordinates** `(x, y)` in the agreed 294×294
grid, with the array row 0 at the top of the image, and in **sky coordinates**
`(ra, dec)` in ICRS derived from the shared WCS.

### Per-epoch persistence

- The selection is stored as an **array coordinate** on the agreed grid, not as
  a screen coordinate. It is therefore invariant across epochs, modes, zoom
  and pan (when zoom/pan arrive later, the selection still names the same
  grid pixel).
- The selection is **shared across epochs**: selecting in side-by-side mode
  selects the same grid pixel in both frames; selecting in single/blink mode
  selects it in the observation on screen.
- The selection is **not** carried across a full page reload unless it is
  persisted (see Contract 4). In-session persistence is sufficient for M5.

### Out-of-footprint behaviour

- If the selected pixel is invalid in an epoch (MASK = 0, or outside the
  footprint), that epoch shows **"no measurement at this pixel"** — never a
  zero, never a colour, never a "source disappeared" statement.
- The per-epoch evidence panel lists the validity status and the reason
  (outside footprint / quality-flagged / informational-flagged / not finite).
- A selection is never rejected because one epoch lacks coverage; both epochs
  are reported, and the uncovered one is reported as uncovered.

### Selection contract (summary)

| Field | Type | Source |
|---|---|---|
| `pixelX`, `pixelY` | integer, 0-based | user click / keyboard |
| `ra`, `dec` | degrees, ICRS | `pixelToSky(wcs, x+0.5, y+0.5)` |
| `selectedEpoch` | index or `null` | the observation the user was looking at |
| `selectionMode` | `pixel` (M5) | extensible later |

---

## Contract 2 — Evidence levels

Every value shown in the inspection panel must be labelled with exactly one of:

- **Observed** — read directly from a validated product (raster pixel value,
  MASK bit, archive metadata, quality flags). Provenance: the product's
  `output_sha256`, the sidecar report, the archive obs id.
- **Derived** — calculated by Novochar using a documented method (sky
  coordinates from WCS, coverage fraction, stretch percentile). Provenance:
  the method name and its inputs.
- **Hypothesis** — a possible interpretation that requires further evidence.
  Never presented as a measurement. Always carries an explicit
  "needs more evidence" marker.

Rules:

1. **No value is shown without its level.** The panel must not mix levels.
2. **Observed values are never re-derived or re-scaled** by the client. The
   raster value is the sidecar's output, read verbatim.
3. **Derived values name their method** (e.g. `pixelToSky` + the WCS
   reference). If the method is not documented, the value cannot be shown.
4. **Hypothesis values are never numeric** in M5. They are text statements
   such as "a source appears in epoch 1 and not epoch 2 over this pixel's
   valid area" — and they must be accompanied by the limitation that a blink
   cannot establish variability.

---

## Contract 3 — Per-epoch evidence panel

For the selected pixel, show one block per epoch (both epochs in side-by-side,
the selected one in single/blink), containing:

- **Sky coordinates** (Observed, via WCS): RA, Dec in ICRS, formatted with
  the existing `fmtRA`/`fmtDec`.
- **Pixel coordinates** (Observed): `x, y` (0-based), array row 0 = top.
- **Pixel value** (Observed, if valid): the float32 IMAGE value in `MJy/sr`,
  or "no data" if MASK = 0 / not finite. No colour, no stretch, no
  re-scaling.
- **Validity** (Observed): `valid` / `invalid` + reason (`outside footprint`,
  `quality-flagged`, `informational-flagged`, `not finite`).
- **Coverage** (Observed): whether this pixel is inside that epoch's footprint
  (`covered_fraction` context).
- **Epoch identity** (Observed): `obs_id`, `date_obs_utc`, MJD, detector,
  `pipeline_version`, units, exposure.
- **Quality flags** (Observed): L1/L2 QA flags from the manifest.
- **Provenance** (Observed): input SHA-256, output SHA-256, grid id, grid
  shape, sidecar versions, the gate flags.

Nothing in this panel may be labelled quantitative, variable, or moving. The
gate disclaimer ("Visualization — spatial alignment only") stays on screen.

---

## Contract 4 — Persistence and recovery

- **In-session:** the selection is held in component state and survives mode
  switches, epoch switches, blink ticks and the `↻ RELOAD` control. It does
  not survive a full page reload in M5 (URL persistence is M6).
- **On reload:** if the selection is lost, the UI shows no selection and
  invites the user to select again — never a stale coordinate.
- **On fetch failure:** the selection is retained in memory; when the data
  reloads the same pixel is re-evaluated against the new mask.
- **On out-of-range selection** (e.g. a stale coordinate from a different
  grid): the selection is cleared and a notice is shown.

---

## Contract 5 — Measurements (deferred gate)

M5 ships **no** new quantitative measurement. The only "measurements" are:

- Coordinate readout (Observed, from WCS).
- Pixel value readout (Observed, from the raster).
- Coverage/validity status (Observed, from the mask).

If a candidate-inspection measurement is later justified (e.g. a centroid
difference), it must pass its own eligibility gate before it can be shown:

| Measurement | Status in M5 | Gate condition |
|---|---|---|
| Coordinate readout | **Observed, shipped** | validated WCS (M3-B) |
| Pixel value readout | **Observed, shipped** | validated raster (M3-B) |
| Coverage / validity | **Observed, shipped** | validated mask (M3-B) |
| Source centroid | **Deferred** | needs a validated extraction method + uncertainty model |
| Positional difference | **Deferred** | needs centroid + astrometric precision + baseline + uncertainty |
| Flux / brightness | **Deferred** | needs calibration validation (gate closed) |
| Variability claim | **Deferred, gated** | gate reports `quantitative_difference_enabled: false` |

A deferred measurement must not appear as a disabled button or a placeholder
number. It must not appear at all until its gate opens.

---

## Contract 6 — Limitations (must be visible)

The inspection panel must always display a "Limitations" block listing, for
the selected region:

- Whether each epoch's pixel is valid, and why not if not.
- The approximate coverage of each epoch (~81% / ~82% of the grid).
- That calibration differences between epochs are not corrected for.
- That a missing or masked pixel is **not** evidence of a source disappearing.
- That a blink or side-by-side view cannot establish motion, variability or
  astrophysical change.
- That the observation is a single detector, single exposure per epoch (D2,
  113.6 s), not a coadd.

This block is not collapsible in M5 and must be present in every mode.

---

## Vertical slices

| Slice | Deliverable | Proof |
|---|---|---|
| **1** | pixel selection + sky-coordinate readout + per-epoch validity | Playwright: click changes the readout; invalid pixel shows "no data"; out-of-footprint shows "uncovered" |
| **2** | evidence panel with Observed/Derived/Hypothesis labels and provenance | Playwright: every value carries a level; no quantitative-difference label |
| **3** | limitations block + loading/recovery states | Playwright: limitations visible in every mode; selection survives a reload of the data |
| **4** | unit tests + desktop/mobile acceptance | `npm test` + `npm run check:spherex` |

M5 exit gate: *a user can select and revisit a sky region; selection coordinates
are consistent with the validated WCS; invalid pixels and uncovered regions are
handled explicitly; every measurement has traceable provenance; uncertainty or
insufficient evidence is clearly communicated; no candidate is presented as a
confirmed discovery; automated and desktop/mobile acceptance tests pass without
regressions.*

---

## As built — (to be filled when implemented)

Run `npm run check:spherex` for the browser half and `npm test` for the units.
All figures below will come from the two real epochs selected in M2
(`2025W18_1B_0095_2`, `2025W46_2A_0537_1`), reprojected by the sidecar
onto the committed 294×294 grid.

| Contract | Check | Result |
|---|---|---|
| 1 — selection | `spherex-selection.test.js`: pixel → WCS round-trip; out-of-range cleared; out-of-footprint reported | (pending) |
| 2 — evidence levels | acceptance: every panel value carries Observed/Derived/Hypothesis; no forbidden labels | (pending) |
| 3 — evidence panel | acceptance: obs id, date, MJD, pipeline, units, quality flags, SHA-256 shown | (pending) |
| 4 — persistence | acceptance: selection survives mode/epoch/blink switch and `↻ RELOAD` | (pending) |
| 5 — no new measurements | acceptance: no control or value matches `centroid|motion|variab|flux|difference` | (pending) |
| 6 — limitations | acceptance: limitations block visible in every mode | (pending) |

**What this proves (when complete):** a user can pick a pixel and see exactly
what each observation says about it, with the level of every value stated and
the limits of the data made explicit.

**What it does not prove:** that anything moved, changed or is a Planet X
candidate. M5 ships no measurement that could support such a claim.

---

## What follows M5?

| Milestone | Goal |
|---|---|
| M6 — Reproducible case study | Package one investigation with exact product IDs, retrieval steps, comparison settings, interpretation, alternatives and limitations. |
| M7 — Competition package | Prepare a clean-session demo, fallback screenshots/video, timed presentation and final validation. |