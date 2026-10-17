# SPHEREx M2-A: dataset validation (NEP)

Milestone **M2-A** validates the M1 field manifest — metadata, units, checksums —
and either resolves or explicitly gates every known discrepancy *before* any
retrieval code (M2-B) or viewer (M3) is written. Exit condition: known metadata
discrepancies resolved or explicitly gated.

- **Primary dataset:** North Ecliptic Pole deep field (`data/spherex/demo-manifest.json`).
- **Authority:** *SPHEREx Archive at IRSA — Data Products* user guide (v. 2026-09-28)
  and the *SPHEREx Explanatory Supplement* §2.1, retrieved 2026-10-17.
- **Secondary dataset:** Comet 3I/ATLAS — validated here **only** at the
  data-validation stage, as a separate example. It is not merged into the NEP
  workflow.

## D1 — Units (IMAGE / VARIANCE / ZODI): RESOLVED

| HDU | Header `BUNIT` | Archive documentation | Adopted |
| --- | --- | --- | --- |
| IMAGE | `MJy` | "calibrated **surface brightness** flux density in units of **MJy/sr**" | **MJy/sr** |
| VARIANCE | `MJy2` | "units of **(MJy/sr)²**" | **(MJy/sr)²** |
| ZODI | `MJy` | "**MJy/sr**" | **MJy/sr** |

**Resolution:** the `BUNIT` keyword is an abbreviation that drops `/sr`; the
quantities are surface brightnesses in MJy/sr. The header is not wrong, just
truncated. Any quantitative view must be labelled **MJy/sr**. Converting to flux
requires multiplying by the per-pixel solid angle (the *Solid Angle Pixel Map*
product, or ≈ 6.15² arcsec² nominal).

**Gate:** OK to proceed, provided the app never labels a pixel value as plain
"MJy".

## D2 — Per-pixel spectral WCS: GATED

The `WCS-WAVE` extension is a FITS lookup table (X, Y, VALUES) of central
wavelength and bandwidth. In our cutout its control points include clearly
invalid edge values (0.032 µm wavelength, 1354 nm bandwidth).

**Authority:** the user guide states *"The fidelity of the WCS-WAVE lookup table
is intended for visualization purposes. For science analysis, use the CWAVE and
CBAND extensions in the Spectral WCS calibration product."* Within the valid
grid, bilinear interpolation of the four nearest control points is good to ≈1 nm.

**Gate:** for any scientific wavelength label use
`spectral_wcs_D2_spx_cal-wcs-v*_*.fits` (`CWAVE` = central wavelength in µm,
`CBAND` = bandwidth in µm, both 2040×2040). Treat `WCS-WAVE` as display-only.

## D3 — Band definition: MINOR, DOCUMENTED

The user guide quotes **Band 2 = 1.10–1.62 µm**; the SIA record for our two
exposures gives `em_min/em_max = 1.1033–1.6499 µm`. These are the nominal band
edge versus the detector's full recorded response; they are consistent, not
contradictory. Use the per-observation SIA range for coverage statements and
`CWAVE` for per-pixel central wavelength.

## D4 — Checksums and reproducibility: VERIFIED

Both 0.5° cutouts were re-fetched and hashed; the SHA-256 values match
`demo-manifest.json` byte-for-byte:

- epoch-1 `9ceb7ec1…f887780`
- epoch-2 `bca6bf0d…ce33085`

The cutout service is deterministic for a fixed request.

## D5 — Metadata cross-check (SIA ⟷ FITS ⟷ manifest): VERIFIED

`obs_id`, `DATE-OBS`, `MJD-OBS`, detector, band range and `L1/L2DQAFLG` agree
between the SIA response and the downloaded FITS headers for both epochs. The
manifest's WCS anchors (`CRVAL`, `CRPIX`) come from the cutout headers.

## D6 — Version drift and cross-release gain: GATED

The two primary epochs deliberately share pipeline version **6.4+psffix1**
(build `v20`), so no gain change confounds the pair. Across releases, QR3 data
use a new absolute gain; the user guide provides
`l3_flux_corrections_D2_spx_cal-flxc-v*_*.fits` (per-pixel scaling to combine
QR2 with QR3). Any QR2↔QR3 comparison **must** apply it.

## D7 — PSF product supersession

The QR3 **ePSFs** (`epsf_D2_spx_cal-epsf-v*_*.fits`) supersede the QR2 PSF cube
and are recommended for all images, including QR2. If M3 performs photometry, use
the ePSF, not the bundled `PSF` cube.

## Secondary dataset — Comet 3I/ATLAS (data-validation only)

Validated from the IRSA observation table `obscore_3I_Atlas.vot`
(<https://irsa.ipac.caltech.edu/data/SPHEREx/docs/comet3iatlas/>).

| Property | Finding |
| --- | --- |
| Provenance | `obs_collection = spherex_qr2`, `calib_level = 2`, `dataproduct_subtype = spherex.level2` → genuine SPHEREx Level-2 calibrated spectral images |
| Identity | `target_name = 3I/ATLAS`, `target_moving = true` |
| Volume | 259 exposures, 133 distinct pointings, all six detectors |
| Cadence | 14 dates in two campaigns: **2025-08-01 → 08-15** and **2025-12-08 → 12-14** |
| Motion | predicted comet position moves from RA 252.7°, Dec −17.5° (Aug) to RA 166.4°, Dec +5.4° (Dec) |
| Access | per-exposure datalink URLs, plus official wget/curl scripts and the cutout service |
| Caveats | low signal-to-noise at many wavelengths; source is spatially extended, so the point-source Spectrophotometry Tool is not appropriate |

**Gate:** suitable as an optional *known moving object* demonstration, but it must
clear the same rigor as the NEP before adoption (M3-D). It is explicitly **not**
part of the NEP scientific workflow.

## Outcome

M2-A is complete: the unit discrepancy is **resolved**; the `WCS-WAVE` validity
and cross-release gain issues are **explicitly gated**; checksums and metadata are
**verified**. Proceed to **M2-B — bounded retrieval and caching**.
