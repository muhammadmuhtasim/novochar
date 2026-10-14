# NOVOCHAR ・ নভোচার

> **spacefarer** — An interactive sky viewer and time-series **blink comparator** for
> tracking candidate trans-Neptunian objects, asteroids and high proper-motion stars
> across **SPHEREx**'s 6-month survey passes.

A full-stack React + Node.js (Express) web app in a black / near-black + neon-orange,
sci-fi theme. Built as a scaffold with simulated placeholder telemetry that is easy to
rewire to real NASA data (SPHEREx / GBOT / JPL / NASA NEO API).

## Stack

- **Server** — Node.js + Express REST API (`/server`)
- **Client** — React 18 + Vite 7 (`/client`)
- Root npm workspaces + `concurrently` for a one-command dev server

## Quick start

```bash
npm ci               # reproducible install from package-lock.json
npm run dev          # API on :4000, web app on :5173 (with /api proxy)
```

Then open **http://localhost:5173**.

### Production

```bash
npm run build        # builds the React app into client/dist
npm start            # Express serves the API + static app on :4000
npx playwright install chromium
npm run check:performance  # bundle budgets + production-browser smoke
```

For an actual Vercel deployment, run
`node scripts/verify-deployment.mjs https://your-deployment-url`. To simulate
an older cached document whose lazy chunk has disappeared from the current
release, pass the previous deployment URL as the second argument. The manual
GitHub Actions workflow runs the same probe and saves a report artifact.

### Source ZIP

Create a source archive with `npm run package:source`. It writes
`dist/novochar-source.zip` and excludes `node_modules` and generated build
output. After extracting the archive, run `npm ci` to install the exact locked
dependency tree; do not copy a local `node_modules` folder into the archive.

### Deploy to Vercel

The root `vercel.json` uses Vercel's "Other" framework preset, builds the Vite
client, and routes `/api/*` requests to the Express API function. Import this
repository in Vercel with the project root set to the repository root; the
configured build command and output directory are `npm run build` and
`client/dist`. The server workspace's build script validates its JavaScript
syntax for deployments that run workspace build scripts.

**Why first paint is fast & reliable:** the survey/passes/objects/stats/presets
are fully deterministic (seeded), so `build` also runs `scripts/precompute-data.mjs`
to bake them into static JSON under `client/dist/data/`. The client loads those
from Vercel's CDN first (with a live-API fallback), so the home page never blocks
on a serverless-function cold start. Deterministic API routes also send
`Cache-Control` so repeat loads avoid the function entirely. `vercel.json` raises
the API function's `maxDuration`/`memory` and long-caches `/data/*`.

To enable the live NASA NEO feed in production, add `NASA_API_KEY` as an
environment variable in the Vercel project settings and redeploy. The app works
without it using the simulated survey data.

## Features

| View             | What it does |
|------------------|--------------|
| **MISSION**      | Home / mission HUD with survey-pass progress, counts, field coords and class cards |
| **SKY VIEWER**   | Immersive **3D free-flight space**, ported from the standalone [`3d/`](3d) project with its `world`/`controls` modules vendored as `client/src/lib/world3d.js` + `controls3d.js` and rendered by `Space3DCanvas`. A **procedural, effectively infinite** wireframe world generates deterministic 72-unit sectors around the camera (revisiting a sector regenerates the same geometry). Click to capture the pointer and fly: **WASD** translate, **mouse** look, **Space/Ctrl** vertical, **Q/E** roll, **Shift** boost, **Esc** release. The HUD shows live coordinates, FPS and active-sector count, plus a **FULL DISPLAY** mode that reproduces the standalone module's full-window view |
| **BLINK COMPARATOR** | Time-series blink across survey passes to spot movers; motion trails + readout (per-pass spectral band shown) |
| **CATALOGUE**    | Filterable / sortable table of tracked objects with detail drawer |
| **SPECTRA**      | Spectral-analysis workbench: 1-D log-flux-vs-wavelength plot with labeled atomic/molecular **line markers**, a **line-free continuum** overlay and a **residual strip** for line identification, an **SPHEREx bandpass guide**, clickable **HEALPix** map that loads spectra + **multi-target comparison overlay**, a **cross-correlation AUTO-z** estimator with a live template-match score, **spectral index (F_λ ∝ λ^α)** and strongest-line readouts, a rest→observed **line-identification table**, and **export** (CSV / JSON / FITS / self-contained SVG / PNG) |
| **DATA SOURCES** | NASA data-source cards + optional live NEO feed |

### Layout / theming

- Palette lives as CSS variables in `client/src/styles.css` (`--neon: #ff6a00`, etc.).
- Every component is a standalone file under `client/src/components/` — edit or delete freely.

### Data layer (where to plug in real NASA data)

All simulated data is generated in a single file:

```
server/data.js   ->  generateSurvey()   (passes + object catalogue)
                 ->  buildFrames()      (per-object epoch blink frames)
                 ->  fetchNEO(key)      (optional live NASA NEO API)
```

### Processing & matching layer (`server/astro/`)

Reusable, dependency-free astronomy utilities implementing the plan's
**Processing/Matching layer** — coordinate conversion and HEALPix spatial
cross-matching for sources arriving from heterogeneous archives (IRSA / MAST /
HEASARC / VizieR / SIMBAD …) in RA/Dec:

```
server/astro/
  coords.js     RA/Dec <-> Galactic (astropy-exact matrix) + great-circle separation
  healpix.js    HEALPix ring & nest: ang2pix / pix2ang / ring<->nest (Healpy-exact)
  crossmatch.js HEALPix-indexed cross-match, cone search, k-nearest neighbours
  index.js      public API (convertCoordinates, separationArcsec, …)
```

Validated against Healpy / astropy reference values (ring/polar anchors, nest
pixel-centre oracles, `pix2ang(16,1440)`, `ring2nest(16,1504)=1130`) and an
exhaustive `ang2pix(pix2ang(p)) == p` round-trip on every pixel for
nside ≤ 32. Run the full suite (Node built-in test runner, no extra deps) —
server tests plus client-side math/export/3D tests:

```bash
npm test
```

(per-workspace: `npm test -w server`, `npm test -w client`.)

Example:

```js
import { convertCoordinates, crossmatch } from './astro/index.js';

const row = convertCoordinates(266.405, -28.936, 64); // -> {galactic:{l,b}, healpix:{pixel,center}}
const pairs = crossmatch(detections, referenceCatalogue, { radiusArcsec: 3 });
```

### Ingestion & access layer (`server/ivoa/`)

Node IVOA clients implementing the plan's **Ingestion/Access layer** — the
JS-vs-Python decision (see `docs/ARCHITECTURE.md §5`) keeps the whole pipeline
in Node with no Python runtime:

```txt
server/ivoa/
  votable.js    IVOA VOTable (TABLEDATA) parser -> typed JSON rows (no deps)
  tap.js        Table Access Protocol client (ADQL -> VOTable)
  sia2.js       Simple Image Access 2 client (cutout footprints)
  ssa.js        Simple Spectral Access client (spectra footprints)
  resolver.js   Name resolution: SIMBAD JSON + CDS Sesame XML (jradeg/jdedeg)
  index.js      barrel + endpoint registry (VizieR, SIMBAD, GAIA, IRSA, HEASARC, MAST)
```

Exposed via `GET /api/ivoa/*` (see API endpoints) and unit-tested with an
injectable `fetch` (no live network needed in tests).

The architecture doc (`docs/ARCHITECTURE.md`) maps all four roadmap layers to
these files; `server/store/` is the (not-yet-built) Layer-3 scaffold.

To use the live NEO endpoint set a free NASA API key:

```bash
NASA_API_KEY=your_key_here npm run dev
```

## API endpoints

```
GET /api/health
GET /api/survey
GET /api/stats
GET /api/objects?type=TNO&band=3&q=...
GET /api/objects/:id
GET /api/objects/:id/blink?count=18
GET /api/presets          (curated quick-launch targets for the blink workflow)
GET /api/nasa/neo

# Layer 4 — Data Representation
GET /api/spectra/:id          (SED: photometry + continuum, deterministic)
GET /api/field/heatmap?nside=64   (HEALPix density footprint of the field)

# Layer 1 — IVOA Ingestion (Node clients, no Python)
GET /api/ivoa                (protocol registry)
GET /api/ivoa/resolve?name=Crab&service=auto   (SIMBAD JSON -> CDS Sesame XML)
GET /api/ivoa/tap?endpoint=vizier&query=...&limit=...   (ADQL -> VOTable)
GET /api/ivoa/sia2?endpoint=irsa&pos=83.63,22.01&size=0.1
GET /api/ivoa/ssa?endpoint=mast&pos=83.63,22.01&size=0.1

# Archive source ingestion (JSON; requests run server-side)
GET  /api/archives
POST /api/archives/:archive/query
GET  /api/archives/mast/file?uri=mast%3A...
GET  /api/archives/lambda/file?path=relative%2Fproduct.fits
GET  /api/archives/darts/file?path=relative%2Fproduct.fits
```

POST requests use `{ "operation": "...", "params": { ... } }`. TAP archives
accept `operation: "tap"` with an ADQL `query`; MAST supports `cone`, `name`,
and `products` (cone pagination is controlled with `page` / `pagesize`); NED
supports `name`; ESA/DARTS support registry `discover` and IVOID-backed `tap`
where a matching, allowlisted endpoint is found; LAMBDA and DARTS support a
public index/file path. Tabular responses use `{archive, service, status,
count, fields, rows}` where available. MAST product URIs and relative LAMBDA /
DARTS paths are redirected only to their provider's fixed host.

These are bounded query/product access routes, not bulk mirrors of the source
archives. Availability is provider- and network-dependent. At last live check,
VizieR, Gaia, NOIRLab TAP, ESO TAP, MAST REST/products, NED name lookup, and ESA
PSA TAP discovery/query returned real data. IRSA timed out, HEASARC could not
be reached, LAMBDA was unreachable, and DARTS registry search found no TAP match;
the app reports these as configured/unverified rather than claiming success.

## Notes / placeholders

- All object positions, motions and flux are **seeded, deterministic simulators**
  (stability across restarts, same for every user).
- Real SPHEREx telemetry is not yet public pipeline data; replace the generators in
  `server/data.js` with your feed — the client contract stays unchanged.
