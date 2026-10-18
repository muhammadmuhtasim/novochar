# M4 — aligned, timestamped comparison of the two NEP observations

M4 adds the comparison interaction on top of the M3-C viewer: a **manual epoch
toggle**, a **controllable blink**, and the reference **side-by-side** layout.
The milestone question is narrow and answerable:

> Can a reader look at the same sky position in two real SPHEREx observations,
> know exactly which observation is on screen, and see the field *not move* when
> they switch?

Everything here is built so the answer stays **yes** even where that is
inconvenient — and so that none of it silently becomes a scientific
measurement. The M3-B gate is unchanged: spatial alignment is validated,
`quantitative_difference_enabled` is `false`.

## Scope

**In:** manual toggle (epoch A ↔ B), controllable blink (play/pause, 250/500/
1000/2000 ms), side-by-side kept as the reference, per-frame identification,
the spatial-alignment disclaimer in every mode, the invalid-mask/no-data
handling carried through every mode, retryable failure and loading states in
comparison mode, desktop and mobile browser acceptance.

**Out (deliberately, this milestone):** any difference, subtraction, delta or
photometric-variability analysis (there is no route and no control that could
produce one); M5 candidate inspection and uncertainty handling; 3I/ATLAS
(M3-D); Gaia DR3 and BSC5; indexing/LOD; any 3D redesign.

---

## The one invariant that carries the milestone

The comparison state lives in `client/src/lib/spherex-compare.js` and holds
**only** `{ mode, activeEpoch, playing, speedMs }`. It holds no WCS, no zoom, no
pan, no stretch and no pixel values. The grid, the display stretch and the
screen transform are derived from the loaded products in the component, outside
this state.

That is the "switching cannot move the view" guarantee, expressed as a
structural fact rather than a promise: there is no field in this state through
which an epoch switch or a blink tick could reach the view. `COMPARISON_KEYS`
lists the closed set and a unit test asserts the reducer never introduces
another key.

| Mode | Drawn | Controls that appear | Epoch identity shown |
|---|---|---|---|
| `side-by-side` (default, M3-C reference) | both epochs, 2 canvases | mode selector, `↻ RELOAD` | per-frame head in each panel |
| `single` | the selected epoch only | + EPOCH-1 / EPOCH-2 | "DISPLAYING" strip |
| `blink` | one epoch, alternating | + `⏸ PAUSE`/`▶ BLINK`, SPEED (250/500/1000/2000 ms, default 500) | "DISPLAYING" strip, updated each frame |

## Behaviour rules (and why)

1. **The default stays `side-by-side`.** It is the M3-C reference layout, so the
   M3-C acceptance expectation (two canvases on first load) is untouched, and a
   reader who changes nothing sees what M3-C validated.
2. **A manual epoch selection always beats the automatic alternation.** Picking
   EPOCH-1 or EPOCH-2 pauses a running blink and keeps that epoch on screen for
   at least one interval. This holds *even when the user selects the epoch that
   is already displayed* — the user asked for that epoch, so the frame must not
   flip back out from under the cursor. (This exact case was found by the M4
   acceptance gate and fixed in the reducer: an epoch action on the currently
   displayed epoch now pauses a running blink instead of being a no-op.)
| `tick` advances the epoch | only when `mode === 'blink' && playing` |
| unknown action / unknown mode / interval not offered | state returned unchanged |

Entering `blink` preserves the epoch being inspected rather than resetting to
the first one, so entering or leaving the blink does not itself switch the
frame.

## What the reader always sees

* **Banner** — every comparison mode keeps the gate disclaimer ("Visualization
  — spatial alignment only", "No difference, subtraction or variability
  measurement is computed here") plus a mode-specific sentence. In `blink` that
  sentence is explicit: *"A blink can suggest that something looks different; it
  cannot by itself establish motion or astrophysical variability."*
* **"DISPLAYING" strip** (`role="status"`, so it is announced, not hover-only) —
  in every compare mode it names the observation on screen: label · `obs_id`,
  `date_obs_utc` (UTC), MJD, `pipeline_version`, units, and grid size. This is
  what the acceptance checks against the served metadata, so the label can never
  drift from the pixels.
* **Coverage note** under the legend — per observation, from the sidecar's own
  `derived.stats.valid_fraction` (≈ 81% / 82% of the grid here, i.e. ~19% / 18%
  uncovered). The uncovered remainder stays transparent over the distinct
  no-data backdrop **in every mode** and is never filled with zero. The note
  says plainly that signal in one epoch over the other's uncovered area has not
  been shown to change.
* **The shared stretch** — one 1–99 percentile stretch over both epochs' valid
  pixels, shown in the legend. It never rescales per mode or per epoch, so a
  blink cannot create a brightness change by re-stretching.

A valid pixel whose value is 0 is drawn opaque black; an invalid pixel is
transparent. A unit test asserts exactly that, because in a blink "the source
disappeared" and "that pixel has no measurement" must not look alike.

## Not a measurement

There is no difference, subtraction, delta, ratio or variability statistic
anywhere in this milestone — not in the reducer, not in the routes, not in the
client. The acceptance enumerates every control in the fully expanded blink mode
and asserts none matches `difference|subtract|delta|photometr|variab`, and
asserts the gate still reports `quantitative_difference_enabled: false`.

## Failure and recovery in comparison mode

A failure raised **while comparing** is shown as the same retryable failure
(`code: sidecar_unavailable`, with a Retry button), never as a blank frame. A
`↻ RELOAD` control re-fetches without a page reload, and the comparison mode the
user chose survives the retry: a reader comparing two epochs does not get
silently dropped back to the default layout.

## Verification

Run `npm run check:spherex` for the browser half; `npm test` covers the reducer
and rendering units; `npm run test:sidecar` covers the Python boundary.

| Area | Check | Result |
|---|---|---|
| state | `client/src/lib/spherex-compare.test.js`: mode/epoch switching preserves every other field; manual selection pauses a blink, including selecting the epoch already showing, with no stale tick undoing it; `play`/`tick` gated to blink; index clamping; unknown mode/action/interval rejected; keys ⊆ `COMPARISON_KEYS` | 11 tests |
| rendering | `spherex-view.test.js`: a valid zero renders opaque black, an invalid pixel transparent | added in M4 |
| desktop interaction | acceptance: reference view; SINGLE strip identity + rim transparency; epoch switch keeps the same canvas node, changes the checksum, and leaves sky position, pixel readout and legend unchanged; entering BLINK preserves epoch/node/cadence and alternates on its own; the field does not move; pause holds for 1.4 s; play resumes; manual EPOCH-1 selection pauses and stays; no forbidden analysis labels; gate still false; back to SIDE BY SIDE restores the reference | PASS |
| failure in comparison | acceptance: forced `503 sidecar_unavailable` while in SINGLE mode → retryable error, then Retry restores the SAME mode | PASS |
| mobile (390 × 844) | acceptance: one-column grid, controls inside the viewport with usable tap targets, real taps through SINGLE / EPOCH-2 / BLINK / PAUSE, blink alternates and pause holds under touch, collapsed menu still leaves and re-enters the tab | PASS |

**What this proves:** the two real observations can be compared by eye on one
grid with the field of view fixed, always identified by their own metadata, in
desktop and mobile browsers, with honest no-data and honest failure handling.

**What it does not prove:** that the epochs are scientifically comparable, or
that anything changed. A blink is a viewing aid; a difference, subtraction or
variability claim still requires the calibration and data-quality handling that
the gate withholds.

## Change found and fixed during M4

Selecting the epoch that was already displayed while the blink was running was a
no-op in the reducer, so the blink kept flipping and the reader could not hold
the frame by clicking its own epoch button. Manual selection now always pauses
the blink, even for the already-displayed epoch. Caught by the acceptance, fixed
in `spherex-compare.js`, covered by a unit test.

A long SHA-256 value in the provenance panel did not wrap, which made the body
programmatically scrollable at mobile width and could shift every element under
a tap; the `.kv` display values now wrap. Not M4-specific, but it made the
mobile comparison honest and stable.
