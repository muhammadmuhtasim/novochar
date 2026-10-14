// IVOA VOTable parser (TABLEDATA + BINARY + BINARY2/base64), no deps.
//
// Data encodings handled:
//   <TABLEDATA>  text cells (VizieR, MAST, NOIRLab, ESO)
//   <BINARY>     base64 network-byte-order scalar and array values
//   <BINARY2>    base64 network-byte-order values with per-cell null flags
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
  long: (s) => (s === '' ? null : parseVOTableInteger(s)),
  short: (s) => (s === '' ? null : parseInt(s, 10)),
  longlong: (s) => (s === '' ? null : parseVOTableInteger(s)),
  unsignedbyte: (s) => (s === '' ? null : parseInt(s, 10)),
  boolean: (s) => (s === '' ? null : /^[Tt1]/.test(s)),
  char: (s) => s,
  unicodechar: (s) => s,
};

function parseVOTableInteger(value) {
  const integer = BigInt(value);
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(integer)
    : integer.toString();
}

function coerce(raw, datatype, arraysize = null) {
  const type = (datatype || 'char').toLowerCase();
  const text = raw == null ? '' : String(raw);
  // Character whitespace is significant in VOTable and must not be trimmed.
  const s = type === 'char' || type === 'unicodechar' ? text : text.trim();
  const fn = TYPE_FNS[type];
  if (arraysize && ['double', 'float', 'real', 'int', 'long', 'short', 'longlong', 'unsignedbyte', 'boolean'].includes(type)) {
    if (s === '') return null;
    const match = /^(\d+(?:x\d+)*|)\*?$/.exec(String(arraysize).trim());
    if (!match) throw new Error(`Unsupported VOTable arraysize "${arraysize}"`);
    const dimensions = match[1] ? match[1].split('x').map(Number) : [];
    if (dimensions.some((dimension) => !Number.isSafeInteger(dimension) || dimension < 1)) {
      throw new Error(`Invalid VOTable arraysize "${arraysize}"`);
    }
    const capacity = dimensions.reduce((product, dimension) => product * dimension, 1);
    if (!Number.isSafeInteger(capacity) || capacity > MAX_ARRAY_ELEMENTS) throw new Error('VOTable array is too large');
    const values = s.split(/\s+/);
    const variable = String(arraysize).trim().endsWith('*');
    if (values.length > MAX_ARRAY_ELEMENTS || (variable ? (dimensions.length && values.length > capacity) : values.length !== capacity)) {
      throw new Error(`VOTable array has ${values.length} elements; arraysize is "${arraysize}"`);
    }
    return values.map((value) => fn ? fn(value) : value);
  }
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
      row[(f && f.name) || `col${i}`] = coerce(value, f ? f.datatype : 'char', f && f.arraysize);
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

// --- BINARY and BINARY2 (network byte order) decoding ----------------------
const BINARY_SIZE = { boolean: 1, unsignedbyte: 1, short: 2, int: 4, long: 8, longlong: 8, float: 4, double: 8, char: 1, unicodechar: 2 };
const MAX_ARRAY_ELEMENTS = 10_000_000;

function binaryArrayInfo(field, offset, readLen, byteLength) {
  const rawSize = field.arraysize;
  if (rawSize == null || rawSize === '') return { isArray: false, count: 1, dataOffset: offset };

  const match = /^(\d+(?:x\d+)*|)\*?$/.exec(String(rawSize).trim());
  if (!match) throw new Error(`Unsupported VOTable arraysize "${rawSize}" for field "${field.name || '?'}"`);
  const dimensions = match[1] ? match[1].split('x').map(Number) : [];
  if (dimensions.some((dimension) => !Number.isSafeInteger(dimension) || dimension < 1)) {
    throw new Error(`Invalid VOTable arraysize "${rawSize}" for field "${field.name || '?'}"`);
  }
  const variable = String(rawSize).trim().endsWith('*');
  const fixedCapacity = dimensions.reduce((product, dimension) => product * dimension, 1);
  if (!Number.isSafeInteger(fixedCapacity) || fixedCapacity > MAX_ARRAY_ELEMENTS) {
    throw new Error(`VOTable array is too large for field "${field.name || '?'}"`);
  }
  if (!variable) return { isArray: true, count: fixedCapacity, dataOffset: offset };

  if (offset + 4 > byteLength) throw new Error(`Missing variable-array length for field "${field.name || '?'}"`);
  const count = readLen(offset);
  if (count < 0 || count > MAX_ARRAY_ELEMENTS || (dimensions.length && count > fixedCapacity)) {
    throw new Error(`Invalid variable-array element count ${count} for field "${field.name || '?'}"`);
  }
  return { isArray: true, count, dataOffset: offset + 4 };
}

export function decodeBinaryRows(b64, fields, endian = 'be', binary2 = false) {
  if (!b64 || typeof atob === 'undefined') return [];
  const raw = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const be = endian === 'be';
  const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  const readLen = (off) => (be ? dv.getInt32(off, false) : dv.getInt32(off, true));

  const decodePrimitive = (datatype, offset) => {
    if (datatype === 'double') return dv.getFloat64(offset, !be);
    if (datatype === 'float') return dv.getFloat32(offset, !be);
    if (datatype === 'long' || datatype === 'longlong') {
      const value = dv.getBigInt64 ? dv.getBigInt64(offset, !be) : BigInt(dv.getInt32(offset, !be)) * 4294967296n + BigInt(dv.getUint32(offset + 4, !be));
      return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
    }
    if (datatype === 'int') return dv.getInt32(offset, !be);
    if (datatype === 'short') return dv.getInt16(offset, !be);
    if (datatype === 'unsignedbyte') return raw[offset];
    if (datatype === 'boolean') {
      const value = String.fromCharCode(raw[offset]);
      if (/^[Tt1]$/.test(value)) return true;
      if (/^[Ff0]$/.test(value)) return false;
      if (value === '?') return null;
      throw new Error(`Invalid VOTable boolean byte 0x${raw[offset].toString(16)}`);
    }
    if (datatype === 'char') return String.fromCharCode(raw[offset]);
    if (datatype === 'unicodechar') return String.fromCharCode(dv.getUint16(offset, !be));
    return null;
  };

  const decodeCharacterArray = (datatype, offset, count) => {
    let value = '';
    if (datatype === 'char') {
      for (let index = 0; index < count; index++) {
        const code = raw[offset + index];
        // FITS-compatible char arrays may terminate early with ASCII NUL.
        // Fixed-width trailing spaces remain part of the string.
        if (code === 0) break;
        value += String.fromCharCode(code);
      }
      return value;
    }
    for (let index = 0; index < count; index++) {
      value += String.fromCharCode(dv.getUint16(offset + index * 2, !be));
    }
    return value;
  };

  const rows = [];
  let pos = 0;
  const nullBytes = binary2 ? Math.ceil(fields.length / 8) : 0;
  while (pos + nullBytes < raw.length) {
    const nullFlags = binary2 ? raw.subarray(pos, pos + nullBytes) : null;
    const row = {};
    let p = pos + nullBytes;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const dt = (f.datatype || 'char').toLowerCase();
      try {
        const array = binaryArrayInfo(f, p, readLen, raw.byteLength);
        const bytesPerElement = BINARY_SIZE[dt];
        const bitArray = dt === 'bit';
        const byteCount = bitArray ? Math.ceil(array.count / 8) : bytesPerElement ? array.count * bytesPerElement : array.count * (dt === 'unicodechar' ? 2 : 1);
        const next = array.dataOffset + byteCount;
        if (!Number.isSafeInteger(byteCount) || next > raw.length) {
          throw new Error(`Truncated VOTable binary value for field "${f.name || '?'}"`);
        }

        let value;
        if (binary2 && (nullFlags[i >> 3] & (1 << (7 - (i & 7))))) value = null;
        else if (bitArray) {
          value = Array.from({ length: array.count }, (_, index) => Boolean(raw[array.dataOffset + (index >> 3)] & (1 << (7 - (index & 7)))));
        } else if (dt === 'char' || dt === 'unicodechar') {
          value = decodeCharacterArray(dt, array.dataOffset, array.count);
        } else if (bytesPerElement) {
          if (array.isArray) {
            value = Array.from({ length: array.count }, (_, index) => decodePrimitive(dt, array.dataOffset + index * bytesPerElement));
          } else {
            value = decodePrimitive(dt, array.dataOffset);
          }
        } else {
          const start = array.dataOffset;
          let end = start + byteCount;
          while (end > start && raw[end - 1] === 0) end--;
          value = dec ? dec.decode(raw.slice(start, end)) : '';
        }
        row[(f.name) || `col${i}`] = value;
        p = next;
      } catch (error) {
        throw new Error(`Unable to decode VOTable field "${f.name || `col${i}`}" at byte ${p}: ${error.message}`);
      }
    }
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
      else if (bin) { encoding = 'BINARY'; rows = decodeBinaryRows(bin[1], fields, 'be'); }
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
