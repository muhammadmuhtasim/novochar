# NOVOCHAR ・ নভোচার

> **spacefarer** — An interactive sky viewer and time-series **blink comparator** for
> tracking candidate trans-Neptunian objects, asteroids and high proper-motion stars
> across **SPHEREx**'s 6-month survey passes.

A full-stack React + Node.js (Express) web app in a black / near-black + neon-orange,
sci-fi theme. Built as a scaffold with simulated placeholder telemetry that is easy to
rewire to real NASA data (SPHEREx / GBOT / JPL / NASA NEO API).

## Stack

- **Server** — Node.js + Express REST API (`/server`)
- **Client** — React 18 + Vite 5 (`/client`)
- Root npm workspaces + `concurrently` for a one-command dev server

## Quick start

```bash
npm install          # installs server + client + root tooling
npm run dev          # API on :4000, web app on :5173 (with /api proxy)
```

Then open **http://localhost:5173**.

### Production

```bash
npm run build        # builds the React app into client/dist
npm start            # Express serves the API + static app on :4000
```

### Deploy to Vercel

The root `vercel.json` uses Vercel's "Other" framework preset, builds the Vite
client, and routes `/api/*` requests to the Express API function. Import this
repository in Vercel with the project root set to the repository root; the
configured build command and output directory are `npm run build` and
`client/dist`. The server workspace's build script validates its JavaScript
syntax for deployments that run workspace build scripts.

To enable the live NASA NEO feed in production, add `NASA_API_KEY` as an
environment variable in the Vercel project settings and redeploy. The app works
without it using the simulated survey data.

## Features

| View             | What it does |
|------------------|--------------|
| **MISSION**      | Home / mission HUD with an **interactive live sky preview** + curated presets; survey-pass progress, counts, field coords, class cards |
| **SKY VIEWER**   | Interactive pan/zoom star map with candidate markers; **6-band SPHEREx filter**, **RA/Dec or name coordinate search**, and one-click **sample-target presets** |
| **BLINK COMPARATOR** | Time-series blink across survey passes to spot movers; motion trails + readout (per-pass spectral band shown) |
| **CATALOGUE**    | Filterable / sortable table of tracked objects with detail drawer |
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
nside ≤ 32. Run the suite (Node built-in test runner, no extra deps):

```bash
npm test -w server
```

Example:

```js
import { convertCoordinates, crossmatch } from './astro/index.js';

const row = convertCoordinates(266.405, -28.936, 64); // -> {galactic:{l,b}, healpix:{pixel,center}}
const pairs = crossmatch(detections, referenceCatalogue, { radiusArcsec: 3 });
```

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
```

## Notes / placeholders

- All object positions, motions and flux are **seeded, deterministic simulators**
  (stability across restarts, same for every user).
- Real SPHEREx telemetry is not yet public pipeline data; replace the generators in
  `server/data.js` with your feed — the client contract stays unchanged.
