import React, { useEffect, useRef, useState } from 'react';

const PADL = 46; const PADR = 14; const PADT = 20; const PADB = 38;

/**
 * A brushable canvas scatter used by the linked-analysis panel. Dragging draws
 * a rectangle and emits the ids inside it via `onBrush` (empty Set to clear);
 * clicking a single point picks it via `onPick`; clicking empty clears the
 * brush. Points in `highlightIds` are ringed so each view echoes the current
 * linked selection. Rendered as its own <canvas> (one per SkyView analysis view).
 */
export default function ScatterPlot({
  title,
  xLabel,
  yLabel,
  points = [], // [{ o, x, y, color }]  (x/y must be finite)
  selectedId = null,
  highlightIds = null, // Set or null
  onPick = () => {},
  onBrush = () => {},
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const drag = useRef(null);
  const drawRef = useRef(null);
  const projRef = useRef(null);
  const propsRef = useRef({ points, selectedId, highlightIds, onPick, onBrush });
  const rectRef = useRef(null);
  const [rect, setRect] = useState(null);

  propsRef.current = { points, selectedId, highlightIds, onPick, onBrush };
  rectRef.current = rect;

  // Build + draw on the canvas whenever props or the brush rect change.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 24 || h < 24) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const { points, selectedId, highlightIds } = propsRef.current;
      const all = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

      ctx.fillStyle = '#06070b';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;

      if (!all.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '12px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No points in this projection.', w / 2, h / 2);
        return;
      }

      let xmin = Infinity; let xmax = -Infinity; let ymin = Infinity; let ymax = -Infinity;
      for (const p of all) {
        xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
        ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
      }
      if (xmin === xmax) { xmin -= 1; xmax += 1; }
      if (ymin === ymax) { ymin -= 1; ymax += 1; }
      const px = (xmax - xmin) * 0.06; const py = (ymax - ymin) * 0.06;
      xmin -= px; xmax += px; ymin -= py; ymax += py;

      const plotW = w - PADL - PADR;
      const plotH = h - PADT - PADB;
      const X = (x) => PADL + ((x - xmin) / (xmax - xmin)) * plotW;
      const Y = (y) => PADT + (1 - (y - ymin) / (ymax - ymin)) * plotH;
      projRef.current = { all, X, Y };

      for (let i = 0; i <= 4; i++) {
        const gx = X(xmin + (i / 4) * (xmax - xmin));
        ctx.beginPath(); ctx.moveTo(gx, PADT); ctx.lineTo(gx, h - PADB); ctx.stroke();
        const gy = Y(ymin + (i / 4) * (ymax - ymin));
        ctx.beginPath(); ctx.moveTo(PADL, gy); ctx.lineTo(w - PADR, gy); ctx.stroke();
      }
      ctx.fillStyle = '#888d98';
      ctx.font = '10px "Share Tech Mono", monospace';
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i <= 4; i++) {
        const vx = xmin + (i / 4) * (xmax - xmin);
        ctx.textAlign = 'center';
        ctx.fillText(vx.toFixed(1), X(vx), h - PADB + 16);
        const vy = ymin + (i / 4) * (ymax - ymin);
        ctx.textAlign = 'right';
        ctx.fillText(vy.toFixed(1), PADL - 6, Y(vy) + 3);
      }

      ctx.fillStyle = '#9aa0aa';
      ctx.font = '11px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(xLabel, w / 2, h - 6);
      ctx.save();
      ctx.translate(13, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();

      const hiOn = highlightIds && highlightIds.size > 0;
      for (const p of all) {
        const sx = X(p.x); const sy = Y(p.y);
        const sel = selectedId === p.o.id;
        const hi = hiOn && highlightIds.has(p.o.id);
        const dim = hiOn && !hi && !sel;
        if (sel) {
          ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#ff6a00'; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.globalAlpha = dim ? 0.18 : 0.95;
        ctx.beginPath(); ctx.arc(sx, sy, sel ? 5 : hi ? 4.5 : 3.4, 0, Math.PI * 2);
        ctx.fillStyle = p.color; ctx.fill();
        if (hi) { ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke(); }
        ctx.globalAlpha = 1;
      }

      const r = rectRef.current;
      if (r) {
        const bx = Math.min(r.x1, r.x2); const by = Math.min(r.y1, r.y2);
        const bw = Math.abs(r.x2 - r.x1); const bh = Math.abs(r.y2 - r.y1);
        ctx.fillStyle = 'rgba(255,106,0,0.12)';
        ctx.strokeStyle = '#ff6a00';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
      }
    };

    drawRef.current = draw;
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => { ro.disconnect(); drawRef.current = null; };
  }, [points, selectedId, highlightIds, rect]);

  const toLocal = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const idAt = (px, py) => {
    const proj = projRef.current;
    if (!proj) return null;
    let best = null; let bestD = Infinity;
    for (const p of proj.all) {
      const d = Math.hypot(proj.X(p.x) - px, proj.Y(p.y) - py);
      if (d < bestD) { bestD = d; best = p; }
    }
    return bestD < 14 ? best.o : null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    drag.current = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    setRect(drag.current);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const p = toLocal(e);
    drag.current.x2 = p.x; drag.current.y2 = p.y;
    setRect({ ...drag.current });
  };
  const onPointerUp = (e) => {
    if (!drag.current) return;
    const p = toLocal(e);
    const x1 = Math.min(drag.current.x1, p.x); const x2 = Math.max(drag.current.x1, p.x);
    const y1 = Math.min(drag.current.y1, p.y); const y2 = Math.max(drag.current.y1, p.y);
    const moved = Math.abs(x2 - x1) + Math.abs(y2 - y1) > 5;
    if (moved) {
      const ids = new Set();
      const proj = projRef.current;
      if (proj) {
        for (const pt of proj.all) {
          const sx = proj.X(pt.x); const sy = proj.Y(pt.y);
          if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) ids.add(pt.o.id);
        }
      }
      propsRef.current.onBrush(ids);
    } else {
      const picked = idAt(p.x, p.y);
      if (picked) propsRef.current.onPick(picked);
      else propsRef.current.onBrush(new Set());
    }
    drag.current = null;
    setRect(null);
  };

  return (
    <div className="scatter panel-sub">
      <div className="panel-head"><h3>{title}</h3></div>
      <div className="scatter-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="scatter-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { if (!drag.current) setRect(null); }}
        />
      </div>
      {highlightIds && highlightIds.size > 0 && (
        <p className="muted caption">
          Linking {highlightIds.size} object{highlightIds.size > 1 ? 's' : ''} — click empty space to clear the brush.
        </p>
      )}
    </div>
  );
}
