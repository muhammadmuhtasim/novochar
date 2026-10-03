import React, { useEffect, useRef, useState } from 'react';
import { starField, normalizedToRaDec, raDecToNormalized } from '../lib/celestial.js';
import { fmtRA, fmtDec } from '../lib/api.js';

const STARS = starField();

export default function SkyViewerCanvas({ canvasRef, wrapRef, objects, field, selRef, onSelect }) {
  const [hover, setHover] = useState(null);
  const [readout, setReadout] = useState('');
  const state = useRef({ cx: 0.5, cy: 0.5, zoom: 1, drag: null });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
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
    const clamp = () => {
      state.current.cx = Math.min(1, Math.max(0, state.current.cx));
      state.current.cy = Math.min(1, Math.max(0, state.current.cy));
    };

    const draw = () => {
      const w = W();
      const h = H();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#050302';
      ctx.fillRect(0, 0, w, h);
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

      for (const o of objects) {
        const { nx, ny } = raDecToNormalized(o.ra, o.dec, field);
        const p = toScreen(nx, ny);
        if (p.x < -24 || p.x > w + 24 || p.y < -24 || p.y > h + 24) continue;
        const sel = selRef.current === o.id;
        const size = (3.5 + Math.min(10, o.motion / 28)) * (0.72 + state.current.zoom * 0.24);
        ctx.save();
        ctx.shadowColor = o.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = o.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * (sel ? 1.9 : 1.45), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fillStyle = o.color;
        ctx.fill();
        ctx.lineWidth = sel ? 2.6 : 1.3;
        ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,0.25)';
        ctx.stroke();
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
      setHover(obj ? { name: obj.name, type: obj.typeLabel, x: overlay.x, y: overlay.y } : null);
      const { nx, ny } = toWorld(mx, my);
      const { ra, dec } = normalizedToRaDec(nx, ny, field);
      setReadout(`${fmtRA(ra)}  ${fmtDec(dec)}  zoom ×${state.current.zoom.toFixed(1)}`);
    };
    const onUp = () => { state.current.drag = null; };
    const onWheel = (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      state.current.zoom = Math.min(60, Math.max(1, state.current.zoom * f));
      clamp();
      draw();
    };
    const onClick = (e) => {
      const { mx, my } = toCanvas(e);
      const obj = hitTest(mx, my);
      if (obj) onSelect(obj);
    };
    const onLeave = () => setHover(null);
    const resize = () => {
      const w = Math.max(2, wrap.clientWidth);
      const h = Math.max(2, wrap.clientHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      draw();
    };

    canvasRef.current.action = (cmd) => {
      if (cmd === 'reset') { state.current = { cx: 0.5, cy: 0.5, zoom: 1, drag: null }; draw(); }
      if (cmd && cmd.mode === 'focus') {
        const { ra, dec, zoom } = cmd;
        const { nx, ny } = raDecToNormalized(ra, dec, field);
        state.current.cx = Math.min(1, Math.max(0, nx));
        state.current.cy = Math.min(1, Math.max(0, ny));
        state.current.zoom = Math.min(60, Math.max(1, zoom || 3));
        state.current.drag = null;
        draw();
      }
    };

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
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onClick);
      resizeObserver.disconnect();
      if (canvasRef.current) delete canvasRef.current.action;
    };
  }, [objects, field, selRef, onSelect, canvasRef, wrapRef]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="sky-canvas" />
      {hover && (
        <div className="hover-tip" style={{ left: hover.x + 18, top: hover.y - 6 }}>
          <strong>{hover.name}</strong> · {hover.type}
        </div>
      )}
      <div className="readout">{readout}</div>
    </div>
  );
}