// Canonical catalog object model for Mode B — Observe.
//
// A catalog record is the frame-normalized unit the rest of Observe works with.
// Every coordinate in the model is ICRS, in DEGREES:
//
//   {
//     schema,   // CATALOG_SCHEMA_VERSION, so records can migrate over time
//     id,       // stable, non-empty identifier (unique within a catalog)
//     name,     // human label; falls back to the id
//     ra,       // ICRS right ascension, degrees, [0, 360)
//     dec,      // ICRS declination, degrees, [-90, 90]
//     mag,      // optional Johnson V magnitude, or null
//     pmRa,     // optional proper motion mu_alpha* = mu_alpha * cos(dec), mas/yr
//     pmDec,    // optional proper motion mu_delta, mas/yr
//     pmUnits,  // the unit the two proper-motion values are stored in
//     frame,    // always CATALOG_FRAME ('icrs'): the record's coordinate frame
//     extras,   // source-specific fields, preserved but NOT interpreted
//   }
//
// The normalized fields above are typed and validated. Anything a source
// exposes beyond them belongs in `extras` and is never silently promoted into a
// coordinate: the split between normalized fields and `extras` is explicit.
//
// FRAME POLICY: normalization never guesses. A source frame must be stated
// explicitly, either on the row (`row.frame`) or via the `frame` option, and
// only an ICRS designation is accepted. FK5/J2000 (or any other) sources must
// be converted to ICRS by the caller — the shared @novochar/astro core exposes
// the frame-bias transform — before reaching this module. A missing or
// unrecognized frame is rejected, never assumed to be ICRS.

export const CATALOG_SCHEMA_VERSION = 1;

/** The one coordinate frame the canonical model stores. */
export const CATALOG_FRAME = 'icrs';

/** Canonical proper-motion unit of the model. */
export const CATALOG_PM_UNIT = 'mas/yr';

// Accepted spellings for the proper-motion units a source may declare, mapped to
// a factor that converts the source value to the canonical mas/yr.
const PM_UNITS_TO_MAS_PER_YEAR = new Map([
  ['mas/yr', 1],
  ['mas/year', 1],
  ['mas/y', 1],
  ['milliarcsec/yr', 1],
  ['milliarcsec/year', 1],
  ['milliarcsecond/yr', 1],
  ['milliarcsecond/year', 1],
  ['arcsec/yr', 1000],
  ['arcsec/year', 1000],
  ['arcsec/y', 1000],
  ['arcsecond/yr', 1000],
  ['arcsecond/year', 1000],
]);

/** Normalize a frame/unit token: trim, lower-case, collapse separators. */
function canonicalToken(value) {
  return String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isIcrs(frame) {
  return canonicalToken(frame) === CATALOG_FRAME;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalize optional proper motion to the canonical unit.
 * Returns `{ pmRa, pmDec }`, or `{ error }` when the declaration is invalid.
 * The pair is optional, but when present the unit MUST be declared and known.
 */
function normalizeProperMotion(raw) {
  const hasRa = raw.pmRa !== undefined && raw.pmRa !== null;
  const hasDec = raw.pmDec !== undefined && raw.pmDec !== null;
  if (!hasRa && !hasDec) return { pmRa: null, pmDec: null };

  const declaredUnit = raw.pmUnits ?? raw.properMotionUnits;
  if (declaredUnit === undefined || declaredUnit === null || declaredUnit === '') {
    return { error: 'missing-pm-units' };
  }
  const factor = PM_UNITS_TO_MAS_PER_YEAR.get(canonicalToken(declaredUnit));
  if (!factor) return { error: `unsupported-pm-units:${String(declaredUnit)}` };

  if (hasRa && !isFiniteNumber(raw.pmRa)) return { error: 'invalid-pmRa' };
  if (hasDec && !isFiniteNumber(raw.pmDec)) return { error: 'invalid-pmDec' };

  return {
    pmRa: hasRa ? raw.pmRa * factor : null,
    pmDec: hasDec ? raw.pmDec * factor : null,
  };
}

/**
 * Build a canonical record from one source row.
 * @returns {{record: object}|{error: string}} the normalized record, or a
 *   machine-readable reason it was rejected.
 */
function normalizeRecordDetailed(raw, { frame } = {}) {
  if (!raw || typeof raw !== 'object') return { error: 'not-an-object' };

  // The `frame` option asserts the frame of every row. It is a caller
  // assertion, so an unsupported value is a programming error, not bad data.
  if (frame !== undefined && frame !== null && !isIcrs(frame)) {
    throw new RangeError(
      `normalizeRecord: unsupported frame option "${frame}"; only "${CATALOG_FRAME}" is accepted`,
    );
  }
  const declaredFrame = frame ?? raw.frame;
  if (declaredFrame === undefined || declaredFrame === null || declaredFrame === '') {
    return { error: 'missing-frame' };
  }
  if (!isIcrs(declaredFrame)) {
    return { error: `unsupported-frame:${String(declaredFrame)}` };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return { error: 'missing-id' };

  if (!isFiniteNumber(raw.ra) || raw.ra < 0 || raw.ra >= 360) return { error: 'invalid-ra' };
  if (!isFiniteNumber(raw.dec) || raw.dec < -90 || raw.dec > 90) return { error: 'invalid-dec' };

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;

  if (raw.mag !== undefined && raw.mag !== null && !isFiniteNumber(raw.mag)) {
    return { error: 'invalid-mag' };
  }
  const mag = isFiniteNumber(raw.mag) ? raw.mag : null;

  const pm = normalizeProperMotion(raw);
  if (pm.error) return { error: pm.error };

  const extras =
    raw.extras && typeof raw.extras === 'object' && !Array.isArray(raw.extras)
      ? { ...raw.extras }
      : {};

  return {
    record: {
      schema: CATALOG_SCHEMA_VERSION,
      id,
      name,
      ra: raw.ra,
      dec: raw.dec,
      mag,
      pmRa: pm.pmRa,
      pmDec: pm.pmDec,
      pmUnits: CATALOG_PM_UNIT,
      frame: CATALOG_FRAME,
      extras,
    },
  };
}

/**
 * Normalize a single source row to a canonical ICRS record.
 * @returns {object|null} the record, or null if the row is invalid.
 */
export function normalizeRecord(raw, options = {}) {
  return normalizeRecordDetailed(raw, options).record ?? null;
}

/**
 * Validate a row/record without building it.
 * @returns {string|null} a stable reason code, or null when valid.
 */
export function validateRecord(raw, options = {}) {
  return normalizeRecordDetailed(raw, options).error ?? null;
}

/**
 * Build a catalog from source rows.
 *
 * Invalid rows are skipped and reported in `issues` (with their original index)
 * rather than aborting the whole build, so one bad row cannot lose a catalog.
 * Rows whose id duplicates an earlier accepted row are rejected the same way.
 *
 * @param {Array} rows
 * @param {{frame?: string, meta?: object, source?: string}} [options]
 *   `frame` asserts the frame of every row lacking its own `frame` field.
 * @returns {{schema, frame, meta, records, issues, stats}}
 */
export function buildCatalog(rows, { frame, meta = {}, source } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('buildCatalog: rows must be an array');

  const records = [];
  const issues = [];
  const firstIndexById = new Map();

  rows.forEach((raw, index) => {
    const { record, error } = normalizeRecordDetailed(raw, { frame });
    if (!record) {
      issues.push({ index, id: raw && typeof raw.id === 'string' ? raw.id : null, reason: error });
      return;
    }
    if (firstIndexById.has(record.id)) {
      issues.push({ index, id: record.id, reason: `duplicate-id:${firstIndexById.get(record.id)}` });
      return;
    }
    firstIndexById.set(record.id, index);
    records.push(record);
  });

  return {
    schema: CATALOG_SCHEMA_VERSION,
    frame: CATALOG_FRAME,
    meta: source ? { source, ...meta } : { ...meta },
    records,
    issues,
    stats: { rows: rows.length, accepted: records.length, rejected: issues.length },
  };
}
