# NOVOCHAR — System Architecture (RFC-0001)

- **Status:** Proposed / partial implementation (scaffold stage)
- **Author:** Novochar platform
- **Date:** 2026-09
- **Scope:** Map the "Categorization of Astronomical Data Archives", the
  "Data Process Network" and the "Data Representation & Visualisation" plan
  items onto the existing Novochar repository, capture the JS-vs-Python
  decision, and define the target file tree.

---

## 1. Purpose

Novochar is currently a scaffold: a React + Express app that simulates SPHEREx
survey telemetry and offers a blink-comparator sky viewer. The roadmap turns it
into a multi-archive astronomical data platform. This RFC makes that roadmap
concrete: the four pipeline layers, where each lives in the repo, which
language runs each protocol, and which files change first.

## 2. Architectural principles

1. **No Python runtime in the serving path.** The app deploys to a Node
   serverless host (Vercel "Other" preset) and a Node/Express origin. The IVOA
   protocols (TAP / SIA² / SSA, VOTable transport) are plain HTTP + XML/JSON, so
   they are implemented client-side in Node rather than shelling out to
   PyVO/astroquery (see §5).
2. **Protocols before libraries.** We depend on IVOA wire-protocols, not on a
   specific astronomy stack. Any service speaking TAP / SIA² / SSA (VizieR,
   SIMBAD, HEASARC, IRSA, MAST, ESO, DARTS…) is a drop-in endpoint.
3. **Deterministic seam.** Real telemetry replaces simulated data without
   changing the client contract (the existing `server/data.js` guarantee).
4. **Reusable, dependency-free kernels.** Coordination transforms, HEALPix and
   cross-matching are pure, tested ES modules usable from API routes and batch
   jobs alike.

## 3. The four pipeline layers

```
 DATA SOURCES                IRSA · MAST · HEASARC · VizieR · SIMBAD · NED · ESA · ESO · DARTS
      |
      |  IVOA: TAP / SIA2 / SSA / Sesame
      v
 [1] INGESTION & ACCESS        server/ivoa/    (Node IVOA clients + VOTable parser)
      |                        api/            (Vercel serverless thin proxies)
      v
 [2] PROCESSING & MATCHING     server/astro/   (RA/Dec <-> Galactic <-> HEALPix, cross-match)
      |
      v
 [3] STORAGE & INDEXING        server/store/   (TARGET: DuckDB/PostGIS + Redis cache; not yet built)
      |
      v
 [4] APPLICATION & SERVICE     server/index.js (Express routes)  ->  client/src (React views)
                                      |                                  |
                                      +----  SED/spectra · cutouts · heatmaps  ----+
```

### 3.1 Layer 1 — Ingestion & Access
- **What:** Concurrency-safe workers that query IVOA endpoints, returning
  normalised tables; coordinate plumbing (RA/Dec ↔ Galactic ↔ HEALPix).
- **Repo:** `server/ivoa/` (new, this RFC), `api/` (Vercel proxies), plus the
  coordinate/HEALPix converters in `server/astro/coords.js`,
  `server/astro/healpix.js`.
- **Delivered:** VOTable parser, TAP/SIA²/SSA query builders, name resolver
  (Sesame). See §6.

### 3.2 Layer 2 — Processing & Matching
- **What:** Spatial cross-identification, image alignment (reproject to common
  WCS), frame subtraction for difference cutouts.
- **Repo:** `server/astro/` (implemented): `coords.js`, `healpix.js`,
  `crossmatch.js`. Image alignment/subtraction remain FUTURE (a
  reproject-equivalent in JS).
- **Delivered:** RA/Dec ↔ Galactic ↔ HEALPix, great-circle separation, HEALPix
  spatial index, cross-match/cone/k-nearest. See `server/astro/index.js`.

### 3.3 Layer 3 — Storage & Indexing
- **What:** Vector/spatial indexes (PostGIS / DuckDB with H3 or HEALPix keys),
  Redis cache for FITS cutouts & PNGs.
- **Repo:** `server/store/` — **NOT YET BUILT.** Scaffolded in the file tree so
  callers can target `store.putPixelBins(...)` / `store.crossMatch(...)` once
  implemented. HEALPix keys are produced by `server/astro/healpix.js`, so the
  storage schema is already well-defined.

### 3.4 Layer 4 — Application & Service
- **What:** Web APIs serving cutouts, light curves, spectra; inference engine
  for transient / moving-source detection.
- **Repo:** `server/index.js` (Express), `client/src` (React).
- **Delivered:** new `/api/spectra/:id` and `/api/field/heatmap` routes, and a
  **SPECTRA** client view rendering multi-band SED curves, an image cutout and
  a HEALPix density heatmap (§8). The blink comparator, catalogue and sky
  viewer make up the rest of this layer.
## 4. Repository map (target tree)

```
novochar/
├─ docs/
│  └─ ARCHITECTURE.md            THIS FILE
├─ server/
│  ├─ index.js                   L4 Express routes  (health/survey/objects/blink/spectra/heatmap/ivoa)
│  ├─ data.js                    simulated survey + blink frames + NEO feed (deterministic seam)
│  ├─ astro/                     L2 Processing & Matching  [IMPLEMENTED]
│  │  ├─ coords.js               RA/Dec <-> Galactic + separation
│  │  ├─ healpix.js              HEALPix ring/nest ang2pix·pix2ang·ring<->nest
│  │  ├─ crossmatch.js           HEALPix-indexed crossmatch · cone · kNN
│  │  └─ index.js                public API (convertCoordinates)
│  ├─ ivoa/                      L1 Ingestion & Access  [NEW in this RFC]
│  │  ├─ votable.js              VOTable XML -> rows (no deps)
│  │  ├─ tap.js                  TAP (ADQL) query client
│  │  ├─ sia2.js                 Simple Image Access 2 client
│  │  ├─ ssa.js                  Simple Spectral Access client
│  │  ├─ resolver.js             Sesame name resolver (SIMBAD/VizieR/NED)
│  │  └─ index.js                barrel + endpoint registry
│  ├─ store/                     L3 Storage & Indexing  [FUTURE — scaffold only]
│  │  └─ README.md
│  └─ package.json
├─ api/                          Vercel serverless proxies (thin; existing)
└─ client/                       L4 React app
   └─ src/
      ├─ App.jsx                 tab router (MISSION/SKY/BLINK/CATALOGUE/SPECTRA/DATA SOURCES)
      ├─ lib/api.js              fetch helpers
      └─ components/
         ├─ SpectraView.jsx      NEW: SED + cutout + HEALPix heatmap
         └─ ...existing views
```

## 5. JS-vs-Python IVOA decision (ADR)

**Context.** The classic astronomy toolchain (PyVO, astroquery, healpy) is
Python. Novochar is a Node/React serverless app.

**Options considered**
- **A. Runtime Python service** (e.g. separate FastAPI + PyVO worker).
  Pro: reuses battle-tested clients. Con: adds a second runtime, container
  tooling, and cold-start/latency; contradicts the Vercel "Other" deploy path.
- **B. Node IVOA client (chosen).** The IVOA protocols are plain HTTP +
  XML/JSON; VOTable parsing and ADQL query building are straightforward in JS.
  Node 18+ has native `fetch`. Con: we re-implement what PyVO offers, but only
  the small surface we need.

**Decision.** Implement Layer 1 in Node (`server/ivoa/`). Rationale: (1) no
  extra runtime or deployment surface; (2) the required surface (resolve name ->
  TAP/SIA²/SSA query -> parse VOTable -> feed Layer 2) is small and stable; (3)
  keeps the whole pipeline in one language, simplifying the deterministic-seam
  guarantee. We port PyVO's *behaviour* where it matters (ADQL phrasing,
  VOTable subsetting) rather than its process.

**Consequences / risks**
- We must keep the VOTable parser open to the IVOA schemas used by major
  providers (VizieR, CDS, IRSA). Mitigated by parsing per `<FIELD>` + `<DATA>`
  generically and testing against representative documents.
- Advanced PyVO features (multi-endpoint async, HIERARCH metadata) are
  deferred; Layer 1 targets sync queries per endpoint.

## 6. Layer 1 API surface (this RFC)

`GET /api/ivoa/resolve?name=Crab` -> `{ name, service, resolved:{ra,dec}, aliases }`
via Sesame (SIMBAD vault). Accepts broad identifiers (TYC2-…, NGC 1952, 3C 273…).

`GET /api/ivoa/tap?endpoint=tapvizier&query=…&q=…&limit=…`
runs an ADQL query against a registry-named endpoint (VizieR TAP by default)
and returns parsed rows.

`GET /api/ivoa/sia2?pos=ra,dec&size=0.1` and `/api/ivoa/ssa?pos=…` — image and
spectrum footprints in a given field radius, parsed to JSON rows.

Endpoints are read-only, fail fast with structured `{error}` and fall back to
sample data when live access is unavailable, mirroring the existing
`NASA_API_KEY` pattern.

## 7. Layer 2 -> Layer 4 contract examples

```js
// L1 -> L2: a resolver returns a coordinate, then Layer 2 normalises + bins it
import { convertCoordinates } from '../astro/index.js';
const target = await resolveObject('3C 273');
const { galactic, healpix } = convertCoordinates(target.ra, target.dec, 64);
```

```js
// L2 -> L4: cross-match a field of detections against a reference archive row-set
const pairs = crossmatch(detections, reference, { radiusArcsec: 3 });
```

```js
// L3 schema sketch: HEALPix key is the stable spatial id produced upstream
//   "nc:<nside>:<ringPix>:<epochJD>"  (JSON value: counts / flux / ids)
```

## 8. Layer 4 — Data Representation (this RFC)

The plan's four visualisation families map to client views:

| Plan item | Client implementation |
|-----------|-----------------------|
| Image cutouts & spatial maps | `SpectraView` cutout canvas (PSF cutout) |
| Time-series & motion | existing **BLINK COMPARATOR** |
| SED & spectra | **NEW SPECTRA** view — multi-band photometry + spectrum overlay (asinh/log) |
| HEALPix footprints | `/api/field/heatmap` -> density heatmap canvas |
| Co-ordinated multi-view (RFC) | `SkyViewer` **linked analysis panel** — brushable **colour–colour** (B1−B3 vs B4−B6) and **magnitude-vs-motion** scatters + a sortable table, sharing selection with the map (`SkyAnalysis` / `ScatterPlot`) |
| Richer markers (RFC) | **Semantic zoom** in `SkyViewerCanvas` (hexbin density < zoom 3 → markers → deep trails); shape per class, vector = motion, rings = `nBands`, opacity = `snr`, dashed = unconfirmed |
| Velocity / proper motion | New per-object `pa` (position angle) drives marker vectors (motion direction). `mags` per-band powers the colour indices |

Server feeds:

- `GET /api/spectra/:id` — synthetic SED built deterministically from a
  catalogue object's mag/type/band (photometric points + continuum spectrum).
- `GET /api/field/heatmap?nside=64` — HEALPix (ring) counts over the survey
  field, produced with `server/astro/healpix.js` (the seam where imported
  catalogues will later supply the counts).

RFC data contract additions (`server/data.js`, deterministic like every field):

- `pa` — position angle of apparent motion (deg, east of north) → motion vectors.
- `snr` — detection confidence (~3–20) → marker opacity.
- `nBands` — bands with a strong detection (1–6) → concentric marker rings.
- `mags[1..6]` — per-band apparent magnitudes → colour-colour indices.

## 9. Open questions / next steps

- Define the L3 storage engine (DuckDB in-process vs PostGIS service) and the
  cache (Redis) once ingestion volume is known.
- Add image alignment / frame subtraction (L2) — likely FITS WCS handling and
  a reproject-like kernel in JS.
- Provision real endpoints and env config for VizieR/SIMBAD/IRSA/MAST/HEASARC
  behind `IVOA_*` env vars so live ingestion can ship without code changes.
- Decide on later dependency lifts (Plotly.js, fast-xml-parser) vs. hand-rolled
  clients as the feature surface grows (see ADR in §5).
