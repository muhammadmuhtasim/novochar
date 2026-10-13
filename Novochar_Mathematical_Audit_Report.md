# Novochar: Mathematical and Numerical Audit Report

**Project:** Novochar  
**Scope:** Astronomy coordinate transformations, HEALPix indexing, cone-search crossmatching, astrometric propagation, synthetic spectra, sky-motion visualization, spectrum plotting, FITS wavelength calibration, time conversion, and selected 3D movement mathematics  
**Audit basis:** Source inspection of the supplied project archive and execution of the server test suite in an isolated extraction  
**Status:** Engineering audit; not a certification of scientific accuracy

---

## 1. Executive summary

The reviewed code contains several mathematically sound foundations, including the equatorial-to-Galactic coordinate transformation, angular-unit conversions, the Julian Date conversion from Unix time, the redshift wavelength relation, the magnitude scaling relation, and the spherical-vector formulation used for proper-motion propagation. Existing tests provide useful coverage: **72 tests passed** in the isolated server test run. One API test file could not initialize because the isolated environment lacked the `express` dependency; this is an environment/setup limitation, not evidence that the API test itself fails.

The principal risks are not all incorrect equations. Some are mismatches between what the code claims to guarantee and what the implementation actually guarantees, plus numerical-range and scientific-model limitations.

### Highest-priority findings

1. **HEALPix NEST indexing has a range mismatch.** The validator permits `nside` values much larger than the 16-bit coordinate interleaving helper can safely encode. At unsupported resolutions, high bits may be discarded and indices can be wrong.
2. **The cone-search pixel probe is not proven complete.** The sampled tangent-plane grid can work well in tested cases, but finite sampling does not establish the claimed guarantee that every HEALPix pixel intersecting a search cone is visited. Exact angular filtering cannot recover objects in pixels that were never probed.
3. **Some sky-displacement calculations use raw RA differences.** Right ascension is a coordinate angle, not a uniform east-west angular distance at every declination. Small east-west offsets scale approximately with \(\cos(\delta)\).
4. **Coordinate-rotation comments use misleading convention labels.** The matrix composition appears to produce the standard equatorial-to-Galactic transformation, but the individual matrices are transposed relative to the usual active, right-handed, column-vector rotation convention. Avoid changing signs without independent reference tests.
5. **Synthetic spectra should not be presented as calibrated physical flux.** The code combines a Planck-like wavelength term with procedural line and continuum features, while metadata uses Jy. That is suitable for visualization if clearly labelled, but it is not automatically a physically calibrated spectrum.
6. **Numerical input validation needs strengthening** around angular separation, logarithmic plots, HEALPix limits, and FITS wavelength consistency.

### Overall assessment

The coordinate-transform core appears structurally sound. The most important scientific correctness risks are the HEALPix cone-search completeness claim and the distinction between visual simulation and physical measurement. Before treating search results or plots as scientific-grade, fix the identified edge cases and compare outputs against independent reference implementations.

---

## 2. Scope, method, and limitations

### 2.1 Reviewed areas

The source inspection covered the following modules and related code paths:

- `server/astro/coords.js`
- `server/astro/healpix.js`
- `server/astro/crossmatch.js`
- `server/ivoa/gaia.js`
- `server/astro/spectra.js`
- `server/astro/data.js`
- `client/src/lib/spectrum-plot.js`
- Selected FITS generation, readout, and 3D movement logic

The review focused on equation correctness, units, coordinate-frame conventions, numerical stability, boundary behavior, scientific interpretation, and the relationship between comments and actual guarantees.

### 2.2 Test execution

The server test command was run in an isolated extraction of the supplied archive. The result was:

- **72 tests passed**
- **1 API test file failed to initialize** because `express` was missing from the isolated environment

That initialization issue means the API test was not evaluated. It should not be reported as a failing assertion, but the full test suite should be rerun after installing the project's declared dependencies in a complete environment.

### 2.3 What this audit does not establish

This review is not a full formal proof, peer-reviewed validation, or exhaustive test of every code path. Passing tests show that tested examples behave as expected; they do not prove global properties such as complete cone searches at every HEALPix resolution. The review did not establish a full comparison against Astropy, healpy, or another independent scientific reference implementation.

---

## 3. Findings by subsystem

## 3.1 Angular-unit constants and coordinate conversion

### Equations and implementation

The code defines degree/radian conversion constants using \(\pi\):

\[
\mathrm{DEG2RAD} = \frac{\pi}{180},
\qquad
\mathrm{RAD2DEG} = \frac{180}{\pi}.
\]

These are correct.

Right ascension and declination are represented as a unit vector:

\[
\mathbf{r} =
\begin{bmatrix}
\cos\delta\cos\alpha\\
\cos\delta\sin\alpha\\
\sin\delta
\end{bmatrix},
\]

where \(\alpha\) is right ascension and \(\delta\) is declination, both in radians. This is the standard spherical-to-Cartesian conversion for the conventional equatorial axes.

The inverse uses the vector's \(z\)-component for declination and the \(x,y\) components for right ascension. Clamping the argument passed to \(\arcsin\) to \([-1,1]\) is a sensible floating-point safeguard. Normalizing right ascension into a canonical interval is also appropriate.

### Assessment

**Status: Correct in principle.**

The unit-vector conversion is conventional and suitable for spherical-coordinate calculations. The inverse should continue to guard against small floating-point excursions outside the valid domain.

### Recommendations

- Keep angular units explicit in function names, parameter names, and comments.
- Add tests for RA wraparound near \(0^\circ/360^\circ\), declinations at both poles, and values near the valid boundaries.
- Decide whether public functions accept only valid sky coordinates or normalize arbitrary values, and document that contract.

---

## 3.2 Equatorial-to-Galactic coordinate transformation

### Constants and matrix composition

The code uses the following reference angles:

- North Galactic Pole right ascension: approximately \(192.8594812065^\circ\)
- North Galactic Pole declination: approximately \(27.1282511809^\circ\)
- Galactic longitude of the north celestial pole: approximately \(122.9319185680^\circ\)

It constructs the equatorial-to-Galactic matrix as a product of `rotZ` and `rotY` matrices and computes the inverse as the transpose.

The individual matrix functions use sign patterns that differ from the usual **active, right-handed rotations on column vectors**. They are effectively the opposite/passive forms relative to that convention. However, the combined signs and multiplication order appear to produce the standard equatorial-to-Galactic transform.

### Assessment

**Status: Transform appears correct; convention comments are misleading.**

This is a convention/documentation problem with a risk of future regressions. It is not a recommendation to flip signs blindly. A seemingly intuitive sign correction could break a composition that is currently correct.

### Recommendations

1. Rewrite the comments to state the exact convention used: active versus passive, row versus column vectors, and matrix multiplication order.
2. Test the transform against independently sourced reference coordinates or a trusted library such as Astropy, using explicitly matched frames.
3. Test that the inverse round-trip returns the original direction within a stated angular tolerance.
4. Include known Galactic landmarks and pole cases in the test suite.

### Frame-label caution

ICRS and FK5 J2000 are not strictly identical frames. If code or UI labels the same data as both “ICRS” and “FK5/J2000,” document whether the distinction is intentionally ignored or implement the intended frame conversion. Reference comparisons must use matching frame definitions.

---

## 3.3 Angular separation

### Formula

The code uses the haversine form for angular separation. For two sky positions \((\alpha_1,\delta_1)\) and \((\alpha_2,\delta_2)\), define

\[
h =
\sin^2\left(\frac{\delta_2-\delta_1}{2}\right)
+
\cos\delta_1\cos\delta_2
\sin^2\left(\frac{\alpha_2-\alpha_1}{2}\right).
\]

Then

\[
\theta = 2\arcsin\left(\sqrt{h}\right).
\]

This is a standard spherical-distance expression and behaves well for many small-angle use cases.

### Numerical issue

The implementation caps the upper bound before the square root but does not also explicitly cap the lower bound. In exact arithmetic \(h\geq0\), but roundoff can produce a tiny negative value in edge cases. Passing a negative value to `Math.sqrt` yields `NaN`.

### Recommendations

Clamp the value to the full valid interval:

\[
h_{\mathrm{safe}} = \min(1,\max(0,h)),
\qquad
\theta = 2\arcsin\left(\sqrt{h_{\mathrm{safe}}}\right).
\]

For particularly robust behavior at extremely small separations or near-antipodal positions, consider the vector form

\[
\theta =
\operatorname{atan2}
\left(
\lVert\mathbf{u}\times\mathbf{v}\rVert,
\mathbf{u}\cdot\mathbf{v}
\right),
\]

where \(\mathbf{u}\) and \(\mathbf{v}\) are unit vectors. This is a useful independent formulation for cross-checking.

The conversion

\[
1^\circ = 3600\ \mathrm{arcsec}
\]

is correct.

---

## 3.4 HEALPix indexing and resolution

### Pixel-count equations

The implementation uses

\[
N_{\mathrm{pix}} = 12N_{\mathrm{side}}^2,
\qquad
N_{\mathrm{side}} =
\sqrt{\frac{N_{\mathrm{pix}}}{12}}.
\]

These relations are standard for HEALPix. The inverse operation should validate that the result is an allowed integer resolution rather than silently accepting arbitrary values.

### Resolution estimate

The code estimates characteristic angular resolution using

\[
\theta_{\mathrm{res}} \approx
\sqrt{\frac{4\pi}{N_{\mathrm{pix}}}}.
\]

This is the square root of the mean solid angle per pixel, expressed in radians. It is a useful characteristic scale, but it is **not a guaranteed pixel side length or maximum pixel diameter**. HEALPix pixels are not all identical planar squares.

The arcseconds-per-radian constant is approximate in the implementation. The more precise value is approximately

\[
\frac{180}{\pi}\times3600
\approx 206264.806247\ \mathrm{arcsec/rad}.
\]

The existing approximation is likely adequate for rough display-scale calculations, but a shared precise constant avoids avoidable inconsistency in scientific calculations.

### NEST indexing range mismatch

The NEST implementation interleaves coordinate bits through a helper that first masks the coordinate to 16 bits:

```js
let x = v & 0xffff;
```

But the resolution validator permits values far beyond the range represented by 16 bits. For large supported-by-validator values, high coordinate bits can be discarded, producing incorrect pixel indices.

### Assessment

**Status: Standard equations; important implementation-range defect.**

### Recommendations

- Either reject NEST resolutions that exceed the bit-interleaving helper's true supported range or implement a safe wider-bit method.
- Make the validator, documentation, and implementation share one explicit maximum `nside`.
- Consider JavaScript's 32-bit bitwise-operation semantics and the exact-integer range of `Number` when selecting supported resolutions.
- Add boundary tests immediately below, at, and above the supported limit.
- Ensure invalid values are rejected clearly rather than mapped to plausible-looking but incorrect indices.

### Testing

Existing tests for pixel centers, RING/NEST behavior, and round trips passed in the inspected run. That is useful evidence for the tested resolutions, but it does not cover the high-resolution bit-width mismatch unless those limits are explicitly exercised.

---

## 3.5 HEALPix cone-search and crossmatching

### Current approach

The crossmatch implementation chooses an `nside` based on the query radius and probes pixels by sampling a tangent-plane grid around the target. The grid spacing is approximately half the estimated pixel scale, and the search region extends beyond the nominal radius by a margin. Candidates are then filtered using exact angular separation.

The exact angular-distance filter is the right kind of final check: it removes candidates that are outside the requested angular radius.

### Main correctness risk: completeness

A finite grid of sample points does not by itself prove that every HEALPix pixel intersecting a circular search region is visited. A pixel can intersect the cone without containing any of the selected sample points. If such a pixel is omitted from the candidate set, the later exact-distance filter cannot recover its objects.

Therefore, comments claiming that the sampling guarantees no false negatives are stronger than the current method justifies.

### Assessment

**Status: High-priority algorithmic guarantee gap.**

The existing crossmatch tests passed, including comparisons against brute-force results for the cases represented in the test suite. Those tests support correctness for those cases, but do not establish a proof of completeness over all sky positions, radii, and resolutions.

### Recommendations

1. Replace the sampled-pixel probe with a proven HEALPix cone-disc query or a conservative overlap/neighbor strategy whose coverage property is documented.
2. If retaining the current method temporarily, describe it as an approximate candidate-generation method rather than a guaranteed-complete search.
3. Build randomized differential tests against brute-force angular-distance filtering. Include:
   - targets close to HEALPix pixel boundaries;
   - targets near the poles;
   - RA wraparound near \(0^\circ/360^\circ\);
   - radii smaller than, comparable to, and larger than a pixel scale;
   - circles that cross face or base-pixel boundaries;
   - several `nside` values and both RING/NEST layouts where applicable.
4. Track both recall (no missed in-cone objects) and precision (unnecessary candidates). For scientific cone searches, recall is the critical requirement.
5. Document whether radius values are inclusive at the boundary, and use a consistent tolerance policy.

### Priority

**P0 / release-blocking if the application promises complete astronomical cone searches.** If the feature is explicitly approximate and clearly labelled as such, the priority can be reduced, but the guarantee must not be overstated.

---

## 3.6 Gaia-style proper-motion propagation

### Current formulation

The implementation constructs a unit position vector and local east/north tangent basis. It then forms a tangent displacement from proper motion and applies a spherical exponential-map expression of the form

\[
\mathbf{r}(t) =
\cos \rho\,\mathbf{r}_0
+
\frac{\sin\rho}{\rho}
\left(
a\,\mathbf{e}_{E}+d\,\mathbf{e}_{N}
\right),
\]

where \(a\) and \(d\) are the eastward and northward angular displacement components, and

\[
\rho=\sqrt{a^2+d^2}.
\]

The limiting value of \(\sin\rho/\rho\) as \(\rho\to0\) is \(1\), so a numerically safe implementation should handle the near-zero case without dividing by a value that is effectively zero.

Proper motion is commonly reported in milliarcseconds per year. The conversion to radians uses the correct dimensional chain when the time interval is expressed in years. Gaia's `pmra` convention is \(\mu_{\alpha *}=\dot{\alpha}\cos\delta\), which is compatible with using the local east tangent basis.

### Assessment

**Status: Mathematically sound for the stated simplified model.**

This is a spherical propagation approximation under constant proper-motion components. It should not be represented as a complete high-precision astrometric propagation model. Full propagation can require parallax, radial velocity, perspective effects, epoch definitions, and frame/time conventions.

### Missing-value behavior

Missing or non-finite proper-motion values are defaulted to zero. That can be a reasonable display fallback, but it can also make incomplete astrometry appear like a fully valid stationary solution.

### Recommendations

- Preserve a completeness/quality flag when any required astrometric parameter is missing.
- Distinguish “assumed zero proper motion” from “measured zero proper motion.”
- Add tests for zero motion, very small motion, high proper motion, polar positions, and epoch intervals of both signs.
- Document the epoch and coordinate-frame assumptions.
- If high-precision scientific positions are a product requirement, validate against a dedicated astrometry library and define the required physical model.

---

## 3.7 Synthetic spectrum generation

### Planck-like continuum

The code uses a Planck-like wavelength expression with a constant near

\[
\frac{hc}{k_B}
\approx 1.4387769\times10^4\ \mu\mathrm{m\,K}.
\]

That value is consistent with the standard \(hc/k_B\) conversion when wavelength is measured in micrometres and temperature in kelvin.

However, the generated spectrum also includes procedural continuum behavior, randomized Gaussian line features, and sinusoidal modulation. It is therefore a synthetic visualization model rather than a complete radiative-transfer calculation or a calibrated observation.

### Magnitude scaling

The implementation uses a scaling relation equivalent to

\[
F \propto 10^{-0.4m}.
\]

The specific relative scale based on a reference magnitude \(m_0\) is

\[
\frac{F}{F_0}=10^{-0.4(m-m_0)}.
\]

The implemented form \(10^{0.4(14-m)}\) is mathematically correct as a relative magnitude scaling with reference magnitude 14.

### Redshift

The relation

\[
\lambda_{\mathrm{obs}}=\lambda_{\mathrm{rest}}(1+z)
\]

is correct for the usual redshift definition. The approximation \(v\approx cz\) is only appropriate at low redshift and should be labelled as an approximation, not a general conversion from cosmological redshift to velocity.

### Unit inconsistency risk

Metadata identifies flux in Jy, whereas the Planck-like \(B_\lambda\) expression is naturally a spectral radiance per unit wavelength. These are not interchangeable units. A physically calibrated output needs a consistent spectral-density convention and a valid conversion between \(F_\lambda\) and \(F_\nu\), along with an actual normalization.

For wavelength \(\lambda\), the spectral-density conversion in compatible units follows

\[
F_\nu = F_\lambda\frac{\lambda^2}{c}.
\]

Care is required with the units of wavelength and whether the density is expressed per metre, micrometre, or another unit.

### Assessment

**Status: Appropriate for procedural visuals; not a calibrated physical spectrum.**

### Recommendations

- Label the output “synthetic” or “illustrative” wherever it is displayed or exported.
- Do not label values as Jy unless the calculation actually produces \(F_\nu\) in Jy.
- Separate the visualization model from any future physical-spectrum model.
- Use deterministic random seeds in tests so synthetic output is reproducible.
- Test positivity, finite values, wavelength ordering, and behavior across extreme temperatures and wavelengths.
- Explain that randomized absorption/emission features are visual constructs unless they are derived from a specified physical line list and model.

---

## 3.8 Sky-motion visualization and RA/Dec differences

### Current calculation

The inspected data-building logic computes a drift from an angular motion value and elapsed time, converts milliarcseconds to degrees using

\[
1^\circ = 3{,}600{,}000\ \mathrm{mas},
\]

and applies a deliberate exaggeration factor and a maximum display cap.

The unit conversion is correct. The exaggeration factor and cap are display choices, not physical astrometry.

### RA geometry issue

A raw difference in right ascension does not represent the same east-west angular displacement at every declination. For small coordinate differences, the local east-west angular component is approximately

\[
\Delta \theta_E \approx \Delta\alpha\cos\delta,
\]

while the north-south component is approximately

\[
\Delta \theta_N \approx \Delta\delta.
\]

Thus a raw \(\Delta\alpha\) is not a generally valid measure of on-sky displacement, particularly near the poles. It also needs wraparound handling across \(0^\circ/360^\circ\).

### Assessment

**Status: Fine for an explicitly stylized animation; not a valid general angular-distance metric.**

### Recommendations

- For real sky displacement, use spherical angular separation or a local tangent-plane projection with wraparound handled.
- Keep exaggerated display motion clearly separated from scientific coordinates and measurements.
- Review UI readouts that derive “distance moved” from raw RA/Dec differences.
- Test at high declination and across the RA wrap boundary.

---

## 3.9 Spectrum plot coordinate mapping

### Linear axes

The reviewed linear mapping uses the expected affine transformation between data and plot coordinates. Guarding flat spans avoids division by zero when all \(x\) or \(y\) values are equal.

### Logarithmic axes

A logarithmic coordinate is only defined for positive values:

\[
y_{\log}=\log_{10}(y), \qquad y>0.
\]

The plot code calls `Math.log10(flux)` without guarding against zero, negative, or non-finite flux. Such values can yield `-Infinity` or `NaN`, potentially corrupting the plotted coordinates.

### Input assumptions

The mapping also appears to assume that the arrays are non-empty and contain finite numeric values.

### Recommendations

- Validate that log-axis values are strictly positive and finite.
- Decide whether invalid samples should be rejected, omitted, or shown as gaps; do not silently transform them into invalid coordinates.
- Validate non-empty arrays and finite ranges before plotting.
- Test constant arrays, one-point arrays, zero values, negative fluxes, and mixed finite/non-finite data.
- Keep the distinction between a data-space value and a pixel-space coordinate explicit.

---

## 3.10 FITS wavelength calibration and file correctness

### Linear wavelength solution

For evenly spaced wavelengths, the linear calibration is

\[
\lambda_i = \lambda_0 + i\,\mathrm{CDELT1},
\qquad
\mathrm{CDELT1} = \frac{\lambda_1-\lambda_0}{N-1},
\]

for \(N>1\), where \(\lambda_0\) is the first sample wavelength and \(\lambda_1\) is the last sample wavelength.

This relation is correct for evenly spaced sample positions.

### Precision consistency

The synthetic wavelength samples are rounded to a limited number of decimal places, while the FITS header wavelength solution can retain a different precision. Consequently, the header's reconstructed wavelength at a pixel may not exactly match the wavelength associated with the rounded sample.

### Recommendations

- Generate sample wavelengths and FITS header calibration from the same unrounded source values.
- Confirm the FITS `CRPIX1`, `CRVAL1`, and `CDELT1` conventions are applied consistently; the standard linear WCS relation is generally expressed as \(\lambda_i=\mathrm{CRVAL1}+(i+1-\mathrm{CRPIX1})\mathrm{CDELT1}\) for one-based FITS pixel index \(i+1\).
- Test reconstructed wavelengths at the first, middle, and last pixel.
- Validate the complete FITS structure and headers with an independent FITS reader, not only block padding or file length.
- Preserve integer identifiers as strings or `BigInt` when needed; JavaScript `Number` cannot exactly represent every large integer above \(2^{53}-1\).

---

## 3.11 Julian Date conversion

The reviewed conversion follows

\[
\mathrm{JD} =
2440587.5 +
\frac{t_{\mathrm{Unix,ms}}}{86{,}400{,}000},
\]

where the Unix timestamp is measured in milliseconds. This is the correct Unix-epoch-to-Julian-Date relationship under that timestamp convention.

### Recommendations

- State clearly whether input timestamps are milliseconds or seconds.
- Test the Unix epoch, dates before the epoch, leap-day dates, and fractional-day timestamps.
- Keep UTC/time-scale assumptions explicit if the application later needs precision astronomy. Julian Date alone does not identify whether the time scale is UTC, TT, or another standard.

---

## 3.12 3D movement mathematics

The inspected 3D controls use camera-relative movement, combine movement components, normalize the direction when needed, and scale by frame delta time. These are standard approaches for a free-flight 3D viewer.

A maximum frame delta (approximately \(0.05\) seconds in the reviewed logic) prevents very large jumps after a stall. This intentionally discards elapsed time beyond the cap, which is a reasonable interactive-control choice but means motion is not a perfect integration of wall-clock time during long stalls.

### Recommendations

- Test movement along each axis and diagonal directions to ensure normalized movement does not make diagonal travel faster.
- Test orientation changes, zero-input frames, and large frame stalls.
- Test procedural sector generation at negative coordinates and around sector boundaries.
- Keep navigation/display units separate from astronomical units unless the environment explicitly models physical distances.

---

## 4. Consolidated risk register

| ID | Finding | Risk | Priority | Suggested action |
|---|---|---|---|---|
| A-01 | HEALPix NEST helper masks coordinates to 16 bits while validation permits larger resolutions | Incorrect pixel indices at unsupported high resolutions | **P0/P1** | Enforce real supported limit or implement wider interleaving |
| A-02 | Sampled cone-search pixels do not prove complete coverage | False-negative astronomical crossmatches | **P0** if completeness is promised | Use a proven HEALPix disc query or conservative coverage method |
| A-03 | Raw RA differences used as sky displacement | Misleading displacement, especially at high declination | **P1** for scientific readouts | Use spherical separation or tangent-plane offsets |
| A-04 | Rotation comments mislabel matrix convention | Future sign/order regression | **P1** | Document convention and add independent reference tests |
| A-05 | Synthetic spectrum flux metadata may say Jy without computing calibrated \(F_\nu\) | Misleading physical interpretation | **P1** if presented as scientific data | Label synthetic output and align units |
| A-06 | Haversine intermediate not clamped at lower bound | `NaN` in rare floating-point edge cases | **P2** | Clamp \(h\) to \([0,1]\) |
| A-07 | Log plot does not guard non-positive flux | Invalid plot coordinates | **P1/P2** | Validate and define handling of invalid samples |
| A-08 | Gaia-like propagation treats missing proper motion as zero | Incomplete data can look fully valid | **P1/P2** | Preserve missing-data quality flags |
| A-09 | FITS wavelength samples and header precision may differ | Small wavelength inconsistencies | **P2** | Derive both from a common full-precision solution |
| A-10 | Approximate arcsec-per-radian constant | Small systematic numerical difference | **P3** | Use a shared precise constant |
| A-11 | ICRS and FK5/J2000 labels may be conflated | Frame-level discrepancies | **P1/P2** | Define frame contract and compare matching frames |
| A-12 | API test file not initialized due to missing dependency in isolated environment | Incomplete verification | **P2** | Install dependencies and rerun full suite |

Priority labels are based on impact if the relevant behavior is part of the product's advertised contract. In particular, A-02 is release-blocking only if cone-search completeness is promised.

---

## 5. Recommended verification plan

### Phase 1 — Correctness-critical fixes

- [ ] Align the HEALPix NEST validation limit with the bit-interleaving implementation.
- [ ] Replace or formally bound the cone-search candidate-pixel generation.
- [ ] Clamp the haversine intermediate to \([0,1]\).
- [ ] Replace raw RA/Dec displacement readouts with spherical geometry where they represent real sky motion.
- [ ] Validate positive finite data for logarithmic plotting.
- [ ] Clarify the synthetic-spectrum label and flux units.

### Phase 2 — Independent scientific references

- [ ] Compare equatorial/Galactic transformations against Astropy using matched frame definitions.
- [ ] Compare angular separations against an independent vector-based calculation.
- [ ] Compare HEALPix pixel IDs and centers against a trusted HEALPix implementation at low, medium, and maximum supported resolutions.
- [ ] Differential-test cone searches against brute-force angular filtering on randomized catalogs and adversarial boundaries.
- [ ] Compare proper-motion propagation against an independent astrometry implementation under explicitly matched assumptions.
- [ ] Validate exported FITS files with an independent FITS library and reconstruct the wavelength grid from the header.

### Phase 3 — Numerical robustness

- [ ] Add tests for poles, RA wraparound, nearly coincident points, and nearly antipodal points.
- [ ] Test non-finite values, missing values, empty arrays, zero spans, and log-axis invalid values.
- [ ] Test large integer IDs and timestamp units.
- [ ] Test sector generation at negative coordinates and sector boundaries.
- [ ] Add property-based or randomized tests with fixed seeds so failures are reproducible.

### Phase 4 — Build and release verification

- [ ] Install dependencies in a complete project environment.
- [ ] Run the full server test suite, including the API tests.
- [ ] Run client tests and build checks.
- [ ] Record runtime versions and exact commands in the audit log.
- [ ] Do not describe the project as scientifically validated until the independent-reference and edge-case tests have passed.

---

## 6. Suggested acceptance criteria

The following criteria make the audit actionable:

1. **Coordinate transformations:** Known reference points agree with a trusted implementation within a stated angular tolerance, and forward/inverse round trips pass.
2. **Angular separation:** Results remain finite and within \([0,\pi]\) for all valid inputs; degenerate and boundary cases pass.
3. **HEALPix:** Every accepted `nside` is supported by both the validator and indexing implementation; pixel centers round-trip as specified.
4. **Cone search:** No in-radius catalog point is omitted across randomized and adversarial tests at every supported resolution, or the feature is explicitly documented as approximate.
5. **Astrometric propagation:** Units, epochs, frame, and missing-data behavior are explicit and tests match the chosen physical model.
6. **Synthetic spectra:** Every output is clearly labelled synthetic unless it has a validated physical model and consistent units.
7. **Plots:** Invalid logarithmic inputs have defined behavior and cannot silently introduce `NaN` or infinite pixel coordinates.
8. **FITS:** Header reconstruction agrees with sample wavelengths within a documented tolerance and independent readers accept the file.
9. **Build/test:** The full test suite, including API initialization, runs in the documented project environment.

---

## 7. Final conclusion

The audit found a sound mathematical base for several core operations, especially spherical coordinate conversion, the combined equatorial-to-Galactic transform, unit conversion, the redshift wavelength relation, relative magnitude scaling, and the Julian Date formula.

The most consequential issues concern **guarantees and edge cases**: the NEST bit-width mismatch, the unproven completeness of the sampled HEALPix cone search, and the use of raw RA differences as angular displacement. Scientific interpretation also needs clearer boundaries: the generated spectra are procedural visualizations, and the simplified proper-motion model is not a full high-precision astrometric solution.

The recommended next step is to fix the correctness-critical items, then run differential tests against independent astronomy libraries and validate FITS outputs independently. Until that work is complete, the appropriate status is **“mathematically reviewed with identified issues,” not “scientifically validated.”**

---

## Appendix A — Core equations collected

### Degree/radian conversion

\[
\theta_{\mathrm{rad}} = \theta_{\mathrm{deg}}\frac{\pi}{180},
\qquad
\theta_{\mathrm{deg}} = \theta_{\mathrm{rad}}\frac{180}{\pi}.
\]

### Equatorial unit vector

\[
\mathbf{r} =
(\cos\delta\cos\alpha,\,
 \cos\delta\sin\alpha,\,
 \sin\delta).
\]

### Spherical angular separation

\[
h =
\sin^2\left(\frac{\delta_2-\delta_1}{2}\right)
+
\cos\delta_1\cos\delta_2
\sin^2\left(\frac{\alpha_2-\alpha_1}{2}\right),
\]

\[
\theta = 2\arcsin\left(\sqrt{\min(1,\max(0,h))}\right).
\]

### HEALPix pixel count and characteristic scale

\[
N_{\mathrm{pix}}=12N_{\mathrm{side}}^2,
\qquad
\theta_{\mathrm{res}}\approx\sqrt{\frac{4\pi}{N_{\mathrm{pix}}}}.
\]

The latter is a characteristic scale derived from mean pixel area, not a guaranteed maximum pixel diameter.

### Magnitude relation

\[
\frac{F}{F_0}=10^{-0.4(m-m_0)}.
\]

### Redshift relation

\[
\lambda_{\mathrm{obs}}=\lambda_{\mathrm{rest}}(1+z).
\]

### Approximate small-angle sky displacement

\[
\Delta\theta_E\approx\Delta\alpha\cos\delta,
\qquad
\Delta\theta_N\approx\Delta\delta,
\]

with all angular quantities expressed in consistent units and RA differences wrapped appropriately.

### Julian Date from Unix milliseconds

\[
\mathrm{JD}=2440587.5+
\frac{t_{\mathrm{Unix,ms}}}{86{,}400{,}000}.
\]

### Linear wavelength calibration

\[
\lambda_i=\lambda_0+i\,\mathrm{CDELT1},
\qquad
\mathrm{CDELT1}=\frac{\lambda_1-\lambda_0}{N-1},
\]

for uniformly spaced samples and \(N>1\), subject to the FITS pixel-origin and WCS conventions in the header.

---

## Appendix B — Audit status summary

- **Coordinate conversion:** Sound in principle; convention comments need correction and independent validation.
- **Equatorial/Galactic transform:** Combined matrix appears correct; verify against matched-frame reference coordinates.
- **Angular separation:** Standard formula; clamp both bounds for numerical robustness.
- **HEALPix indexing:** Standard equations; NEST implementation has a bit-width/validator mismatch.
- **Cone search:** Tests pass for covered cases, but completeness is not established by finite grid sampling.
- **Proper-motion propagation:** Sound simplified spherical model; not a full high-precision astrometric solution.
- **Spectra:** Suitable as synthetic visuals; not physically calibrated as currently described.
- **Sky-motion readout:** Display exaggeration is intentional, but raw RA differences are not a general angular distance.
- **Spectrum plot:** Linear mapping is conventional; logarithmic inputs need validation.
- **FITS wavelength solution:** Linear equation is sound; sample precision and header calibration should be unified and independently checked.
- **Julian Date:** Formula is correct for Unix timestamps in milliseconds.
- **3D movement:** Standard interactive-control math; test boundaries and stalls.
- **Test status:** 72 passed; API test initialization blocked by missing `express` in isolated extraction.
