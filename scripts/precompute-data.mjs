// Build-time precompute of the deterministic Novochar dataset.
//
// The survey / passes / objects / stats / presets are 100% deterministic (they
// are seeded in server/data.js), so there is no reason to generate them inside
// a Vercel serverless function on every cold start. Baking them into static
// JSON under client/dist/data lets Vercel's edge CDN serve them instantly and
// keeps the first paint off the slow, cold-start-prone /api/* path.
//
// Determinism guarantee: data.js uses a fixed seed (mulberry32(0x53505845)),
// so the output here is identical across runs/builds. If you change the
// generators, just redeploy and the static files are regenerated.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateSurvey } from '../server/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// client/dist is produced by `vite build` (runs first); we fill dist/data/.
const outDir = path.resolve(__dirname, '..', 'client', 'dist', 'data');
mkdirSync(outDir, { recursive: true });

const { survey, passes, objects } = generateSurvey();

const write = (rel, data) => {
  const p = path.join(outDir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data));
  return rel;
};

let written = 0;

// Mirror of GET /api/survey
written++;
write('survey.json', { survey, passes });

// Mirror of GET /api/objects (no filters)
written++;
write('objects.json', { count: objects.length, objects });

// Mirror of GET /api/stats
{
  const byType = {};
  objects.forEach((o) => { byType[o.type] = (byType[o.type] || 0) + 1; });
  written++;
  write('stats.json', {
    totals: {
      objects: objects.length,
      tno: byType.TNO || 0,
      asteroid: byType.AST || 0,
      hpm: byType.HPM || 0,
    },
    passes: passes.length,
    completedPasses: passes.filter((p) => p.status === 'complete').length,
    progresses: passes.map((p) => p.completion),
    fastMovers: objects.filter((o) => o.motion > 40).length,
  });
}

// Mirror of GET /api/presets
{
  const all = generateSurvey().presets;
  const list = Object.values(all);
  written++;
  write('presets.json', { count: list.length, presets: all, list });
}

// Mirror of GET /api/field/heatmap?nside=64 (the client default). The API keeps
// serving other nside values on demand.
{
  const { buildHeatmap } = await import('../server/heatmap.js');
  written++;
  write('heatmap/64.json', buildHeatmap(objects, 64));
}

// Index of every precomputed path so the client can discover (and future
// tooling can sanity check) what was baked in.
write(
  'index.json',
  {
    generatedAt: new Date().toISOString(),
    version: 1,
    files: [
      'survey.json',
      'objects.json',
      'stats.json',
      'presets.json',
      'heatmap/64.json',
    ],
  }
);

console.log(
  `\n  Precomputed deterministic dataset -> ${outDir}` +
    `\n  { survey, objects (${objects.length}), stats, presets, heatmap/64 } files written\n`
);