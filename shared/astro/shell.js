// Spherical-shell geometry for the Novochar explorer.
//
// The shell is a hollow spherical VOLUME BAND centred on the Sun:
//
//   S(R, T) = { x in R^3 : rMin <= |x - o| <= rMax }
//   rMin = max(0, R - T/2),  rMax = R + T/2
//
// where R is the mean radius and T the FULL thickness (not half-thickness).
// Membership is determined by the whole band, not by the two boundary surfaces.
//
// This module is pure: no DOM, no renderer, no network, no state. It is the ONE
// place the membership predicate is implemented, so the server query, the 2D/3D
// renderers and the tests can never disagree about what "inside the shell" means.
//
// All distances are in the canonical distance unit (light-years); callers
// convert at the boundary with `./distance.js` before calling in.

import { assertFiniteNumber } from './vector.js';
import { CANONICAL_DISTANCE_UNIT, isKnownDistanceUnit } from './distance.js';

/** Layers the explorer can show. `outside` is not a layer: it is excluded. */
export const SHELL_LAYERS = Object.freeze({
  LOCATED: 'located',
  UNCERTAIN: 'uncertain',
  UNKNOWN: 'unknown',
});

const SHELL_LAYER_IDS = new Set(Object.values(SHELL_LAYERS));

/** Which layers are visible by default (direction-only data stays off). */
export const DEFAULT_SHELL_LAYERS = Object.freeze({
  [SHELL_LAYERS.LOCATED]: true,
  [SHELL_LAYERS.UNCERTAIN]: true,
  [SHELL_LAYERS.UNKNOWN]: false,
});

/** A sensible, valid starting selection: a 100 ly shell, 20 ly thick. */
export const DEFAULT_SHELL_SELECTION = Object.freeze({
  radius: 100,
  thickness: 20,
  unit: CANONICAL_DISTANCE_UNIT,
  layers: DEFAULT_SHELL_LAYERS,
});

function assertNonNegative(value, name) {
  assertFiniteNumber(value, name);
  if (value < 0) throw new RangeError(`${name} must be >= 0`);
}

/**
 * Inner and outer radii for a mean radius and full thickness.
 * The inner radius is clamped at zero so a thickness greater than twice the
 * radius yields a solid ball (rMin = 0) rather than a negative radius.
 * @returns {{rMin:number, rMax:number}} in the canonical unit
 */
export function shellBounds(radius, thickness) {
  assertNonNegative(radius, 'radius');
  assertNonNegative(thickness, 'thickness');
  const half = thickness / 2;
  return { rMin: Math.max(0, radius - half), rMax: radius + half };
}

/**
 * Exact, inclusive membership predicate for a distance already in the canonical
 * unit. Both boundaries are inside. A non-finite distance is never a member.
 */
export function insideBounds(distance, bounds) {
  return distance >= bounds.rMin && distance <= bounds.rMax;
}

/** Exact, inclusive membership predicate for `insideShell(d, R, T)`. */
export function insideShell(distance, radius, thickness) {
  return insideBounds(distance, shellBounds(radius, thickness));
}

/** Volume of the shell band, in cubic canonical units. */
export function shellVolume(radius, thickness) {
  const { rMin, rMax } = shellBounds(radius, thickness);
  return (4 * Math.PI / 3) * (rMax ** 3 - rMin ** 3);
}

/**
 * Thin-shell volume approximation, 4πR²T. Retained because it is the reason
 * fixed-thickness counts grow with radius squared; the exact form is used for
 * any value that matters.
 */
export function shellVolumeApprox(radius, thickness) {
  assertNonNegative(radius, 'radius');
  assertNonNegative(thickness, 'thickness');
  return 4 * Math.PI * radius * radius * thickness;
}

/** Normalize a layer toggle map, defaulting any missing layer. */
export function normalizeLayers(layers) {
  const out = {};
  for (const id of SHELL_LAYER_IDS) {
    const value = layers && Object.prototype.hasOwnProperty.call(layers, id) ? layers[id] : DEFAULT_SHELL_LAYERS[id];
    out[id] = Boolean(value);
  }
  return out;
}

/**
 * Validate and normalize a shell selection descriptor, `{ radius, thickness,
 * unit, layers }`, into the canonical form. Throws on out-of-range or unknown
 * inputs; never guesses a unit. Radius and thickness are validated in the unit
 * as given, then reported unchanged (distance arithmetic happens in the core).
 */
export function normalizeShellSelection(selection = {}) {
  const radius = selection.radius ?? DEFAULT_SHELL_SELECTION.radius;
  const thickness = selection.thickness ?? DEFAULT_SHELL_SELECTION.thickness;
  const unit = selection.unit ?? CANONICAL_DISTANCE_UNIT;

  assertNonNegative(radius, 'radius');
  assertNonNegative(thickness, 'thickness');
  if (!isKnownDistanceUnit(unit)) {
    throw new RangeError(`unknown distance unit "${unit}"`);
  }
  // Build the bounds once so an invalid combination fails here rather than deep
  // inside a query.
  shellBounds(radius, thickness);
  return { radius, thickness, unit, layers: normalizeLayers(selection.layers) };
}
