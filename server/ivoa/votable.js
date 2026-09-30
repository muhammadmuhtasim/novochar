// IVOA VOTable parser (TABLEDATA + BINARY + BINARY2/base64), no deps.
//
// Data encodings handled:
//   <TABLEDATA>  text cells (VizieR, MAST, NOIRLab, ESO)
//   <BINARY>     base64 little-endian fixed-width (HEASARC, SIMBAD)
//   <BINARY2>    base64 big-endian fixed-width (Gaia/ESA, TAP 1.4+)
//   <FITS>       reported as encoding='FITS' (not decoded)
//
// Resources may be nested; extraction balances <RESOURCE> depth so inner
// tables aren't truncated. Rows are typed JSON keyed by <FIELD> name. The
// VOTable QUERY_STATUS is surfaced so callers can distinguish a service ERROR
// from an empty-but-valid result.

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
  boolean: (s) => (s === '' ? null : /^[Tt1]/.test(s)),
  char: (s) => s,
  unicodeChar: (s) => s,
};

function coerce(raw, datatype) {
  const s = raw == null ? '' : String(raw).trim();
  const fn = TYPE_FNS[(datatype || 'char').toLowerCase()];
  return fn ? fn(s) : s;
}

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
      nullValue: a && a.null !== undefined ? a.null : null,
    });
  }
  return fields;
}

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
      row[(f && f.name) || `col${i}`] = coerce(value, f ? f.datatype : 'char');
    });
    rows.push(row);
  }
  return rows;
}

// --- balanced <RESOURCE> extraction (handles nesting) -----------------------
function extractResourceBodies(xml) {
  const out = [];
  const tokens = [];
  let m;
  const oe = /<RESOURCE\b/g;
  while ((m = oe.exec(xml))) tokens.push({ i: m.index, d: 1 });
  const ce = /<\/RESOURCE\s*>/g;
  while ((m = ce.exec(xml))) tokens.push({ i: m.index, d: -1 });
  tokens.sort((a, b) => a.i - b.i);
  let depth = 0;
  let start = -1;
  for (const t of tokens) {
    if (start < 0) { start = t.i; depth = 1; continue; }
    depth += t.d;
    if (depth === 0) {
      out.push({ body: xml.slice(start, t.i + '</RESOURCE>'.length) });
      start = -1;
    }
  }
  return out;
}

// --- BINARY (little-endian) + BINARY2 (big-endian) decoding ----------------
const BINARY_SIZE = { boolean: 1, unsignedbyte: 1, short: 2, int: 4, long: 8, longlong: 8, float: 4, double: 8 };

export function decodeBinaryRows(b64, fields, endian = 'le', binary2 = false) {
  if (!b64 || typeof atob === 'undefined') return [];
  const raw = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const be = endian === 'be';
  const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  const readLen = (off) => (be ? (raw[off] << 24) | (raw[off + 1] << 16) | (raw[off + 2] << 8) | raw[off + 3]
    : (raw[off] | (raw[off + 1] << 8) | (raw[off + 2] << 16) | (raw[off + 3] << 24)));
  const advance = (f, p) => {
    const n = BINARY_SIZE[(f.datatype || 'char').toLowerCase()];
    if (n) return p + n;
    const as = f.arraysize;
    if (!as || as === '*') return p + 4 + Math.abs(readLen(p));
    return p + (as === 'x' ? 1 : parseInt(as, 10));
  };

  const rows = [];
  let pos = 0;
  const nullBytes = binary2 ? Math.ceil(fields.length / 8) : 0;
  while (pos + nullBytes < raw.length) {
    const nullFlags = binary2 ? raw.subarray(pos, pos + nullBytes) : null;
    const row = {};
    let p = pos + nullBytes;
    let ok = true;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const dt = (f.datatype || 'char').toLowerCase();
      const next = advance(f, p);
      if (next > raw.length) { ok = false; break; }
      try {
        if (binary2 && (nullFlags[i >> 3] & (1 << (7 - (i & 7))))) row[(f.name) || `col${i}`] = null;
        else if (dt === 'double') row[(f.name) || `col${i}`] = dv.getFloat64(p, !be);
        else if (dt === 'float') row[(f.name) || `col${i}`] = dv.getFloat32(p, !be);
        else if (dt === 'long') {
          const value = dv.getBigInt64 ? dv.getBigInt64(p, !be) : BigInt(dv.getInt32(p, !be)) * 4294967296n + BigInt(dv.getUint32(p + 4, !be));
          row[(f.name) || `col${i}`] = value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
        }
        else if (dt === 'int') row[(f.name) || `col${i}`] = dv.getInt32(p, !be);
        else if (dt === 'short') row[(f.name) || `col${i}`] = dv.getInt16(p, !be);
        else if (dt === 'longlong') row[(f.name) || `col${i}`] = Number(dv.getBigInt64 ? dv.getBigInt64(p, !be) : (dv.getUint32(p, !be) + 4294967296 * dv.getUint32(p + 4, !be)));
        else if (dt === 'boolean') row[(f.name) || `col${i}`] = raw[p] !== 0;
        else if (dt === 'unsignedByte') row[(f.name) || `col${i}`] = raw[p];
        else {
          const as = f.arraysize;
          let start = p, size = as === 'x' || !as ? 1 : parseInt(as, 10);
          if (!as || as === '*') { size = Math.abs(readLen(p)); start = p + 4; }
          let end = start + Math.max(0, size);
          while (end > start && raw[end - 1] === 0) end--;
          row[(f.name) || `col${i}`] = dec ? dec.decode(raw.slice(start, end)) : '';
        }
      } catch (_) { ok = false; break; }
      p = next;
    }
    if (!ok) break;
    rows.push(row);
    pos = p;
    if (rows.length >= 100000) break;
  }
  return rows;
}

export function parseVOTable(xml) {
  const status = queryStatus(xml);
  const bodies = extractResourceBodies(xml);
  const resources = [];
  for (const rb of bodies) {
    const nameMatch = /<RESOURCE\b[^>]*name\s*=\s*"([^"]*)"/i.exec(rb.body);
    const body = rb.body;
    const fields = extractFields(body);
    let rows = [], encoding = null;
    if (/<TABLEDATA/i.test(body)) {
      encoding = 'TABLEDATA'; rows = extractRows(body, fields);
    } else {
      const bin2 = /<BINARY2>[\s\S]*?<STREAM[^>]*encoding\s*=\s*(?:"base64"|'base64')[^>]*>([\s\S]*?)<\/STREAM\s*>/i.exec(body);
      const bin = /<BINARY>[\s\S]*?<STREAM[^>]*encoding\s*=\s*(?:"base64"|'base64')[^>]*>([\s\S]*?)<\/STREAM\s*>/i.exec(body);
      if (bin2) { encoding = 'BINARY2'; rows = decodeBinaryRows(bin2[1], fields, 'be', true); }
      else if (bin) { encoding = 'BINARY'; rows = decodeBinaryRows(bin[1], fields, 'le'); }
      else if (/<FITS/i.test(body)) { encoding = 'FITS'; }
      else { encoding = 'TABLEDATA'; rows = extractRows(body, fields); }
    }
    resources.push({ name: nameMatch ? nameMatch[1] : null, fields, rows, encoding, status });
  }
  return resources;
}

export function queryStatus(xml) {
  const m = /<INFO[^>]*name\s*=\s*"QUERY_STATUS"[^>]*value\s*=\s*"([^"]*)"/i.exec(xml);
  return m ? m[1].toUpperCase() : null;
}

export function firstTableRows(xml) {
  const resources = parseVOTable(xml);
  for (const r of resources) if (r.rows.length) return r.rows;
  return [];
}
