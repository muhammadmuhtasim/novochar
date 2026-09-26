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

The root `vercel.json` builds the Vite client and routes `/api/*` requests to the
Express API function. Import this repository in Vercel with the project root set
to the repository root; the configured build command and output directory are
`npm run build` and `client/dist`.

To enable the live NASA NEO feed in production, add `NASA_API_KEY` as an
environment variable in the Vercel project settings and redeploy. The app works
without it using the simulated survey data.

## Features

| View             | What it does |
|------------------|--------------|
| **MISSION**      | Home / mission HUD: SPHEREx survey-pass progress, counts, field coords, class cards |
| **SKY VIEWER**   | Interactive pan/zoom star map with candidate markers; click to inspect astrometry |
| **BLINK COMPARATOR** | Time-series blink across survey passes to spot movers; motion trails + readout |
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

To use the live NEO endpoint set a free NASA API key:

```bash
NASA_API_KEY=your_key_here npm run dev
```

## API endpoints

```
GET /api/health
GET /api/survey
GET /api/stats
GET /api/objects?type=TNO&q=...
GET /api/objects/:id
GET /api/objects/:id/blink?count=18
GET /api/nasa/neo
```

## Notes / placeholders

- All object positions, motions and flux are **seeded, deterministic simulators**
  (stability across restarts, same for every user).
- Real SPHEREx telemetry is not yet public pipeline data; replace the generators in
  `server/data.js` with your feed — the client contract stays unchanged.
