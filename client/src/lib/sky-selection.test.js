// Unit tests for the Mode A render selection policy.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { apparentMagnitude, selectVisibleStars } from './sky-selection.js';

const star = (id, magnitude, extra = {}) => ({ id, magnitude, ...extra });

test('apparentMagnitude uses the catalog magnitude and a finite fallback', () => {
  assert.equal(apparentMagnitude({ mag: 3.4 }), 3.4);
  assert.equal(apparentMagnitude({ mag: '5.2' }), 5.2);
  assert.equal(apparentMagnitude({ mag: null }, 10), 10);
  assert.equal(apparentMagnitude({}, 12), 12);
});

test('draws the brightest candidates, not the farthest', () => {
  const visible = selectVisibleStars({
    candidates: [star('dim', 12), star('bright', 3), star('mid', 7)],
    maxCount: 3,
  });
  assert.deepEqual(visible.map((s) => s.id), ['bright', 'mid', 'dim']);
});

test('respects the render limit', () => {
  const visible = selectVisibleStars({
    candidates: [star('a', 1), star('b', 2), star('c', 3), star('d', 4)],
    maxCount: 2,
  });
  assert.deepEqual(visible.map((s) => s.id), ['a', 'b']);
});

test('is deterministic and does not mutate the input array', () => {
  const candidates = [star('b', 5), star('a', 5), star('c', 5)];
  const before = candidates.map((s) => s.id);
  const first = selectVisibleStars({ candidates, maxCount: 3 });
  const second = selectVisibleStars({ candidates, maxCount: 3 });
  assert.deepEqual(first.map((s) => s.id), ['a', 'b', 'c'], 'ties break by id');
  assert.deepEqual(first.map((s) => s.id), second.map((s) => s.id));
  assert.deepEqual(candidates.map((s) => s.id), before, 'input order preserved');
});

test('pins the selected object even when it is beyond the render limit', () => {
  const faint = star('target', 20);
  const visible = selectVisibleStars({
    candidates: [star('a', 1), star('b', 2), faint],
    maxCount: 2,
    pinned: faint,
  });
  assert.deepEqual(visible.map((s) => s.id), ['a', 'b', 'target']);
});

test('pins a target that is absent from the candidates (frustum / magnitude / distance)', () => {
  const hidden = star('searched', 25);
  const visible = selectVisibleStars({
    candidates: [star('a', 1)],
    maxCount: 5,
    pinned: hidden,
  });
  assert.deepEqual(visible.map((s) => s.id), ['a', 'searched']);
});

test('does not duplicate a pinned object that is already drawn', () => {
  const pinned = star('bright', 1);
  const visible = selectVisibleStars({
    candidates: [star('bright', 1), star('b', 2)],
    maxCount: 5,
    pinned,
  });
  assert.deepEqual(visible.map((s) => s.id), ['bright', 'b']);
});

test('a zero limit still yields only the pinned target', () => {
  const pinned = star('target', 9);
  assert.deepEqual(selectVisibleStars({ candidates: [star('a', 1)], maxCount: 0, pinned }).map((s) => s.id), ['target']);
  assert.deepEqual(selectVisibleStars({ candidates: [star('a', 1)], maxCount: 0 }).map((s) => s.id), []);
});

test('handles empty input', () => {
  assert.deepEqual(selectVisibleStars(), []);
  assert.deepEqual(selectVisibleStars({ candidates: [], maxCount: 10 }), []);
});
