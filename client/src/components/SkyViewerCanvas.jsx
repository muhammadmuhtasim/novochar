import React, { useEffect, useRef, useState } from 'react';
import { starField, normalizedToRaDec, raDecToNormalized } from '../lib/celestial.js';
import { api, fmtRA, fmtDec } from '../lib/api.js';

const STARS = starField();
const MAXIMAGERY_DEG = 2.0; // DSS cutouts cap at 2°.

// Semantic-zoom thresholds (see the marker pass in draw()):
//  - zoom < DENSITY_ZOOM  => hexbin density layer (no individual markers)
//  - mid zoom             => markers + motion vectors on the top-N movers
//  - zoom >= DEEP_ZOOM    => all markers + velocity trails
const DENSITY_ZOOM = 3.0;
const DEEP_ZOOM = 16;
const MAX_VECTORS = 10; // top-N by motion that get vector ticks at mid zoom

// One colour per *object class* so the markers carry meaning at a glance and the
// on-canvas legend can explain what each ring is. Shape is the class-agnostic
// (colour-blind-safe) channel: ring = TNO, diamond = AST, arrow = HPM.
const TYPE_COLORS = {
  TNO: '#ff8c1a', // distant trans-Neptunian candidates
  AST: '#27d4e6', // near-by asteroids
  HPM: '#ff5fc2', // high proper-motion stars
};
const typeColor = (o) => TYPE_COLORS[o.type] || o.color || '#ff8c1a';
// Legend glyphs (Unicode) mirror the shapes drawn on the canvas.
const TYPE_GLYPHS = { TNO: '◎', AST: '◇', HPM: '›' };

/**
 * Interactive sky canvas. When `imagery` is enabled and the view is zoomed into
 * a field ≤ 2°, a real DSS survey cutout (proxied through the server) is drawn
 * beneath the marker layer so the viewer shows true sky pixels from the archive.
 */
export default function SkyViewerCanvas({
  canvasRef,
  wrapRef,
  objects,
  field,
  selRef,
  onSelect,
  imagery = true,
  initialZoom = 1,
  onImageryStatus = null,
  highlight = null, // Set of ids to keep lit during brushing (empty => no brush)
}) {
  const [hover, setHover] = useState(null);
  const [readout, setReadout] = useState('');
  const [imgState, setImgState] = useState({ status: imagery ? 'pending' : 'disabled', survey: '' });
  const state = useRef({ cx: 0.5, cy: 0.5, zoom: Math.max(1, initialZoom || 1), drag: null });
  const bg = useRef({ image: null, meta: null, key: '' });
  const fetchSeq = useRef(0);
  const bgTimer = useRef(null);
  const lastSig = useRef('');

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const W = () => canvas.width / dpr;
    const H = () => canvas.height / dpr;
    const toScreen = (nx, ny) => ({
      x: ((nx - state.current.cx) * state.current.zoom + 0.5) * W(),
      y: ((ny - state.current.cy) * state.current.zoom + 0.5) * H(),
    });
    const toWorld = (mx, my) => ({
      nx: (mx / W() - 0.5) / state.current.zoom + state.current.cx,
      ny: (my / H() - 0.5) / state.current.zoom + state.current.cy,
    });

    const loadImage = (blob) => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });

    const setImg = (patch) => setImgState((s) => ({ ...s, ...patch }));

    const requestImagery = async () => {
      const w = W();
      const h = H();
      const z = state.current.zoom;
      if (!imagery || w < 2 || h < 2) return;
      // Visible angular extents in the (physical) projection used by the canvas.
      const raW = (2 * field.raHalf) / z;   // physical degrees wide
      const decH = (2 * field.decHalf) / z; // degrees tall
      if (Math.max(raW, decH) > MAXIMAGERY_DEG) {
        bg.current.image = null;
        bg.current.meta = null;
        setImg({ status: 'wide', survey: '' });
        draw();
        return;
      }
      const { ra, dec } = normalizedToRaDec(state.current.cx, state.current.cy, field);
      const size = Math.min(raW, decH);
      const aspect = raW / decH;
      const key = `${ra.toFixed(3)}/${dec.toFixed(3)}/${size.toFixed(3)}/${aspect.toFixed(2)}`;
      if (bg.current.key === key && bg.current.image) { setImg({ status: 'ready', survey: bg.current.survey || '' }); return; }
      const seq = ++fetchSeq.current;
      setImg({ status: 'pending', survey: '' });
      try {
        const res = await fetch(api.skyImageUrl(ra, dec, size, { aspect, width: 480 }));
        if (!res.ok) throw new Error(`sky image ${res.status}`);
        const meta = {
          raLeft: parseFloat(res.headers.get('X-Sky-Ra-Left')),
          raRight: parseFloat(res.headers.get('X-Sky-Ra-Right')),
          decTop: parseFloat(res.headers.get('X-Sky-Dec-Top')),
          decBottom: parseFloat(res.headers.get('X-Sky-Dec-Bottom')),
          survey: res.headers.get('X-Sky-Survey') || '',
        };
        if (![meta.raLeft, meta.raRight, meta.decTop, meta.decBottom].every(Number.isFinite)) {
          throw new Error('sky imagery returned no usable WCS corners');
        }
        const blob = await res.blob();
        const image = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : await loadImage(blob);
        if (seq !== fetchSeq.current) return;
        bg.current = { image, meta, key, survey: meta.survey };
        setImg({ status: 'ready', survey: meta.survey });
        draw();
      } catch (err) {
        if (seq !== fetchSeq.current) return;
        bg.current.image = null;
        bg.current.meta = null;
        setImg({ status: 'error', survey: '' });
        draw();
      }
    };

    const scheduleImagery = () => {
      // Only re-request when the view actually changed, so an idle canvas never
      // runs a steady fetch loop (important when zoomed out to the synthetic view).
      const sig = `${imagery}|${state.current.cx.toFixed(4)}|${state.current.cy.toFixed(4)}|${state.current.zoom.toFixed(4)}|${W()}|${H()}`;
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      clearTimeout(bgTimer.current);
      bgTimer.current = setTimeout(requestImagery, 260);
    };

    const draw = () => {
      const w = W();
      const h = H();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#030201';
      ctx.fillRect(0, 0, w, h);

      const img = bg.current.image;
      const hasImg = Boolean(img && bg.current.meta);

      if (hasImg) {
        const m = bg.current.meta;
        const centerY = 0.5;
        const centerX = 0.5;
        const xLeft = toScreen(raDecToNormalized(m.raLeft, field.decCenter, field).nx, centerY).x;
        const xRight = toScreen(raDecToNormalized(m.raRight, field.decCenter, field).nx, centerY).x;
        const yTop = toScreen(centerX, raDecToNormalized(field.raCenter, m.decTop, field).ny).y;
        const yBottom = toScreen(centerX, raDecToNormalized(field.raCenter, m.decBottom, field).ny).y;
        const dx = Math.min(xLeft, xRight);
        const dy = Math.min(yTop, yBottom);
        ctx.drawImage(img, dx, dy, Math.abs(xRight - xLeft), Math.abs(yBottom - yTop));
        // Only a whisper of corner vignette — enough to seat the markers without
        // crushing the real star field into near-invisibility (the accuracy bug
        // where the survey imagery looked like it wasn't there at all).
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      } else {
        const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
        grad.addColorStop(0, '#211006');
        grad.addColorStop(0.7, '#0d0805');
        grad.addColorStop(1, '#030201');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        for (const s of STARS) {
          const p = toScreen(s.nx, s.ny);
          if (p.x < -4 || p.x > w + 4 || p.y < -4 || p.y > h + 4) continue;
          const r = Math.max(0.6, (20 - s.mag) / (3 + state.current.zoom * 0.25));
          ctx.fillStyle =
            s.mag < 9 ? 'rgba(255,205,150,0.9)' : s.mag < 14 ? 'rgba(255,255,255,0.6)' : 'rgba(205,205,225,0.32)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Celestial grid (fainter over real imagery).
      ctx.strokeStyle = hasImg ? 'rgba(255,128,24,0.10)' : 'rgba(255,128,24,0.18)';
      ctx.lineWidth = 1;
      const stepDeg = Math.max(1, 2 * Math.round(1 / state.current.zoom));
      for (let i = -8; i <= 8; i++) {
        const ra = field.raCenter + i * stepDeg;
        const { nx } = raDecToNormalized(ra, field.decCenter, field);
        const p = toScreen(nx, 0.5);
        if (p.x < -1 || p.x > w + 1) continue;
        ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, h); ctx.stroke();
      }
      for (let i = -8; i <= 8; i++) {
        const dec = field.decCenter + i * stepDeg;
        const { ny } = raDecToNormalized(field.raCenter, dec, field);
        const p = toScreen(0.5, ny);
        if (p.y < -1 || p.y > h + 1) continue;
        ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(w, p.y); ctx.stroke();
      }

      // Compass + angular scale so the view reads as an *accurate* map of the
      // sky instead of an abstract dot-plot. In this projection RA increases
      // eastward but is drawn decreasing to the right, so East sits on the left.
      ctx.font = `${hasImg ? 10 : 11}px "Share Tech Mono", monospace`;
      ctx.fillStyle = 'rgba(255,215,165,0.55)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pad = 14;
      ctx.fillText('N ↑', w / 2, pad + 4);
      ctx.fillText('S ↓', w / 2, h - pad - 4);
      ctx.textAlign = 'left';
      ctx.fillText('← E', pad, h / 2);
      ctx.textAlign = 'right';
      ctx.fillText('W →', w - pad, h / 2);

      // Scale bar (arcminutes when zoomed, degrees when wide).
      const degWide = (2 * field.raHalf) / state.current.zoom;
      const barFrac = 0.22;
      const px = Math.min(w * barFrac, 140);
      const barDeg = degWide * barFrac;
      const barLabel = barDeg >= 1 ? `${barDeg.toFixed(1)}°` : `${Math.round(barDeg * 60)}′`;
      const bx = w - pad - px;
      const by = h - pad - 4;
      ctx.strokeStyle = 'rgba(255,215,165,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + px, by);
      ctx.moveTo(bx, by - 3); ctx.lineTo(bx, by + 3);
      ctx.moveTo(bx + px, by - 3); ctx.lineTo(bx + px, by + 3);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(barLabel, bx + px, by - 7);

      // Candidate markers — representation switches with zoom (semantic zoom).
      // Wide: hexbin density layer. Mid: markers + top-N motion vectors.
      // Deep: all markers + trails + selected label.
      if (state.current.zoom < DENSITY_ZOOM) {
        drawDensity(w, h);
      } else {
        drawMarkers(state.current.zoom >= DEEP_ZOOM, w, h);
      }
      scheduleImagery();
    };
    // --- semantic-zoom layers ------------------------------------------------
    const brushed = highlight && highlight.size ? highlight : null;
    const isBrushed = !!brushed;
    // Marker opacity from detection confidence (dim marginal detections without
    // hiding them) and, when a brush is active, dim everything outside it.
    const markerAlpha = (o) => {
      let a = Math.max(0.3, Math.min(1, (o.snr || 8) / 12));
      if (o.id !== selRef.current && isBrushed && !brushed.has(o.id)) a *= 0.16;
      return a;
    };
    // Apparent-motion direction in [nx, ny] unit terms. Position angle (`pa`)
    // is measured east of north; on this map north = +ny and east = -nx.
    const motionDir = (o) => {
      const rad = (((o.pa != null ? o.pa : 90) % 360) * Math.PI) / 180;
      return { dx: -Math.sin(rad), dy: Math.cos(rad) };
    };
    const drawArrowhead = (x, y, dx, dy, size, alpha, col) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.6, -size * 0.55);
      ctx.lineTo(-size * 0.2, 0);
      ctx.lineTo(-size * 0.6, size * 0.55);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.restore();
    };
    // Velocity tick: a short arrow along the direction of travel. Length grows
    // with (log) motion and zoom so slow TNO drift and fast HPM streaks are both
    // legible. (HPM markers already encode direction via their arrowhead shape.)
    const drawMotionVector = (o, p, zoom) => {
      if (o.type === 'HPM') return;
      const len = (5 + 15 * Math.log10((o.motion || 1) + 2)) * (0.7 + zoom * 0.05);
      const d = motionDir(o);
      const tipX = p.x + d.dx * len;
      const tipY = p.y + d.dy * len;
      const col = typeColor(o);
      ctx.save();
      ctx.strokeStyle = col;
      ctx.globalAlpha = markerAlpha(o) * 0.9;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      drawArrowhead(tipX, tipY, d.dx, d.dy, Math.max(5, len * 0.22), markerAlpha(o), col);
      ctx.restore();
    };
    // Fading ghost trail behind the marker (past positions on the sky).
    const drawTrail = (o, p, zoom) => {
      const d = motionDir(o);
      const step = (2 + 4 * Math.log10((o.motion || 1) + 2)) * (0.7 + zoom * 0.04);
      ctx.save();
      for (let i = 1; i <= 5; i++) {
        const t = i * step;
        ctx.beginPath();
        ctx.arc(p.x - d.dx * t, p.y - d.dy * t, Math.max(0.6, 2.2 - i * 0.3), 0, Math.PI * 2);
        ctx.fillStyle = typeColor(o);
        ctx.globalAlpha = markerAlpha(o) * (0.28 - i * 0.045);
        ctx.fill();
      }
      ctx.restore();
    };

    // Draw a single candidate marker: shape by class, nBands rings for TNOs,
    // dashed outline for unconfirmed candidates, opacity = confidence / brush.
    const drawMarker = (o, p, size) => {
      const sel = selRef.current === o.id;
      const col = typeColor(o);
      const alpha = markerAlpha(o);
      const stroke = o.status === 'confirmed' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.22)';

      if (o.type === 'HPM') {
        const d = motionDir(o);
        const s = size * (sel ? 2.2 : 1.6);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(d.dy, d.dx));
        ctx.beginPath();
        ctx.moveTo(s, 0);
        ctx.lineTo(-s * 0.75, -s * 0.8);
        ctx.lineTo(-s * 0.75, s * 0.8);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.restore();
      } else if (o.type === 'AST') {
        const s = size * (sel ? 2.0 : 1.5);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-s, -s, s * 2, s * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.restore();
      } else {
        // TNO: one concentric ring per strongly-detected band (capped at 6).
        const rings = Math.max(1, Math.min(6, o.nBands || 1));
        ctx.save();
        ctx.strokeStyle = col;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        for (let i = 1; i <= rings; i++) {
          const r = size * (i / rings) * (sel ? 2.0 : 1.5);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.lineWidth = sel ? 2.2 : 1.1;
          if (o.status !== 'confirmed') ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // Quality/outline flag around every marker.
      ctx.save();
      ctx.globalAlpha = alpha;
      if (o.status !== 'confirmed') ctx.setLineDash([3, 3]);
      ctx.lineWidth = sel ? 2.6 : 1.2;
      ctx.strokeStyle = sel ? '#fff' : stroke;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * (sel ? 2.0 : 1.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Label the active marker so ordinary users see who they've caught.
      if (sel) {
        ctx.save();
        ctx.font = '11px "Share Tech Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 4;
        ctx.fillText(
          isBrushed && !brushed.has(o.id) ? `${o.id} · dimmed by brush` : `${o.id} · ${o.name}`,
          p.x + size + 5,
          p.y - size - 3
        );
        ctx.restore();
      }
    };

    // Mid/deep marker pass. At mid zoom, vector ticks only on the top-N movers.
    const drawMarkers = (deep, w, h) => {
      const zoom = state.current.zoom;
      const vectorPass =
        deep || objects.length <= MAX_VECTORS
          ? objects
          : objects
              .filter((o) => o.type !== 'HPM')
              .sort((a, b) => (b.motion || 0) - (a.motion || 0))
              .slice(0, MAX_VECTORS);
      for (const o of vectorPass) {
        const { nx, ny } = raDecToNormalized(o.ra, o.dec, field);
        const p = toScreen(nx, ny);
        if (p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) continue;
        if (deep) drawTrail(o, p, zoom);
        drawMotionVector(o, p, zoom);
      }
      for (const o of objects) {
        const { nx, ny } = raDecToNormalized(o.ra, o.dec, field);
        const p = toScreen(nx, ny);
        if (p.x < -24 || p.x > w + 24 || p.y < -24 || p.y > h + 24) continue;
        const size = (3.5 + Math.min(10, (o.motion || 0) / 28)) * (0.72 + zoom * 0.24);
        drawMarker(o, p, size);
      }
    };
    // Wide zoom: hexbin density layer instead of individual dots.
    const drawDensity = (w, h) => {
      const R = Math.max(12, 16 * (1 - state.current.zoom / (DENSITY_ZOOM * 1.6)));
      const hstep = R * Math.sqrt(3);
      const counts = new Map();
      let max = 0;
      for (const o of objects) {
        const { nx, ny } = raDecToNormalized(o.ra, o.dec, field);
        const p = toScreen(nx, ny);
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
        let q = Math.round(p.x / (R * 1.5));
        let r = Math.round(p.y / hstep - q * 0.5);
        // cube-coordinate rounding for a clean hex grid
        let x = q; let z = r; let y = -x - z;
        let rx = Math.round(x); let ry = Math.round(y); let rz = Math.round(z);
        const xd = Math.abs(rx - x); const yd = Math.abs(ry - y); const zd = Math.abs(rz - z);
        if (xd > yd && xd > zd) rx = -ry - rz;
        else if (yd > zd) ry = -rx - rz;
        else rz = -rx - ry;
        q = rx; r = rz;
        const key = q + ',' + r;
        counts.set(key, (counts.get(key) || 0) + 1);
        max = Math.max(max, counts.get(key));
      }
      for (const [key, n] of counts) {
        const [qq, rr] = key.split(',').map(Number);
        const cx = R * 1.5 * qq;
        const cy = hstep * (rr + qq * 0.5);
        const t = n / (max || 1);
        const alpha = 0.16 + 0.82 * t;
        const hue = 26 - t * 26; // orange -> red as clusters densify
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = cx + R * Math.cos(a);
          const py = cy + R * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = `hsla(${hue}, 95%, 58%, ${alpha})`;
        ctx.strokeStyle = `hsla(${hue}, 90%, 62%, ${Math.min(1, alpha + 0.15)})`;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n, cx, cy);
        ctx.restore();
      }
      ctx.save();
      ctx.font = '10px "Share Tech Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,215,165,0.7)';
      ctx.fillText('DENSITY · scroll to zoom into markers', 12, 18);
      ctx.restore();
    };

    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        mx: (e.clientX - r.left) * (W() / r.width),
        my: (e.clientY - r.top) * (H() / r.height),
      };
    };
    const toOverlay = (e) => {
      const r = wrap.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hitTest = (mx, my) => {
      if (state.current.zoom < DENSITY_ZOOM) return null; // density layer has no discrete markers
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        const { nx, ny } = raDecToNormalized(o.ra, o.dec, field);
        const p = toScreen(nx, ny);
        const size = (3.5 + Math.min(10, o.motion / 28)) * (0.72 + state.current.zoom * 0.24);
        if (mx > p.x - size - 4 && mx < p.x + size + 4 && my > p.y - size - 4 && my < p.y + size + 4) return o;
      }
      return null;
    };

    const onDown = (e) => {
      state.current.drag = { x: e.clientX, y: e.clientY, cx: state.current.cx, cy: state.current.cy };
    };
    const onMove = (e) => {
      const { mx, my } = toCanvas(e);
      if (state.current.drag) {
        const dx = (e.clientX - state.current.drag.x) / W();
        const dy = (e.clientY - state.current.drag.y) / H();
        state.current.cx = state.current.drag.cx - dx / state.current.zoom;
        state.current.cy = state.current.drag.cy - dy / state.current.zoom;
        clamp();
        draw();
      }
      const obj = hitTest(mx, my);
      const overlay = toOverlay(e);
      setHover(obj ? { name: obj.name, type: obj.type, x: overlay.x, y: overlay.y } : null);
      const { nx, ny } = toWorld(mx, my);
      const { ra, dec } = normalizedToRaDec(nx, ny, field);
      setReadout(`${fmtRA(ra)}  ${fmtDec(dec)}  zoom ×${state.current.zoom.toFixed(1)}`);
    };
    const onUp = () => { state.current.drag = null; };
    const onWheel = (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      state.current.zoom = Math.min(120, Math.max(1, state.current.zoom * f));
      clamp();
      draw();
    };
    const onClick = (e) => {
      const { mx, my } = toCanvas(e);
      const obj = hitTest(mx, my);
      if (obj) onSelect(obj);
    };
    const onLeave = () => setHover(null);
    const clamp = () => {
      state.current.cx = Math.min(1, Math.max(0, state.current.cx));
      state.current.cy = Math.min(1, Math.max(0, state.current.cy));
    };

    const resize = () => {
      const w = Math.max(2, wrap.clientWidth);
      const h = Math.max(2, wrap.clientHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      draw();
    };

    canvasRef.current.action = (cmd) => {
      if (cmd === 'reset') { state.current = { cx: 0.5, cy: 0.5, zoom: (initialZoom || 1), drag: null }; bg.current.key = ''; setImg({ status: 'pending', survey: '' }); draw(); }
      if (cmd && cmd.mode === 'focus') {
        const { ra, dec, zoom } = cmd;
        const { nx, ny } = raDecToNormalized(ra, dec, field);
        state.current.cx = Math.min(1, Math.max(0, nx));
        state.current.cy = Math.min(1, Math.max(0, ny));
        state.current.zoom = Math.min(120, Math.max(1, zoom || 3));
        state.current.drag = null;
        bg.current.key = ''; // force a fresh cutout at the new centre
        setImg({ status: 'pending', survey: '' });
        draw();
      }
    };

    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        state.current.drag = { x: t.clientX, y: t.clientY, cx: state.current.cx, cy: state.current.cy };
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 1 && state.current.drag) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = (t.clientX - state.current.drag.x) / W();
        const dy = (t.clientY - state.current.drag.y) / H();
        state.current.cx = state.current.drag.cx - dx / state.current.zoom;
        state.current.cy = state.current.drag.cy - dy / state.current.zoom;
        clamp();
        draw();
      }
    };
    const onTouchEnd = () => { state.current.drag = null; };

    if ('ontouchstart' in window) {
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd);
    }
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', onClick);
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);

    return () => {
      clearTimeout(bgTimer.current);
      fetchSeq.current += 1;
      if ('ontouchstart' in window) {
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
      }
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onClick);
      resizeObserver.disconnect();
      if (canvasRef.current) delete canvasRef.current.action;
    };
  }, [objects, field, selRef, onSelect, imagery, initialZoom, canvasRef, wrapRef, highlight]);
  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="sky-canvas" />
      {imgState.status === 'ready' && imgState.survey && (
        <div className="imagery-badge" title="Real sky pixels proxied from the connected survey archive">
          ◉ LIVE {imgState.survey.trim() || 'DSS'} SURVEY
        </div>
      )}
      {imgState.status === 'pending' && <div className="imagery-badge loading">LOADING REAL SKY…</div>}
      {imgState.status === 'wide' && <div className="imagery-badge hint">OVERVIEW — SCROLL / PINCH TO ZOOM INTO REAL SKY</div>}
      {imgState.status === 'error' && <div className="imagery-badge hint">SKY ARCHIVE OFFLINE — SHOWING STATIC STARS</div>}
      <div className="sky-legend" title="Object classes flagged by the survey">
        {Object.entries(TYPE_COLORS).map(([t, c]) => (
          <span className="sky-legend-item" key={t}>
            <span className="sky-legend-glyph" style={{ color: c, textShadow: `0 0 6px ${c}` }}>{TYPE_GLYPHS[t]}</span>
            {t}
          </span>
        ))}
        <span className="sky-legend-note">shape = class · ring count = bands · arrow = motion</span>
      </div>
      {hover && (
        <div className="hover-tip" style={{ left: Math.min(hover.x + 18, (wrapRef.current ? wrapRef.current.clientWidth : 200) - 140), top: hover.y - 6 }}>
          <strong>{hover.name}</strong> · {hover.type}
        </div>
      )}
      <div className="readout">{readout}</div>
    </div>
  );
}
