import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateSurvey, buildFrames, fetchNEO } from './data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const NASA_API_KEY = process.env.NASA_API_KEY || '';

// Pre-generate the deterministic survey dataset once at startup.
const { survey, passes, objects } = generateSurvey();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'novochar-api',
    mission: survey.mission,
    time: new Date().toISOString(),
    // remaining-days estimate for the 6-month survey
    utc: { now: new Date().toISOString(), jd: jdNow() },
  });
});

app.get('/api/survey', (req, res) => res.json({ survey, passes }));

app.get('/api/objects', (req, res) => {
  const { type, q, band } = req.query;
  let list = objects;
  if (type && type !== 'ALL') list = list.filter((o) => o.type === type);
  if (band && band !== 'ALL') {
    const b = Number(band);
    list = list.filter((o) => o.bandIndex === b);
  }
  if (q) {
    const term = q.toLowerCase();
    list = list.filter((o) => o.id.toLowerCase().includes(term) || o.name.toLowerCase().includes(term));
  }
  res.json({ count: list.length, objects: list });
});

app.get('/api/presets', (req, res) => {
  const all = generateSurvey().presets;
  const list = Object.values(all);
  res.json({ count: list.length, presets: all, list });
});

app.get('/api/objects/:id', (req, res) => {
  const obj = objects.find((o) => o.id === req.params.id);
  if (!obj) return res.status(404).json({ error: 'object not found' });
  res.json(obj);
});

app.get('/api/objects/:id/blink', (req, res) => {
  const obj = objects.find((o) => o.id === req.params.id);
  if (!obj) return res.status(404).json({ error: 'object not found' });
  let count = parseInt(req.query.count || '18', 10);
  count = Math.max(2, Math.min(24, count));
  res.json({ object: { id: obj.id, name: obj.name, motion: obj.motion }, frames: buildFrames(obj, passes, count) });
});

app.get('/api/nasa/neo', async (req, res) => {
  try {
    const data = await fetchNEO(NASA_API_KEY || req.query.api_key);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  const byType = {};
  objects.forEach((o) => { byType[o.type] = (byType[o.type] || 0) + 1; });
  res.json({
    totals: { objects: objects.length, tno: byType.TNO || 0, asteroid: byType.AST || 0, hpm: byType.HPM || 0 },
    passes: passes.length,
    completedPasses: passes.filter((p) => p.status === 'complete').length,
    progresses: passes.map((p) => p.completion),
    fastMovers: objects.filter((o) => o.motion > 40).length,
  });
});

// In production, serve the built React app alongside the API.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

export default app;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => {
    console.log(`\n  Novochar API listening on http://localhost:${PORT}`);
    console.log(`  Survey passes: ${passes.length} | Tracked objects: ${objects.length}\n`);
  });
}

function jdNow() {
  return 2440587.5 + Date.now() / 86400000;
}