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

/** A representative distance (canonical ly) for a classification, or null. */
export function representativeDistance(classification) {
  if (!classification) return null;
  if (Number.isFinite(classification.distance)) return classification.distance;
  if (classification.interval && Number.isFinite(classification.interval.low) && Number.isFinite(classification.interval.high)) {
    return (classification.interval.low + classification.interval.high) / 2;
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
      distance: representativeDistance(classification),
      interval: classification.interval ?? null,
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
  if (Number.isFinite(extras.distance)) return `${convert(extras.distance).toFixed(2)} ${unit}`;
  if (extras.interval && Number.isFinite(extras.interval.low) && Number.isFinite(extras.interval.high)) {
    return `${convert(extras.interval.low).toFixed(2)}–${convert(extras.interval.high).toFixed(2)} ${unit}`;
  }
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
  if (Array.isArray(extras.qualityNotes) && extras.qualityNotes.includes('simulated')) {
    return 'Simulated source: distances are model values, not measurements.';
  }
  if (Array.isArray(extras.qualityNotes) && extras.qualityNotes.includes('distance-without-uncertainty')) {
    return 'Distance is carried without an uncertainty; membership is shown as adopted.';
  }
  return null;
}
