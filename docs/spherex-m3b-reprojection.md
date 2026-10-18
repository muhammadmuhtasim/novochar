# SPHEREx M3-B: reprojection onto a common tangent plane

Milestone **M3-B** maps both selected epochs onto one deterministic tangent-plane
grid so they can be viewed together. Gate: **passed** (`ok = true`).

**Acceptance rule:** matching output grids plus passing reprojection tests
establish **spatial alignment — not scientific comparability**. The report states
this itself and keeps `quantitative_difference_enabled: false`.

## Environment

`sidecar/requirements.txt`, pinned and verified in the Python 3.14 venv:

```
astropy==8.0.2  numpy==2.5.4  reproject==0.21.0  scipy==1.18.1  pyerfa==2.0.1.5
```

Every report carries its own interpreter and library versions, so a stale
environment cannot masquerade as the tested one.

```sh
sidecar/.venv/bin/python sidecar/reproject_common.py --request request.json
sidecar/.venv/bin/python -m unittest discover -s sidecar/tests   # 18 tests
```

## The common grid

One deterministic TAN plane shared by every product, `north-up / east-left` (the
viewer convention) at rotation 0, `det(CD) < 0` matching SPHEREx handedness:

| | |
| --- | --- |
| tangent point | RA 270.0°, Dec 66.5° |
| pixel scale | 6.15″/px |
| shape | 294 × 294, `CRPIX` (147.5, 147.5) |
| projection | `RA---TAN` / `DEC--TAN` |
| rotation | 0.0° |

## How each extension is handled

| Extension | Method | Why |
| --- | --- | --- |
| IMAGE | `reproject_interp` bilinear | the science image |
| FLAGS | `reproject_interp` **nearest-neighbour** | copies existing bit values; a bitmask must never be interpolated into a pattern no input pixel ever had |
| VARIANCE | bilinear, **assumption stated** | see below |
| ZODI | *not* reprojected | a model rather than a measurement; deferred |

**Variance model (recorded verbatim in every report).** The variance field is
interpolated with the same kernel as the flux. The assumption is that the
variance field varies smoothly on the pixel scale. Per-pixel independent
propagation — `sum of w_i^2 * sigma_i^2` — is **not** applied, because `reproject`
does not expose its interpolation weights. Implemented only because the
assumptions are written down.

**Flag policy.** The bit *numbers* are read from the `MP_*` keywords in each
product's own FLAGS header (the archive embeds its definitions there), so no bit
value is assumed. Only the *roles* are fixed in code:

- `pathology` (13 bits: transient, overflow, sur_error, phantom, nonfunc, dichroic,
  missing_data, hot, cold, phanmiss, nonlinear, persist, outlier) → invalid
- `not_sky` (`MP_REFERENCE`) → invalid
- `informational` (`MP_SOURCE`, `MP_FULLSAMPLE`) → **does not** invalidate
- anything unlisted → `unclassified`, conservatively **invalid**, and reported so an
  unknown bit can never silently pass a mask

**Footprint.** An output pixel is usable only if it is covered (`footprint > 0.5`),
finite, and carries no invalid bit. Outside the input footprint there is no flag
data at all, so those pixels are invalid — written as a declared sentinel
(`FLAGS_OUTSIDE = -1`), never as "all flags clear".

## Validation (18 tests)

Covers each required case, on synthetic products whose WCS is known exactly:

| Case | Test |
| --- | --- |
| synthetic point source | `test_point_source_lands_on_expected_output_pixel` (≤ 1 px of the analytically expected output pixel) |
| constant image | `test_constant_image_is_preserved` (valid pixels identical to input), `test_variance_is_interpolated_with_explicit_assumption` |
| shifted / rotated WCS | `test_epochs_with_different_wcs_align` (293-vs-294-style offsets and a 180° rotation reproject to the *same* pixel) |
| partial coverage | `test_partial_coverage_is_masked_not_filled` (uncovered ⇒ `MASK=0`, centre covered) |
| masks | `test_flags_are_nearest_neighbour_and_policy_is_applied`, `test_bit_roles_come_from_the_header_not_assumption` |
| repeated-run reproducibility | `test_repeated_runs_are_byte_identical` (identical output SHA-256 across runs) |
| gate scope | `test_gate_claims_alignment_only` |

## Real-data result

Both manifest cutouts, hashes re-verified through the sidecar itself.

| | epoch-a `2025W18_1B_0095_2` | epoch-b `2025W46_2A_0537_1` |
| --- | --- | --- |
| input shape / sky PA | 293 × 293, **PA 123.6°** | 294 × 293, **PA −29.1°** |
| input hash check | matches manifest | matches manifest |
| covered fraction | 0.8337 | 0.8455 |
| valid fraction | 0.8096 | 0.8203 |
| any-flag fraction | 0.4337 | 0.4336 |
| **quality-flag fraction** | **0.0289** | **0.0298** |
| informational-flag fraction | 0.4078 | 0.4064 |

Cross-epoch diagnostic: **residual integer-lag offset (0, 0) px** at peak
correlation 0.639 over **65,328 common pixels**. The search uses integer lags
within ±4 px, so "0" means *below one pixel* (1 px = 6.15″); sub-pixel offsets are
**not** resolved by this diagnostic. It is labelled spatial only.

## Findings

1. **The epochs are rotated differently on the sky** (PA 123.6° vs −29.1°), both
   correctly centred on the requested position. This is the direct confirmation
   that raw pixel blink is invalid — it also explains why a same-centre,
   same-scale grid still only reaches ~83 % coverage: the target square and the
   two rotated input squares only partly overlap. The uncovered rim is masked,
   not filled.
2. **The 43 % flag figure from M3-A decomposes.** Any-flag is ~0.434, but only
   **~2.9 % of pixels carry a quality flag**; **40.8 % is `MP_SOURCE`** (bit 21,
   "pixel mapped to a known source"), which is informational. Masking every
   nonzero flag — the naive reading of M3-A's number — would throw away two fifths
   of the field, most of it perfectly usable. Quality flags are dominated by
   `MP_OUTLIER` (2.3 %), then transient (~0.5 %), sur_error (~0.3 %), persist,
   nonfunc, cold, overflow.
3. **All 16 real `MP_*` bits are classified** — no unclassified bits in either
   epoch, so no conservative fallback was exercised on real data (it is covered
   only by the synthetic test).
4. **Reproducibility is carried across the boundary.** Input SHA-256 values match
   the M2 manifest, and repeated runs produce byte-identical outputs. That is
   reproducibility of inputs *and* determinism of processing — still not
   comparability.
5. **Bugs the tests caught** (both would have corrupted results silently):
   - `reproject` returns NaN outside the footprint, and casting NaN to an integer
     dtype silently yields `INT64_MIN`. That invented a flag value no input pixel
     had *and* made 82 % of the grid read as "flagged". Fixed with a declared
     sentinel and a subset check restricted to sampled pixels.
   - astropy 8 changed `float(Quantity)` to raise and returns 0-d ndarrays from
     the `*_pixel_values` helpers (no `__round__`), which silently returned
     `None` for the pixel scale under a broad `except` in M3-A — caught only
     because the test asserted the value.

## Gate

- `spatial_alignment: true` — common grid, passing reprojection tests, residual
  offset below one pixel.
- `quantitative_difference_enabled: **false**` — with recorded reasons:
  calibration/background not matched, observing conditions not shown identical,
  uncertainty model unvalidated, flag policy still to be reviewed against the
  Explanatory Supplement.

The comparison in M3-C is therefore labelled a **visualization**. Per-epoch
descriptive statistics are recorded in the report but never differenced.

## Status

- M3-A: complete (`docs/spherex-m3a-validation.md`).
- M3-B: **complete, gate passed.**
- Next: **M3-C** — viewer (epoch A, epoch B, comparison, with full metadata), then
  M3-D (3I/ATLAS, separate).
