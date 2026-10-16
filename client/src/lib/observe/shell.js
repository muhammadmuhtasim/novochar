// Mode B — Observe: the spherical-shell layer.
//
// This module is the ONLY place the shell query result is turned into things the
// existing Observe scene and renderers understand. It owns no astronomy: the
// shell band, membership and distance classification all come from the server,
// which in turn uses the shared @novochar/astro core. Here we only:
//
//   * describe the shell view state (radius, thickness, unit, visible layers);
//   * turn that state into query parameters;
//   * map a shell record into a catalog row (`extras` carries the shell metadata
//     so the renderers and the target panel can show it without re-querying).
//
// The mapping preserves provenance: nothing about where a record came from, how
// its distance was established, or how sure that distance is gets dropped.

import { SHELL_LAYERS, fromLightYears } from '@novochar/astro';

/** Layer ids in display order, reused from the shared core. */
export const LAYER_ORDER = Object.freeze([
  SHELL_LAYERS.LOCATED,
  SHELL_LAYERS.UNCERTAIN,
  SHELL_LAYERS.UNKNOWN,
]);

/** Units the shell controls offer. The canonical unit is light-years. */
export const SHELL_UNIT_OPTIONS = Object.freeze(['ly', 'pc', 'au']);

/**
 * Default shell view. The unknown (direction-only) layer is on by default so the
 * bright-star catalogue remains visible as the sky background; the located layer
 * is the survey band in front of it.
 */
export const DEFAULT_SHELL_VIEW = Object.freeze({
  radius: 100,
  thickness: 20,
  unit: 'ly',
  layers: Object.freeze({
    [SHELL_LAYERS.LOCATED]: true,
    [SHELL_LAYERS.UNCERTAIN]: true,
    [SHELL_LAYERS.UNKNOWN]: true,
  }),
});

/** Human labels for the layers and their fixed meaning. */
export const LAYER_META = Object.freeze({
  [SHELL_LAYERS.LOCATED]: {
    label: 'Located',
    note: 'usable distance, inside the band',
  },
  [SHELL_LAYERS.UNCERTAIN]: {
    label: 'Uncertain',
    note: 'distance evidence overlaps the band',
  },
  [SHELL_LAYERS.UNKNOWN]: {
    label: 'Unknown',
    note: 'no usable distance — direction only',
  },
});

/** Layer ids that are currently visible. */
export function visibleLayers(view) {
  return LAYER_ORDER.filter((id) => view?.layers?.[id]);
}

/**
 * Build the query parameters for `api.shell`. Always requests the three layers
 * the user can see — an invented layer is never requested.
 */
export function shellQueryParams(view, { limit = 1000 } = {}) {
  const include = visibleLayers(view);
  return {
    radius: view.radius,
    thickness: view.thickness,
    unit: view.unit,
    include: (include.length ? include : [SHELL_LAYERS.LOCATED]).join(','),
    limit,
  };
}

/**
 * The radial interval the distance evidence supports, in canonical light-years,
 * for the 3D view. A point distance is a zero-width range; an interval keeps its
 * own extent (an open upper bound stays +Infinity). Anything with no distance — a
 * direction-only record, or a posterior whose CDF has no inverse — returns null,
 * so the renderer never invents a radius. An interval is NEVER collapsed to a
 * midpoint here: the range itself is what the evidence actually says.
 */
export function radialRange(classification) {
  if (!classification) return null;
  if (Number.isFinite(classification.distance)) {
    return { low: classification.distance, high: classification.distance };
  }
  const interval = classification.interval;
  if (interval && Number.isFinite(interval.low)) {
    return { low: interval.low, high: Number.isFinite(interval.high) ? interval.high : Infinity };
  }
  return null;
}

/**
 * Map one shell record to a catalog row. The canonical coordinates (`ra`, `dec`,
 * `frame`) are passed through untouched; everything shell-specific travels in
 * `extras` so the frame policy and the scene code see an ordinary ICRS row.
 */
export function shellRecordToRow(record) {
  const classification = record?.classification ?? {};
  return {
    id: record.id,
    name: record.name,
    ra: record.ra,
    dec: record.dec,
    mag: Number.isFinite(record.mag) ? record.mag : null,
    frame: record.frame ?? 'icrs',
    extras: {
      type: record.type ?? 'OBJECT',
      status: record.status ?? null,
      reason: classification.reason ?? null,
      source: record.provenance?.source ?? null,
      catalog: record.provenance?.catalog ?? null,
      spectralType: record.spectralType ?? null,
      qualityNotes: Array.isArray(record.qualityNotes) ? record.qualityNotes : [],
      // `distance` is a real point measurement only. An interval never becomes a
      // scalar here — it is carried in `interval` (and `radialRange`) instead.
      distance: Number.isFinite(classification.distance) ? classification.distance : null,
      interval: classification.interval ?? null,
      radialRange: radialRange(classification),
      probability: Number.isFinite(classification.probability) ? classification.probability : null,
    },
  };
}

/** Map a shell query result into catalog rows. */
export function shellResultToRows(result) {
  return Array.isArray(result?.records) ? result.records.map(shellRecordToRow) : [];
}

/** Metadata attached to the scene built from a shell result. */
export function shellSceneMeta(result) {
  return {
    source: 'shell',
    bounds: result?.bounds ?? null,
    selection: result?.selection ?? null,
    counts: result?.counts ?? null,
    coverage: result?.coverage ?? [],
  };
}

/**
 * Human-readable distance for the target panel, or null when unknown. The
 * canonical distance in `extras` is always light-years; when the caller asks for
 * another unit the value is converted (never relabelled), so the number and the
 * unit always agree.
 */
export function formatDistance(extras, unit = 'ly') {
  if (!extras) return null;
  const convert = (ly) => fromLightYears(ly, unit);
  // The interval is the honest primary value: an interval must never be shown as
  // one exact distance. A point distance is shown only when there is no interval
  // to report.
  const { interval, distance } = extras;
  if (interval && Number.isFinite(interval.low)) {
    if (Number.isFinite(interval.high)) {
      return `${convert(interval.low).toFixed(2)}–${convert(interval.high).toFixed(2)} ${unit}`;
    }
    return `≥ ${convert(interval.low).toFixed(2)} ${unit}`;
  }
  if (Number.isFinite(distance)) return `${convert(distance).toFixed(2)} ${unit}`;
  return null;
}

/**
 * A short, honest note for a record: how the distance was established, and any
 * caveat the source attached. Unknown/direction-only records get an explicit
 * sentence rather than a blank field.
 */
export function distanceNote(extras) {
  if (!extras) return '';
  if (extras.status === SHELL_LAYERS.UNKNOWN || extras.reason === 'no-distance') {
    return 'No usable distance: position is known, 3D shell membership is not.';
  }
  if (extras.status === SHELL_LAYERS.UNCERTAIN) {
    if (extras.interval && !Number.isFinite(extras.interval.high)) {
      return 'Distance evidence is only a lower bound that reaches the band; membership is not definite.';
    }
    return 'Distance evidence is an interval that overlaps the band; the object is not definitely inside it.';
  }
  if (Array.isArray(extras.qualityNotes) && extras.qualityNotes.includes('simulated')) {
    return 'Simulated source: distances are model values, not measurements.';
  }
  if (Array.isArray(extras.qualityNotes) && extras.qualityNotes.includes('distance-without-uncertainty')) {
    return 'Distance is carried without an uncertainty; membership is shown as adopted.';
  }
  if (extras.interval) {
    return 'Distance is an interval from the source, wholly inside the band.';
  }
  return null;
}

/** Page size the Observe client requests; the server paginates the remainder. */
export const SHELL_PAGE_SIZE = 300;

/**
 * True when a response arriving out of order must be dropped. Requests are
 * tagged with a monotonically increasing sequence number and only the newest one
 * may commit to state, so a slow earlier response can never overwrite a faster
 * later one — which would leave the displayed catalogue stale.
 */
export function isSuperseded(responseSeq, latestSeq) {
  return responseSeq !== latestSeq;
}

/**
 * True when the server rejected a cursor because it no longer matches the query
 * that made it — for example a band change while a "load more" was in flight.
 * The caller should restart from page one rather than show a fatal error; the
 * server is refusing to apply one query's offset to a different result set.
 */
export function isStaleCursorError(error) {
  return error?.code === 'invalid-cursor';
}

/**
 * Merge a later page into the accumulated result. Records are de-duplicated by
 * stable id (first occurrence wins), so a cursor that lands twice can never show
 * an object twice; `counts.returned` is recomputed as the number actually on
 * screen while the server's authoritative `members`/`pending` figures pass
 * through unchanged.
 */
export function mergeShellResults(current, incoming) {
  if (!current) return incoming ?? null;
  if (!incoming) return current;
  const existing = Array.isArray(current.records) ? current.records : [];
  const seen = new Set(existing.map((record) => record.id));
  const appended = (Array.isArray(incoming.records) ? incoming.records : []).filter(
    (record) => !seen.has(record.id),
  );
  const records = [...existing, ...appended];
  return {
    ...current,
    records,
    counts: incoming.counts ? { ...incoming.counts, returned: records.length } : current.counts,
    coverage: incoming.coverage ?? current.coverage,
    page: incoming.page ?? current.page,
  };
}
