// Object name-resolution client (SIMBAD / CDS Sesame).
//
// A name like "Crab", "NGC 1952", "3C 273" or "TYC2 2234-01132-1" is turned
// into a sky position (RA/Dec) and identifier aliases. Primary resolver is
// the SIMBAD `sim-id` JSON service; CDS Sesame XML (`-o=xml`) is a fallback.

export const SIMBAD_ID_BASE = 'https://simbad.u-strasbg.fr/simbad/sim-id';
export const SESAME_BASE = 'https://cds.unistra.fr/cgi-bin/nph-sesame';

/**
 * Resolve a target name to equatorial coordinates.
 *
 * @param {string} name  target identifier(s)
 * @param {object} [opts]
 * @param {'auto'|'simbad'|'sesame'} [opts.service='auto']
 *   `auto` tries SIMBAD's JSON service first, then CDS Sesame's XML service.
 * @param {function} [opts.fetchImpl=globalThis.fetch] injectable for tests
 * @returns {Promise<{name, service, found, ra?, dec?, types?, aliases?}>}
 */
export async function resolveObject(name, { service = 'auto', fetchImpl = globalThis.fetch } = {}) {
  const trimmed = String(name == null ? '' : name).trim();
  if (!trimmed) throw new TypeError('resolveObject requires a target name');
  if (service === 'simbad') return simbadResolve(trimmed, fetchImpl);
  if (service === 'sesame') return sesameResolve(trimmed, fetchImpl);
  // auto: try SIMBAD's JSON, otherwise fall back to CDS Sesame's XML
  try {
    const r = await simbadResolve(trimmed, fetchImpl);
    if (r.found) return r;
  } catch (_) {
    /* fall through */
  }
  return sesameResolve(trimmed, fetchImpl);
}

async function simbadResolve(name, fetchImpl) {
  const url = `${SIMBAD_ID_BASE}?output.format=JSON&Ident=${encodeURIComponent(name)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`SIMBAD ${url} -> HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json || json.errorcode === 'id-not-found' || json.ra == null || json.dec == null) {
    return { name, service: 'simbad', found: false, reason: (json && json.errorcode) || 'not_resolved' };
  }
  return {
    name,
    service: 'simbad',
    found: true,
    ra: Number(json.ra),
    dec: Number(json.dec),
    types: Array.isArray(json.types) ? json.types : [],
    aliases: Array.isArray(json.id) ? json.id.map(String) : [name],
  };
}

async function sesameResolve(name, fetchImpl) {
  const xmlUrl = `${SESAME_BASE}/-o=xml&${encodeURIComponent(name)}`;
  const res = await fetchImpl(xmlUrl);
  if (!res.ok) throw new Error(`Sesame ${xmlUrl} -> HTTP ${res.status}`);
  const xml = await res.text();
  const fromXml = coordinatesFromSesameXML(xml);
  if (fromXml) {
    return { name, service: 'sesame', found: true, ra: fromXml.ra, dec: fromXml.dec, aliases: [name] };
  }
  // some mirrors are VOTable-based; try that shape too
  const vot = extractFromVOTableHint(xml);
  if (vot) return { name, service: 'sesame', found: true, ...vot, aliases: [name] };
  return { name, service: 'sesame', found: false, reason: 'no_coords' };
}

/**
 * Extract {ra, dec} from a Sesame `-o=xml` response (decimal degrees).
 * @param {string} xml
 */
export function coordinatesFromSesameXML(xml) {
  const ra = /<jradeg>([^<]+)<\/jradeg>/i.exec(xml);
  const dec = /<jdedeg>([^<]+)<\/jdedeg>/i.exec(xml);
  if (!ra || !dec) return null;
  const r = Number(ra[1].trim());
  const d = Number(dec[1].trim());
  if (!Number.isFinite(r) || !Number.isFinite(d)) return null;
  return { ra: r, dec: d };
}


function extractFromVOTableHint(xml) {
  const td = /<TR\b[^>]*>(?:[\s\S]*?)<\/TR\s*>/i.exec(xml);
  if (!td) return null;
  // generic: first numeric pair resembling ra/dec among row cells
  const cells = [...td[0].matchAll(/<TD[^>]*>([\s\S]*?)<\/TD\s*>/gi)].map((m) => m[1].trim());
  const nums = cells.map(Number).filter(Number.isFinite);
  if (nums.length >= 2) return { ra: nums[0], dec: nums[1] };
  return null;
}

/**
 * Test helper: resolve coordinates from a previously-parsed Sesame-style row
 * (kept separate so the VOTable parsing can be unit-tested in isolation).
 */
export function coordinatesFromRow(row) {
  const raKey = Object.keys(row).find(
    (k) => /^ra$/i.test(k) || (/ra/i.test(k) && !/q|mg|par/i.test(k))
  );
  const decKey = Object.keys(row).find((k) => /^dec$/i.test(k) || /^dec\b/i.test(k));
  if (!raKey || !decKey) return null;
  const ra = Number(row[raKey]);
  const dec = Number(row[decKey]);
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  return { ra, dec };
}