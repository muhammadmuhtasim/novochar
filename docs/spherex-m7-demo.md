# M7 — Competition Demo Script: NEP SPHEREx Comparison

Timed walkthrough for the NASA Space Apps 2026 *Planet X and SPHEREx* challenge.
Target duration: **3 minutes 30 seconds**. Every step shows real SPHEREx data.

Pinned demonstration commit: see §6.

---

## Pre-demo checklist (2 minutes before)

1. Open a terminal in the project root.
2. Verify the build is current:
   ```sh
   npm run build -w client
   ```
3. Start the server:
   ```sh
   npm start
   ```
   (or `PORT=3000 node server/index.js` if port 3000 is taken).
4. Open `http://localhost:3000` in Chromium (full-screen, 1920×1080 if possible).
5. Confirm the SPHEREx FIELD tab loads two side-by-side canvases.
6. Have `docs/spherex-m6-case-study.md` open in a second tab as backup.
7. If the sidecar is unavailable, the tab shows a retryable error — practice
   the recovery path (§5) before going live.

---

## Timed walkthrough

### 0:00–0:20 — Open and load (20 s)

**Action:** Click **SPHEREx FIELD**.

**Expected:** "Loading SPHEREx products" spinner (10–30 s on first load while
the sidecar runs). Two side-by-side grayscale canvases appear.

**Narration:** "This is Novochar. It does not simulate SPHEREx data — it pulls
two real Quick Release 2 observations of the North Ecliptic Pole from IRSA,
verifies every byte against a SHA-256, and reprojects them onto one common
grid."

### 0:20–0:45 — Metadata and provenance (25 s)

**Action:** Scroll to "What is being shown" → "Archive", "Derived", "Scientific gate".

**Expected (Archive):** mission SPHEREx, release "SPHEREx Quick Release Spectral
Images - QR2", DOI 10.26131/IRSA652, field `nep`, centre 270° 66.5°,
baseline ~200.93 d, usage terms "IRSA public data, no usage restrictions".

**Expected (Derived):** grid `nep-qr2-common`, shape `[294, 294]`, pixel scale
`6.15″/px`, orientation "north-up, east-left", wire format
`novochar.spherex.raster/v1`, raster size 432180 bytes, sidecar
`astropy 8.0.2 · reproject 0.21.0`, Python 3.14.7.

**Expected (Scientific gate):** spatial alignment ESTABLISHED, quantitative
difference DISABLED, integer-lag ±0 px, peak ρ 0.6386 over 65,328 px.

**Narration:** "Every number is traceable. The obs IDs, the dates, the SHA-256
hashes of every input and output — all verifiable against the archive."

### 0:45–1:10 — Cursor and coordinates (25 s)

**Action:** Move the mouse slowly across the left frame, top to bottom, left to
right.

**Expected:** RA increases left-to-right; Dec decreases top-to-bottom (north-up,
east-left). A pixel outside the footprint reads "no data" instead of a number.
The readout shows `px x, y (0-based)`.

**Narration:** "The coordinate system is validated against an astropy fixture.
North is up, east is left — the same convention astronomers use."

### 1:10–1:30 — Toggle to a single epoch (20 s)

**Action:** Click **SINGLE**.

**Expected:** One canvas remains. A "DISPLAYING" strip appears naming
epoch-1 · 2025W18_1B_0095_2 with date, MJD, pipeline version and units.
Banner: "One observation at a time on one agreed grid: switching changes only
which observation is drawn, never the field of view or the stretch."

**Narration:** "Switching epochs changes which observation is drawn — nothing
else. The grid, the zoom, the stretch: all fixed."

### 1:30–1:55 — Switch epochs (25 s)

**Action:** Click **EPOCH-2**.

**Expected:** The canvas repaints with epoch-2's pixels (same node, not
remounted). The strip now names epoch-2 · 2025W46_2A_0537_1. Sky position
and legend unchanged.

**Narration:** "Two different observations, six and a half months apart, on
one common grid."

### 1:55–2:20 — Blink (25 s)

**Action:** Click **BLINK**. Let it alternate 3–4 times. Click **⏸ PAUSE**.
Click **▶ BLINK** to resume. Set speed to 2000 ms, then back to 500 ms.

**Expected:** Frame alternates at the chosen cadence. PAUSE freezes it; BLINK
resumes. Banner: "A blink can suggest that something looks different; it
cannot by itself establish motion or astrophysical variability."

**Narration:** "A blink is a viewing aid. It can make something look different.
It cannot prove anything moved or changed. We say that explicitly."

### 2:20–2:45 — Candidate inspection (25 s)

**Action:** Click **SIDE BY SIDE**. Click a bright pixel in the left frame.

**Expected:** "Selected region" panel appears below. Shows:
- "Observed (Derived via WCS)" with RA/Dec in ICRS.
- "Observed (grid)" with `pixel x, y (0-based, array row 0 = top)`.
- One evidence block per epoch: EVIDENCE LEVEL (Observed), OBSERVED (UTC),
  MJD, DETECTOR, EXPOSURE, QUALITY L1/L2, PIPELINE, UNITS, PIXEL VALUE,
  VALIDITY, COVERED, INPUT SHA-256, OUTPUT SHA-256.
- "Limitations" block with 7 items.

**Narration:** "Every value is labelled Observed, Derived, or Hypothesis.
The SHA-256 ties it to the exact product file. And the limitations are always
visible — we never hide what we don't know."

### 2:45–3:05 — Mobile (20 s)

**Action:** Resize the browser to 390×844 (or open on a phone).

**Expected:** One column, controls inside the viewport, tap to select a pixel,
evidence panel readable, collapsed menu still reaches the SPHEREx tab.

**Narration:** "It works on a phone. The same honest data, the same limits."

### 3:05–3:20 — Failure recovery (15 s, optional)

**Action:** Click **↻ RELOAD** while the sidecar is unavailable (or describe
the path).

**Expected:** `sidecar_unavailable: ... — this is a transient environment
failure, not a missing observation.` with a Retry button. Retry restores both
frames.

**Narration:** "If the archive or sidecar is down, we say so. Never a blank
picture."

### 3:20–3:40 — Closing (20 s)

**Narration:** "Novochar takes real SPHEREx observations, aligns them on one
grid, and lets you inspect any pixel with full provenance. It does not claim
to find Planet X. It makes the evidence inspectable and the limits explicit.
That is the honest thing a tool can do with this data."

---

## Fallback materials

### Screenshots (to capture)

Save in `docs/m7-demo/screenshots/` (create the directory). Capture at
1600×1000 unless noted. Use the production build (`npm run build -w client &&
npm start`).

| File | View | What it shows |
|---|---|---|
| `01-side-by-side.png` | Desktop, initial load | Two canvases, legend, coverage note |
| `02-metadata-panel.png` | Desktop, scrolled | Archive + Derived + Scientific gate |
| `03-single-epoch.png` | Desktop, SINGLE mode | One canvas, DISPLAYING strip |
| `04-blink-paused.png` | Desktop, BLINK paused | Alternating frame, PAUSE button |
| `05-evidence-panel.png` | Desktop, selection open | Selected region + evidence blocks + limitations |
| `06-mobile-side-by-side.png` | Mobile 390×844 | One column, controls in viewport |
| `07-mobile-evidence.png` | Mobile 390×844 | Evidence panel readable |
| `08-failure-recovery.png` | Desktop | Retryable error + Retry button |

### Screen recording (optional)

If a screen recorder is available (e.g. `ffmpeg`, OBS, or the browser's
built-in recorder), capture a 60-second walkthrough of steps 1–8. Save as
`docs/m7-demo/demo.mp4`. If no recorder is available, the screenshots above
are sufficient.

### Fallback narrative (read aloud if the app won't load)

> "Novochar is a web tool that pulls two real SPHEREx observations of the
> North Ecliptic Pole from IRSA, verifies every byte against a SHA-256, and
> reprojects them onto one common 294×294 grid at 6.15 arcseconds per pixel.
> It shows them side by side with one shared intensity stretch, lets you blink
> between them, and lets you click any pixel to see its value, validity, and
> full provenance in both epochs. The scientific gate reports spatial
> alignment established but quantitative difference disabled — the tool never
> claims to find Planet X. It makes the evidence inspectable and the limits
> explicit. The case study is in docs/spherex-m6-case-study.md."

---

## Recovery path (rehearsal)

### Scenario A: Sidecar unavailable

1. The SPHEREx FIELD tab shows:
   `sidecar_unavailable: the sidecar could not be started — this is a
   transient environment failure, not a missing observation.`
2. Click **Retry**. If the sidecar starts, both frames return.
3. If the sidecar cannot start (e.g. no Python), show the fallback
   screenshots and read the fallback narrative.

### Scenario B: Slow initial load

1. The spinner may take 10–30 s on first load (sidecar reprojection).
2. Do not click anything; wait. If it exceeds 60 s, reload the page.
3. If reload fails, show screenshots and read the narrative.

### Scenario C: Network failure mid-demo

1. If the IRSA fetch fails, the tab shows a retryable error.
2. Click **Retry**. If it fails again, show screenshots.
3. The cached `.cache/` directory (if present) may serve stale data.

### Scenario D: Browser crash

1. Restart the browser, navigate to the app, click SPHEREx FIELD.
2. If the build is stale, run `npm run build -w client` first.

---

## Release checks

Run these before the demonstration. Record the results.

```sh
npm test                # shared 60 + server 200 + client 181 = 441, 0 fail
npm run test:sidecar    # 18 tests, OK
npm run check:data       # precomputed data OK
npm run check:spherex   # 87 checks, 0 fail (desktop + mobile)
npm run build -w client # production build OK
```

### `check:shell` (Mode A) status

The Mode A (Observe / catalog) acceptance check stalls at a `.observe-footer`
visibility timeout in this environment. It has been reproduced at a clean HEAD
checkout (worktree, no M5 changes) and with the full M5 build. The likely cause
is a software-rendering stall on a machine with high load (load average ~7,
22 Chrome renderer processes). It is **not** caused by the SPHEREx changes.

- Reproduction: `timeout 2400 node scripts/shell-acceptance.mjs` → fails at
  `locator.waitFor: Timeout 30000ms exceeded` waiting for `.observe-footer`.
- The script's own comments document this class of stall ("software rendering
  can stall a freshly created page").
- Mode A behavior is verified by the unit tests (200 server + 60 shared) and
  by manual inspection; the acceptance script's timeout is an environment
  issue, not a code regression.

---

## Pinned demonstration version

| Property | Value |
|---|---|
| Commit | `9b87c2f` (M6 case study) + M7 doc commit |
| Branch | `main` |
| Tests | 441 pass (shared 60 + server 200 + client 181), sidecar 18 pass |
| Acceptance | `check:spherex` 87/87 pass, `check:data` OK |
| Build | `npm run build -w client` OK |
| Case study | `docs/spherex-m6-case-study.md` |
| Contracts | `docs/spherex-m3c-contracts.md` |
| Blink spec | `docs/spherex-m4-blink.md` |
| M5 plan | `docs/spherex-m5-plan.md` |

---

## Submission requirements (to verify)

The official NASA Space Apps 2026 challenge page for "Planet X and SPHEREx"
could not be fetched from this environment (network transport error). Before
submitting, verify independently:

1. **Deadline** — confirm the 2026 submission deadline (typically early
   October, but verify the exact date).
2. **Deliverable format** — confirm whether the submission requires a GitHub
   repository link, a video, a written description, or a combination.
3. **Team requirements** — confirm minimum/maximum team size and registration
   requirements.
4. **Judging criteria** — confirm how the "Planet X and SPHEREx" challenge is
   scored (scientific merit, usability, reproducibility, presentation).
5. **Demo length** — confirm the maximum presentation time (typically 2–5
   minutes for Space Apps).
6. **Fallback** — confirm whether a live demo is required or a recording is
   acceptable.

Check: https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/

---

## README verification

The README should be checked for:
- [ ] Setup instructions match current build/run commands
- [ ] SPHEREx section references `docs/spherex-m3c-contracts.md` and
      `docs/spherex-m4-blink.md`
- [ ] Case study link (`docs/spherex-m6-case-study.md`) resolves
- [ ] No stale references to M0/M1/M2 milestones in the feature table
- [ ] Known limitations are stated (quantitative difference disabled,
      shell-check stall, single exposure, visualization-grade WCS-WAVE)

---

## What M7 does NOT do

- No new science features (no centroiding, motion, flux, variability).
- No new components or UI beyond what M0–M6 delivered.
- No refactor of Mode A (spherical-shell explorer).
- No change to the scientific gate (`quantitative_difference_enabled: false`).
- No push to `origin/main` without explicit authorization.