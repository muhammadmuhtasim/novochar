"""Tests for M3-B reprojection: alignment, masks and reproducibility.

Synthetic products with known WCS, so a passing assertion is evidence about the
reprojection path rather than about the archive.

    sidecar/.venv/bin/python -m unittest discover -s sidecar/tests -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import warnings

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
import astropy.units as u

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from reproject_common import (  # noqa: E402
    BIT_ROLES,
    build_report,
    build_target_grid,
    read_flag_policy,
)

PIXEL_SCALE = 6.15  # arcsec, matches the real cutouts
CENTER = (270.0, 66.5)
# Archive-style MP_* definitions written into the synthetic FLAGS header.
MP_CARDS = [
    ("MP_TRANSIENT", 0, "Transient detected during SUR"),
    ("MP_SUR_ERROR", 2, "Error in onboard processing"),
    ("MP_NONFUNC", 6, "Permanently unusable"),
    ("MP_PERSIST", 17, "Persistent charge above threshold"),
    ("MP_SOURCE", 21, "Pixel mapped to a known source"),
    ("MP_MYSTERY", 30, "Deliberately undefined bit"),
]


def wcs_for(nx, ny, crpix=None, crval=CENTER, rotation_deg=0.0):
    w = WCS(naxis=2)
    w.wcs.crpix = list(crpix) if crpix else [(nx + 1) / 2.0, (ny + 1) / 2.0]
    w.wcs.crval = list(crval)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.cunit = ["deg", "deg"]
    theta = np.deg2rad(rotation_deg)
    step = PIXEL_SCALE / 3600.0
    w.wcs.cd = [
        [-step * np.cos(theta), step * np.sin(theta)],
        [-step * np.sin(theta), -step * np.cos(theta)],
    ]
    return w


def make_product(path, **kwargs):
    """Write a synthetic product, silencing the HIERARCH-keyword notices.

    The MP_* keys exceed 8 characters. The real archive product writes them as
    HIERARCH cards too, so mirror that convention instead of renaming them.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return _write_product(path, **kwargs)


def _write_product(path, nx=120, ny=120, crpix=None, crval=CENTER, rotation_deg=0.0,
                   image=None, flags=None, variance=None):
    w = wcs_for(nx, ny, crpix=crpix, crval=crval, rotation_deg=rotation_deg)
    if image is None:
        image = np.full((ny, nx), 5.0, dtype=np.float32)
    if flags is None:
        flags = np.zeros((ny, nx), dtype=np.int32)
    if variance is None:
        variance = np.full((ny, nx), 4.0, dtype=np.float32)

    primary = fits.PrimaryHDU()
    primary.header["VERSION"] = "6.4+psffix1"
    hdus = [primary]

    image_hdu = fits.ImageHDU(data=image.astype(np.float32), header=w.to_header())
    image_hdu.header["EXTNAME"] = "IMAGE"
    image_hdu.header["BUNIT"] = "MJy / sr"
    hdus.append(image_hdu)

    flags_hdu = fits.ImageHDU(data=flags.astype(np.int32), header=w.to_header())
    flags_hdu.header["EXTNAME"] = "FLAGS"
    for name, bit, comment in MP_CARDS:
        flags_hdu.header[name] = (bit, comment)
    hdus.append(flags_hdu)

    variance_hdu = fits.ImageHDU(data=variance.astype(np.float32), header=w.to_header())
    variance_hdu.header["EXTNAME"] = "VARIANCE"
    variance_hdu.header["BUNIT"] = "MJy2 / sr2"
    hdus.append(variance_hdu)

    hdus.append(fits.ImageHDU(data=np.zeros((ny, nx), dtype=np.float32), name="ZODI"))
    fits.HDUList(hdus).writeto(path, overwrite=True)
    return w


def grid_spec(shape=(120, 120)):
    return {
        "ra": CENTER[0],
        "dec": CENTER[1],
        "pixel_scale_arcsec": PIXEL_SCALE,
        "shape": list(shape),
        "rotation_deg": 0.0,
    }


def status_of(checks, ident):
    for c in checks:
        if c["id"] == ident:
            return c["status"]
    return None


def _idx(value):
    """Round a pixel coordinate to an index.

    astropy 8 returns 0-d ndarray values from the *_pixel_values helpers, and
    ndarray does not implement __round__, so coerce through float first.
    """
    return int(round(float(np.asarray(value))))


class ReprojectCommonTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "product.fits")
        self.out_dir = os.path.join(self.tmp.name, "out")
        os.makedirs(self.out_dir, exist_ok=True)

    def tearDown(self):
        self.tmp.cleanup()

    def report(self, path=None, shape=(120, 120), write=False, **extra):
        request = {
            "grid": grid_spec(shape),
            "products": [{"role": "epoch-a", "path": path or self.path}],
        }
        if write:
            request["outputs"] = {"dir": self.out_dir, "write": True}
        request.update(extra)
        return build_report(request)

    def out_path(self, role="epoch-a"):
        return os.path.join(self.out_dir, f"{role}_reprojected.fits")

    # 1. constant image -----------------------------------------------------
    def test_constant_image_is_preserved(self):
        make_product(self.path)
        report = self.report()
        self.assertTrue(report["ok"], report)
        product = report["products"][0]
        self.assertGreater(product["stats"]["valid_fraction"], 0.95)
        report = self.report(write=True)
        with fits.open(self.out_path()) as hd:
            data = np.asarray(hd["IMAGE"].data, dtype=float)
            mask = np.asarray(hd["MASK"].data)
        valid = mask == 1
        self.assertGreater(valid.sum(), 1000)
        self.assertTrue(
            np.allclose(data[valid], 5.0, atol=1e-3),
            f"constant input not preserved: {data[valid].min()}..{data[valid].max()}",
        )

    # 2. synthetic point source --------------------------------------------
    def test_point_source_lands_on_expected_output_pixel(self):
        nx = ny = 120
        src = SkyCoord(*(np.array(CENTER) + [0.02, -0.01]) * u.deg)
        w = wcs_for(nx, ny)
        px, py = w.world_to_pixel_values(src.ra.deg, src.dec.deg)
        px, py = _idx(px), _idx(py)
        image = np.full((ny, nx), 1.0, dtype=np.float32)
        image[py, px] = 500.0
        make_product(self.path, image=image)

        report = self.report(write=True)
        self.assertTrue(report["ok"], report)
        target_wcs, _ = build_target_grid(grid_spec())
        with fits.open(self.out_path()) as hd:
            data = np.asarray(hd["IMAGE"].data, dtype=float)
            mask = np.asarray(hd["MASK"].data)
        iy, ix = np.unravel_index(np.argmax(np.where(mask == 1, data, -np.inf)), data.shape)
        expected_x, expected_y = target_wcs.world_to_pixel_values(src.ra.deg, src.dec.deg)
        self.assertLessEqual(
            np.hypot(ix - expected_x, iy - expected_y), 1.0,
            f"point source at ({ix},{iy}), expected ({expected_x:.2f},{expected_y:.2f})",
        )

    # 3. shifted / rotated WCS ---------------------------------------------
    def test_epochs_with_different_wcs_align(self):
        src = SkyCoord(*(np.array(CENTER) + [-0.03, 0.02]) * u.deg)
        outs = []
        for i, kwargs in enumerate(
            [dict(crpix=[40.0, 95.0], rotation_deg=0.0),
             dict(crpix=[80.0, 30.0], rotation_deg=180.0)]
        ):
            nx = ny = 120
            w = wcs_for(nx, ny, **kwargs)
            px, py = w.world_to_pixel_values(src.ra.deg, src.dec.deg)
            image = np.full((ny, nx), 1.0, dtype=np.float32)
            image[_idx(py), _idx(px)] = 500.0
            path = os.path.join(self.tmp.name, f"epoch_{i}.fits")
            make_product(path, image=image, **kwargs)
            report = build_report(
                {
                    "grid": grid_spec(),
                    "products": [{"role": f"epoch-{i}", "path": path}],
                    "outputs": {"dir": self.out_dir, "write": True},
                }
            )
            self.assertTrue(report["ok"], report)
            with fits.open(self.out_path(f"epoch-{i}")) as hd:
                data = np.asarray(hd["IMAGE"].data, dtype=float)
                mask = np.asarray(hd["MASK"].data)
            iy, ix = np.unravel_index(
                np.argmax(np.where(mask == 1, data, -np.inf)), data.shape
            )
            outs.append((ix, iy))
        self.assertEqual(
            outs[0], outs[1],
            f"different input WCS reprojected to different positions: {outs}",
        )

    # 4. partial coverage ---------------------------------------------------
    def test_partial_coverage_is_masked_not_filled(self):
        make_product(self.path, nx=60, ny=60)
        report = self.report(shape=(140, 140), write=True)
        self.assertTrue(report["ok"], report)
        stats = report["products"][0]["stats"]
        self.assertLess(stats["valid_fraction"], 0.5, "expected a large uncovered rim")
        self.assertEqual(status_of(report["products"][0]["checks"], "footprint_retained"), "pass")
        with fits.open(self.out_path()) as hd:
            mask = np.asarray(hd["MASK"].data)
            footprint = np.asarray(hd["FOOTPRINT"].data)
        self.assertTrue((mask[footprint <= 0] == 0).all(), "uncovered pixels must be invalid")
        self.assertGreater(mask[mask.shape[0] // 2, mask.shape[1] // 2], 0, "centre must be covered")

    # 5. masks and flag semantics ------------------------------------------
    def test_flags_are_nearest_neighbour_and_policy_is_applied(self):
        nx = ny = 120
        image = np.full((ny, nx), 5.0, dtype=np.float32)
        flags = np.zeros((ny, nx), dtype=np.int32)
        flags[15, 15] = 1 << 21   # MP_SOURCE only -> informational, stays valid
        flags[25, 100] = 1 << 0   # MP_TRANSIENT -> pathology, invalid
        flags[105, 40] = 1 << 30  # MP_MYSTERY   -> unclassified, conservatively invalid
        # deliberately nothing near the centre pixel the assertion below checks
        make_product(self.path, image=image, flags=flags)

        report = self.report(write=True)
        product = report["products"][0]
        self.assertEqual(status_of(product["checks"], "flags_bit_values_preserved"), "pass")
        self.assertEqual(status_of(product["checks"], "flags_reprojected_nearest_neighbour"), "pass")
        self.assertEqual(status_of(product["checks"], "flag_definitions_from_header"), "warn")
        self.assertIn("MP_MYSTERY", product["flag_policy"]["unclassified_bits"])

        target_wcs, _ = build_target_grid(grid_spec())
        with fits.open(self.out_path()) as hd:
            out_flags = np.asarray(hd["FLAGS"].data)
            mask = np.asarray(hd["MASK"].data)
        self.assertTrue(set(np.unique(out_flags)) <= {0, 1 << 21, 1 << 0, 1 << 30})

        def at(ra_off, dec_off):
            x, y = target_wcs.world_to_pixel_values(CENTER[0] + ra_off, CENTER[1] + dec_off)
            return mask[_idx(y), _idx(x)]

        # centre pixel of the 120x120 grid corresponds to (0,0) offset
        self.assertEqual(at(0.0, 0.0), 1, "clean centre must be valid")
        # locate the flagged pixels by their input pixel coordinates
        w = wcs_for(nx, ny)
        for (py, px), bit, expect in [
            ((15, 15), 21, 1),
            ((25, 100), 0, 0),
            ((105, 40), 30, 0),
        ]:
            ra, dec = w.pixel_to_world_values(px, py)
            x, y = target_wcs.world_to_pixel_values(ra, dec)
            got = mask[_idx(y), _idx(x)]
            self.assertEqual(got, expect, f"bit {bit} at ({px},{py}) -> mask {got}, expected {expect}")

    def test_bit_roles_come_from_the_header_not_assumption(self):
        make_product(self.path)
        with fits.open(self.path) as hd:
            policy = read_flag_policy(hd["FLAGS"].header)
        self.assertEqual(policy["source"], "MP_* keywords in this product's FLAGS header")
        self.assertEqual(policy["bits"]["MP_SOURCE"]["bit"], 21)
        self.assertEqual(policy["bits"]["MP_SOURCE"]["role"], "informational")
        self.assertEqual(policy["bits"]["MP_TRANSIENT"]["role"], "pathology")
        self.assertEqual(policy["bits"]["MP_MYSTERY"]["role"], "unclassified")
        # MP_MYSTERY is unknown, so it must be inside the invalid mask
        self.assertTrue(policy["invalid_mask"] & (1 << 30))
        self.assertFalse(policy["invalid_mask"] & (1 << 21), "MP_SOURCE must not invalidate")
        self.assertEqual(set(policy["bits"]) - set(BIT_ROLES), {"MP_MYSTERY"})

    # 6. variance -----------------------------------------------------------
    def test_variance_is_interpolated_with_explicit_assumption(self):
        make_product(self.path, variance=np.full((120, 120), 7.5, dtype=np.float32))
        report = self.report(write=True)
        method = report["method"]
        self.assertIn("sum of w_i^2", method["variance_model"])
        self.assertIn("NOT applied", method["variance_model"])
        self.assertEqual(
            status_of(report["products"][0]["checks"], "variance_handling_explicit"), "pass"
        )
        with fits.open(self.out_path()) as hd:
            var = np.asarray(hd["VARIANCE"].data, dtype=float)
            mask = np.asarray(hd["MASK"].data)
        valid = mask == 1
        self.assertTrue(
            np.allclose(var[valid], 7.5, atol=1e-3),
            f"constant variance not preserved: {var[valid].min()}..{var[valid].max()}",
        )

    # 7. reproducibility ----------------------------------------------------
    def test_repeated_runs_are_byte_identical(self):
        make_product(self.path)
        hashes, arrays = [], []
        for run in range(2):
            report = self.report(write=True)
            self.assertTrue(report["ok"], report)
            hashes.append(report["products"][0]["output"]["sha256"])
            arrays.append(report["products"][0]["arrays_sha256"])
        self.assertEqual(hashes[0], hashes[1], "repeated runs produced different output bytes")
        self.assertEqual(arrays[0], arrays[1])

    def test_input_hash_is_verified_against_the_manifest(self):
        make_product(self.path)
        report = build_report(
            {
                "grid": grid_spec(),
                "products": [{"role": "a", "path": self.path, "sha256": "deadbeef"}],
            }
        )
        self.assertEqual(
            status_of(report["products"][0]["checks"], "input_hash_matches_expected"), "fail"
        )
        self.assertFalse(report["ok"])

    # 8. cross-epoch alignment ----------------------------------------------
    def test_alignment_diagnostic_reports_subpixel_offset(self):
        src = SkyCoord(*(np.array(CENTER) + [0.01, 0.01]) * u.deg)
        paths = []
        for i, kwargs in enumerate(
            [dict(crpix=[45.0, 80.0], rotation_deg=0.0),
             dict(crpix=[75.0, 35.0], rotation_deg=90.0)]
        ):
            w = wcs_for(120, 120, **kwargs)
            px, py = w.world_to_pixel_values(src.ra.deg, src.dec.deg)
            image = np.full((120, 120), 1.0, dtype=np.float32)
            image[_idx(py), _idx(px)] = 500.0
            path = os.path.join(self.tmp.name, f"al_{i}.fits")
            make_product(path, image=image, **kwargs)
            paths.append(path)

        report = build_report(
            {
                "grid": grid_spec(),
                "products": [
                    {"role": "epoch-a", "path": paths[0]},
                    {"role": "epoch-b", "path": paths[1]},
                ],
            }
        )
        self.assertTrue(report["ok"], report)
        self.assertIsNotNone(report["alignment"], "two products must produce a diagnostic")
        self.assertLessEqual(
            report["alignment"]["offset_px"], 1.0, report["alignment"]
        )
        self.assertEqual(status_of(report["checks"], "cross_epoch_alignment"), "pass")
        self.assertIn("spatial alignment only", report["alignment"]["scope"])
        self.assertFalse(report["gate"]["quantitative_difference_enabled"])
        # private arrays must not leak into the serialisable report
        self.assertTrue(all("_image" not in p and "_mask" not in p for p in report["products"]))

    def test_alignment_diagnostic_absent_for_a_single_product(self):
        make_product(self.path)
        report = self.report()
        self.assertIsNone(report["alignment"])
        self.assertIsNone(status_of(report["checks"], "cross_epoch_alignment"))

    # 9. the gate itself ----------------------------------------------------
    def test_gate_claims_alignment_only(self):
        make_product(self.path)
        report = self.report(write=True)
        gate = report["gate"]
        self.assertTrue(gate["spatial_alignment"])
        self.assertFalse(gate["quantitative_difference_enabled"])
        self.assertIn("not scientific comparability", gate["acceptance_rule"])
        self.assertEqual(status_of(report["checks"], "quantitative_difference_disabled"), "pass")
        self.assertTrue(report["ok"])
        self.assertEqual(report["sidecar"]["reproject"], __import__("reproject").__version__)


if __name__ == "__main__":
    unittest.main()
