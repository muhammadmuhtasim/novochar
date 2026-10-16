import React, { useEffect, useRef, useState } from 'react';

import { projectGraticuleLine } from '../lib/observe/graticule.js';
import { pickAt } from '../lib/observe/scene.js';

// Mode B — Observe: the 2D half of the linked sky. This component is a thin
// canvas renderer over a shared observe scene: it owns no astronomy. Coordinates
// come from the scene's projection (frame-neutral `forward`), the view frame from
// the scene's frame adapter, and picking from the scene's plane index. Selection
// is the scene's stable record id, shared with the 3D sphere and the rest of the
// app, so the two views can never disagree about *which* object is selected.

const MARGIN_PX = 16;
const PICK_RADIUS_PX = 7;
const DRAG_SLOP_PX = 4;
const GRATICULE_STEP_DEG = 30;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 40;

/** Draw size from magnitude: brighter (smaller V) draws larger. */
function magnitudeRadius(mag) {
  if (!Number.isFinite(mag)) return 1.5;
  return Math.max(1.1, Math.min(5.5, 4.6 - mag * 0.55));
}

function fmtMag(mag) {
  return Number.isFinite(mag) ? `V ${mag.toFixed(2)}` : 'V —';
}

export default function ObserveMap2D({ scene, selectedId = null, onSelect = () => {} }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const sceneRef = useRef(scene);
  const selectedRef = useRef(selectedId);
  const cameraRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const redrawRef = useRef(() => {});
  const [hover, setHover] = useState(null);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  // A new scene (frame / catalogue change) resets the view and the hover state.
  useEffect(() => {
    sceneRef.current = scene;
    cameraRef.current = { zoom: 1, panX: 0, panY: 0 };
    setHover(null);
    redrawRef.current();
  }, [scene]);

  useEffect(() => {
    selectedRef.current = selectedId;
    redrawRef.current();
  }, [selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');

    let width = 1;
    let height = 1;
    let dpr = 1;

    const view = () => {
      const s = sceneRef.current;
      const bounds = s?.projection?.bounds ?? { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
      const spanX = bounds.xMax - bounds.xMin;
      const spanY = bounds.yMax - bounds.yMin;
      const base = Math.min((width - 2 * MARGIN_PX) / spanX, (height - 2 * MARGIN_PX) / spanY);
      const { zoom, panX, panY } = cameraRef.current;
      return { cx: width / 2 + panX, cy: height / 2 + panY, scale: base * zoom, bounds };
    };
    const toScreen = (p, v) => [v.cx + p.x * v.scale, v.cy - p.y * v.scale];
    const toPlane = (sx, sy, v) => ({ x: (sx - v.cx) / v.scale, y: (v.cy - sy) / v.scale });

    const project = (lonRad, latRad) => {
      const s = sceneRef.current;
      return s.projection.forward(lonRad, latRad, { centralMeridianRad: s.centralMeridianRad });
    };

    // Stroke a sampled graticule line as its seam-split polylines, so nothing is
    // ever drawn straight across the projection seam.
    const strokeLine = (v, sample) => {
      const s = sceneRef.current;
      const polylines = projectGraticuleLine(sample, project, {
        centralMeridianRad: s.centralMeridianRad,
      });
      for (const line of polylines) {
        if (line.length < 2) continue;
        ctx.beginPath();
        line.forEach((p, index) => {
          const [sx, sy] = toScreen(p, v);
          if (index === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }
    };

    const drawGraticule = (v) => {
      const deg = Math.PI / 180;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      for (let lat = -60; lat <= 60; lat += GRATICULE_STEP_DEG) {
        const sample = [];
        for (let lon = 0; lon <= 360; lon += 3) sample.push([lon * deg, lat * deg]);
        strokeLine(v, sample);
      }
      for (let lon = 0; lon < 360; lon += GRATICULE_STEP_DEG) {
        const sample = [];
        for (let lat = -90; lat <= 90; lat += 3) sample.push([lon * deg, lat * deg]);
        strokeLine(v, sample);
      }
      ctx.strokeStyle = 'rgba(255,158,90,0.22)';
      const equator = [];
      for (let lon = 0; lon <= 360; lon += 3) equator.push([lon * deg, 0]);
      strokeLine(v, equator);
      ctx.restore();
    };

    const draw = () => {
      const s = sceneRef.current;
      if (!s) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#040406';
      ctx.fillRect(0, 0, width, height);

      const v = view();
      drawGraticule(v);

      // Whole-sky ellipse boundary from the projection's own extent.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,140,80,0.6)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.ellipse(v.cx, v.cy, v.bounds.xMax * v.scale, v.bounds.yMax * v.scale, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const selected = selectedRef.current;
      for (const point of s.points) {
        const [sx, sy] = toScreen(point, v);
        if (sx < -12 || sy < -12 || sx > width + 12 || sy > height + 12) continue;
        const r = magnitudeRadius(point.record.mag);
        const isSelected = point.id === selected;
        ctx.beginPath();
        ctx.fillStyle = isSelected ? '#ffe0bd' : 'rgba(178,216,255,0.9)';
        ctx.arc(sx, sy, isSelected ? r + 1.4 : r, 0, Math.PI * 2);
        ctx.fill();
        if (isSelected) {
          ctx.beginPath();
          ctx.strokeStyle = '#ff7a2a';
          ctx.lineWidth = 1.5;
          ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };
    redrawRef.current = draw;

    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;

    const localPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const pickRecordAtScreen = (px, py) => {
      const s = sceneRef.current;
      const v = view();
      const { x, y } = toPlane(px, py, v);
      return pickAt(s, x, y, PICK_RADIUS_PX / v.scale);
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      lastX = startX = event.clientX;
      lastY = startY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
      canvas.classList.add('is-dragging');
    };

    const onPointerMove = (event) => {
      if (dragging) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > DRAG_SLOP_PX) moved = true;
        if (moved) {
          cameraRef.current.panX += dx;
          cameraRef.current.panY += dy;
          draw();
        }
        return;
      }
      const { x, y } = localPoint(event);
      const record = pickRecordAtScreen(x, y);
      setHover(record ? { id: record.id, name: record.name || record.id, mag: record.mag, x, y } : null);
    };

    const onPointerUp = (event) => {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove('is-dragging');
      canvas.releasePointerCapture?.(event.pointerId);
      if (moved) return;
      const { x, y } = localPoint(event);
      const record = pickRecordAtScreen(x, y);
      onSelectRef.current(record ? record.id : null);
    };

    const onPointerCancel = () => {
      dragging = false;
      canvas.classList.remove('is-dragging');
    };

    const onPointerLeave = () => setHover(null);

    const onWheel = (event) => {
      event.preventDefault();
      const { x: px, y: py } = localPoint(event);
      const before = toPlane(px, py, view());
      const factor = Math.exp(-event.deltaY * 0.0015);
      cameraRef.current.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cameraRef.current.zoom * factor));
      const v = view();
      // Keep the plane point under the cursor fixed while zooming.
      cameraRef.current.panX += px - (v.cx + before.x * v.scale);
      cameraRef.current.panY += py - (v.cy - before.y * v.scale);
      draw();
    };

    const onDoubleClick = () => {
      cameraRef.current = { zoom: 1, panX: 0, panY: 0 };
      draw();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, []);

  return (
    <div className="canvas-wrap observe-map" ref={wrapRef}>
      <canvas ref={canvasRef} className="sky-canvas" aria-label="Mollweide sky map" />
      {hover && (
        <div className="hover-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <strong>{hover.name}</strong> · {fmtMag(hover.mag)}
        </div>
      )}
      <div className="readout">MOLLWEIDE · drag to pan · scroll to zoom · click to select</div>
    </div>
  );
}
