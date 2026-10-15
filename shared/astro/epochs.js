// Epoch conventions for the scientific core.
//
// Canonical representation: a numeric Julian Date on the TT scale, matching the
// committed catalogue pipeline's `referenceEpochJD` (J2000.0 = JD 2451545.0).
// Human-facing "Julian year" values (e.g. 2016.0) convert through these
// helpers. Never infer an epoch's system or scale from context — store it
// alongside the value; these functions only convert the numeric representation.

export const J2000_JD = 2451545.0; // 2000-01-01T12:00:00 TT
export const J2000_JULIAN_YEAR = 2000.0;
export const JULIAN_YEAR_DAYS = 365.25;

/** Julian year (e.g. 2000.0) -> Julian Date. */
export function julianYearToJD(julianYear) {
  return J2000_JD + (julianYear - J2000_JULIAN_YEAR) * JULIAN_YEAR_DAYS;
}

/** Julian Date -> Julian year. */
export function jdToJulianYear(jd) {
  return J2000_JULIAN_YEAR + (jd - J2000_JD) / JULIAN_YEAR_DAYS;
}

/** Signed days from `refJD` to `targetJD`. */
export function daysBetweenEpochs(refJD, targetJD) {
  return targetJD - refJD;
}

/** Signed Julian years from `refJD` to `targetJD`. */
export function yearsBetweenEpochs(refJD, targetJD) {
  return (targetJD - refJD) / JULIAN_YEAR_DAYS;
}
