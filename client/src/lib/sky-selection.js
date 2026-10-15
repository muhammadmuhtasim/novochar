/**
 * Rendering selection policy for the Mode A celestial sphere.
 *
 * The Explore renderer can only draw a bounded number of catalog objects, so the
 * choice of *which* ones is a policy decision kept here, independent of Three.js,
 * so it can be unit-tested and reused unchanged when the simulated survey records
 * are replaced by a real star catalog (e.g. Hipparcos / Yale BSC).
 *
 * Rules:
 *  - `candidates` are already visibility-culled upstream (frustum, distance and
 *    apparent-magnitude limits).
 *  - the drawn set is the N *brightest* candidates (lowest apparent magnitude),
 *    never the farthest — distance must not stand in for brightness on a
 *    celestial sphere.
 *  - a `pinned` object (the user's current selection / search target) is always
 *    included, even when it falls outside the candidate filters, so navigating to
 *    a search result can never land on a point the renderer omitted.
 */

export function apparentMagnitude(object, fallback = 10) {
  const raw = object?.mag;
  if (raw === null || raw === undefined || raw === '') return fallback;
  const magnitude = Number(raw);
  return Number.isFinite(magnitude) ? magnitude : fallback;
}

export function selectVisibleStars({ candidates = [], maxCount = 0, pinned = null } = {}) {
  const limit = Number.isFinite(maxCount) ? Math.max(0, Math.floor(maxCount)) : 0;
  const ordered = candidates
    .slice()
    .sort((a, b) => a.magnitude - b.magnitude || String(a.id).localeCompare(String(b.id)));
  const selected = ordered.slice(0, limit);
  if (pinned && !selected.some((candidate) => candidate.id === pinned.id)) {
    selected.push(pinned);
  }
  return selected;
}
