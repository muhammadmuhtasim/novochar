#!/usr/bin/env python3
"""Generate trusted astronomical reference values for the Novochar scientific core.

Uses Astropy as an independent, reputable implementation to compute:

  * ICRS <-> Galactic (l, b) transforms. Inputs are ICRS (`frame="icrs"`), so
    the committed values are the ICRS-native Galactic transform. Astropy builds
    this as the composition of the USNO Circular 179 ICRS->FK5(J2000) frame-bias
    B-matrix with the classic IAU 1958 FK5(J2000)->Galactic rotation; the
    Novochar core reproduces that composition exactly (shared/astro/frames.js).
  * on-sky angular separations
  * proper-motion-propagated positions (radial velocity 0 -> distance-independent)
  * Julian-year <-> Julian-Date epoch conversions
  * the ICRS<->FK5(J2000) frame bias at representative points (informational)

The output is committed as shared/astro/reference/astropy-reference.json and
consumed by shared/astro/reference.test.js, so the JavaScript core is checked
against an external authority rather than only against itself.

This script is NOT part of the normal test suite or the build. Regenerate
intentionally and review the diff:

    python3 -m venv /tmp/astro-venv
    /tmp/astro-venv/bin/pip install astropy
    /tmp/astro-venv/bin/python scripts/generate-astro-reference.py
"""

import json
import pathlib

import astropy
from astropy import units as u
from astropy.coordinates import ICRS, SkyCoord
from astropy.time import Time

OUT = (
    pathlib.Path(__file__).resolve().parent.parent
    / "shared"
    / "astro"
    / "reference"
    / "astropy-reference.json"
)

J2000_JD = 2451545.0
JULIAN_YEAR_DAYS = 365.25


def galactic_samples():
    points = [
        (0.0, 0.0),
        (0.0, 90.0),
        (192.8594812065348, 27.12825118085622),  # NGP (Astropy _ngp_J2000)
        (266.40499, -28.93617),  # Galactic centre (Sgr A*)
        (101.28715533, -16.71611586),  # Sirius
        (279.23473479, 38.78368896),  # Vega
        (88.79293899, 7.407064),  # Betelgeuse
        (10.0, -89.9),
        (350.0, 88.0),
        (120.5, 45.25),
        (200.0, -75.0),
        (0.0, -90.0),
    ]
    for ra in range(0, 360, 30):
        for dec in (-60, -20, 0, 20, 60):
            points.append((float(ra), float(dec)))
    out = []
    for ra, dec in points:
        c = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")
        g = c.galactic
        xyz = g.cartesian.xyz.value
        out.append(
            {
                "ra": ra,
                "dec": dec,
                "l": float(g.l.deg),
                "b": float(g.b.deg),
                # Output unit vector in the galactic frame. Compared directly by
                # the JS tests: (l, b) is ill-conditioned within a small distance
                # of a galactic pole (arcsin near +/-1), whereas the vector is
                # well-conditioned everywhere.
                "x": float(xyz[0]),
                "y": float(xyz[1]),
                "z": float(xyz[2]),
            }
        )
    return out


def separation_samples():
    pairs = [
        (0, 0, 0, 1),
        (0, 0, 1, 0),
        (0, 0, 180, 0),
        (90, 0, 270, 0),
        (45.123, -12.5, 45.123, -12.5),
        (0, 89.5, 1, 89.5),
        (359.999999, 0, 0.000001, 0),
        (120.0, -30.0, 240.0, 45.0),
        (0, -89.9, 180, 89.9),
        (10.0, 10.0, 10.0, 10.001),
    ]
    out = []
    for ra1, dec1, ra2, dec2 in pairs:
        c1 = SkyCoord(ra=ra1 * u.deg, dec=dec1 * u.deg, frame=ICRS)
        c2 = SkyCoord(ra=ra2 * u.deg, dec=dec2 * u.deg, frame=ICRS)
        out.append(
            {
                "ra1": ra1,
                "dec1": dec1,
                "ra2": ra2,
                "dec2": dec2,
                "arcsec": float(c1.separation(c2).arcsec),
            }
        )
    return out


def proper_motion_samples():
    # radial_velocity = 0 -> the propagated direction is independent of distance,
    # so the golden values do not depend on an assumed parallax.
    cases = [
        (0, 0, 1000, 0, 10),
        (0, 60, 1000, 0, 10),
        (0, 0, 0, 1000, 10),
        (30, 45, 1000, 500, 10),
        (123, 90, 1000, 0, 10),
        (123, -90, 0, 1000, 10),
        (101.28715533, -16.71611586, -553, -1205, 10),  # Sirius
        (279.2, 38.78, -546, -1230, 50),  # high-pm, 50 yr
        (10.0, 80.0, 2000, -1000, 25),
    ]
    t0 = Time(J2000_JD, format="jd", scale="tt")
    out = []
    for ra, dec, pmra, pmdec, dt in cases:
        c = SkyCoord(
            ra=ra * u.deg,
            dec=dec * u.deg,
            frame=ICRS,
            pm_ra_cosdec=pmra * u.mas / u.yr,
            pm_dec=pmdec * u.mas / u.yr,
            radial_velocity=0 * u.km / u.s,
            obstime=t0,
            distance=1 * u.kpc,
        )
        t1 = Time(J2000_JD + dt * JULIAN_YEAR_DAYS, format="jd", scale="tt")
        c1 = c.apply_space_motion(new_obstime=t1)
        out.append(
            {
                "ra": ra,
                "dec": dec,
                "pmRaMasYr": pmra,
                "pmDecMasYr": pmdec,
                "dtYears": dt,
                "raOut": float(c1.ra.deg),
                "decOut": float(c1.dec.deg),
            }
        )
    return out


def epoch_samples():
    out = []
    for jyear in (2000.0, 1950.0, 2016.0, 2025.25):
        t = Time(jyear, format="jyear", scale="tt")
        out.append({"julianYear": jyear, "jd": float(t.jd)})
    return out


def frame_bias_samples():
    """Quantify the ICRS <-> FK5(J2000) frame bias at representative points.

    The Novochar core now applies the IAU ICRS-native Galactic transform.
    Astropy's ICRS and FK5(J2000) differ slightly; we record that bias for
    informational purposes.
    """
    out = []
    for ra, dec in [(0.0, 0.0), (0.0, 90.0), (90.0, 0.0), (120.5, 45.25), (266.40499, -28.93617)]:
        icrs = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs").galactic
        fk5 = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="fk5", equinox="J2000").galactic
        out.append(
            {
                "ra": ra,
                "dec": dec,
                "icrsL": float(icrs.l.deg),
                "icrsB": float(icrs.b.deg),
                "fk5L": float(fk5.l.deg),
                "fk5B": float(fk5.b.deg),
                "biasArcsec": float(icrs.separation(fk5).arcsec),
            }
        )
    return out


def main():
    data = {
        "generatedBy": f"astropy {astropy.__version__}",
        "note": (
            "Reference values generated by scripts/generate-astro-reference.py. "
            "Galactic samples use frame='icrs' (IAU ICRS-native Galactic). Do not hand-edit."
        ),
        "galactic": galactic_samples(),
        "separationArcsec": separation_samples(),
        "properMotion": proper_motion_samples(),
        "epochs": epoch_samples(),
        "frameBias": frame_bias_samples(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print(
        f"wrote {OUT} ({astropy.__version__}): "
        f"{len(data['galactic'])} galactic, "
        f"{len(data['separationArcsec'])} separations, "
        f"{len(data['properMotion'])} proper-motion, "
        f"{len(data['epochs'])} epochs"
    )


if __name__ == "__main__":
    main()
