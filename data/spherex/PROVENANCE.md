# SPHEREx demo field: source manifest and provenance

This note records **Milestone 1 (field selection)** of the competition plan: the
real SPHEREx field we propose to investigate, the exact products, the evidence
that they have the temporal coverage the demo needs, how they were verified
against the archive, and the terms that govern their use. The machine-readable
form is `data/spherex/demo-manifest.json`.

This NEP field is the **primary M2/M3 acceptance dataset**: a reproducible,
controlled comparison. The Comet 3I/ATLAS set is kept as a **separate, optional**
known-moving-object demonstration and is not combined with this workflow.

Nothing here is a claim about Planet X. The goal is a documented, reproducible
observation sequence that supports an honest "what changed between these two
epochs?" investigation — whatever the answer turns out to be.

## Separation of concerns

Keep these separate in code, commits and any redistribution, as with
`data/catalog/PROVENANCE.md`.

| Layer | What it is | Governed by |
| --- | --- | --- |
| **Novochar source code** | Adapters, viewers and scripts added in M2/M3 | Novochar's own project licence |
| **SPHEREx data** | NASA/Caltech archive products | IRSA terms (public, no usage restrictions) |
| **Field selection, manifest & this note** | Our choice of field, verification results, provenance record | Novochar's project licence (documentation is ours) |

**No SPHEREx FITS files are committed to this repository.** The manifest records
archive URLs and SHA-256 checksums so the same cutouts can be fetched on demand
and checked. This mirrors the "no third-party catalogue data is committed" rule
already used for star catalogues.

## The field

- **Field:** North Ecliptic Pole (NEP) deep field.
- **Centre:** RA = 270.0°, Dec = +66.5° (ICRS). Used as a convenient SIA query
  centre; see open questions about the definitive deep-field pointing.
- **Requested cutout:** 0.5° × 0.5° (= 293 × 293 pixels at 6.15″/px).

The NEP is one of SPHEREx's Deep Fields, so it is revisited far more often than
the wide survey. The challenge brief — "mapping the entire sky every six months"
— is represented directly here, since a ~6-month epoch pair exists with the same
pipeline version.

### Why this field (temporal coverage evidence)

A 0.05° SIA query at the centre, recorded in the manifest, shows:

| Collection | Rows | Date range | Distinct dates | Detectors |
| --- | --- | --- | --- | --- |
| QR2 wide | 620 | 2025-04-25 → 2026-07-18 | 318 | D2, D5 |
| QR3 wide | 66 | 2026-07-23 → 2026-09-05 | 33 | D2, D5 |
| QR3 deep | 2943 | 2026-07-20 → 2026-09-07 | 1496 | D1–D6 |

That is roughly 17 months of near-continuous revisit coverage, so the demo is
not dependent on a single lucky pair.

## The product

**Level-2 Spectral Image**, a Multi-Extension FITS file — one per detector per
exposure. This is *not* an ordinary 2D picture: each exposure is a 2040 × 2040
spatial frame in which the wavelength varies across the field (LVF
spectrograph), and the wavelength at each pixel is supplied by a lookup table.

| Property | Value | Source |
| --- | --- | --- |
| Detector / band | 2 (`SPHEREx-D2`) | FITS `DETECTOR=2`; SIA `energy_bandpassname` |
| Wavelength range | 1.1033 – 1.6499 µm | SIA `em_min`/`em_max` |
| Native pixels | 2040 × 2040 | FITS `JACTIVE`/`KACTIVE`; SIA `s_xel1/2` |
| Pixel scale | 6.15 ″/px | SIA `s_pixel_scale`; verified from cutout geometry |
| Projection | `RA---TAN-SIP` / `DEC--TAN-SIP`, `RADESYS=ICRS` | FITS `CTYPE*`, `RADESYS` |
| Exposure | 113.58 s | FITS `XPOSURE` |
| Quality | `L1DQAFLG`/`L2DQAFLG = Pass` | FITS |

Extension-by-extension (verified on a real cutout): `IMAGE` (MJy), `FLAGS`
(bitmask), `VARIANCE` (MJy²), `ZODI` (MJy background model), `PSF` (oversampled
cube in QR2; `EPSF` table in QR3), and `WCS-WAVE` (11 × 11 control-point table of
central wavelength and bandwidth).

## The selected observations

Two epochs, ~6.6 months apart, deliberately sharing the **same pipeline version
(`6.4+psffix1`, build tag `v20`)** so that a brightness comparison is not
confounded by a calibration change.

| | Epoch 1 | Epoch 2 |
| --- | --- | --- |
| `DATE-OBS` (UTC) | 2025-04-29T03:50:28.360 | 2025-11-16T02:07:55.367 |
| `MJD-OBS` | 60794.160050463 | 60995.088835266 |
| `OBSID` | `2025W18_1B_0095_2` | `2025W46_2A_0537_1` |
| Detector | 2 | 2 |
| Pipeline | `6.4+psffix1` / `l2b-v20-2025-240` | `6.4+psffix1` / `l2b-v20-2025-321` |
| Quality | Pass / Pass | Pass / Pass |
| Cutout | 293 × 293, 6 431 040 B | 293 × 293, 6 431 040 B |
| Cutout SHA-256 | `9ceb7ec1…f887780` | `bca6bf0d…ce33085` |

**Baseline: 200.93 days ≈ 6.6 months.**

## Retrieval and reproducibility

- **Search:** IRSA SIA v2, `COLLECTION=spherex_qr2`, CSV response.
- **Cutout:** append `?center=RA,Dec&size=deg` to any archive URL (`size` is in
  degrees). Re-requesting the same URL returned a **byte-identical** file
  (SHA-256 match), so retrieval is deterministic.
- **Cloud mirror:** `s3://nasa-irsa-spherex/qr2/` (us-east-1, no AWS account,
  `aws s3 ls --no-sign-request`).
- **No authentication** is required for any of the above.

## Rights, attribution and redistribution

- **Terms:** IRSA public data, *no usage restrictions*
  (<https://irsa.ipac.caltech.edu/data_use_terms.html>).
- **Citation DOI:** `10.26131/IRSA652` (QR2). (QR1 = `10.26131/IRSA629`, retired;
  QR3 = `10.26131/IRSA662`.)
- **Required acknowledgement:** *"This publication makes use of data products
  from the Spectro-Photometer for the History of the Universe, Epoch of
  Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet
  Propulsion Laboratory and the California Institute of Technology, and is
  funded by the National Aeronautics and Space Administration."*
- **Redistribution:** permitted. We still choose not to commit raw FITS; the app
  should fetch on demand from IRSA (or the AWS mirror) and show the checksum.

## Caveats (verified, not assumed)

Milestone **M2-A** resolved or explicitly gated each of these; the full record is
`docs/spherex-m2a-validation.md`.

1. **Different pointings, therefore different orientation.** The two epochs
   reference different pixels (`CRPIX` 147.5,27.5 vs 86.5,168.5) and different
   sky references. A valid blink **requires WCS reprojection** to a common grid;
   a raw pixel difference would be meaningless.
2. **Units — resolved in M2-A.** The `IMAGE` card reads `BUNIT = 'MJy / sr'`
   (VARIANCE `'MJy2 / sr2'`), matching the archive documentation; the earlier
   "header says MJy" note was a M1 parse artifact. Values are **MJy/sr** surface
   brightness. Label them accordingly.
3. **`WCS-WAVE` is visualization-grade — confirmed in M2-A.** In a cutout its
   control points included invalid edge values (0.032 µm, 1354 nm bandwidth). The
   user guide directs science use to the Spectral WCS calibration product
   (`CWAVE`/`CBAND`).
4. **Version drift across the archive — gated in M2-A.** Epochs months apart can
   carry different pipeline versions and, across QR2→QR3, a gain change handled by
   the `l3_flux_corrections_D2` product. The primary pair shares pipeline
   `6.4+psffix1`; any longer baseline must apply the correction explicitly.
5. **A cutout can silently truncate.** Our first candidate epoch returned a
   59 × 3 cutout because the requested box fell off the edge of the footprint.
   Every candidate must be checked for a full-size cutout, not just for a
   non-empty response.

## Alternatives considered

- **Comet 3I/ATLAS** — validated (data only) in M2-A as **259 exposures / 133
  pointings** of genuine `spherex_qr2` Level-2 images (`target_moving=true`), in
  two campaigns: 2025-08-01→15 and 2025-12-08→14. A known mover gives an
  unambiguous change-over-time demonstration; low S/N and an extended source are
  the caveats. Held as the optional second example (adoption gated on M3-D), not
  part of the NEP workflow. See `docs/spherex-m2a-validation.md`.
- **SPLICES** (SPHEREx Target List of Ice Sources) — IRSA-hosted catalogue; no
  image blink, so not suitable as the primary demo sequence.

## What this milestone does *not* establish

- It does not confirm that anything visible **changes** at the NEP between the two
  epochs. That requires the reprojection and comparison work of M2/M3, and the
  result may honestly be "no significant change."
- It does not identify a Planet X candidate, and nothing in the plan assumes one.
- It does not yet fix the viewer format (M3) or the retrieval adapter (M2).

## Open questions

1. Confirm the definitive NEP deep-field pointing and footprint from the SPHEREx
   Explanatory Supplement, rather than the SIA centroid used as a query centre.
2. Quantify the real change signal between the two epochs once WCS reprojection
   is available.
3. Decide whether the public demo should lead with a static deep field (NEP) or
   with a moving-object sequence (e.g. 3I/ATLAS), or offer both.
