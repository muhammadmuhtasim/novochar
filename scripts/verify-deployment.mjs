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
const styleUrl = findAsset(html, /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/, 'stylesheet');
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
assert.ok(Number.isFinite(Number(apiCache['stale-while-revalidate'])) && Number(apiCache['stale-while-revalidate']) <= 86_400, 'API catalogue stale window should be present and no more than one day');
const apiObjects = await apiObjectsResponse.json();
assert.equal(apiObjects.count, 1660, 'objects API fallback should report all 1,660 rows');

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
  staleDocumentRecovery: 'not requested',
};

if (staleUrl) {
  const staleHtmlResponse = await requireOk(staleUrl, 'previous deployment HTML');
  const staleHtml = await staleHtmlResponse.text();
  const staleScriptUrl = findAsset(staleHtml, /<script\b[^>]*\bsrc="([^"]+)"/, 'previous entry script', staleUrl);
  const staleStyleMatch = staleHtml.match(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/);
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
    report.staleDocumentRecovery = { passed: true, staleEntry: staleScriptUrl.pathname, recoveredAt: page.url() };
  } finally {
    await browser.close();
  }
}

console.log(JSON.stringify(report, null, 2));
