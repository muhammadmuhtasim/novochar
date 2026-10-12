import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { ProceduralWorld } from '../lib/world3d.js';
import { FreeFlightControls } from '../lib/controls3d.js';

const fmt = (n) => (n < 0 ? '−' : '') + Math.abs(n).toFixed(1).padStart(5, '0');

/**
 * Immersive 3D wireframe space view, embedded in the SkyViewer panel.
 * Uses Three.js (CDN), ProceduralWorld for infinite sectors, and
 * FreeFlightControls for 6DoF pointer-locked flight.
 */
export default function Space3DCanvas() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef(null); // holds renderer/scene/world/controls for cleanup

  const [coords, setCoords] = useState({ x: '000.0', y: '000.0', z: '000.0' });
  const [fps, setFps] = useState('--');
  const [sectors, setSectors] = useState(27);
  const [status, setStatus] = useState('WORLD ONLINE');
  const [controlsOpen, setControlsOpen] = useState(true);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(stateRef.current?._toastTimer);
    if (stateRef.current) {
      stateRef.current._toastTimer = setTimeout(() => setToast(''), 1900);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // ── Scene ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.FogExp2(0x050505, 0.00125);

    // ── Camera ──
    const camera = new THREE.PerspectiveCamera(76, wrap.clientWidth / wrap.clientHeight, 0.08, 900);
    camera.position.set(0, 0, 0);
    camera.rotation.order = 'YXZ';

    // ── World & Controls ──
    const world = new ProceduralWorld(scene, { sectorSize: 72, viewRadius: 1 });
    const controls = new FreeFlightControls(camera, canvas);
    world.update(camera.position);

    // ── HUD update state ──
    let previous = performance.now(), elapsed = 0, frames = 0;
    let animId = null;
    let disposed = false;

    const ref = { renderer, scene, camera, world, controls, _toastTimer: null };
    stateRef.current = ref;

    // ── Resize ──
    const resize = () => {
      if (disposed) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    // ── Pointer lock events ──
    const onLockChange = () => {
      const locked = document.pointerLockElement === canvas;
      setStatus(locked ? 'FLIGHT ACTIVE' : 'WORLD ONLINE');
      if (locked) showToast('FLIGHT CONTROL ENABLED');
    };
    const onCanvasClick = () => {
      if (document.pointerLockElement !== canvas) showToast('CLICK TO CAPTURE POINTER · ESC TO RELEASE');
    };
    document.addEventListener('pointerlockchange', onLockChange);
    canvas.addEventListener('click', onCanvasClick);

    // ── Animation loop ──
    const animate = (now) => {
      if (disposed) return;
      animId = requestAnimationFrame(animate);
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      elapsed += dt;
      frames++;

      controls.update(dt);
      const sc = world.update(camera.position);
      renderer.render(scene, camera);

      if (elapsed >= 0.25) {
        const f = Math.round(frames / elapsed);
        setFps(String(f));
        setCoords({ x: fmt(camera.position.x), y: fmt(camera.position.y), z: fmt(camera.position.z) });
        setSectors(sc);
        elapsed = 0;
        frames = 0;
      }
    };
    animId = requestAnimationFrame(animate);

    // ── Cleanup ──
    return () => {
      disposed = true;
      cancelAnimationFrame(animId);
      clearTimeout(ref._toastTimer);
      document.removeEventListener('pointerlockchange', onLockChange);
      canvas.removeEventListener('click', onCanvasClick);
      ro.disconnect();
      controls.dispose();
      world.dispose();
      renderer.dispose();
      stateRef.current = null;
    };
  }, [showToast]); // showToast is stable (useCallback []), so this runs once per mount

  return (
    <div className="space3d-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="space3d-canvas" aria-label="Interactive 3D wireframe space" />

      {/* ── HUD overlay ── */}
      <div className="space3d-hud">
        {/* Top bar */}
        <div className="s3d-topbar">
          <div className="s3d-brand">
            <span className="s3d-brand-mark">◇</span>
            <span>VOID<span className="s3d-brand-sub"> / FREE SPACE</span></span>
          </div>
          <div className="s3d-meta">
            <span className="s3d-live-dot" />
            <span>{status}</span>
            <span className="s3d-sep">/</span>
            <span>{fps} FPS</span>
          </div>
        </div>

        {/* Coordinate readout */}
        <div className="s3d-readout">
          <div className="s3d-eyebrow">COORDINATES <span>·</span> FLOATING ORIGIN</div>
          <div className="s3d-coords">
            <span>{coords.x}</span><span className="s3d-sep">/</span>
            <span>{coords.y}</span><span className="s3d-sep">/</span>
            <span>{coords.z}</span>
          </div>
          <div className="s3d-readout-foot">
            <span className="s3d-pulse" />
            <span>{sectors} ACTIVE SECTORS</span>
          </div>
        </div>

        {/* Controls card */}
        {controlsOpen && (
          <div className="s3d-controls-card">
            <div className="s3d-card-head">
              <span>FLIGHT SYSTEM</span>
              <button onClick={() => setControlsOpen(false)} aria-label="Hide controls">×</button>
            </div>
            <div className="s3d-row"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Translate</span></div>
            <div className="s3d-row"><kbd>SPACE</kbd><kbd>CTRL</kbd><span>Vertical axis</span></div>
            <div className="s3d-row"><kbd>MOUSE</kbd><span>Look / pitch / yaw</span></div>
            <div className="s3d-row"><kbd>Q</kbd><kbd>E</kbd><span>Roll</span></div>
            <div className="s3d-row"><kbd>SHIFT</kbd><span>Boost velocity</span></div>
            <div className="s3d-card-foot">CLICK SCENE TO CAPTURE POINTER</div>
          </div>
        )}
        {!controlsOpen && (
          <button className="s3d-show-help" onClick={() => setControlsOpen(true)}>CONTROLS <span>＋</span></button>
        )}

        {/* Center reticle */}
        <div className="s3d-reticle" aria-hidden="true"><span /><i /></div>
        <div className="s3d-reticle-label">FREE FLIGHT <span>·</span> NO GRAVITY</div>

        {/* Bottom bar */}
        <div className="s3d-bottombar">
          <div className="s3d-bottom-left">
            <span className="s3d-key">CLICK</span> TO ENTER FLIGHT <span className="s3d-sep">/</span> <span className="s3d-key">ESC</span> TO RELEASE
          </div>
          <div className="s3d-bottom-right">
            <span className="s3d-tiny-grid">▦</span> PROCEDURAL GEOMETRY <span className="s3d-sep">/</span> NOVOCHAR
          </div>
        </div>

        {/* Toast */}
        <div className={`s3d-toast${toast ? ' show' : ''}`} role="status">{toast}</div>
      </div>
    </div>
  );
}
