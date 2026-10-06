import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateSurvey, buildFrames, fetchNEO } from './data.js';
import { buildSpectrum } from './spectra.js';
import { buildHeatmap } from './heatmap.js';
import { fetchDssImage, normSkyParams } from './sky.js';
import {
  tapQuery,
  tapTables,
  querySIA,
  querySSA,
  resolveObject,
  probeAll,
  probeArchive,
  IVOA_REGISTRY,
  IVOA_LABEL,
  ARCHIVES,
  PROTOCOL_LABEL,
  queryGaiaMotion,
  SOURCE_ADAPTERS,
  queryArchiveSource,
  lambdaFileUrl,
  mastProductUrl,
  dartsFileUrl,
} from './ivoa/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const NASA_API_KEY = process.env.NASA_API_KEY || '';

// Pre-generate the deterministic survey dataset once at startup.
const { survey, passes, objects } = generateSurvey();

const app = express();
app.use(cors());
app.use(express.json());

// Deterministic GET endpoints never change per-request, so allow the browser and
// Vercel's edge to cache them (repeat loads avoid a serverless cold start).
const CACHEABLE_API = /^\/api\/(survey|objects|stats|presets|spectra\/|field\/heatmap)/;
app.use((req, res, next) => {
  if (req.method === 'GET' && CACHEABLE_API.test(req.path || req.url)) {
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=31536000');
  }
  next();
});

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
    const data = await fetchNEO(NASA_API_KEY);
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

// --- Layer 4: Data Representation ------------------------------------------
// SED / spectra for a tracked candidate (deterministic, overlayable photometry).
app.get('/api/spectra/:id', (req, res) => {
  const obj = objects.find((o) => o.id === req.params.id);
  if (!obj) return res.status(404).json({ error: 'object not found' });
  res.json({ sed: buildSpectrum(obj) });
});

// HEALPix density footprint of the tracked field.
app.get('/api/field/heatmap', (req, res) => {
  const nside = Math.min(1024, Math.max(1, parseInt(req.query.nside || '64', 10)));
  res.json(buildHeatmap(objects, nside));
});

// --- Layer 1: IVOA Ingestion (real clients, live endpoints + probe) --------
app.get('/api/ivoa', (_req, res) =>
  res.json({
    protocol: 'IVOA (TAP / SIA / SSA / Sesame) — real clients, no Python runtime',
    note: 'Archive status reflects live probes; GET /api/ivoa/probe for current truth.',
    registries: IVOA_REGISTRY,
    protocols: PROTOCOL_LABEL,
    archives: Object.fromEntries(
      Object.entries(ARCHIVES).map(([k, a]) => [
        k,
        {
          name: a.name,
          org: a.org,
          category: a.category,
          domain: a.domain,
          status: a.status,
          note: a.note,
          protocols: Object.keys(a.protocols || {}),
        },
      ])
    ),
  })
);

app.get('/api/archives', (_req, res) => res.json({ archives: SOURCE_ADAPTERS }));

app.post('/api/archives/:archive/query', async (req, res) => {
  const { archive } = req.params;
  try {
    res.json(await queryArchiveSource({
      archive,
      operation: req.body && req.body.operation,
      params: req.body && req.body.params,
    }));
  } catch (err) {
    const status = err instanceof TypeError || err instanceof RangeError ? 400 : 502;
    res.status(status).json({ archive, error: err.message });
  }
});

app.get('/api/archives/lambda/file', (req, res) => {
  try {
    res.redirect(302, lambdaFileUrl(req.query.path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/archives/mast/file', (req, res) => {
  try {
    res.redirect(302, mastProductUrl(req.query.uri));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/archives/darts/file', (req, res) => {
  try {
    res.redirect(302, dartsFileUrl(req.query.path));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/ivoa/probe', async (req, res) => {
  try {
    res.json(await probeAll());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/ivoa/probe/:key', async (req, res) => {
  const out = await probeArchive(req.params.key);
  if (!ARCHIVES[req.params.key]) return res.status(404).json(out);
  res.json(out);
});

app.get('/api/ivoa/resolve', async (req, res) => {
  const { name, service = 'auto' } = req.query;
  if (!name) return res.status(400).json({ error: 'query param `name` is required' });
  try {
    res.json(await resolveObject(name, { service }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/ivoa/gaia/motion', async (req, res) => {
  const { ra, dec, radius, epoch } = req.query;
  if (ra == null || dec == null) {
    return res.status(400).json({ error: 'query params `ra` and `dec` are required' });
  }
  try {
    res.json(await queryGaiaMotion({ ra, dec, radius, targetEpoch: epoch }));
  } catch (err) {
    const status = err instanceof TypeError || err instanceof RangeError ? 400 : 502;
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/ivoa/tap', async (req, res) => {
  const { archive = 'vizier', endpoint, query, limit } = req.query;
  if (!query) return res.status(400).json({ error: 'query param `query` (ADQL) is required' });
  try {
    const out = await tapQuery({
      archive: endpoint ? undefined : archive,
      endpoint,
      query,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({
      count: out.rows.length,
      rows: out.rows.slice(0, 500),
      fields: (out.resources && out.resources[0] && out.resources[0].fields) || [],
      status: out.status,
      endpoint: out.endpoint,
      query: out.query,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/ivoa/tap/tables', async (req, res) => {
  const { archive = 'vizier', endpoint } = req.query;
  try {
    const rows = await tapTables({ archive: endpoint ? undefined : archive, endpoint });
    res.json({ count: rows.length, rows: rows.slice(0, 500), archive: archive, endpoint: endpoint || archive });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/ivoa/sia2', async (req, res) => {
  const { archive = 'noirlab', endpoint, pos, size } = req.query;
  if (!pos) return res.status(400).json({ error: 'query param `pos` ("ra dec") is required' });
  try {
    const out = await querySIA({ endpoint: endpoint || archive, pos, size: size ? parseFloat(size) : undefined });
    res.json({
      count: out.rows.length,
      rows: out.rows.slice(0, 200),
      fields: (out.resources && out.resources[0] && out.resources[0].fields) || [],
      status: out.status,
      first: out.first,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/ivoa/ssa', async (req, res) => {
  const { archive = 'mast', endpoint, pos, size } = req.query;
  if (!pos) return res.status(400).json({ error: 'query param `pos` ("ra dec") is required' });
  try {
    const out = await querySSA({ endpoint: endpoint || archive, pos, size: size ? parseFloat(size) : undefined });
    res.json({
      count: out.rows.length,
      rows: out.rows.slice(0, 200),
      fields: (out.resources && out.resources[0] && out.resources[0].fields) || [],
      status: out.status,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Real sky imagery for the SKY VIEWER: a DSS cutout (the survey plates served by
// IRSA/STScI/MAST) rendered server-side into an oriented PNG, proxied so the
// browser never needs cross-origin access. WCS corner metadata is returned in
// response headers so the client can register the image under the marker layer.
app.get('/api/sky/image', async (req, res) => {
  const { ra, dec, size, aspect, width } = req.query;
  try {
    const p = normSkyParams(ra, dec, size, aspect);
    const out = await fetchDssImage({
      ...p,
      width: width && Number.isFinite(Number(width)) ? Math.min(720, Math.max(64, parseInt(width, 10))) : 480,
    });
    res.set({
      'Content-Type': out.contentType,
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Expose-Headers': 'X-Sky-Center-Ra, X-Sky-Center-Dec, X-Sky-Size, X-Sky-Aspect, X-Sky-Ra-Left, X-Sky-Ra-Right, X-Sky-Dec-Top, X-Sky-Dec-Bottom, X-Sky-Survey, X-Sky-Source',
      'X-Sky-Center-Ra': String(out.meta.ra),
      'X-Sky-Center-Dec': String(out.meta.dec),
      'X-Sky-Size': String(out.meta.size),
      'X-Sky-Aspect': String(out.meta.aspect),
      'X-Sky-Ra-Left': String(out.meta.raLeft),
      'X-Sky-Ra-Right': String(out.meta.raRight),
      'X-Sky-Dec-Top': String(out.meta.decTop),
      'X-Sky-Dec-Bottom': String(out.meta.decBottom),
      'X-Sky-Survey': out.meta.survey,
      'X-Sky-Source': out.meta.source,
    });
    res.send(out.buffer);
  } catch (err) {
    const status = err instanceof RangeError || err instanceof TypeError ? 400 : 502;
    res.status(status).json({ error: err.message });
  }
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