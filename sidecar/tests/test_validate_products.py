"""Tests for the M3-A product validator.

These exercise the real astropy path with synthetic FITS files whose WCS is
known exactly, so a passing check is evidence about the validator, not about the
archive. Run with:

    sidecar/.venv/bin/python -m unittest discover -s sidecar/tests -v
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from validate_products import build_report  # noqa: E402


def make_product(path, nx=100, ny=100, crval=(270.0, 66.5), nan_fraction=0.0, with_zodi=True):
    w = WCS(naxis=2)
    w.wcs.crpix = [(nx + 1) / 2, (ny + 1) / 2]  # crval at the array centre
    w.wcs.crval = list(crval)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.cdelt = [-6.15 / 3600, 6.15 / 3600]

    image = np.full((ny, nx), 1.0, dtype=np.float32)
    if nan_fraction:
        flat = image.reshape(-1)
        flat[: int(nan_fraction * flat.size)] = np.nan

    primary = fits.PrimaryHDU()
    primary.header["VERSION"] = "6.4+psffix1"
    hdus = [primary]
    image_hdu = fits.ImageHDU(data=image, header=w.to_header())
    image_hdu.header["EXTNAME"] = "IMAGE"
    image_hdu.header["BUNIT"] = "MJy / sr"
    hdus.append(image_hdu)
    for name, bunit in (("FLAGS", None), ("VARIANCE", "MJy2 / sr2")):
        hdu = fits.ImageHDU(data=np.zeros((ny, nx), dtype=np.int16), name=name)
        if bunit:
            hdu.header["BUNIT"] = bunit
        hdus.append(hdu)
    if with_zodi:
        hdus.append(fits.ImageHDU(data=np.zeros((ny, nx), dtype=np.float32), name="ZODI"))
    fits.HDUList(hdus).writeto(path, overwrite=True)


class ValidateProductsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "product.fits")
        self.expected = {
            "ra": 270.0,
            "dec": 66.5,
            "size_deg": 100 * 6.15 / 3600,
            "pixel_scale_arcsec": 6.15,
            "center_tolerance_arcsec": 30.0,
        }

    def tearDown(self):
        self.tmp.cleanup()

    def report(self, expected=None, **kwargs):
        make_product(self.path, **kwargs)
        return build_report({"expected": expected or self.expected, "products": [{"role": "epoch-a", "path": self.path}]})

    def status(self, report, check_id):
        return next(c["status"] for c in report["products"][0]["checks"] if c["id"] == check_id)

    def test_valid_product_passes_and_reports_wcs(self):
        report = self.report()
        self.assertTrue(report["ok"], report)
        self.assertEqual(self.status(report, "center_matches_request"), "pass")
        self.assertEqual(self.status(report, "coverage_complete"), "pass")
        self.assertEqual(self.status(report, "wcs_celestial"), "pass")
        wcs = report["products"][0]["wcs"]
        self.assertTrue(wcs["celestial"])
        self.assertLess(wcs["center_offset_arcsec"], 1.0)
        self.assertAlmostEqual(wcs["pixel_scale_arcsec"][0], 6.15, places=3)
        self.assertEqual(report["products"][0]["primary"]["version"], "6.4+psffix1")

    def test_wrong_center_fails(self):
        expected = {**self.expected, "dec": 66.6}
        report = self.report(expected=expected)
        self.assertFalse(report["ok"])
        self.assertEqual(self.status(report, "center_matches_request"), "fail")

    def test_missing_extension_fails(self):
        report = self.report(with_zodi=False)
        self.assertFalse(report["ok"])
        self.assertEqual(self.status(report, "extensions_present"), "fail")

    def test_truncated_dimensions_fail(self):
        expected = {**self.expected, "size_deg": 0.5}  # asks for ~293 px, file is 100
        report = self.report(expected=expected)
        self.assertEqual(self.status(report, "dimensions_match"), "fail")

    def test_blank_margin_detected_by_coverage(self):
        report = self.report(nan_fraction=0.30)
        self.assertFalse(report["ok"])
        self.assertEqual(self.status(report, "coverage_complete"), "fail")

    def test_cross_product_grid_and_provenance_checks(self):
        a = os.path.join(self.tmp.name, "a.fits")
        b = os.path.join(self.tmp.name, "b.fits")
        make_product(a, nx=100, ny=100)
        make_product(b, nx=101, ny=100)  # deliberately off the common grid

        def cross(nx_b):
            make_product(b, nx=nx_b, ny=100)
            report = build_report(
                {
                    "expected": self.expected,
                    "products": [{"role": "epoch-a", "path": a}, {"role": "epoch-b", "path": b}],
                }
            )
            return {c["id"]: c["status"] for c in report["cross"]["checks"]}, report["ok"]

        checks, ok = cross(101)
        self.assertEqual(checks["common_pixel_grid"], "warn")
        self.assertEqual(checks["pipeline_version_matches"], "pass")
        self.assertTrue(ok, "a differing grid warns, it does not fail")

        checks, ok = cross(100)
        self.assertEqual(checks["common_pixel_grid"], "pass")
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
