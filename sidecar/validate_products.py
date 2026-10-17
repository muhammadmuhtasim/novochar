#!/usr/bin/env python3
"""SPHEREx M3-A: validate source products (WCS, footprint, coverage).

Reads a JSON request describing local, already-verified FITS paths plus the
expectations for them, and writes a JSON report to stdout. It never fetches
anything: the Node server owns retrieval, caching and checksums and hands this
process only local files.

Request
-------
{
  "expected": {
    "ra": 270.0, "dec": 66.5, "size_deg": 0.5,
    "pixel_scale_arcsec": 6.15,
    "extensions": ["IMAGE", "FLAGS", "VARIANCE", "ZODI"],
    "center_tolerance_arcsec": 30.0,
    "min_finite_fraction": 0.98
  },
  "products": [ {"role": "epoch-a", "path": "/abs/a.fits"}, ... ]
}

Response: a JSON report with per-product structure, WCS, coverage and checks.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np
import astropy
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS

DEFAULT_EXPECTED = {
    "extensions": ["IMAGE", "FLAGS", "VARIANCE", "ZODI"],
    "center_tolerance_arcsec": 30.0,
    "min_finite_fraction": 0.98,
}

# The science extensions whose pixel grids must line up.
IMAGE_EXTENSIONS = ("IMAGE", "FLAGS", "VARIANCE", "ZODI")


def _num(value):
    """Coerce a FITS header value to a JSON-safe float or None."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _hdu_index_by_extname(hdulist, extname):
    for i, hdu in enumerate(hdulist):
        if (hdu.header.get("EXTNAME") or "").strip().upper() == extname:
            return i
    return None


def _structure(hdulist):
    out = []
    for i, hdu in enumerate(hdulist):
        h = hdu.header
        shape = []
        for axis in range(h.get("NAXIS", 0), 0, -1):
            shape.append(int(h.get(f"NAXIS{axis}", 0)))
        out.append(
            {
                "index": i,
                "xtension": (h.get("XTENSION") or "PRIMARY").strip(),
                "extname": (h.get("EXTNAME") or "").strip() or None,
                "shape": shape,
                "bunit": (h.get("BUNIT") or "").strip() or None,
            }
        )
    return out


def _wcs_report(hdulist, image_index, expected):
    hdr = hdulist[image_index].header
    nx = int(hdr.get("NAXIS1", 0))
    ny = int(hdr.get("NAXIS2", 0))
    report = {
        "ctype": [hdr.get("CTYPE1"), hdr.get("CTYPE2")],
        "radesys": (hdr.get("RADESYS") or "").strip() or None,
        "crpix": [_num(hdr.get("CRPIX1")), _num(hdr.get("CRPIX2"))],
        "crval": [_num(hdr.get("CRVAL1")), _num(hdr.get("CRVAL2"))],
        "has_sip": any(k.startswith("A_") or k.startswith("B_") for k in hdr),
        "celestial": False,
        "singular": None,
        "pixel_scale_arcsec": None,
        "center_sky": None,
        "corners_sky": None,
        "center_offset_arcsec": None,
    }
    try:
        wcs = WCS(hdr)
    except Exception as exc:  # noqa: BLE001 - report, never crash
        report["error"] = f"WCS(): {exc}"
        return report, []

    report["celestial"] = bool(wcs.has_celestial)
    if not wcs.has_celestial:
        return report, []

    try:
        scales = wcs.proj_plane_pixel_scales()[:2]
        report["pixel_scale_arcsec"] = [float(s.to(u.arcsec).value) for s in scales]
    except Exception:  # noqa: BLE001
        pass

    if wcs.pixel_scale_matrix is not None:
        report["singular"] = bool(abs(np.linalg.det(wcs.pixel_scale_matrix)) < 1e-14)

    # Center and corners in 0-based pixel coordinates; all_pix2world is SIP-aware.
    center_px = [(nx - 1) / 2.0, (ny - 1) / 2.0]
    corner_px = [[0, 0], [nx - 1, 0], [nx - 1, ny - 1], [0, ny - 1]]
    try:
        center_sky = wcs.all_pix2world([center_px], 0)[0]
        corners_sky = wcs.all_pix2world(corner_px, 0)
        report["center_sky"] = [_num(center_sky[0]), _num(center_sky[1])]
        report["corners_sky"] = [[_num(c[0]), _num(c[1])] for c in corners_sky]
        if all(v is not None for v in report["center_sky"]):
            want = SkyCoord(expected["ra"] * u.deg, expected["dec"] * u.deg)
            got = SkyCoord(report["center_sky"][0] * u.deg, report["center_sky"][1] * u.deg)
            report["center_offset_arcsec"] = float(want.separation(got).arcsec)
    except Exception as exc:  # noqa: BLE001
        report["error"] = f"all_pix2world(): {exc}"
    return report, [center_px, corner_px]


def _coverage(hdulist, image_index):
    """Finite-pixel fraction of IMAGE and nonzero-fraction/bits of FLAGS."""
    out = {"image_finite_fraction": None, "flags_nonzero_fraction": None, "flags_bits": {}}
    try:
        data = np.asarray(hdulist[image_index].data, dtype=float)
        out["image_finite_fraction"] = float(np.isfinite(data).mean())
    except Exception:  # noqa: BLE001
        pass
    flags_index = _hdu_index_by_extname(hdulist, "FLAGS")
    if flags_index is not None:
        try:
            flags = np.asarray(hdulist[flags_index].data)
            out["flags_nonzero_fraction"] = float((flags != 0).mean())
            bits = {}
            for bit in range(min(16, int(flags.max()).bit_length() or 1)):
                frac = float(((flags >> bit) & 1).mean())
                if frac > 0:
                    bits[str(bit)] = frac
            out["flags_bits"] = bits
        except Exception:  # noqa: BLE001
            pass
    return out


def _check(checks, ident, status, detail):
    checks.append({"id": ident, "status": status, "detail": detail})


def validate_product(role, path, expected):
    checks = []
    with fits.open(path, memmap=False) as hdulist:
        structure = _structure(hdulist)
        image_index = _hdu_index_by_extname(hdulist, "IMAGE")
        present = {s["extname"] for s in structure if s["extname"]}

        # 1. Required extensions present.
        missing = [e for e in expected["extensions"] if e not in present]
        _check(
            checks,
            "extensions_present",
            "fail" if missing else "pass",
            f"missing {missing}" if missing else f"present {sorted(present)}",
        )

        if image_index is None:
            _check(checks, "image_hdu", "fail", "no HDU with EXTNAME='IMAGE'")
            return {"role": role, "path": path, "structure": structure, "checks": checks}

        # 2. Dimensions match the request (completeness proxy).
        header = hdulist[image_index].header
        nx, ny = int(header.get("NAXIS1", 0)), int(header.get("NAXIS2", 0))
        expected_px = None
        if expected.get("size_deg") and expected.get("pixel_scale_arcsec"):
            expected_px = int(round(expected["size_deg"] * 3600.0 / expected["pixel_scale_arcsec"]))
        dims_ok = expected_px is not None and abs(nx - expected_px) <= 2 and abs(ny - expected_px) <= 2
        _check(
            checks,
            "dimensions_match",
            "pass" if dims_ok else "fail",
            f"IMAGE {nx}x{ny}, expected ~{expected_px}x{expected_px}",
        )

        # 3. Science extensions share the IMAGE grid.
        shapes = {s["extname"]: tuple(s["shape"]) for s in structure if s["extname"] in IMAGE_EXTENSIONS}
        consistent = len({sh for sh in shapes.values()}) <= 1
        _check(
            checks,
            "extension_grids_consistent",
            "pass" if consistent else "warn",
            json.dumps({k: list(v) for k, v in shapes.items()}),
        )

        # 4. Usable celestial WCS.
        wcs_report, _ = _wcs_report(hdulist, image_index, expected)
        _check(checks, "wcs_celestial", "pass" if wcs_report.get("celestial") else "fail", str(wcs_report.get("ctype")))
        singular = wcs_report.get("singular")
        _check(checks, "wcs_invertible", "fail" if singular else "pass", f"singular={singular}")

        # 5. Footprint: the WCS center must land on the requested position.
        offset = wcs_report.get("center_offset_arcsec")
        tol = float(expected.get("center_tolerance_arcsec", 30.0))
        center_ok = offset is not None and offset <= tol
        _check(
            checks,
            "center_matches_request",
            "pass" if center_ok else "fail",
            f"offset {offset:.2f}\" (tol {tol}\")" if offset is not None else "no center",
        )
        corners = wcs_report.get("corners_sky")
        corners_ok = bool(corners) and all(c is not None and all(v is not None for v in c) for c in corners)
        _check(checks, "footprint_corners_finite", "pass" if corners_ok else "fail", json.dumps(corners))

        # 6. Coverage: the IMAGE must be mostly finite (no blank margins).
        coverage = _coverage(hdulist, image_index)
        finite = coverage["image_finite_fraction"]
        min_finite = float(expected.get("min_finite_fraction", 0.98))
        coverage_ok = finite is not None and finite >= min_finite
        _check(
            checks,
            "coverage_complete",
            "pass" if coverage_ok else "fail",
            f"finite fraction {finite:.4f} (min {min_finite})" if finite is not None else "no data",
        )

        primary = {}
        for key in ("VERSION", "DATE", "ORIGIN", "TELESCOP", "INSTRUME"):
            value = hdulist[0].header.get(key)
            primary[key.lower()] = value if value is None else str(value).strip()

        return {
            "role": role,
            "path": path,
            "structure": structure,
            "primary": primary,
            "image": {"index": image_index, "shape": [nx, ny], "bunit": (header.get("BUNIT") or "").strip() or None},
            "wcs": wcs_report,
            "coverage": coverage,
            "checks": checks,
        }


def _cross_product_checks(products):
    """Compare the products as a set: grids, footprint and provenance.

    A differing grid is a *warning*, not a failure: each product can be complete
    and correctly WCS-solved while still not sharing a pixel grid. That is the
    case reprojection (M3-B) exists to resolve.
    """
    if len(products) < 2:
        return {"image_shapes": {}, "pipeline_versions": {}, "checks": []}
    shapes = {p.get("role"): (p.get("image") or {}).get("shape") for p in products}
    versions = {p.get("role"): (p.get("primary") or {}).get("version") for p in products}
    checks = []
    unique_shapes = {tuple(v) for v in shapes.values() if v}
    same_grid = len(unique_shapes) <= 1
    _check(
        checks,
        "common_pixel_grid",
        "pass" if same_grid else "warn",
        "identical grid" if same_grid else f"grids differ {json.dumps({k: v for k, v in shapes.items()})} - reprojection (M3-B) required",
    )
    unique_versions = {v for v in versions.values() if v}
    _check(
        checks,
        "pipeline_version_matches",
        "pass" if len(unique_versions) <= 1 else "warn",
        f"version(s) {sorted(unique_versions)}",
    )
    return {"image_shapes": shapes, "pipeline_versions": versions, "checks": checks}


def build_report(request):
    expected = {**DEFAULT_EXPECTED, **(request.get("expected") or {})}
    if "ra" not in expected or "dec" not in expected:
        raise ValueError("request.expected requires ra and dec")
    products = [validate_product(p.get("role"), p["path"], expected) for p in request.get("products", [])]
    cross = _cross_product_checks(products)
    return {
        "sidecar": {
            "python": sys.version.split()[0],
            "astropy": astropy.__version__,
            "numpy": np.__version__,
        },
        "expected": expected,
        "products": products,
        "cross": cross,
        "ok": bool(products)
        and all(c["status"] != "fail" for p in products for c in p["checks"])
        and all(c["status"] != "fail" for c in cross["checks"]),
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
