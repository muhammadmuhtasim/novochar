# Star catalogue: licensing split and provenance

This project deliberately separates three things that are often conflated. Keep
them separate in code, commits and any redistribution.

| Layer | What it is | Governed by |
| --- | --- | --- |
| **Novochar source code** | Everything in `server/`, `client/`, `scripts/` (including the catalogue *adapters*) | Novochar's own project licence |
| **Catalogue data** | Third-party star records and any raw files derived from them | The catalogue provider's own terms |
| **Preprocessing & provenance** | Our deterministic scripts, the data contract, and this document | Novochar's project licence (documentation is ours) |

## Status: production catalogue on hold

Commercial use of Novochar is still undecided, and the redistribution terms for
candidate bright-star catalogues are not yet clear. **No third-party catalogue
data is committed to this repository.**

Consequently the pipeline's active source is the small, explicitly
redistributable fixture described below. The code is written so that switching to
a real catalogue later is a one-line change plus vendoring that catalogue's raw
file — the contract, precompute step, API route and renderer do not change.

## Active source: the redistributable fixture

- **Path:** `data/catalog/fixture/stars.json`
- **Content:** a handful of individual, commonly published astronomical facts
  (right ascension, declination, V magnitude, B-V, spectral type) for well-known
  bright stars.
- **Terms:** dedicated to the public domain under **CC0-1.0**. It is an
  authored fixture, not a substantial extraction from any catalogue, and it is a
  **placeholder** — not an authoritative sky catalogue.
- **Adapter:** `server/catalog/fixture.js` (our code).

Its sky coverage is intentionally sparse (a handful of stars spread over the whole
celestial sphere), so the initial field of view may legitimately contain **zero**
catalogue stars — that is the honest state, not a failure. Search and selection
still work, and the footer reports the three distinct states separately
(`CATALOG n · IN VIEW n · RENDERED n`): catalogue availability, objects passing
the current magnitude/distance/frustum filters, and objects actually drawn.

## Build integrity

`client/public/data/*.json` is committed and copied verbatim into the bundle by
Vite, so generated data must be produced *before* the client build and must be
byte-reproducible:

1. `npm run build` runs `precompute:data` **first**, then the Vite build. Because
   the steps are chained with `&&`, a failed precompute stops the build.
2. `scripts/precompute-data.mjs` validates the star artifact with
   `validateStarCatalog` (schema, non-empty, finite coordinates, explicit
   nulls) and exits non-zero on a malformed catalogue, before any bundling.
3. `scripts/check-generated-data.mjs` (`npm run check:data`, also the first step
   of `npm test`) regenerates into a scratch directory and compares byte-for-byte
   against the committed files, so stale or non-deterministic output fails CI.
4. The output is deterministic: no timestamps are written. (`index.json`
   deliberately has no `generatedAt`, which previously churned on every run.)

## Candidate source: Yale Bright Star Catalogue (VizieR V/50)

The leading candidate for the bright-sky field, held back until its terms are
confirmed.

- **Catalogue:** Bright Star Catalogue, 5th Revised Ed. (preliminary)
- **Authors:** Hoffleit D., Warren Jr. W.H. (1991) — `1991bsc..book.....H`
- **VizieR id:** `V/50`
- **Raw file:** `catalog.gz` (197-column fixed-width records), retrieved from
  `https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz`
- **ReadMe (format spec):** `https://cdsarc.cds.unistra.fr/ftp/V/50/ReadMe`
- **Retrieved for evaluation:** 2026-10-16
- **SHA-256 (evaluation download):** `3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed`
- **Licence:** **unresolved.** The V/50 page states no explicit licence. Under
  the CDS general terms a dataset of public information is distributed under an
  open licence (CC-BY) with attribution, and the contributor-specific licence is
  shown on the dataset page — but this has not been confirmed in writing for
  V/50 specifically. **Do not treat as cleared for commercial redistribution.**

### Enabling it (once cleared)

1. Vendor the raw file at `data/catalog/raw/bsc5/catalog.gz` (this path is
   git-ignored on purpose; commit it only once terms allow redistribution, and
   update the SHA-256 above if the file differs).
2. Set `DEFAULT_STAR_SOURCE = 'bsc5'` in `server/catalog/index.js`.
3. Re-run `npm run precompute:data` and the test suite.

The adapter is `server/catalog/bsc5.js` (our code) and is already unit-tested
against hand-built records, so no third-party file is needed to test it.

## Deterministic preprocessing contract

- **Entry point:** `scripts/precompute-data.mjs` → `client/public/data/stars.json`
  (also served at `GET /api/catalog/stars`, with `GET /api/catalog/stars/:id`).
- **Schema:** `novochar.stars/v1` — `{ schema, source, frame, equinox,
  referenceEpochJD, count, dropped, stars[] }`.
- **Frame/epoch:** carried explicitly on the artefact (`frame`, `equinox`,
  `referenceEpochJD`). V/50 is FK5 / J2000 / epoch J2000.0.
- **Units:** proper motion normalised to **mas/yr** (`pmRaMasYr` is the projected
  μ*α = cos(dec)·dRA/dt), parallax to **mas**, distance to **light-years**.
- **Missing data is explicit:** absent photometry, proper motion or parallax stay
  `null` and are never zero-filled. Records with no position are dropped and
  reported in `dropped`, never fabricated.
- **Determinism:** identical input → byte-identical `stars.json`; the pipeline
  performs no network access at build or runtime.

## Validation performed

- Sirius (HR 2491): RA 06h45m08.9s, Dec −16°42′58″, V −1.46, B−V 0.00, A1V,
  parallax 375 mas → 8.70 ly.
- Rigel (HR 1713): V 0.12, B8Ia. Adhara (HR 2618): V 1.50, B−V −0.21.
- V/50 full file: 9,110 records → 9,096 with valid positions; 14 blank-position
  (removed) records correctly dropped.
