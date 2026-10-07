import React, { useEffect, useRef, useState } from 'react';
import {
  starField,
  normalizedToRaDec,
  raDecToNormalized,
  raDecToVector,
  viewRotation,
  applyViewRotation,
  celestialSphereStars,
} from '../lib/celestial.js';
import { fmtRA, fmtDec } from '../lib/api.js';

const STARS = starField();
const SPHERE_STARS = celestialSphereStars();

// Semantic-zoom thresholds (see the marker pass in draw()):
//  - zoom < DENSITY_ZOOM  => hexbin density layer (no individual markers)
//  - mid zoom             => markers + motion wakes on the top-N movers
//  - zoom >= DEEP_ZOOM    => all markers + velocity trails
const DENSITY_ZOOM = 3.0;
const DEEP_ZOOM = 16;
const MAX_VECTORS = 10; // top-N by motion that get wake ticks at mid zoom
const DEG_RAD = Math.PI / 180;

// A single warm amber/ember family (matches the HUD design system) so the
// markers feel native to the site instead of a disjoint neon rainbow. Shape is
// the colour-blind-safe channel: disc = icy body, rock = asteroid, comet = fast
// star. Confirmed detections get a green confirmation ring; marginal ones dim.
const TYPE_COLORS = {
  TNO: '#FFB84D', // soft gold — distant icy body (planet-like disc)
  AST: '#FF6A1F', // ember orange — nearby asteroid (pointed "rock")
  HPM: '#FFE08A', // pale gold — fast-moving star (streaking comet)
};
const CONFIRMED = '#00FF88';
const FAST = '#7ADBF7';
const typeColor = (o) => TYPE_COLORS[o.type] || o.color || '#FFB84D';
// Legend glyphs (Unicode) mirror the shapes drawn on the canvas.
const TYPE_GLYPHS = { TNO: '●', AST: '◆', HPM: '☄' };
// Plain-English names for general users
const TYPE_NAMES = {
  TNO: 'Icy Body',
  AST: 'Asteroid',
  HPM: 'Fast Star',
};

/**
 * Interactive sky map (synthetic star field + candidate markers, no live sky
 * imagery). It reports the current view through `onView({ ra, dec, raW, decH,
 * zoom })` so a synced companion view (e.g. the REAL SKY mosaic) can mirror the
 * exact patch of sky the user is looking at.
 */
export default function SkyViewerCanvas({
  canvasRef,
  wrapRef,
  objects,
  field,
  selRef,
  onSelect,
  initialZoom = 1,
  onView = null, // callback: ({ ra, dec, raW, decH, zoom }) on every view change
  highlight = null, // Set of ids to keep lit during brushing (empty => no brush)
  mode = 'map', // 'map' (flat 2D) | '3d' (rotatable celestial sphere)
  onModeChange = () => {},
}) {
  const [hover, setHover] = useState(null);
  const [readout, setReadout] = useState('');
  const state = useRef({
    cx: 0.5, cy: 0.5, zoom: Math.max(1, initialZoom || 1), drag: null,
    v3: null, // { raC, decC } — 3D sphere view centre
    _mode: null, // last mode this effect ran in (for seamless toggling)
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const MODE = mode || 'map';

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

    // Publish the current view so a synced companion (REAL SKY mosaic) can mirror
    // the exact patch of sky on screen. Called from the end of every draw().
    const reportView = () => {
      if (!onView) return;
      const { cx, cy, zoom, v3 } = state.current;
      const raW = (2 * field.raHalf) / zoom;   // physical degrees wide
      const decH = (2 * field.decHalf) / zoom; // degrees tall
      if (MODE === '3d' && v3) {
        onView({ ra: v3.raC, dec: v3.decC, raW, decH, zoom });
      } else {
        const { ra, dec } = normalizedToRaDec(cx, cy, field);
        onView({ ra, dec, raW, decH, zoom });
      }
    };

    const draw = () => {
      const w = W();
      const h = H();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#030201';
      ctx.fillRect(0, 0, w, h);

      // 3D celestial-sphere view delegates to its own painter.
      if (MODE === '3d') { drawSphere(w, h); reportView(); return; }

      // Synthetic backdrop (no live imagery on the main map).
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

      // Celestial grid.
      ctx.strokeStyle = 'rgba(255,128,24,0.18)';
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
      ctx.font = `11px "Share Tech Mono", monospace`;
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
      reportView();
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
    // Hex colour -> rgba with alpha (theme markers share one warm palette).
    const hexA = (hex, a) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };
    // A clean angled head ("v") rendered on the canvas at tip of a motion wake.
    const drawChevron = (x, y, dx, dy, size, alpha, col) => {
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.strokeStyle = col;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1.4, size * 0.3);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(size * 0.35, -size * 0.5);
      ctx.moveTo(size, 0);
      ctx.lineTo(size * 0.35, size * 0.5);
      ctx.stroke();
      ctx.restore();
    };
    // Tapered motion "wake" pointing the way the object is heading — reads like a
    // comet tail / afterburner streak (intuitive to general users) rather than a
    // hard abstract arrow. Length grows with (log) motion and zoom.
    const drawMotionVector = (o, p, zoom) => {
      if (o.type === 'HPM') return; // comet markers carry their own tail
      const alpha = markerAlpha(o);
      if (alpha < 0.25) return;
      const d = motionDir(o);
      const len = (10 + 16 * Math.log10((o.motion || 2) + 2)) * (0.6 + zoom * 0.05);
      const col = typeColor(o);
      const halfW = Math.max(1, 1.4 + (o.motion || 0) / 220);
      const tx = p.x + d.dx * len;
      const ty = p.y + d.dy * len;
      ctx.save();
      ctx.globalAlpha = alpha;
      const g = ctx.createLinearGradient(p.x - d.dx * halfW * 2, p.y - d.dy * halfW * 2, tx, ty);
      g.addColorStop(0, hexA(col, 0.7));
      g.addColorStop(1, hexA(col, 0.04));
      ctx.strokeStyle = g;
      ctx.lineWidth = halfW * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x - d.dx * halfW, p.y - d.dy * halfW);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      drawChevron(tx, ty, d.dx, d.dy, Math.max(6, len * 0.2), alpha, hexA(col, 0.9));
      ctx.restore();
    };
    // Fading ghost trail behind the marker (the path it already travelled).
    const drawTrail = (o, p, zoom) => {
      const d = motionDir(o);
      const step = (2 + 4 * Math.log10((o.motion || 1) + 2)) * (0.7 + zoom * 0.04);
      const col = typeColor(o);
      ctx.save();
      for (let i = 1; i <= 5; i++) {
        const t = i * step;
        ctx.beginPath();
        ctx.arc(p.x - d.dx * t, p.y - d.dy * t, Math.max(0.6, 2.2 - i * 0.3), 0, Math.PI * 2);
        ctx.fillStyle = hexA(col, markerAlpha(o) * (0.24 - i * 0.04));
        ctx.fill();
      }
      ctx.restore();
    };
    // Faceted "rock" hexagon used for asteroid markers.
    const rockHexagon = (x, y, s, col, alpha, sel) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = hexA(col, sel ? 1 : 0.85);
      ctx.lineWidth = sel ? 2 : 1.2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 11;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2 + (sel ? 0.35 : 0);
        const px = x + Math.cos(a) * s;
        const py = y + Math.sin(a) * s;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = hexA(col, 0.95);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.6, s * 0.42), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

// Draw a single candidate marker (redesigned to the warm HUD theme):
    //   - Icy Body (TNO) -> soft glowing planet + faint band rings
    //   - Asteroid (AST) -> faceted "rock" hexagon
    //   - Fast Star (HPM) -> streaking comet with a backward tail
    // Confirmed detections gain a green ring; opacity = confidence / brush.
    const drawMarker = (o, p, size) => {
      const sel = selRef.current === o.id;
      const col = typeColor(o);
      const alpha = markerAlpha(o);
      const confirmed = o.status === 'confirmed';
      const k = sel ? 1.9 : 1.35; // selected marker grows

      ctx.save();
      ctx.globalAlpha = Math.max(alpha, 0.2);

      if (o.type === 'HPM') {
        const d = motionDir(o);
        const s = size * k;
        const head = Math.max(2.6, s * 0.6);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, head);
        grad.addColorStop(0, hexA(col, 0.98));
        grad.addColorStop(0.55, hexA(col, 0.55));
        grad.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = grad;
        ctx.shadowColor = col;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, head, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // slender tapered tail behind the head (direction it's come from)
        const tail = head * 2.8;
        ctx.strokeStyle = hexA(col, 0.6);
        ctx.lineWidth = Math.max(1, head * 0.34);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - d.dx * tail, p.y - d.dy * tail);
        ctx.stroke();
      } else if (o.type === 'AST') {
        rockHexagon(p.x, p.y, size * k, col, alpha, sel);
      } else {
        // Icy body: soft planet-like disc + one faint ring per detected band.
        const rings = Math.max(1, Math.min(6, o.nBands || 1));
        const rCore = Math.max(2.2, size * 0.7 * k);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rCore);
        grad.addColorStop(0, hexA(col, 0.98));
        grad.addColorStop(1, hexA(col, 0.3));
        ctx.fillStyle = grad;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rCore, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = hexA(col, confirmed ? 0.9 : 0.5);
        for (let i = 1; i <= rings; i++) {
          ctx.lineWidth = sel ? 2 : 1;
          ctx.setLineDash(confirmed ? [] : [2.5, 3]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * (0.85 + 0.42 * i) * k, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Green confirmation ring for confirmed detections (status at a glance).
      if (confirmed) {
        ctx.strokeStyle = CONFIRMED;
        ctx.globalAlpha = Math.max(alpha, 0.4);
        ctx.lineWidth = sel ? 2.2 : 1.1;
        ctx.setLineDash([3, 4]);
        ctx.shadowColor = CONFIRMED;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * (sel ? 2.4 : 1.9), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
      }
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

    // --- 3D celestial sphere -------------------------------------------------
    // A dependency-free rotatable orthographic globe of the whole sky. RA/Dec is
    // lifted onto the unit sphere, spun by a view rotation, then projected
    // orthographically (visible hemisphere = front-facing points, z > 0).
    const sphereGeom = () => {
      const w = W();
      const h = H();
      const cx = w / 2;
      const cy = h / 2;
      const Rbase = Math.min(w, h) * 0.44;
      const zoomF = Math.pow(1.035, (state.current.zoom || 4) - 4);
      const R = Math.max(Rbase * 0.3, Math.min(Rbase * 1.6, Rbase * zoomF));
      if (!state.current.v3) state.current.v3 = { raC: 0, decC: 0 };
      const rot = viewRotation(state.current.v3.raC, state.current.v3.decC);
      return { cx, cy, R, rot };
    };
    const sphereProject = (s, ra, dec) => {
      const p3 = applyViewRotation(raDecToVector(ra, dec), s.rot);
      return { x: s.cx + p3.x * s.R, y: s.cy - p3.y * s.R, z: p3.z };
    };

    const drawSphere = (w, h) => {
      const s = sphereGeom();
      const cx = s.cx; const cy = s.cy; const R = s.R;

      // ambient body + crisp amber rim so the sphere reads as a rotating globe
      const body = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
      body.addColorStop(0, 'rgba(22,15,6,0.92)');
      body.addColorStop(0.7, 'rgba(8,7,9,0.96)');
      body.addColorStop(1, 'rgba(32,16,4,0.98)');
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,106,0,0.5)';
      ctx.lineWidth = 1.2;
      ctx.shadowColor = 'rgba(255,106,0,0.45)';
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      // stroke a 3D polyline, drawing only front-hemisphere segments
      const strokePath3D = (pts) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]; const b = pts[i + 1];
          if (a.z <= 0.02 || b.z <= 0.02) continue;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      };

      // RA meridians every 30°, Dec parallels every 30° (graticule)
      ctx.save();
      ctx.strokeStyle = 'rgba(255,175,90,0.15)';
      ctx.lineWidth = 1;
      for (let ra = 0; ra < 360; ra += 30) {
        const pts = [];
        for (let dec = -90; dec <= 90; dec += 7.5) pts.push(sphereProject(s, ra, dec));
        strokePath3D(pts);
      }
      for (let dec = -60; dec <= 60; dec += 30) {
        const pts = [];
        for (let ra = 0; ra <= 360; ra += 10) pts.push(sphereProject(s, ra, dec));
        strokePath3D(pts);
      }
      ctx.restore();

      // Ecliptic ring (dashed warm line) — where the Solar-System movers cluster
      const ecliptic = [];
      for (let ra = 0; ra <= 360; ra += 6) {
        const dec = Math.asin(Math.sin(23.44 * DEG_RAD) * Math.sin(ra * DEG_RAD)) / DEG_RAD;
        ecliptic.push(sphereProject(s, ra, dec));
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(255,196,54,0.5)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.1;
      strokePath3D(ecliptic);
      ctx.restore();

      // background stars on the globe (front hemisphere), twinkling subtly
      ctx.save();
      for (const st of SPHERE_STARS) {
        const p = sphereProject(s, st.ra, st.dec);
        if (p.z <= 0.03) continue;
        const rr = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
        if (rr > R * R) continue;
        const magA = Math.max(0.06, 1.1 - st.mag / 18);
        ctx.fillStyle = `rgba(255,236,205,${magA * (0.3 + 0.7 * p.z)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, st.mag < 6 ? 1.4 : st.mag < 12 ? 0.9 : 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // candidate markers on the front hemisphere, scaled by closeness
      const zoom = state.current.zoom;
      for (const o of objects) {
        const p = sphereProject(s, o.ra, o.dec);
        if (p.z <= 0.12) continue;
        const rr = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
        if (rr > R * R) continue;
        const near = 0.35 + 0.65 * p.z;
        const size = (3.2 + Math.min(10, (o.motion || 0) / 28)) * (0.7 + zoom * 0.16) * near;
        ctx.save();
        ctx.globalAlpha = markerAlpha(o) * (0.45 + 0.55 * p.z);
        drawMarker(o, p, size);
        ctx.restore();
      }

      // north pole label when it's on the front side
      const np = sphereProject(s, 0, 90);
      if (np.z > 0.1) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,196,54,0.85)';
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('N', np.x, np.y - 5);
        ctx.restore();
      }

      if (state.current.v3) {
        ctx.save();
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,200,140,0.65)';
        ctx.fillText('SPHERE · 3D — drag to rotate', 12, 34);
        ctx.restore();
      }
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
      if (MODE === '3d') {
        const s = sphereGeom();
        const zoom = state.current.zoom;
        for (let i = objects.length - 1; i >= 0; i--) {
          const o = objects[i];
          const p = sphereProject(s, o.ra, o.dec);
          if (p.z <= 0.12) continue;
          const rr = (p.x - s.cx) * (p.x - s.cx) + (p.y - s.cy) * (p.y - s.cy);
          if (rr > s.R * s.R) continue;
          const near = 0.35 + 0.65 * p.z;
          const size = (3.2 + Math.min(10, o.motion / 28)) * (0.7 + zoom * 0.16) * near;
          if (mx > p.x - size - 4 && mx < p.x + size + 4 && my > p.y - size - 4 && my < p.y + size + 4) return o;
        }
        return null;
      }
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
      state.current.drag = {
        x: e.clientX, y: e.clientY,
        cx: state.current.cx, cy: state.current.cy,
        raC: state.current.v3 ? state.current.v3.raC : 0,
        decC: state.current.v3 ? state.current.v3.decC : 0,
      };
      // For the sphere, capture the pointer so rotation stays smooth off-canvas.
      if (MODE === '3d' && e.pointerId !== undefined && canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
    };
    const onMove = (e) => {
      const { mx, my } = toCanvas(e);
      if (state.current.drag) {
        const dx = e.clientX - state.current.drag.x;
        const dy = e.clientY - state.current.drag.y;
        if (MODE === '3d') {
          // Spin the globe: drag right/toward bottom = RA↑ / Dec↓ (mirrors map).
          const v = state.current.v3 || (state.current.v3 = { raC: 0, decC: 0 });
          v.raC = (((state.current.drag.raC + dx * 0.22) % 360) + 360) % 360;
          v.decC = Math.max(-85, Math.min(85, state.current.drag.decC + dy * 0.22));
          draw();
        } else {
          state.current.cx = state.current.drag.cx - (dx / W()) / state.current.zoom;
          state.current.cy = state.current.drag.cy - (dy / H()) / state.current.zoom;
          clamp();
          draw();
        }
      }
      const obj = hitTest(mx, my);
      const overlay = toOverlay(e);
      setHover(obj ? { name: obj.name, type: obj.type, x: overlay.x, y: overlay.y } : null);
      if (MODE === '3d' && state.current.v3) {
        setReadout(`${fmtRA(state.current.v3.raC)}  ${fmtDec(state.current.v3.decC)}  SPHERE`);
      } else {
        const { nx, ny } = toWorld(mx, my);
        const { ra, dec } = normalizedToRaDec(nx, ny, field);
        setReadout(`${fmtRA(ra)}  ${fmtDec(dec)}  zoom ×${state.current.zoom.toFixed(1)}`);
      }
    };
    const onUp = () => { state.current.drag = null; };
    const onWheel = (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      state.current.zoom = Math.min(120, Math.max(1, state.current.zoom * f));
      if (MODE !== '3d') clamp();
      draw();
    };
    const onClick = (e) => {
      const { mx, my } = toCanvas(e);
      const obj = hitTest(mx, my);
      if (obj) onSelect(obj);
    };
    const onLeave = () => setHover(null);
    const clamp = () => {
      // Whole-sky map: cx/cy in [0,1] already span the full celestial sphere
      // (RA wraps ±180°, Dec −90..+90°), so roaming is never boxed into a patch.
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
      if (cmd === 'reset') {
        state.current = {
          cx: 0.5, cy: 0.5, zoom: (initialZoom || 1), drag: null,
          v3: { raC: 0, decC: 0 }, _mode: state.current._mode,
        };
        draw();
      }
      if (cmd && cmd.mode === 'focus') {
        const { ra, dec, zoom } = cmd;
        const { nx, ny } = raDecToNormalized(ra, dec, field);
        state.current.cx = Math.min(1, Math.max(0, nx));
        state.current.cy = Math.min(1, Math.max(0, ny));
        state.current.zoom = Math.min(120, Math.max(1, zoom || 3));
        state.current.v3 = { raC: ra, decC: Math.max(-85, Math.min(85, dec)) }; // sphere + map both point here
        state.current.drag = null;
        draw();
      }
    };

    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        state.current.drag = {
          x: t.clientX, y: t.clientY,
          cx: state.current.cx, cy: state.current.cy,
          raC: state.current.v3 ? state.current.v3.raC : 0,
          decC: state.current.v3 ? state.current.v3.decC : 0,
        };
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 1 && state.current.drag) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - state.current.drag.x;
        const dy = t.clientY - state.current.drag.y;
        if (MODE === '3d') {
          const v = state.current.v3 || (state.current.v3 = { raC: 0, decC: 0 });
          v.raC = (((state.current.drag.raC + dx * 0.22) % 360) + 360) % 360;
          v.decC = Math.max(-85, Math.min(85, state.current.drag.decC + dy * 0.22));
          draw();
        } else {
          state.current.cx = state.current.drag.cx - (dx / W()) / state.current.zoom;
          state.current.cy = state.current.drag.cy - (dy / H()) / state.current.zoom;
          clamp();
          draw();
        }
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
    // Seamless toggle between MAP 2D and SPHERE 3D: keep both views centred on
    // the same patch so flicking between them never re-orients the user.
    if (state.current._mode !== MODE) {
      if (MODE === '3d') {
        if (!state.current.v3) {
          const { ra, dec } = normalizedToRaDec(state.current.cx, state.current.cy, field);
          state.current.v3 = { raC: ra, decC: dec };
        }
      } else if (state.current.v3) {
        const { nx, ny } = raDecToNormalized(state.current.v3.raC, state.current.v3.decC, field);
        state.current.cx = Math.min(1, Math.max(0, nx));
        state.current.cy = Math.min(1, Math.max(0, ny));
      }
      state.current._mode = MODE;
      draw();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);

    return () => {
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
  }, [objects, field, selRef, onSelect, onView, initialZoom, canvasRef, wrapRef, highlight, mode, onModeChange]);
  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="sky-canvas" />
      <div className={`sky-legend${mode === '3d' ? ' sphere' : ''}`} title="Candidate classes flagged by the survey">
        {Object.entries(TYPE_COLORS).map(([t, c]) => (
          <span className="sky-legend-item" key={t}>
            <span className="sky-legend-glyph" style={{ color: c, textShadow: `0 0 6px ${c}` }}>{TYPE_GLYPHS[t]}</span>
            {TYPE_NAMES[t] || t}
          </span>
        ))}
        <span className="sky-legend-note">
          {mode === '3d'
            ? 'drag to spin · green ring = confirmed · tail / streak = direction'
            : 'shape = class · wake = direction · green ring = confirmed'}
        </span>
      </div>
      {hover && (
        <div className="hover-tip" style={{ left: Math.min(hover.x + 18, (wrapRef.current ? wrapRef.current.clientWidth : 200) - 140), top: hover.y - 6 }}>
          <strong>{hover.name}</strong> · {TYPE_NAMES[hover.type] || hover.type}
        </div>
      )}
      <div className="readout">{readout}</div>
    </div>
  );
}
