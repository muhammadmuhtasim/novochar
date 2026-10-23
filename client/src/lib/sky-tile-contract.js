// Identity checks for a fetched sky raster.
//
// The server stamps every raster with its product mode, epoch, model revision
// and (where applicable) spatial address. The loader compares those headers
// with the request before decoding. A cache or CDN that returns the wrong
// epoch, mode or tile must fail visibly rather than quietly paint the wrong
// sky.

function headerName(name) {
  return String(name).toLowerCase();
}

function missing(header) {
  return `sky response identity mismatch: ${header} is missing`;
}

function mismatch(header, expected, actual) {
  return `sky response identity mismatch: ${header} expected "${expected}", got "${actual ?? 'missing'}"`;
}

/**
 * @param {Response} response
 * @param {{
 *   headers?: Record<string, string|number>,
 *   required?: string[],
 *   contentType?: string,
 * }} [expectation]
 */
export function assertSkyResponseIdentity(response, expectation) {
  if (!expectation) return;
  const headers = expectation.headers ?? {};
  for (const [name, expected] of Object.entries(headers)) {
    if (expected === undefined || expected === null) continue;
    const header = headerName(name);
    const actual = response.headers.get(header);
    if (actual === null) throw new Error(missing(header));
    if (actual !== String(expected)) throw new Error(mismatch(header, expected, actual));
  }
  for (const name of expectation.required ?? []) {
    const header = headerName(name);
    const actual = response.headers.get(header);
    if (!actual) throw new Error(missing(header));
  }
  if (expectation.contentType) {
    const actual = response.headers.get('content-type');
    if (!actual || !actual.toLowerCase().startsWith(expectation.contentType.toLowerCase())) {
      throw new Error(mismatch('content-type', expectation.contentType, actual));
    }
  }
}

/** Build the header map for one illustrative raster request. */
export function illustrativeExpectation({ revision, epoch, order, ipix, width, height }) {
  const headers = {
    'x-novochar-sky-mode': 'illustrative',
    'x-novochar-sky-epoch': epoch,
    'x-novochar-sky-revision': revision,
  };
  if (order !== undefined && order !== null) headers['x-novochar-sky-order'] = String(order);
  if (ipix !== undefined && ipix !== null) headers['x-novochar-sky-ipix'] = String(ipix);
  if (width !== undefined && width !== null) headers['x-novochar-sky-width'] = String(width);
  if (height !== undefined && height !== null) headers['x-novochar-sky-height'] = String(height);
  return { headers, required: [], contentType: 'image/png' };
}

/** Build the header map for one archive raster request. */
export function archiveExpectation({ revision, epoch, width, height, outputSha256 }) {
  const headers = {
    'x-novochar-sky-mode': 'archive',
    'x-novochar-sky-epoch': epoch,
    'x-novochar-sky-revision': revision,
    'x-novochar-sky-role': epoch,
  };
  if (width !== undefined && width !== null) headers['x-novochar-sky-width'] = String(width);
  if (height !== undefined && height !== null) headers['x-novochar-sky-height'] = String(height);
  if (outputSha256) headers['x-novochar-sky-output-sha256'] = outputSha256;
  return {
    headers,
    required: ['x-novochar-sky-source-sha256'],
    contentType: 'image/png',
  };
}
