// Source adapter: server star-catalogue artifact -> canonical observe rows.
//
// The server publishes a `novochar.stars/v1` artifact ({ source, frame, equinox,
// referenceEpochJD, stars: [...] }). This module maps each published star onto a
// canonical catalog row. It is deliberately a faithful adapter, not an
// interpreter:
//
//   * the artifact's declared `frame` is forwarded verbatim onto every row, so
//     the catalog's frame policy — never this adapter — decides what is
//     acceptable. An ICRS artifact is accepted; a missing frame is reported as
//     `missing-frame`; a non-ICRS artifact (e.g. an FK5 catalogue) is reported
//     per row as `unsupported-frame:*` rather than silently treated as ICRS.
//   * proper motion is only carried when the artifact actually has it, in the
//     unit the artifact records it (`mas/yr`), never zero-filled.
//   * source-specific fields that have no canonical home (spectral type, B-V,
//     parallax, aliases, ...) go to `extras`, preserved but not interpreted.
//
// This keeps the catalog authoritative and the mapping reviewable in one place.

import { CATALOG_PM_UNIT } from './catalog.js';

/** Source-specific fields preserved verbatim under `record.extras`. */
function starExtras(star, fallbackEpochJD) {
  return {
    type: star.type ?? null,
    aliases: Array.isArray(star.aliases) ? star.aliases.slice() : [],
    spectralType: star.spectralType ?? null,
    bv: star.bv ?? null,
    parallaxMas: star.parallaxMas ?? null,
    distanceLy: star.distanceLy ?? null,
    refEpochJD: star.refEpochJD ?? fallbackEpochJD ?? null,
  };
}

function starToRow(star, declaredFrame, fallbackEpochJD) {
  const row = {
    id: star.id,
    name: star.name || star.id,
    ra: star.ra,
    dec: star.dec,
    mag: star.mag ?? null,
    // Forward the artifact's declared source frame verbatim; the catalog — not
    // this adapter — enforces the frame policy.
    frame: declaredFrame,
    extras: starExtras(star, fallbackEpochJD),
  };

  const pmRa = star.pmRaMasYr;
  const pmDec = star.pmDecMasYr;
  const hasPm = (pmRa !== null && pmRa !== undefined) || (pmDec !== null && pmDec !== undefined);
  if (hasPm) {
    row.pmRa = pmRa ?? null;
    row.pmDec = pmDec ?? null;
    row.pmUnits = CATALOG_PM_UNIT;
  }
  return row;
}

/** Provenance carried into the scene's catalog `meta`. */
export function starArtifactMeta(artifact) {
  return {
    schema: artifact?.schema ?? null,
    source: artifact?.source ?? null,
    sourceFrame: artifact?.frame ?? null,
    equinox: artifact?.equinox ?? null,
    referenceEpochJD: artifact?.referenceEpochJD ?? null,
  };
}

/**
 * Map a published star artifact to canonical rows. The returned rows carry the
 * artifact's declared frame so `buildCatalog` can accept or reject them.
 * @returns {Array<object>}
 */
export function starArtifactToRows(artifact) {
  const declaredFrame = artifact?.frame ?? null;
  const fallbackEpochJD = artifact?.referenceEpochJD ?? null;
  const stars = Array.isArray(artifact?.stars) ? artifact.stars : [];
  return stars.map((star) => starToRow(star, declaredFrame, fallbackEpochJD));
}
