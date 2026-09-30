// Object name-resolution client.
//
// Primary: CDS Sesame (verified live) - resolves an identifier like "M1",
// "NGC 1952" or "3C 273" to equatorial coordinates by parsing the %J line of
// Sesame's response. Fallback: SIMBAD TAP (best-effort).

export const SESAME_BASE = 'https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame';
export const SIMBAD_ID_BASE = 'https://simbad.u-strasbg.fr/simbad/sim-tap';

/**
 * Resolve a target name to equatorial coordinates.
 * @param {string} name
 * @param {object} opts { service: 'auto'|'sesame'|'simbad', fetchImpl, timeout }
 * @returns {Promise<{name, service, found, ra?, dec?, aliases?, reason?}>}
 */
export async function resolveObject(name, { service = 'auto', fetchImpl = globalThis.fetch, timeout = 30000 } = {}) {
  const trimmed = String(name == null ? '' : name).trim();
  if (!trimmed) throw new TypeError('resolveObject requires a target name');
  if (service === 'simbad') return simbadTapResolve(trimmed, fetchImpl);

  try {
    const r = await sesameResolve(trimmed, fetchImpl);
    if (r.found) return r;
    if (service === 'sesame') return r;
  } catch (_) {
    if (service === 'sesame') throw _;
  }
  // Best-effort SIMBAD TAP fallback (SIMBAD serves BINARY VOTable).
  try {
    return await simbadTapResolve(trimmed, fetchImpl);
  } catch (_) {
    return { name: trimmed, service: 'sesame', found: false, reason: 'unresolved' };
  }
}

/** Parse the `%J <ra> <dec>` coordinate line from a Sesame response. */
export function coordinatesFromSesameAscii(body) {
  const line = /%J\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)/i.exec(body);
  if (!line) return null;
  const ra = Number(line[1]);
  const dec = Number(line[2]);
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  return { ra, dec };
}

async function sesameResolve(name, fetchImpl) {
  // Sesame: options + target as a query string. The target is a bareword.
  const url = `${SESAME_BASE}?${encodeURIComponent(name)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Sesame HTTP ${res.status}`);
  const body = await res.text();
  const coords = coordinatesFromSesameAscii(body);
  if (coords) {
    return { name, service: 'sesame', found: true, ra: coords.ra, dec: coords.dec, aliases: [name] };
  }
  return { name, service: 'sesame', found: false, reason: 'no_coords' };
}

async function simbadTapResolve(name, fetchImpl) {
  const safe = name.replace(/'/g, "''");
  const query = `SELECT b.main_id, b.ra, b.dec FROM ident i JOIN basic b ON b.oid = i.oidref WHERE i.id = '${safe}'`;
  const { tapQuery } = await import('./tap.js');
  const out = await tapQuery({ endpoint: SIMBAD_ID_BASE, query, timeout: 20000, fetchImpl });
  const row = out.rows[0];
  if (!row) return { name, service: 'simbad', found: false, reason: 'not_resolved' };
  return {
    name, service: 'simbad', found: true,
    ra: Number(row.ra), dec: Number(row.dec),
    aliases: row.main_id ? [name, row.main_id] : [name],
  };
}

/** Extract {ra, dec} from a Sesame `-o=xml` response (kept for tests/compat). */
export function coordinatesFromSesameXML(xml) {
  const ra = /<jradeg>([^<]+)<\/jradeg>/i.exec(xml);
  const dec = /<jdedeg>([^<]+)<\/jdedeg>/i.exec(xml);
  if (!ra || !dec) return null;
  const r = Number(ra[1].trim());
  const d = Number(dec[1].trim());
  if (!Number.isFinite(r) || !Number.isFinite(d)) return null;
  return { ra: r, dec: d };
}

/** Test helper: resolve coordinates from an already-parsed table row. */
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
