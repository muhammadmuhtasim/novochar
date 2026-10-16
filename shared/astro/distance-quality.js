// Distance-evidence classification for the spherical-shell explorer.
//
// The shell asks a single scientific question about each object: given what the
// source actually measured, can we say the object is inside this distance band?
// The answer is one of four mutually exclusive classes, and this module is the
// one place that decides it:
//
//   located    usable distance, exact membership in the band (plan §5.4)
//   uncertain  the evidence overlaps or assigns non-negligible probability to
//              the band, but does not establish definite membership
//   unknown    insufficient information to assess 3D shell membership at all
//   outside    usable evidence that the object is NOT in the band (excluded)
//
// `outside` is deliberately distinct from the three display layers: an object
// with a precise distance that falls outside the band is not "unknown", and it
// is not shown — it simply is not in the selected region. Keeping it explicit
// stops the UI from listing definitively-outside objects as uncertain.
//
// Honesty rules (plan §5) this module is built around:
//   * a standard error is NOT treated as a Gaussian distance distribution;
//   * a parallax is not silently turned into a symmetric distance error;
//   * interval semantics are taken at face value and reported, not reinterpreted;
//   * probability thresholds are explicit and configurable, never hard-coded
//     into a scientific claim.
//
// Pure: no DOM, renderer, or network. Distances are canonical light-years.

import { toLightYears } from './distance.js';
import { shellBounds } from './shell.js';

export const DISTANCE_CLASS = Object.freeze({
  LOCATED: 'located',
  UNCERTAIN: 'uncertain',
  UNKNOWN: 'unknown',
  OUTSIDE: 'outside',
});

/**
 * Default membership policy.
 *
 *   locateFullInterval  an interval wholly inside the band counts as located
 *                       (plan §5.2: allowed "if the source's interval semantics
 *                       and the configured quality rules support" it);
 *   probabilityThreshold minimum shell probability for `uncertain` (0 => any
 *                       non-zero probability is uncertain, the least-committal
 *                       default until a source-specific model is validated);
 *   locatedProbability  minimum shell probability for `located` (1 => the
 *                       posterior's support must sit inside the band).
 */
export const DEFAULT_MEMBERSHIP_POLICY = Object.freeze({
  locateFullInterval: true,
  probabilityThreshold: 0,
  locatedProbability: 1,
});

/** Resolve a distance bound, tolerating an open upper bound and a sub-solar lower. */
function boundToCanonical(value, unit) {
  if (value === Infinity) return Infinity;
  if (value === -Infinity) return 0; // anything below the Sun is simply the origin
  return toLightYears(value, unit);
}

function classification(status, reason, extra) {
  return extra === undefined ? { status, reason } : { status, reason, ...extra };
}

function classifyPoint(evidence, bounds) {
  let distance;
  try {
    distance = toLightYears(evidence.value, evidence.unit);
  } catch (err) {
    return classification(DISTANCE_CLASS.UNKNOWN, `invalid-distance:${err.message}`);
  }
  if (distance < 0) return classification(DISTANCE_CLASS.UNKNOWN, 'negative-distance');
  const inside = distance >= bounds.rMin && distance <= bounds.rMax;
  return inside
    ? classification(DISTANCE_CLASS.LOCATED, 'inside-shell', { distance })
    : classification(DISTANCE_CLASS.OUTSIDE, 'outside-shell', { distance });
}

function classifyInterval(evidence, bounds, policy) {
  let low;
  let high;
  try {
    low = boundToCanonical(evidence.low, evidence.unit);
    high = boundToCanonical(evidence.high, evidence.unit);
  } catch (err) {
    return classification(DISTANCE_CLASS.UNKNOWN, `invalid-interval:${err.message}`);
  }
  if (high < low) return classification(DISTANCE_CLASS.UNKNOWN, 'inverted-interval');

  const interval = { low, high };
  const overlaps = low <= bounds.rMax && high >= bounds.rMin;
  if (!overlaps) return classification(DISTANCE_CLASS.OUTSIDE, 'interval-outside-shell', { interval });

  const fullyInside = low >= bounds.rMin && high <= bounds.rMax;
  if (fullyInside && policy.locateFullInterval) {
    return classification(DISTANCE_CLASS.LOCATED, 'interval-inside-shell', { interval });
  }
  return classification(DISTANCE_CLASS.UNCERTAIN, 'interval-overlaps-shell', { interval });
}

function classifyPosterior(evidence, bounds, policy) {
  if (typeof evidence.cdf !== 'function') {
    return classification(DISTANCE_CLASS.UNKNOWN, 'invalid-posterior');
  }
  let cdfLow;
  let cdfHigh;
  try {
    cdfLow = evidence.cdf(bounds.rMin);
    cdfHigh = evidence.cdf(bounds.rMax);
  } catch {
    return classification(DISTANCE_CLASS.UNKNOWN, 'invalid-posterior');
  }
  if (!Number.isFinite(cdfLow) || !Number.isFinite(cdfHigh)) {
    return classification(DISTANCE_CLASS.UNKNOWN, 'non-finite-probability');
  }
  const probability = Math.min(1, Math.max(0, cdfHigh - cdfLow));
  if (probability >= policy.locatedProbability) {
    return classification(DISTANCE_CLASS.LOCATED, 'posterior-within-shell', { probability });
  }
  if (probability > policy.probabilityThreshold) {
    return classification(DISTANCE_CLASS.UNCERTAIN, 'posterior-overlaps-shell', { probability });
  }
  return classification(DISTANCE_CLASS.OUTSIDE, 'posterior-outside-shell', { probability });
}

/**
 * Classify one piece of distance evidence against a shell band.
 *
 * Evidence shapes (all pure data; a source adapter builds them):
 *   { kind: 'point',     value, unit }        a single adopted distance
 *   { kind: 'interval',  low, high, unit }    high may be +Infinity
 *   { kind: 'posterior', cdf }                cdf(distanceLy) -> [0, 1]
 *   { kind: 'missing' | 'invalid', reason }   nothing usable
 *
 * @param {object} evidence
 * @param {{rMin:number, rMax:number}} bounds canonical-unit shell bounds
 * @param {object} [policy] see {@link DEFAULT_MEMBERSHIP_POLICY}
 * @returns {{status:string, reason:string, distance?:number, interval?:object, probability?:number}}
 */
export function classifyDistanceEvidence(evidence, bounds, policy = {}) {
  const resolved = { ...DEFAULT_MEMBERSHIP_POLICY, ...policy };
  if (!evidence || typeof evidence !== 'object') {
    return classification(DISTANCE_CLASS.UNKNOWN, 'no-distance');
  }
  switch (evidence.kind) {
    case 'point':
      return classifyPoint(evidence, bounds);
    case 'interval':
      return classifyInterval(evidence, bounds, resolved);
    case 'posterior':
      return classifyPosterior(evidence, bounds, resolved);
    case 'missing':
      return classification(DISTANCE_CLASS.UNKNOWN, evidence.reason || 'no-distance');
    case 'invalid':
      return classification(DISTANCE_CLASS.UNKNOWN, evidence.reason || 'invalid-distance');
    default:
      return classification(DISTANCE_CLASS.UNKNOWN, 'unrecognized-evidence');
  }
}

/**
 * Classify distance evidence for a shell selection. `radius` and `thickness` are
 * in the same unit as the shell selection (canonical light-years here).
 */
export function classifyDistanceMembership(evidence, radius, thickness, policy = {}) {
  return classifyDistanceEvidence(evidence, shellBounds(radius, thickness), policy);
}

/** True for the three classes that can appear in a visible layer. */
export function isLayerClass(status) {
  return (
    status === DISTANCE_CLASS.LOCATED
    || status === DISTANCE_CLASS.UNCERTAIN
    || status === DISTANCE_CLASS.UNKNOWN
  );
}
