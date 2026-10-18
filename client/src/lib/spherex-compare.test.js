import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLINK_SPEEDS_MS,
  COMPARISON_KEYS,
  MODES,
  comparisonReducer,
  displayedEpochs,
  initialComparison,
  isComparing,
} from './spherex-compare.js';

const epochCount = 2;
const run = (state, ...actions) =>
  actions.reduce((s, action) => comparisonReducer(s, { epochCount, ...action }), state);

test('the reference view is the M3-C side-by-side layout', () => {
  const state = initialComparison();
  assert.equal(state.mode, 'side-by-side');
  assert.equal(state.activeEpoch, 0);
  assert.deepEqual(displayedEpochs(state, epochCount), [0, 1]);
  assert.equal(isComparing(state), false);
});

test('comparison state carries only comparison keys — never view parameters', () => {
  // The structural guarantee behind "switching cannot move the view": width,
  // height, WCS, zoom, pan and stretch are not reachable from this state, so
  // no action sequence can introduce or alter them.
  assert.deepEqual(Object.keys(initialComparison()).sort(), [...COMPARISON_KEYS].sort());
  const swept = run(
    initialComparison(),
    { type: 'mode', mode: 'single' },
    { type: 'epoch', epoch: 1 },
    { type: 'mode', mode: 'blink' },
    { type: 'tick' },
    { type: 'speed', speedMs: 250 },
    { type: 'epoch', epoch: 0 },
    { type: 'mode', mode: 'side-by-side' },
    { type: 'tick' },
  );
  assert.deepEqual(Object.keys(swept).sort(), [...COMPARISON_KEYS].sort());
  for (const forbidden of ['width', 'height', 'wcs', 'zoom', 'pan', 'stretch', 'pixels']) {
    assert.ok(!(forbidden in swept), `${forbidden} must not be reachable from comparison state`);
  }
});

test('switching mode changes nothing else', () => {
  const base = initialComparison();
  for (const mode of MODES) {
    const next = run(base, { type: 'mode', mode });
    const { mode: _dropped, ...rest } = next;
    const { mode: _was, ...was } = base;
    assert.deepEqual(rest, was, `mode -> ${mode} left every other field untouched`);
  }
});

test('selecting an epoch changes only which epoch is active', () => {
  const state = run(initialComparison(), { type: 'mode', mode: 'single' }, { type: 'epoch', epoch: 1 });
  assert.equal(state.activeEpoch, 1);
  assert.equal(state.mode, 'single');
  assert.equal(state.speedMs, initialComparison().speedMs);
  assert.equal(state.playing, initialComparison().playing);
  assert.deepEqual(displayedEpochs(state, epochCount), [1]);
});

test('epoch selection outside the loaded range is clamped, not accepted blindly', () => {
  assert.equal(run(initialComparison(), { type: 'epoch', epoch: 5 }).activeEpoch, 1);
  assert.equal(run(initialComparison(), { type: 'epoch', epoch: -1 }).activeEpoch, 1);
  assert.equal(run(initialComparison(), { type: 'epoch', epoch: 'x' }).activeEpoch, 0);
});

test('manual selection pauses an automatic blink and stays where it was put', () => {
  const blinking = run(initialComparison(), { type: 'mode', mode: 'blink' });
  assert.equal(blinking.playing, true, 'entering blink mode alternates by default');
  const chosen = run(blinking, { type: 'epoch', epoch: 1 });
  assert.equal(chosen.activeEpoch, 1, 'the chosen epoch is the one shown');
  assert.equal(chosen.playing, false, 'the frame will not flip back under the cursor');
  // A stale interval tick must not undo the manual choice.
  assert.equal(run(chosen, { type: 'tick' }).activeEpoch, 1);
  // Pressing play resumes alternation from the chosen epoch.
  const resumed = run(chosen, { type: 'play', playing: true });
  assert.equal(resumed.playing, true);
  assert.equal(run(resumed, { type: 'tick' }).activeEpoch, 0);
});

test('selecting the epoch already on screen still pauses a running blink', () => {
  // The blink may have flipped to the epoch the reader wants before their click
  // lands. Manually asking for that epoch must still hold it, or the frame
  // keeps flipping under the cursor and the selection is silently ignored.
  const blinking = run(initialComparison(), { type: 'mode', mode: 'blink' });
  const showingSecond = run(blinking, { type: 'tick' });
  assert.equal(showingSecond.activeEpoch, 1);
  const pinned = run(showingSecond, { type: 'epoch', epoch: 1 });
  assert.equal(pinned.activeEpoch, 1, 'the requested epoch stays on screen');
  assert.equal(pinned.playing, false, 'asking for the visible epoch pauses the blink');
  assert.equal(run(pinned, { type: 'tick' }).activeEpoch, 1, 'no stale tick undoes it');
  // Outside blink mode the same request is a true no-op.
  const single = run(initialComparison(), { type: 'mode', mode: 'single' });
  assert.equal(run(single, { type: 'epoch', epoch: 0 }), single);
});

test('tick alternates only while blinking and playing', () => {
  const idle = run(initialComparison(), { type: 'tick' });
  assert.equal(idle.activeEpoch, 0, 'a stray tick in side-by-side mode does nothing');
  const paused = run(
    initialComparison(),
    { type: 'mode', mode: 'blink' },
    { type: 'play', playing: false },
    { type: 'tick' },
  );
  assert.equal(paused.activeEpoch, 0, 'a stale timer cannot advance a paused blink');
  const running = run(initialComparison(), { type: 'mode', mode: 'blink' });
  assert.equal(run(running, { type: 'tick' }).activeEpoch, 1);
  assert.equal(run(running, { type: 'tick' }, { type: 'tick' }).activeEpoch, 0, 'wraps around');
});

test('speed accepts only the offered intervals and play only applies to blink', () => {
  const state = initialComparison();
  for (const speedMs of BLINK_SPEEDS_MS) {
    assert.equal(run(state, { type: 'speed', speedMs }).speedMs, speedMs);
  }
  assert.equal(run(state, { type: 'speed', speedMs: 333 }), state, 'bogus interval rejected');
  assert.equal(run(state, { type: 'play', playing: false }), state, 'no blink, no pause');
  assert.equal(run(state, { type: 'mode', mode: 'warp' }), state, 'unknown mode rejected');
  assert.equal(run(state, { type: 'shout', loud: true }), state, 'unknown action rejected');
});

test('entering blink keeps the epoch the user was inspecting', () => {
  const state = run(
    initialComparison(),
    { type: 'mode', mode: 'single' },
    { type: 'epoch', epoch: 1 },
    { type: 'mode', mode: 'blink' },
  );
  assert.equal(state.activeEpoch, 1, 'changing mode never re-centres or swaps the epoch');
  assert.equal(state.mode, 'blink');
  assert.deepEqual(displayedEpochs(state, epochCount), [1]);
});

test('the side-by-side reference always draws every loaded epoch', () => {
  assert.deepEqual(displayedEpochs(initialComparison(), 3), [0, 1, 2]);
  assert.deepEqual(displayedEpochs(run(initialComparison(), { type: 'epoch', epoch: 1 }), 3), [0, 1, 2]);
  const singleOfThree = run(
    initialComparison(),
    { type: 'mode', mode: 'single' },
    { type: 'epoch', epoch: 2, epochCount: 3 },
    { epochCount: 3 },
  );
  assert.deepEqual(displayedEpochs(singleOfThree, 3), [2]);
});
