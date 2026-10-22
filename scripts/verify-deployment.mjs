import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const [deploymentArgument, staleArgument] = process.argv.slice(2);
if (!deploymentArgument) {
  console.error('Usage: node scripts/verify-deployment.mjs <deployment-url> [previous-deployment-url]');
  process.exit(2);
}

const deploymentUrl = new URL(deploymentArgument);
const staleUrl = staleArgument ? new URL(staleArgument) : null;
assert.ok(['http:', 'https:'].includes(deploymentUrl.protocol), 'deployment URL must use HTTP or HTTPS');

function findAsset(html, expression, description, baseUrl = deploymentUrl) {
  const match = html.match(expression);
  assert.ok(match?.[1], `could not find ${description} in deployment HTML`);
  return new URL(match[1], baseUrl);
}

function directives(header = '') {
  return Object.fromEntries(header.split(',').map((part) => {
    const [key, value] = part.trim().split('=', 2);
    return [key.toLowerCase(), value?.replace(/^"|"$/g, '') ?? true];
  }));
}

async function requireOk(url, description) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  assert.equal(response.status, 200, `${description} returned HTTP ${response.status}: ${url}`);
  return response;
}

const htmlResponse = await requireOk(deploymentUrl, 'deployment HTML');
const html = await htmlResponse.text();
const htmlCache = directives(htmlResponse.headers.get('cache-control'));
assert.ok(htmlCache['max-age'] === '0' && (htmlCache['must-revalidate'] || htmlCache['no-cache']),
  `HTML should revalidate after deploy, received Cache-Control: ${htmlResponse.headers.get('cache-control')}`);

const scriptUrl = findAsset(html, /<script\b[^>]*\bsrc="([^"]+)"/, 'entry script');
const styleUrl = findAsset(html,
  /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'][^"']*\/assets\/[^"']+\.css["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i,
  'stylesheet');
const assetResults = [];
for (const [kind, url] of [['JavaScript entry', scriptUrl], ['stylesheet', styleUrl]]) {
  assert.equal(url.origin, deploymentUrl.origin, `${kind} should use the deployment origin`);
  assert.match(url.pathname, /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/, `${kind} should use a content-hashed path`);
  const response = await requireOk(url, kind);
  const cache = directives(response.headers.get('cache-control'));
  assert.equal(cache.immutable, true, `${kind} must have immutable caching; received ${response.headers.get('cache-control')}`);
  assert.ok(Number(cache['max-age']) >= 31_536_000, `${kind} should be cacheable for one year`);
  const contentType = response.headers.get('content-type') ?? '';
  assert.match(contentType, kind === 'JavaScript entry' ? /javascript|ecmascript/ : /text\/css/, `${kind} returned an unexpected Content-Type: ${contentType}`);
  assetResults.push({ kind, url: url.href, cacheControl: response.headers.get('cache-control'), contentType });
}

const dataUrl = new URL('/data/objects.json', deploymentUrl);
const dataResponse = await requireOk(dataUrl, 'precomputed object catalogue');
const dataCache = directives(dataResponse.headers.get('cache-control'));
assert.ok(Number.isFinite(Number(dataCache['max-age'])) && Number(dataCache['max-age']) <= 300, 'catalogue browser TTL should be present and no more than five minutes');
assert.ok(Number.isFinite(Number(dataCache['stale-while-revalidate'])) && Number(dataCache['stale-while-revalidate']) <= 86_400, 'catalogue stale window should be present and no more than one day');
const objects = await dataResponse.json();
assert.ok(Array.isArray(objects.objects) && objects.objects.length === 1660, 'deployed object catalogue should contain 1,660 rows');
const apiObjectsResponse = await requireOk(new URL('/api/objects', deploymentUrl), 'objects API fallback');
const apiCache = directives(apiObjectsResponse.headers.get('cache-control'));
assert.ok(Number.isFinite(Number(apiCache['max-age'])) && Number(apiCache['max-age']) <= 300, 'API catalogue browser TTL should be present and no more than five minutes');
// Vercel normalizes function responses to its own cache policy and does not
// preserve stale-while-revalidate on the Express API. The static catalogue is
// the fast path and still carries the stale window; only assert the directive
// when the deployment preserves it.
if (apiCache['stale-while-revalidate'] !== undefined) {
  assert.ok(
    Number.isFinite(Number(apiCache['stale-while-revalidate']))
      && Number(apiCache['stale-while-revalidate']) <= 86_400,
    'API catalogue stale window should be no more than one day when present'
  );
}
const apiObjects = await apiObjectsResponse.json();
assert.equal(apiObjects.count, 1660, 'objects API fallback should report all 1,660 rows');

// SPHEREx FIELD must work from the deployment bundle, not from a local Python
// sidecar. A 503 here is exactly the failure this check exists to catch.
const spherexMetadataUrl = new URL('/api/spherex/products', deploymentUrl);
const spherexResponse = await requireOk(spherexMetadataUrl, 'SPHEREx product metadata');
const spherex = await spherexResponse.json();
assert.equal(spherex.schema, 'novochar.spherex.derived/v1', 'SPHEREx metadata schema should be the derived contract');
assert.equal(spherex.epochs?.length, 2, 'SPHEREx metadata should describe both demo epochs');
assert.equal(spherex.gate?.spatial_alignment, true, 'SPHEREx spatial alignment gate should pass');
assert.equal(spherex.gate?.quantitative_difference_enabled, false, 'quantitative differences must stay disabled');
const spherexRasters = [];
for (const epoch of spherex.epochs) {
  const rasterUrl = new URL(epoch.raster, deploymentUrl);
  const rasterResponse = await requireOk(rasterUrl, `SPHEREx ${epoch.role} raster`);
  const bytes = new Uint8Array(await rasterResponse.arrayBuffer());
  const [width, height] = epoch.derived.shape;
  assert.equal(rasterResponse.headers.get('x-novochar-wire'), spherex.wire.format,
    `SPHEREx ${epoch.role} raster should carry the declared wire format`);
  assert.equal(bytes.length, width * height * 5,
    `SPHEREx ${epoch.role} raster should be float32 IMAGE + uint8 MASK (${width}x${height})`);
  spherexRasters.push({
    role: epoch.role,
    status: rasterResponse.status,
    width,
    height,
    bytes: bytes.length,
    sha256: rasterResponse.headers.get('x-novochar-sha256'),
  });
}

// SPHEREx 3D must also run from the deployment alone: no Python, no local
// cache. These routes are explicitly illustrative; the check pins the mode and
// the real-detail boundary so a future archive swap has to be deliberate.
const skyIndexUrl = new URL('/api/spherex/sky', deploymentUrl);
const skyResponse = await requireOk(skyIndexUrl, 'SPHEREx 3D sky index');
const sky = await skyResponse.json();
assert.equal(sky.schema, 'novochar.spherex.sky-index/v1', 'sky index schema should be the v1 contract');
assert.equal(sky.mode, 'illustrative', 'the in-repo global layer must declare itself illustrative');
assert.equal(sky.epochs?.length, 4, 'the global timeline should describe four epochs');
assert.equal(sky.tiles?.scheme, 'healpix-nest', 'global tiles should use HEALPix NEST');
assert.equal(sky.tiles?.baseOrder, 1, 'the base layer should start at order 1');
assert.equal(sky.tiles?.maxOrder, 4, 'the tile pyramid should reach order 4');
assert.match(sky.notice ?? '', /not an archive measurement|visualization prototype/i,
  'the sky index must carry a non-measurement notice');
const skySourcesUrl = new URL(sky.sources.url, deploymentUrl);
const skySourcesResponse = await requireOk(skySourcesUrl, 'SPHEREx 3D source layer');
const skySources = await skySourcesResponse.json();
assert.equal(skySources.schema, 'novochar.spherex.sky-sources/v1', 'source layer schema should be the v1 contract');
assert.equal(skySources.mode, 'illustrative', 'source layer must declare itself illustrative');
assert.ok(Array.isArray(skySources.candidates) && skySources.candidates.length >= 10,
  'the source layer should expose the prototype candidate set');
for (const candidate of skySources.candidates) {
  assert.equal(candidate.epochs?.length, 4, `source ${candidate.id} should carry four epoch measurements`);
  for (const measurement of candidate.epochs) {
    assert.equal(typeof measurement.ra, 'number', `source ${candidate.id} RA should be numeric`);
    assert.equal(typeof measurement.dec, 'number', `source ${candidate.id} Dec should be numeric`);
    assert.equal(typeof measurement.visible, 'boolean', `source ${candidate.id} visibility should be explicit`);
  }
}

const skyRasters = [];
const baseEpoch = sky.epochs[0].id;
const baseUrl = new URL(sky.tiles.base.urlTemplate.replace('{epoch}', baseEpoch), deploymentUrl);
const tileUrl = new URL(
  sky.tiles.urlTemplate
    .replace('{epoch}', baseEpoch)
    .replace('{order}', String(sky.tiles.baseOrder))
    .replace('{ipix}', '0'),
  deploymentUrl,
);
for (const [kind, url] of [['base', baseUrl], ['tile', tileUrl]]) {
  const response = await requireOk(url, `SPHEREx 3D ${kind} raster`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.headers.get('content-type'), 'image/png', `${kind} raster should be PNG`);
  assert.ok(bytes.length > 8, `${kind} raster should not be empty`);
  assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${kind} raster should carry the PNG signature`);
  assert.equal(response.headers.get('x-novochar-sky-mode'), 'illustrative',
    `${kind} raster should advertise the illustrative mode`);
  assert.ok(response.headers.get('etag'), `${kind} raster should be ETagged`);
  const cache = directives(response.headers.get('cache-control'));
  assert.ok(Number(cache['max-age']) >= 86_400, `${kind} raster should be CDN-cacheable`);
  skyRasters.push({
    kind,
    status: response.status,
    bytes: bytes.length,
    etag: response.headers.get('etag'),
    cacheControl: response.headers.get('cache-control'),
    mode: response.headers.get('x-novochar-sky-mode'),
  });
}

const report = {
  deployment: deploymentUrl.href,
  html: { status: htmlResponse.status, cacheControl: htmlResponse.headers.get('cache-control'), vercelCache: htmlResponse.headers.get('x-vercel-cache') },
  assets: assetResults,
  catalogue: {
    status: dataResponse.status,
    count: objects.objects.length,
    cacheControl: dataResponse.headers.get('cache-control'),
    apiFallbackCacheControl: apiObjectsResponse.headers.get('cache-control'),
  },
  spherex: {
    status: spherexResponse.status,
    schema: spherex.schema,
    gate: spherex.gate,
    rasters: spherexRasters,
  },
  spherex3d: {
    status: skyResponse.status,
    schema: sky.schema,
    mode: sky.mode,
    epochs: sky.epochs.length,
    tiles: { scheme: sky.tiles.scheme, baseOrder: sky.tiles.baseOrder, maxOrder: sky.tiles.maxOrder },
    sources: { status: skySourcesResponse.status, schema: skySources.schema, count: skySources.candidates.length },
    rasters: skyRasters,
  },
  staleDocumentRecovery: 'not requested',
};

if (staleUrl) {
  const staleHtmlResponse = await requireOk(staleUrl, 'previous deployment HTML');
  const staleHtml = await staleHtmlResponse.text();
  const staleScriptUrl = findAsset(staleHtml, /<script\b[^>]*\bsrc="([^"]+)"/, 'previous entry script', staleUrl);
  const staleStyleMatch = staleHtml.match(
    /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'][^"']*\/assets\/[^"']+\.css["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i,
  );
  const staleScriptResponse = await requireOk(staleScriptUrl, 'previous entry script');
  const staleScript = await staleScriptResponse.text();
  assert.ok(staleScript.includes('Retry feature'), 'previous deployment must include the recoverable lazy-load error UI');
  const staleStyleUrl = staleStyleMatch ? new URL(staleStyleMatch[1], staleUrl) : null;
  const staleStyleResponse = staleStyleUrl ? await requireOk(staleStyleUrl, 'previous stylesheet') : null;
  const staleStyle = staleStyleResponse ? await staleStyleResponse.text() : null;

  const systemChromium = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  const browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? { executablePath: systemChromium } : {}),
    args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let servingStaleDocument = false;
    let staleDocumentUsed = false;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const requested = new URL(request.url());
      const isAppRoot = requested.origin === deploymentUrl.origin && requested.pathname === deploymentUrl.pathname;
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && isAppRoot) {
        if (!staleDocumentUsed) {
          staleDocumentUsed = true;
          servingStaleDocument = true;
          await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: staleHtml });
          return;
        }
        servingStaleDocument = false;
        await route.continue();
        return;
      }

      if (servingStaleDocument && requested.origin === deploymentUrl.origin && requested.pathname === staleScriptUrl.pathname) {
        await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: staleScript });
        return;
      }
      if (servingStaleDocument && staleStyleUrl && requested.origin === deploymentUrl.origin && requested.pathname === staleStyleUrl.pathname) {
        await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: staleStyle });
        return;
      }
      if (servingStaleDocument && requested.origin === deploymentUrl.origin && /^\/assets\/.*\.js$/.test(requested.pathname)) {
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Simulated removed lazy chunk from the stale release' });
        return;
      }
      await route.continue();
    });

    await page.goto(deploymentUrl.href, { waitUntil: 'domcontentloaded' });
    await page.locator('.nav-tabs button').nth(1).click();
    await page.getByRole('button', { name: 'Retry feature' }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('button', { name: 'Retry feature' }).click();
    await page.locator('.sky-mode-switch').waitFor({ state: 'visible', timeout: 20_000 });
    assert.deepEqual(pageErrors, [], 'stale-chunk recovery must not leave uncaught JavaScript errors');
    report.staleDocumentRecovery = { passed: true, staleEntry: staleScriptUrl.pathname, recoveredAt: page.url() };
  } finally {
    await browser.close();
  }
}

console.log(JSON.stringify(report, null, 2));
