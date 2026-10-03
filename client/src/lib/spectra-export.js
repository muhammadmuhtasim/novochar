// Export / download helpers for the SPECTRA view. Generates standard formats
// (CSV, JSON, FITS, SVG, PNG) directly in the browser from the fetched SED.

import { spectrumTransform, niceTicks } from './spectrum-plot.js';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function spectrumCSV(sed) {
  const rows = ['lambda_um,flux_Jy'];
  for (const p of sed.spectrum) rows.push(`${p.lambda},${p.flux}`);
  return rows.join('\n');
}

export function spectrumJSON(sed) {
  return JSON.stringify(sed, null, 2);
}

// --- minimal FITS writer (1-D image, big-endian IEEE double) --------------
function padString(s, len) {
  return String(s).padEnd(len, ' ').slice(0, len);
}
function card(keyword, value, comment = '') {
  const vStr = typeof value === 'string' ? `'${value}'` : String(value);
  const line = comment ? `${padString(keyword, 8)}=${padString(vStr, 20)}/ ${comment}` : `${padString(keyword, 8)}=${padString(vStr, 20)}`;
  return padString(line, 80);
}

export function spectrumFITS(sed) {
  const n = sed.spectrum.length;
  const l0 = sed.spectrum[0].lambda;
  const l1 = sed.spectrum[n - 1].lambda;
  const dl = (l1 - l0) / (n - 1);
  const cards = [
    card('SIMPLE', true),
    card('BITPIX', -64),
    card('NAXIS', 1),
    card('NAXIS1', n * 8),
    card('EXTEND', true),
    card('BUNIT', "'Jy'"),
    card('CTYPE1', "'WAVE'"),
    card('CUNIT1', "'um'"),
    card('CRVAL1', +l0.toFixed(6)),
    card('CDELT1', +dl.toFixed(6)),
    card('CRPIX1', 1),
    card('OBJECT', `'${(sed.object.name || sed.object.id || '').slice(0, 28)}'`),
    card('TELESCOP', "'SPHEREx'"),
    card('SNR', sed.meta ? sed.meta.snr : 0),
    card('COMMENT', "'Novochar synthetic spectrum (1-D)'"),
    card('END', ''),
  ];
  let header = '';
  for (const c of cards) header += padString(c, 80);
  header = padString(header, Math.ceil(header.length / 2880) * 2880);
  const headerBytes = new TextEncoder().encode(header);

  const dv = new DataView(new ArrayBuffer(n * 8));
  for (let i = 0; i < n; i++) dv.setFloat64(i * 8, sed.spectrum[i].flux, false); // big-endian
  const dataBytes = new Uint8Array(dv.buffer);
  const paddedLen = Math.ceil(dataBytes.length / 2880) * 2880;
  const out = new Uint8Array(headerBytes.length + paddedLen);
  out.set(headerBytes, 0);
  out.set(dataBytes, headerBytes.length);
  return new Blob([out], { type: 'application/fits' });
}

// --- SVG (publication-ready vector) ---------------------------------------
export function spectraSVG(svgElement) {
  if (!svgElement) return null;
  const clone = svgElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', svgElement.clientWidth || 740);
  clone.setAttribute('height', svgElement.clientHeight || 340);
  return new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
}

// --- PNG (raster) via an offscreen canvas, sharing the plot transform ----
export function spectrumPNGDataURL(sed, { z = 0, xScale = 'linear', lines = [] } = {}) {
  const W = 900;
  const H = 420;
  const pad = { l: 66, r: 20, t: 20, b: 48 };
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const tr = spectrumTransform([sed], { xScale, w: W, h: H, pad });

  ctx.fillStyle = '#0a0c12';
  ctx.fillRect(0, 0, W, H);
  const px = pad.l;
  const py = pad.t;
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px, py, pw, ph);

  ctx.fillStyle = '#6b7686';
  ctx.font = '11px monospace';
  for (const t of niceTicks(tr.wMin, tr.wMax)) {
    const x = tr.X(t);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py + ph); ctx.stroke();
    ctx.fillText(String(t), x - 8, H - 16);
  }
  for (let i = Math.ceil(tr.fMin); i <= Math.floor(tr.fMax); i++) {
    const y = tr.Y(Math.pow(10, i));
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke();
    ctx.fillText(`1e${i}`, 8, y + 4);
  }

  // continuum spectrum
  const pts = sed.spectrum.map((p) => [tr.X(p.lambda), tr.Y(p.flux)]);
  ctx.strokeStyle = '#ff6a00';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();

  // red / blue spectral line markers
  for (const l of lines) {
    const obs = (l.rest || 0) * (1 + z);
    if (obs < tr.wMin || obs > tr.wMax) continue;
    const x = tr.X(obs);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = l.kind === 'em' ? '#2bd6ff' : '#ffb454';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText(l.label, x + 3, py + 12);
  }

  ctx.fillStyle = '#ff6a00';
  ctx.font = '12px monospace';
  ctx.fillText(`Flux (Jy, log) vs Wavelength (µm)  ·  z=${Number(z).toFixed(3)}`, px, 16);
  return cv.toDataURL('image/png');
}
