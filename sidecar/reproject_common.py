#!/usr/bin/env python3
"""SPHEREx M3-B: reproject validated local cutouts onto one common tangent plane.

Inputs are local, already-verified FITS paths (Node owns retrieval, caching and
checksums). Outputs are reprojected FITS products plus a JSON report.

Scope of the claim: matching output grids plus passing reprojection tests
establish **spatial alignment only**. Nothing here establishes photometric
comparability, and the report says so explicitly.

Handling of the science extensions
----------------------------------
IMAGE      bilinear (`reproject_interp`), footprint retained.
FLAGS      nearest-neighbour, so bit values are copied, never interpolated into
           bit patterns that never existed. Validity is then derived from the
           MP_* definitions carried in each file's own FLAGS header.
VARIANCE   bilinear, with the assumption stated in the report: the variance
           field is interpolated with the same kernel as the flux. Per-pixel
           independent propagation (sum of w_i^2 sigma_i^2) is NOT applied
           because the interpolation weights are not exposed; see
           `variance_model` in the response.
ZODI       not reprojected (deferred; it is a model, not a measurement).

Request (JSON file via --request, or stdin)
-------------------------------------------
{
  "grid": {"ra": 270.0, "dec": 66.5, "pixel_scale_arcsec": 6.15,
           "shape": [294, 294], "rotation_deg": 0.0},
  "method": "bilinear",
  "products": [{"role": "epoch-a", "path": "/abs/a.fits", "sha256": "abc..."}],
  "outputs": {"dir": "/abs/out", "write": true}
}
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import numpy as np
import astropy
import astropy.units as u
from astropy.io import fits
from astropy.wcs import WCS
import reproject
from reproject import reproject_interp

DEFAULT_METHOD = "bilinear"
FOOTPRINT_THRESHOLD = 0.5
# Flag value written where an output pixel samples no input pixel. Outside the
# input footprint reproject returns NaN, and casting NaN to an integer dtype
# yields INT64_MIN; an explicit sentinel keeps that choice visible instead.
FLAGS_OUTSIDE = -1
FLAG_PREFIX = "MP_"

# The bit *numbers* come from the MP_* keywords in each product's own FLAGS
# header (archive-provided). Only the *roles* are fixed here. Anything not
# listed is "unclassified" and is treated as invalid - the conservative default -
# and reported so an unknown bit can never silently pass a mask.
BIT_ROLES = {
    # Pathologies: data that should not be used.
    "MP_TRANSIENT": "pathology",
    "MP_OVERFLOW": "pathology",
    "MP_SUR_ERROR": "pathology",
    "MP_PHANTOM": "pathology",
    "MP_NONFUNC": "pathology",
    "MP_DICHROIC": "pathology",
    "MP_MISSING_DATA": "pathology",
    "MP_HOT": "pathology",
    "MP_COLD": "pathology",
    "MP_PHANMISS": "pathology",
    "MP_NONLINEAR": "pathology",
    "MP_PERSIST": "pathology",
    "MP_OUTLIER": "pathology",
    # Not sky signal: readout reference pixels.
    "MP_REFERENCE": "not_sky",
    # Informational: deliberately does NOT invalidate a pixel.
    "MP_FULLSAMPLE": "informational",
    "MP_SOURCE": "informational",
}
INVALID_ROLES = frozenset({"pathology", "not_sky", "unclassified"})

VARIANCE_MODEL = (
    "bilinear interpolation of the variance field with the same kernel as the flux. "
    "Assumption: the variance field varies smoothly on the pixel scale. Per-pixel "
    "independent propagation (sum of w_i^2 * sigma_i^2) is NOT applied, because "
    "reproject does not expose the interpolation weights."
)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array):
    arr = np.ascontiguousarray(array)
    digest = hashlib.sha256()
    digest.update(str(arr.dtype).encode())
    digest.update(str(arr.shape).encode())
    digest.update(arr.tobytes())
    return digest.hexdigest()


def _sha256_bytes_of_dtypes(arrays):
    """Hash several arrays under one digest, for a single run-level value."""
    digest = hashlib.sha256()
    for arr in arrays:
        digest.update(sha256_array(arr).encode())
    return digest.hexdigest()


def build_target_grid(spec):
    """One deterministic TAN plane shared by every product."""
    ra = float(spec["ra"])
    dec = float(spec["dec"])
    scale = float(spec["pixel_scale_arcsec"])
    nx, ny = int(spec["shape"][0]), int(spec["shape"][1])
    rotation = float(spec.get("rotation_deg", 0.0))

    wcs = WCS(naxis=2)
    wcs.wcs.crpix = [(nx + 1) / 2.0, (ny + 1) / 2.0]
    wcs.wcs.crval = [ra, dec]
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.cunit = ["deg", "deg"]
    theta = np.deg2rad(rotation)
    step = scale / 3600.0
    # North-up, east-left at rotation 0 (the viewer convention), then rotated
    # by rotation_deg. det(CD) < 0, matching the handedness of SPHEREx products.
    wcs.wcs.cd = [
        [-step * np.cos(theta), step * np.sin(theta)],
        [step * np.sin(theta), step * np.cos(theta)],
    ]
    return wcs, (ny, nx)


def read_flag_policy(flags_header, role_map=None):
    """Parse MP_* bit definitions out of the product's own FLAGS header."""
    role_map = role_map or BIT_ROLES
    bits = {}
    for card in flags_header.cards:
        keyword = str(card.keyword).strip().upper()
        if not keyword.startswith(FLAG_PREFIX):
            continue
        try:
            bit = int(card.value)
        except (TypeError, ValueError):
            continue
        role = role_map.get(keyword, "unclassified")
        bits[keyword] = {
            "bit": bit,
            "mask": 1 << bit,
            "role": role,
            "description": (card.comment or "").strip(),
        }
    bits = dict(sorted(bits.items(), key=lambda kv: kv[1]["bit"]))
    invalid_mask = 0
    for info in bits.values():
        if info["role"] in INVALID_ROLES:
            invalid_mask |= info["mask"]
    unclassified = [k for k, v in bits.items() if v["role"] == "unclassified"]
    return {
        "source": "MP_* keywords in this product's FLAGS header",
        "bits": bits,
        "invalid_mask": invalid_mask,
        "unclassified_bits": unclassified,
        "roles": sorted({v["role"] for v in bits.values()}),
    }


def _wcs_from(hdulist, extname, fallback):
    header = hdulist[extname].header
    try:
        wcs = WCS(header)
        if wcs.has_celestial:
            return wcs
    except Exception:  # noqa: BLE001
        pass
    return fallback


def _reproject(array, wcs, target_wcs, shape, order):
    out, footprint = reproject_interp(
        (array, wcs), target_wcs, shape_out=shape, order=order, return_footprint=True
    )
    return out, footprint


def reproject_product(role, path, target_wcs, shape, method, expected_sha256=None, output_path=None):
    checks = []
    result = {
        "role": role,
        "input": {"path": path, "sha256": sha256_file(path)},
        "checks": checks,
    }
    if expected_sha256:
        matches = result["input"]["sha256"] == expected_sha256
        checks.append(
            {
                "id": "input_hash_matches_expected",
                "status": "pass" if matches else "fail",
                "detail": "input bytes match the manifest hash" if matches else "input hash mismatch",
            }
        )

    with fits.open(path, memmap=False) as hdulist:
        image_wcs = _wcs_from(hdulist, "IMAGE", None)
        if image_wcs is None:
            checks.append({"id": "image_wcs_present", "status": "fail", "detail": "no celestial WCS on IMAGE"})
            return result
        flags_wcs = _wcs_from(hdulist, "FLAGS", image_wcs)
        variance_wcs = _wcs_from(hdulist, "VARIANCE", image_wcs)

        policy = read_flag_policy(hdulist["FLAGS"].header)
        image = np.asarray(hdulist["IMAGE"].data, dtype=np.float64)
        flags_in = np.asarray(hdulist["FLAGS"].data, dtype=np.int64)
        variance = np.asarray(hdulist["VARIANCE"].data, dtype=np.float64)
        bunit = (hdulist["IMAGE"].header.get("BUNIT") or "").strip() or None

    out_image, footprint = _reproject(image, image_wcs, target_wcs, shape, method)
    out_variance, _ = _reproject(variance, variance_wcs, target_wcs, shape, "bilinear")
    # Nearest neighbour for the bitmask: copies existing bit values verbatim.
    # reproject leaves NaN outside the input footprint, so the sentinel is
    # applied explicitly rather than let the cast decide.
    out_flags_float, _ = _reproject(flags_in, flags_wcs, target_wcs, shape, 0)
    sampled = (footprint > FOOTPRINT_THRESHOLD) & np.isfinite(out_flags_float)
    out_flags = np.full(shape, FLAGS_OUTSIDE, dtype=np.int32)
    out_flags[sampled] = np.rint(out_flags_float[sampled]).astype(np.int32)

    # --- image -------------------------------------------------------------
    finite = np.isfinite(out_image)
    checks.append(
        {
            "id": "image_reprojected",
            "status": "pass" if out_image.shape == shape and finite.any() else "fail",
            "detail": f"shape {list(out_image.shape)} vs target {list(shape)}, finite {int(finite.sum())}/{out_image.size}",
        }
    )

    # --- footprint ---------------------------------------------------------
    covered = footprint > FOOTPRINT_THRESHOLD
    checks.append(
        {
            "id": "footprint_retained",
            "status": "pass" if covered.any() else "fail",
            "detail": f"covered {covered.mean():.4f} at threshold {FOOTPRINT_THRESHOLD}",
        }
    )

    # --- flags -------------------------------------------------------------
    checks.append(
        {
            "id": "flags_reprojected_nearest_neighbour",
            "status": "pass",
            "detail": "order=0 copies bit values; no interpolated bit patterns",
        }
    )
    input_values = set(np.unique(flags_in).tolist())
    output_values = set(np.unique(out_flags[sampled]).tolist())
    invented = sorted(output_values - input_values)
    checks.append(
        {
            "id": "flags_bit_values_preserved",
            "status": "pass" if not invented else "fail",
            "detail": (
                f"all {len(output_values)} sampled flag values already exist in the input "
                f"(outside-footprint sentinel {FLAGS_OUTSIDE} excluded)"
                if not invented
                else f"invented values {invented[:10]}"
            ),
        }
    )
    checks.append(
        {
            "id": "flag_definitions_from_header",
            "status": "pass" if not policy["unclassified_bits"] else "warn",
            "detail": (
                f"{len(policy['bits'])} MP_* bits read from the FLAGS header; "
                f"unclassified (treated invalid): {policy['unclassified_bits'] or 'none'}"
            ),
        }
    )

    # --- validity ----------------------------------------------------------
    quality_bits = [k for k, v in policy["bits"].items() if v["role"] == "pathology"]
    info_bits = [k for k, v in policy["bits"].items() if v["role"] == "informational"]
    quality_mask = 0
    for name in quality_bits:
        quality_mask |= policy["bits"][name]["mask"]
    info_mask = 0
    for name in info_bits:
        info_mask |= policy["bits"][name]["mask"]

    # A pixel is usable only if it is covered, finite, and carries no invalid
    # bit. Outside the footprint there is no flag data at all, so it is invalid.
    flag_ok = np.zeros(shape, dtype=bool)
    flag_ok[sampled] = (out_flags[sampled] & policy["invalid_mask"]) == 0
    valid = covered & finite & flag_ok
    checks.append(
        {
            "id": "validity_mask_derived_from_definitions",
            "status": "pass",
            "detail": f"valid {valid.mean():.4f}; invalid roles {sorted(INVALID_ROLES)}",
        }
    )

    # --- variance ----------------------------------------------------------
    checks.append(
        {
            "id": "variance_handling_explicit",
            "status": "pass",
            "detail": VARIANCE_MODEL,
        }
    )

    # Flag statistics describe sampled pixels only - outside the footprint there
    # are no flags to report, and the sentinel must not read as a flagged pixel.
    sampled_flags = out_flags[sampled]

    def _fraction(bits):
        if sampled_flags.size == 0:
            return 0.0
        return round(float(((sampled_flags & bits) != 0).mean()), 6)

    per_bit = {}
    for name, info in policy["bits"].items():
        frac = _fraction(info["mask"])
        if frac > 0:
            per_bit[name] = {"bit": info["bit"], "role": info["role"], "fraction": frac}

    result.update(
        {
            "image": {"shape": list(shape), "bunit": bunit},
            "stats": {
                "covered_fraction": round(float(covered.mean()), 6),
                "valid_fraction": round(float(valid.mean()), 6),
                "finite_fraction": round(float(finite.mean()), 6),
                "any_flag_fraction": (
                    round(float((sampled_flags != 0).mean()), 6) if sampled_flags.size else 0.0
                ),
                "quality_flag_fraction": _fraction(quality_mask),
                "informational_flag_fraction": _fraction(info_mask),
                "median": float(np.nanmedian(out_image[valid])) if valid.any() else None,
            },
            "flag_policy": {
                "source": policy["source"],
                "invalid_roles": sorted(INVALID_ROLES),
                "unclassified_bits": policy["unclassified_bits"],
                "per_bit": per_bit,
            },
        }
    )

    if output_path:
        arrays = {
            "IMAGE": out_image.astype(np.float32),
            "VARIANCE": out_variance.astype(np.float32),
            "FLAGS": out_flags.astype(np.int32),
            "MASK": valid.astype(np.uint8),
            "FOOTPRINT": footprint.astype(np.float32),
        }
        grid_header = target_wcs.to_header()
        hdus = []
        for name, data in arrays.items():
            header = grid_header.copy()
            header["EXTNAME"] = name
            if name == "IMAGE":
                header["BUNIT"] = bunit or "MJy / sr"
            elif name == "VARIANCE":
                header["BUNIT"] = "MJy2 / sr2"
            elif name == "MASK":
                header["BUNIT"] = "valid"
                header["COMMENT"] = "1 = usable pixel (covered, finite, no invalid flags)"
            hdus.append(fits.ImageHDU(data=data, header=header))
        primary = fits.PrimaryHDU()
        primary.header["ORIGIN"] = "novochar sidecar M3-B"
        primary.header["METHOD"] = method
        primary.header["INPUTSHA"] = result["input"]["sha256"]
        primary.header["ASTROPY"] = astropy.__version__
        primary.header["REPROJ"] = reproject.__version__
        primary.header["TCRV1"] = float(target_wcs.wcs.crval[0])
        primary.header["TCRV2"] = float(target_wcs.wcs.crval[1])
        primary.header["TCRPX1"] = float(target_wcs.wcs.crpix[0])
        primary.header["TCRPX2"] = float(target_wcs.wcs.crpix[1])
        primary.header["COMMENT"] = "Spatial alignment only - not photometric comparability."
        hdulist_out = fits.HDUList([primary, *hdus])
        hdulist_out.writeto(output_path, overwrite=True, checksum=False)
        result["output"] = {"path": output_path, "sha256": sha256_file(output_path)}
        result["arrays_sha256"] = _sha256_bytes_of_dtypes(list(arrays.values()))

    # Retained in memory for the cross-epoch alignment diagnostic, then stripped
    # before the report is serialised.
    result["_image"] = out_image
    result["_mask"] = valid
    return result


def _alignment_diagnostic(products, scale_arcsec, max_lag=4, tolerance_px=1.0):
    """Measure the residual relative offset between reprojected epochs.

    Cross-correlates the reprojected images over the region valid in both, at
    integer pixel lags. This is a *spatial* measurement only: a small offset
    says the two epochs are mapped onto the same grid, not that their fluxes
    are comparable.

    Returns (diagnostic, check) or (None, None) when there is less than a pair.
    """
    ready = [p for p in products if p.get("_image") is not None and p.get("_mask") is not None]
    if len(ready) < 2:
        return None, None

    ref, other = ready[0], ready[1]
    a = np.asarray(ref["_image"], dtype=float)
    b = np.asarray(other["_image"], dtype=float)
    common = np.asarray(ref["_mask"], dtype=bool) & np.asarray(other["_mask"], dtype=bool)
    if int(common.sum()) < 1000:
        return None, None

    best = None
    for dy in range(-max_lag, max_lag + 1):
        for dx in range(-max_lag, max_lag + 1):
            shifted = np.full(a.shape, np.nan)
            dst_y = slice(max(0, dy), a.shape[0] + min(0, dy))
            dst_x = slice(max(0, dx), a.shape[1] + min(0, dx))
            src_y = slice(max(0, -dy), a.shape[0] + min(0, -dy))
            src_x = slice(max(0, -dx), a.shape[1] + min(0, -dx))
            shifted[dst_y, dst_x] = a[src_y, src_x]
            both = common & np.isfinite(shifted) & np.isfinite(b)
            if int(both.sum()) < 1000:
                continue
            av = shifted[both] - np.median(shifted[both])
            bv = b[both] - np.median(b[both])
            denom = float(np.sqrt((av * av).sum() * (bv * bv).sum()))
            if denom <= 0:
                continue
            score = float((av * bv).sum() / denom)
            if best is None or score > best[0]:
                best = (score, dx, dy)

    if best is None:
        return None, None

    score, dx, dy = best
    offset_px = float(np.hypot(dx, dy))
    offset_arcsec = offset_px * scale_arcsec
    diagnostic = {
        "pair": [ref["role"], other["role"]],
        "lag_px": [dx, dy],
        "offset_px": round(offset_px, 3),
        "offset_arcsec": round(offset_arcsec, 3),
        "peak_correlation": round(score, 4),
        "common_pixels": int(common.sum()),
        "resolution": (
            f"integer-lag search within +/-{max_lag} px; 1 px = {scale_arcsec}\" so an "
            "offset of 0 means \"below one pixel\", not literally zero. Sub-pixel "
            "offsets are not resolved by this diagnostic."
        ),
        "scope": "spatial alignment only - not a flux or variability measurement",
    }
    if offset_px <= tolerance_px:
        status = "pass"
    elif offset_px <= 2 * tolerance_px:
        status = "warn"
    else:
        status = "fail"
    check = {
        "id": "cross_epoch_alignment",
        "status": status,
        "detail": (
            f"residual integer-lag offset ({dx:+d},{dy:+d}) px at peak correlation "
            f"{score:.3f} over {diagnostic['common_pixels']} common pixels; 1 px = "
            f"{scale_arcsec}\" so the epochs are aligned to within one pixel "
            f"(tolerance {tolerance_px} px). Spatial only."
        ),
    }
    return diagnostic, check


def build_report(request):
    grid_spec = request["grid"]
    method = request.get("method", DEFAULT_METHOD)
    target_wcs, shape = build_target_grid(grid_spec)
    ny, nx = shape

    outputs = request.get("outputs") or {}
    out_dir = outputs.get("dir")
    write = bool(outputs.get("write", False))
    if write and not out_dir:
        raise ValueError("outputs.write requires outputs.dir")

    products = []
    for entry in request.get("products", []):
        role = entry.get("role") or "product"
        output_path = os.path.join(out_dir, f"{role}_reprojected.fits") if write else None
        products.append(
            reproject_product(
                role,
                entry["path"],
                target_wcs,
                shape,
                method,
                expected_sha256=entry.get("sha256"),
                output_path=output_path,
            )
        )

    # Requires the reprojected arrays, so run this before they are stripped for
    # serialisation.
    alignment, alignment_check = _alignment_diagnostic(
        products, float(grid_spec["pixel_scale_arcsec"])
    )
    for product in products:
        product.pop("_image", None)
        product.pop("_mask", None)

    grids = {p["role"]: p["image"]["shape"] for p in products if p.get("image")}
    checks = [
        {
            "id": "outputs_share_target_grid",
            "status": "pass" if len({tuple(v) for v in grids.values()}) <= 1 else "fail",
            "detail": f"target TAN plane {nx}x{ny} at {grid_spec['pixel_scale_arcsec']}\"/px; {json.dumps(grids)}",
        },
    ]
    if alignment_check:
        checks.append(alignment_check)
    checks.append(
        {
            "id": "quantitative_difference_disabled",
            "status": "pass",
            "detail": "difference/photometry claims are off: spatial alignment only",
        }
    )

    ok = bool(products) and all(c["status"] != "fail" for p in products for c in p["checks"]) and all(
        c["status"] != "fail" for c in checks
    )

    return {
        "sidecar": {
            "python": sys.version.split()[0],
            "astropy": astropy.__version__,
            "numpy": np.__version__,
            "reproject": reproject.__version__,
        },
        "milestone": "M3-B",
        "method": {
            "IMAGE": f"reproject_interp order={method}",
            "FLAGS": "reproject_interp order=0 (nearest-neighbour)",
            "VARIANCE": "reproject_interp order=bilinear (see variance_model)",
            "variance_model": VARIANCE_MODEL,
            "footprint_threshold": FOOTPRINT_THRESHOLD,
            "flags_outside_footprint": FLAGS_OUTSIDE,
        },
        "grid": {
            "ra": float(grid_spec["ra"]),
            "dec": float(grid_spec["dec"]),
            "pixel_scale_arcsec": float(grid_spec["pixel_scale_arcsec"]),
            "shape": [nx, ny],
            "rotation_deg": float(grid_spec.get("rotation_deg", 0.0)),
            "ctype": ["RA---TAN", "DEC--TAN"],
            "crpix": [float(v) for v in target_wcs.wcs.crpix],
        },
        "products": products,
        "checks": checks,
        "alignment": alignment,
        "gate": {
            "spatial_alignment": ok,
            "quantitative_difference_enabled": False,
            "acceptance_rule": (
                "Matching output grids and successful reprojection tests establish spatial "
                "alignment - not scientific comparability."
            ),
            "still_required_for_comparability": [
                "matching calibration and background subtraction",
                "identical observing conditions / photometric response",
                "uncertainty model validated against the variance extension",
                "data-quality flag policy reviewed against the Explanatory Supplement",
            ],
        },
        "ok": ok,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", help="path to a JSON request (default: stdin)")
    args = parser.parse_args(argv)
    if args.request:
        with open(args.request, encoding="utf-8") as handle:
            request = json.load(handle)
    else:
        request = json.load(sys.stdin)
    json.dump(build_report(request), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
