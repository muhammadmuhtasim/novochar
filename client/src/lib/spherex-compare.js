// M4 — comparison state for the SPHEREx FIELD viewer.
//
// This module answers exactly one question: *which of the loaded observations
// is on screen, and should it alternate on its own?* It deliberately holds no
// view parameters — no WCS, no zoom, no pan, no stretch, no pixel values.
// Those are derived from the loaded products elsewhere, so no sequence of
// epoch switches or mode changes can move the field of view, change the grid
// or rescale the image: this state simply cannot reach them.
//
// Two rules are worth stating because the milestone turns on them:
//
//   * selecting an epoch by hand always wins over automatic alternation, so
//     the frame never flips back under the user's cursor;
//   * a blink is a viewing aid, not a measurement. Nothing in this reducer
//     computes a difference, a subtraction or a variability statistic, and
//     nothing here can turn the scientific gate on.

/** Every mode the viewer can be in; `side-by-side` is the M3-C reference. */
export const MODES = ['side-by-side', 'single', 'blink'];

/** Blink intervals offered to the user, in milliseconds. */
export const BLINK_SPEEDS_MS = [250, 500, 1000, 2000];

export const DEFAULT_BLINK_SPEED_MS = 500;

/** The complete set of keys comparison state may ever carry. */
export const COMPARISON_KEYS = ['activeEpoch', 'mode', 'playing', 'speedMs'];

/** The reference view: side by side, first epoch focused, blink ready to run. */
export function initialComparison() {
  return {
    mode: 'side-by-side',
    activeEpoch: 0,
    playing: true,
    speedMs: DEFAULT_BLINK_SPEED_MS,
  };
}

function epochCountOf(action) {
  return Number.isInteger(action.epochCount) && action.epochCount > 0 ? action.epochCount : 2;
}

function clampIndex(index, epochCount) {
  if (!Number.isInteger(index)) return 0;
  return ((index % epochCount) + epochCount) % epochCount;
}

/**
 * Pure transition for the comparison controls. Returns the same object when
 * an action does not apply, so callers can rely on referential stability.
 */
export function comparisonReducer(state, action) {
  const epochCount = epochCountOf(action);
  switch (action.type) {
    case 'mode': {
      if (!MODES.includes(action.mode) || action.mode === state.mode) return state;
      // Only the mode changes: the selected epoch and the blink settings are
      // carried across, and nothing about the view can change here at all.
      return { ...state, mode: action.mode };
    }
    case 'epoch': {
      const activeEpoch = clampIndex(action.epoch, epochCount);
      if (activeEpoch === state.activeEpoch) {
        // Even if the epoch is unchanged, manually selecting it wins over
        // automatic alternation: the user asked for that epoch, so the blink
        // must not flip again until they explicitly play.
        if (state.mode === 'blink' && state.playing) {
          return { ...state, playing: false };
        }
        return state;
      }
      // Manual selection pauses an automatic blink: otherwise the frame would
      // change again within one interval and the user would lose the epoch
      // they deliberately chose. Pressing play resumes alternation.
      const playing = state.mode === 'blink' ? false : state.playing;
      return { ...state, activeEpoch, playing };
    }
    case 'play': {
      if (state.mode !== 'blink') return state;
      return { ...state, playing: Boolean(action.playing) };
    }
    case 'speed': {
      if (!BLINK_SPEEDS_MS.includes(action.speedMs)) return state;
      return { ...state, speedMs: action.speedMs };
    }
    case 'tick': {
      // A stale timer must not advance a paused or non-blinking view.
      if (state.mode !== 'blink' || !state.playing) return state;
      return { ...state, activeEpoch: clampIndex(state.activeEpoch + 1, epochCount) };
    }
    default:
      return state;
  }
}

/**
 * Which epoch indices are drawn in the given state: all of them for the
 * side-by-side reference, exactly one otherwise.
 */
export function displayedEpochs(state, epochCount) {
  const count = Number.isInteger(epochCount) && epochCount > 0 ? epochCount : 2;
  if (state.mode === 'side-by-side') {
    return Array.from({ length: count }, (_, index) => index);
  }
  return [clampIndex(state.activeEpoch, count)];
}

/** True when a single observation is on screen (toggle or blink). */
export function isComparing(state) {
  return state.mode !== 'side-by-side';
}
