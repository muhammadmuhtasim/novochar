# Performance release validation — 2026-10-15

The performance work is based on the pre-optimization `v1.0.0` baseline at
commit `2383dec`. The tag remains unchanged.

## Bundle and loading

| Measure | Baseline | Performance build |
| --- | ---: | ---: |
| Entry JavaScript | 756.11 kB | 168.79 kB |
| Entry JavaScript, gzip | 207.70 kB | 54.72 kB |

That is a 77.7% reduction in raw entry JavaScript and a 73.7% reduction in
gzip size. Feature modules and both 3D experiences load on demand. The initial
landing page does not request `objects.json`; Blink, Catalogue, or Spectra
loads it when first opened. Three.js remains a deferred 490.30 kB chunk
(122.74 kB gzip).

On a local headless Chromium run with cache disabled, document DOMContentLoaded
was about 488 ms and load was about 495 ms. First canvas readiness was about
1,840 ms for Explore Sky and 834 ms for Free-flight. Repeat entries measured
about 710 ms and 641 ms. These timings include local browser and renderer work;
they are not deployment or physical-device guarantees.

## Resilience and navigation

- Blocking the Sky Viewer chunk showed a feature-specific retry screen. After
  unblocking it, Retry feature reloaded the app on `#sky` and the viewer
  mounted. Reloading creates a fresh browser module-loading context after a
  rejected dynamic import.
- Five rapid switches among Blink, Spectra, and Catalogue during a 900 ms
  emulated network delay produced one `objects.json` request. Catalogue then
  rendered all 1,660 objects on the final selected route.
- At a 390×844 mobile viewport, DPR 2, and 4× CPU throttle, both sky modes
  mounted, Free-flight resized with the viewport, and navigating away removed
  all canvases. No JavaScript exceptions were recorded.

## Build and audit

- Fresh `npm ci`: 172 packages installed; zero vulnerabilities reported.
- Tests: 107 server and 23 client tests passed.
- `npm audit` and `npm audit --omit=dev`: zero vulnerabilities.
- `npm run build`: passed with Vite 7.3.7 and deterministic precomputation of
  1,660 objects.
- `dist/novochar-source.zip`: ZIP integrity passed; package files included;
  `node_modules` and `.git` excluded.

Full command logs and detailed browser measurements are in
`dist/release-verification-2026-10-15-performance/` in the local verification
workspace. The `dist/` directory is generated and is not committed.

## Validation limits

Browser checks used local headless Chromium and emulated mobile settings. No
physical mid-range laptop or mobile device was available. Production hosting,
external archive availability, and pointer-lock behavior on actual mobile
browsers remain unverified by this pass.
