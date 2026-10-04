import React, { useRef, useState } from 'react';

const W = 440; const H = 300;
const PAD = { l: 46, r: 14, t: 20, b: 38 };

/**
 * A small brushable SVG scatter used by the linked-analysis panel. Dragging
 * draws a rectangle and emits the ids inside it via `onBrush` (empty Set to
 * clear); clicking a single point picks it via `onPick`; clicking empty clears
 * the brush. Points in `highlightIds` are ringed so each view echoes the
 * current linked selection.
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
  const svgRef = useRef(null);
  const drag = useRef(null);
  const [rect, setRect] = useState(null);

  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!valid.length) {
    return (
      <div className="scatter panel-sub">
        <div className="panel-head"><h3>{title}</h3></div>
        <p className="muted empty">No points in this projection.</p>
      </div>
    );
  }

  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  let xmin = Math.min(...xs); let xmax = Math.max(...xs);
  let ymin = Math.min(...ys); let ymax = Math.max(...ys);
  if (xmin === xmax) { xmin -= 1; xmax += 1; }
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const px = (xmax - xmin) * 0.06; const py = (ymax - ymin) * 0.06;
  xmin -= px; xmax += px; ymin -= py; ymax += py;

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const toXY = (x, y) => ({
    cx: PAD.l + ((x - xmin) / (xmax - xmin)) * plotW,
    cy: PAD.t + (1 - (y - ymin) / (ymax - ymin)) * plotH,
  });

  const toLocal = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  const idAt = (px, py) => {
    let best = null; let bestD = Infinity;
    valid.forEach((p) => {
      const { cx, cy } = toXY(p.x, p.y);
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = p; }
    });
    return bestD < 14 ? best : null;
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
      valid.forEach((pt) => {
        const { cx, cy } = toXY(pt.x, pt.y);
        if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) ids.add(pt.o.id);
      });
      onBrush(ids);
    } else {
      const picked = idAt(p.x, p.y);
      if (picked) onPick(picked.o);
      else onBrush(new Set());
    }
    drag.current = null;
    setRect(null);
  };

  const ticks = (min, max, n) => Array.from({ length: n + 1 }, (_, i) => min + (i / n) * (max - min));

  return (
    <div className="scatter panel-sub">
      <div className="panel-head"><h3>{title}</h3></div>
      <svg
        ref={svgRef}
        className="scatter-svg"
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!drag.current) setRect(null); }}
      >
        {/* gridlines + axis ticks */}
        {ticks(ymin, ymax, 4).map((y, i) => {
          const { cy } = toXY(xmin, y);
          return <line key={i} x1={PAD.l} y1={cy} x2={W - PAD.r} y2={cy} className="scatter-grid" />;
        })}
        {ticks(xmin, xmax, 4).map((x, i) => {
          const { cx } = toXY(x, ymin);
          return <line key={i} x1={cx} y1={PAD.t} x2={cx} y2={H - PAD.b} className="scatter-grid" />;
        })}
        {ticks(ymin, ymax, 4).map((y, i) => {
          const { cy } = toXY(xmin, y);
          return (
            <text key={`ty${i}`} x={PAD.l - 6} y={cy + 3} textAnchor="end" className="scatter-tick">
              {y.toFixed(1)}
            </text>
          );
        })}
        {ticks(xmin, xmax, 4).map((x, i) => {
          const { cx } = toXY(x, ymin);
          return (
            <text key={`tx${i}`} x={cx} y={H - PAD.b + 16} textAnchor="middle" className="scatter-tick">
              {x.toFixed(1)}
            </text>
          );
        })}

        {/* points */}
        {valid.map((pt) => {
          const { cx, cy } = toXY(pt.x, pt.y);
          const sel = selectedId === pt.o.id;
          const hi = highlightIds && highlightIds.has(pt.o.id);
          const dimmed = highlightIds && highlightIds.size > 0 && !hi && !sel;
          return (
            <g key={pt.o.id}>
              {sel && <circle cx={cx} cy={cy} r={8} className="scatter-halo" />}
              <circle
                cx={cx} cy={cy} r={sel ? 5 : hi ? 4.5 : 3.4}
                fill={pt.color}
                className={dimmed ? 'scatter-pt dim' : 'scatter-pt'}
                stroke={hi ? '#fff' : 'rgba(0,0,0,0.4)'}
                strokeWidth={hi ? 1.4 : 0.6}
              />
            </g>
          );
        })}

        {/* brush rectangle */}
        {rect && (
          <rect
            x={Math.min(rect.x1, rect.x2)} y={Math.min(rect.y1, rect.y2)}
            width={Math.abs(rect.x2 - rect.x1)} height={Math.abs(rect.y2 - rect.y1)}
            className="scatter-brush"
          />
        )}

        <text x={W / 2} y={H - 6} textAnchor="middle" className="scatter-axis">{xLabel}</text>
        <text x={-H / 2} y={14} textAnchor="middle" transform="rotate(-90)" className="scatter-axis">{yLabel}</text>
      </svg>
      {highlightIds && highlightIds.size > 0 && (
        <p className="muted caption">
          Linking {highlightIds.size} object{highlightIds.size > 1 ? 's' : ''} — click empty space to clear the brush.
        </p>
      )}
    </div>
  );
}