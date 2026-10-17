# Competition requirements: Planet X and SPHEREx

Milestone 0 requires the challenge criteria to be written down and mapped to
acceptance checks before any data or code work. This is the record.

- **Source:** NASA Space Apps Challenge 2026 challenge page,
  <https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/>
- **Retrieved:** 2026-10-17 (via the challenge summary text; the interactive page
  is JavaScript-only, so the text was obtained through search of the same URL).
- **Event:** 2026 NASA Space Apps Challenge · **Difficulty:** Advanced ·
  **Subjects:** Astrophysics, Planets & Moons, Software.

## The challenge, verbatim

> Since 2025, NASA's SPHEREx mission has been mapping the entire sky every six
> months in 102 bands of near-infrared light, returning images of more than a
> billion objects. Comets, asteroids, stars, brown dwarfs, and even new planets
> reveal themselves by shifting position between images, but no one person can
> sift through all that data alone. Your challenge is to create a public-facing
> web tool to display images of the sky from SPHEREx mission, making it easy for
> anyone to quickly see how they change over time.

## What the deliverable must do

| # | Requirement (from the brief) | Acceptance check |
| --- | --- | --- |
| R1 | Public-facing **web tool** | Runs in a browser; no install; reachable page |
| R2 | **Display images of the sky** from SPHEREx | Shows a real SPHEREx image with its sky context |
| R3 | Make it **easy to see how they change over time** | At least two real epochs of the same field shown and switchable |
| R4 | Support **anyone** (not just experts) | Plain-language labels, units, and a legend |
| R5 | Be **honest** about evidence | Distinguishes change from calibration/artefact; states what is *not* established |

## What the brief implies about the data

- **Temporal baseline:** "every six months" is the mission's full-sky cadence; the
  demo's comparison should be of observations genuinely separated in time.
- **Product type:** "102 bands of near-infrared light" refers to SPHEREx's
  spectral channels. The archive's Level-2 product is a **Spectral Image** whose
  wavelength varies per pixel — not a plain 2D photo — so R2/R3 need care.
- **Objects that move:** comets, asteroids, brown dwarfs, planets. The narrative
  should be able to show a real moving or changing source, or state plainly that
  none was found.
- **Scale:** "more than a billion objects" is why the tool must help a person
  avoid manual sifting — i.e. it should narrow the search, not dump raw pixels.

## Non-goals (explicit)

- Not required, and not assumed, to find **Planet X** — an inconclusive result is
  an acceptable outcome and must be reported honestly.
- No claim that every difference is a moving object or a new planet.
- No expansion of the existing 3D environment beyond what the SPHEREx story needs.

## Traceability to the milestone plan

| Milestone | Deliverable | This requirement |
| --- | --- | --- |
| M0 | requirements + baseline | this file · `docs/competition-baseline.md` |
| M1 | field + provenance | `data/spherex/demo-manifest.json` · `data/spherex/PROVENANCE.md` |
| M2 | bounded retrieval | validated adapter, checksums, offline fixtures |
| M3 | real-product viewer | R2, R4 |
| M4 | blink comparison | R3 |
| M5 | candidate inspection | R3, R5 |
| M6 | reproducible case study | R5 |
| M7 | competition package | R1 |

## Recorded decisions that constrain the implementation

From `docs/competition-baseline.md`, to be respected rather than reversed:

- The catalogue layer stays on the CC0 fixture; Gaia DR3 is the primary *candidate*
  but is not enabled (CC BY-NC terms); BSC5 remains a cross-check only.
- Application code is not to change until a real, verified SPHEREx observation
  sequence is in hand — which M1 now provides.
