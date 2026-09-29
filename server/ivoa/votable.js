// Minimal VOTable parser (IVOA VOTable 1.x TABLEDATA subset).
//
// No external dependencies. Handles the wiring-table structure used by the
// Layer-1 targets (VizieR TAP, CDS Sesame, SIA² / SSA endpoints): it reads the
// <FIELD> metadata and the <DATA><TABLEDATA> rows and emits typed JSON rows.
//
// Not a full XML parser; it assumes well-formed, non-escaped cell text (the
// norm for VOTable TABLEDATA). Binary/FITS-encoded data are not decoded
// (rows come back empty for those tables).

/**
 * Parse the attributes of a single XML tag (quoted strings only).
 * @param {string} tag  e.g. `<FIELD name="RA" datatype="double"/>`
 * @returns {Record<string,string>}
 */
export function parseTagAttributes(tag) {
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return attrs;
}

const TYPE_FNS = {
  double: (s) => (s === '' ? null : Number(s)),
  float: (s) => (s === '' ? null : Number(s)),
  real: (s) => (s === '' ? null : Number(s)),
  int: (s) => (s === '' ? null : parseInt(s, 10)),
  long: (s) => (s === '' ? null : parseInt(s, 10)),
  short: (s) => (s === '' ? null : parseInt(s, 10)),
  longlong: (s) => (s === '' ? null : Number(s)),
  unsignedByte: (s) => (s === '' ? null : parseInt(s, 10)),
  boolean: (s) => s === '' ? null : /^[Tt1]/.test(s),
  char: (s) => s,
  unicodeChar: (s) => s,
};

function coerce(raw, datatype) {
  const s = raw == null ? '' : String(raw).trim();
  const fn = TYPE_FNS[(datatype || 'char').toLowerCase()];
  return fn ? fn(s) : s;
}

/**
 * Extract the ordered <FIELD> metadata from a resource body.
 */
export function extractFields(resourceBody) {
  const fields = [];
  const re = /<FIELD\b[^>]*>/gi;
  let m;
  while ((m = re.exec(resourceBody))) {
    const a = parseTagAttributes(m[0]);
    fields.push({
      name: a.name ?? null,
      datatype: a.datatype ?? 'char',
      unit: a.unit ?? null,
      ucd: a.ucd ?? null,
      arraysize: a.arraysize ?? null,
    });
  }
  return fields;
}

/**
 * Extract typed rows from <DATA><TABLEDATA>…</TABLEDATA>.
 * @returns {Array<Record<string,unknown>>}
 */
export function extractRows(tableBody, fields) {
  const td = /<TABLEDATA>([\s\S]*?)<\/TABLEDATA>/i.exec(tableBody);
  if (!td) return [];
  const rows = [];
  const trRe = /<TR\b[^>]*>([\s\S]*?)<\/TR\s*>/gi;
  let trm;
  while ((trm = trRe.exec(td[1]))) {
    const cells = [];
    const tdRe = /<TD\b[^>]*>([\s\S]*?)<\/TD\s*>/gi;
    let cdm;
    while ((cdm = tdRe.exec(trm[1]))) cells.push(cdm[1]);
    const row = {};
    cells.forEach((value, i) => {
      const f = fields[i];
      const key = (f && f.name) || `col${i}`;
      row[key] = coerce(value, f ? f.datatype : 'char');
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a full VOTable string into a list of resources, each with `fields`
 * and `rows`.
 * @param {string} xml VOTable XML text
 * @returns {Array<{name: string|null, fields: Array, rows: Array}>}
 */
export function parseVOTable(xml) {
  const resources = [];
  const resRe = /<RESOURCE\b[^>]*>([\s\S]*?)<\/RESOURCE\s*>/gi;
  let rm;
  while ((rm = resRe.exec(xml))) {
    const body = rm[1];
    const nameMatch = /<RESOURCE\b[^>]*name\s*=\s*"([^"]*)"/i.exec(rm[0]);
    const fields = extractFields(body);
    resources.push({
      name: nameMatch ? nameMatch[1] : null,
      fields,
      rows: extractRows(body, fields),
    });
  }
  return resources;
}

/** Convenience: flatten the first table's rows. */
export function firstTableRows(xml) {
  const resources = parseVOTable(xml);
  for (const r of resources) if (r.rows.length) return r.rows;
  return [];
}