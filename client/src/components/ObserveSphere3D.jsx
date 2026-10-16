import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

import { skyDirectionOf } from '../lib/observe/scene.js';

// Mode B — Observe: the 3D half of the linked sky. Like the 2D map it is a thin
// renderer over a shared observe scene and owns no astronomy: a record's unit
// direction comes from `skyDirectionOf`, which goes through the same frame
// adapter and shared vector core as the 2D map. Selection is the stable record
// id, so clicking a star here moves the marker on the Mollweide map and vice
// versa.

const PICK_RADIUS_PX = 9;
const DRAG_SLOP_PX = 5;
const ORBIT_RADIUS = 3;
const MIN_FOV = 26;
const MAX_FOV = 105;
const SPHERE_RADIUS = 1;

const MAG_KEY = (record) => (Number.isFinite(record?.mag) ? record.mag : Infinity);

/** White-hot for bright stars, dim blue for faint ones. */
function writeColor(mag, target, offset) {
  const v = Number.isFinite(mag) ? mag : 6;
  const t = Math.max(0, Math.min(1, (6 - v) / 8));
  const bright = 0.4 + 0.6 * t;
  target[offset] = bright;
  target[offset + 1] = bright * (0.9 + 0.1 * t);
  target[offset + 2] = 0.75 + 0.25 * t;
}

export default function ObserveSphere3D({ scene, selectedId = null, onSelect = () => {} }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const selectRef = useRef(onSelect);
  const sceneRef = useRef(scene);
  const selectedRef = useRef(selectedId);
  sceneRef.current = scene;
  selectedRef.current = selectedId;

  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);

  // Prop changes are forwarded to the live engine (if it exists yet).
  useEffect(() => { engineRef.current?.setCatalog(scene); }, [scene]);
  useEffect(() => { engineRef.current?.setSelected(selectedId); }, [selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const view = new THREE.Scene();
    view.background = new THREE.Color(0x02030a);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);

    const pointsGeometry = new THREE.BufferGeometry();
    const pointsMaterial = new THREE.PointsMaterial({
      size: 3.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    });
    const points = new THREE.Points(pointsGeometry, pointsMaterial);
    view.add(points);

    const gridGeometry = new THREE.BufferGeometry();
    const grid = new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: 0x223247, transparent: true, opacity: 0.7 }),
    );
    view.add(grid);

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.052, 40),
      new THREE.MeshBasicMaterial({ color: 0xff7a2a, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    marker.visible = false;
    view.add(marker);

    let yaw = 0.7;
    let pitch = 0.3;
    let stars = [];
    let width = 1;
    let height = 1;

    const updateCamera = () => {
      const cp = Math.cos(pitch);
      camera.position.set(
        ORBIT_RADIUS * cp * Math.sin(yaw),
        ORBIT_RADIUS * Math.sin(pitch),
        ORBIT_RADIUS * cp * Math.cos(yaw),
      );
      camera.lookAt(0, 0, 0);
    };

    const render = () => {
      if (marker.visible) marker.quaternion.copy(camera.quaternion);
      renderer.render(view, camera);
    };

    const buildGrid = () => {
      const deg = Math.PI / 180;
      const r = SPHERE_RADIUS * 1.001;
      const at = (lonDeg, latDeg) => {
        const la = latDeg * deg;
        const lo = lonDeg * deg;
        return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
      };
      const verts = [];
      for (let lat = -60; lat <= 60; lat += 30) {
        for (let lon = 0; lon < 360; lon += 4) verts.push(...at(lon, lat), ...at(lon + 4, lat));
      }
      for (let lon = 0; lon < 360; lon += 30) {
        for (let lat = -90; lat < 90; lat += 4) verts.push(...at(lon, lat), ...at(lon, lat + 4));
      }
      gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    };

    const setSelected = (id) => {
      const star = id ? stars.find((s) => s.record.id === id) : null;
      if (!star) { marker.visible = false; render(); return; }
      marker.position.set(star.dir[0], star.dir[1], star.dir[2]).multiplyScalar(SPHERE_RADIUS * 1.004);
      marker.visible = true;
      render();
    };

    const setCatalog = (nextScene) => {
      const records = nextScene?.catalog?.records ?? [];
      const positions = new Float32Array(records.length * 3);
      const colors = new Float32Array(records.length * 3);
      stars = records.map((record, index) => {
        const dir = skyDirectionOf(nextScene, record);
        positions[index * 3] = dir[0] * SPHERE_RADIUS;
        positions[index * 3 + 1] = dir[1] * SPHERE_RADIUS;
        positions[index * 3 + 2] = dir[2] * SPHERE_RADIUS;
        writeColor(record.mag, colors, index * 3);
        return { record, dir };
      });
      pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      buildGrid();
      setSelected(selectedRef.current);
    };

    // Nearest star to a screen position, restricted to the hemisphere facing the
    // camera. Ties break by brightness then id, matching the 2D picker's policy.
    const pickAt = (px, py) => {
      camera.updateMatrixWorld();
      const camDir = camera.position.clone().normalize();
      const limit = PICK_RADIUS_PX * PICK_RADIUS_PX;
      const v = new THREE.Vector3();
      let best = null;
      let bestD2 = Infinity;
      for (const star of stars) {
        const facing =
          star.dir[0] * camDir.x + star.dir[1] * camDir.y + star.dir[2] * camDir.z;
        if (facing <= 0.05) continue;
        v.set(star.dir[0], star.dir[1], star.dir[2]).multiplyScalar(SPHERE_RADIUS).project(camera);
        const sx = (v.x * 0.5 + 0.5) * width;
        const sy = (-v.y * 0.5 + 0.5) * height;
        const d2 = (sx - px) ** 2 + (sy - py) ** 2;
        if (d2 > limit) continue;
        if (
          best === null ||
          d2 < bestD2 ||
          (d2 === bestD2 &&
            (MAG_KEY(star.record) !== MAG_KEY(best.star.record)
              ? MAG_KEY(star.record) < MAG_KEY(best.star.record)
              : String(star.record.id) < String(best.star.record.id)))
        ) {
          best = { star, d2 };
          bestD2 = d2;
        }
      }
      return best ? best.star.record : null;
    };

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
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > DRAG_SLOP_PX) moved = true;
      if (!moved) return;
      yaw -= dx * 0.006;
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch + dy * 0.006));
      updateCamera();
      render();
    };

    const onPointerUp = (event) => {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove('is-dragging');
      if (moved) return;
      const { x, y } = localPoint(event);
      const record = pickAt(x, y);
      selectRef.current(record ? record.id : null);
    };

    const onPointerCancel = () => {
      dragging = false;
      canvas.classList.remove('is-dragging');
    };

    const onWheel = (event) => {
      event.preventDefault();
      camera.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, camera.fov + event.deltaY * 0.03));
      camera.updateProjectionMatrix();
      render();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    engineRef.current = { setCatalog, setSelected };
    updateCamera();
    buildGrid();
    resize();
    setCatalog(sceneRef.current);
    setSelected(selectedRef.current);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      view.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div className="canvas-wrap observe-sphere" ref={wrapRef}>
      <canvas ref={canvasRef} className="sky-canvas observe-sphere-canvas" aria-label="Celestial sphere (3D)" />
      <div className="readout">3D SPHERE · drag to orbit · scroll to zoom · click to select</div>
    </div>
  );
}
