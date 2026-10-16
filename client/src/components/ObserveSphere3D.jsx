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

/**
 * Marker colour by distance layer, matching the 2D map: located bright cyan,
 * uncertain amber, unknown a dim neutral grey. The unknown colour is deliberately
 * muted — it is the visual counterpart of not having a distance. Falls back to
 * magnitude for records that carry no shell classification (e.g. a future source).
 */
function writeShellColor(record, target, offset) {
  const status = record?.extras?.status;
  if (status === 'located') {
    target[offset] = 0.58;
    target[offset + 1] = 0.88;
    target[offset + 2] = 1;
  } else if (status === 'uncertain') {
    target[offset] = 1;
    target[offset + 1] = 0.74;
    target[offset + 2] = 0.42;
  } else if (status === 'unknown') {
    target[offset] = 0.45;
    target[offset + 1] = 0.49;
    target[offset + 2] = 0.57;
  } else {
    writeColor(record?.mag, target, offset);
  }
}

export default function ObserveSphere3D({ scene, selectedId = null, onSelect = () => {}, shell = null }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const selectRef = useRef(onSelect);
  const sceneRef = useRef(scene);
  const selectedRef = useRef(selectedId);
  const shellRef = useRef(shell);
  sceneRef.current = scene;
  selectedRef.current = selectedId;
  shellRef.current = shell;

  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);

  // Prop changes are forwarded to the live engine (if it exists yet).
  useEffect(() => { engineRef.current?.setCatalog(scene); }, [scene]);
  useEffect(() => { engineRef.current?.setSelected(selectedId); }, [selectedId]);
  useEffect(() => { engineRef.current?.setShell(shell); }, [shell]);

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

    const pointsMaterial = new THREE.PointsMaterial({
      size: 3.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    });
    const points = new THREE.Points(new THREE.BufferGeometry(), pointsMaterial);
    view.add(points);

    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x223247, transparent: true, opacity: 0.7 });
    const grid = new THREE.LineSegments(new THREE.BufferGeometry(), gridMaterial);
    view.add(grid);

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.052, 40),
      new THREE.MeshBasicMaterial({ color: 0xff7a2a, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    marker.visible = false;
    view.add(marker);

    // Shell band: an inner and an outer wireframe bound the selected band. Both
    // stay hidden until a band arrives, so a scene without one is unchanged.
    const shellInner = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffb266, transparent: true, opacity: 0.3 }),
    );
    const shellOuter = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.35 }),
    );
    shellInner.visible = false;
    shellOuter.visible = false;
    view.add(shellInner, shellOuter);

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

    // Replacing attributes on a live geometry (e.g. with `setAttribute`) leaves
    // the previous attribute's GPU buffer allocated, because three.js frees
    // buffers per geometry on dispose, not per attribute on replacement. So every
    // rebuild swaps in a fresh geometry and disposes the one it replaces, which
    // releases its buffers.
    const replaceGeometry = (object3d, geometry) => {
      const previous = object3d.geometry;
      object3d.geometry = geometry;
      if (previous && previous !== geometry) previous.dispose();
    };

    const buildWireSphere = (radius) => {
      const deg = Math.PI / 180;
      const at = (lonDeg, latDeg) => {
        const la = latDeg * deg;
        const lo = lonDeg * deg;
        return [radius * Math.cos(la) * Math.cos(lo), radius * Math.cos(la) * Math.sin(lo), radius * Math.sin(la)];
      };
      const verts = [];
      for (let lat = -60; lat <= 60; lat += 30) {
        for (let lon = 0; lon < 360; lon += 4) verts.push(...at(lon, lat), ...at(lon + 4, lat));
      }
      for (let lon = 0; lon < 360; lon += 30) {
        for (let lat = -90; lat < 90; lat += 4) verts.push(...at(lon, lat), ...at(lon, lat + 4));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      return geometry;
    };

    let currentShell = shellRef.current ?? null;

    /**
     * Radial position for a record. A located or uncertain record with a
     * representative distance is placed at that radius (scaled so the outer band
     * sits on the reference sphere). A direction-only record has no distance and
     * stays on the surface — it is never given a fabricated radius.
     */
    const radiusFor = (record) => {
      const meta = currentShell;
      if (!meta || !(meta.rMax > 0)) return SPHERE_RADIUS;
      const status = record?.extras?.status;
      const distance = record?.extras?.distance;
      if ((status === 'located' || status === 'uncertain') && Number.isFinite(distance)) {
        return SPHERE_RADIUS * Math.max(0.03, Math.min(1.3, distance / meta.rMax));
      }
      return SPHERE_RADIUS;
    };

    const setSelected = (id) => {
      const star = id ? stars.find((s) => s.record.id === id) : null;
      if (!star) { marker.visible = false; render(); return; }
      marker.position.set(star.dir[0], star.dir[1], star.dir[2]).multiplyScalar(star.radius * 1.004);
      marker.visible = true;
      render();
    };

    const setCatalog = (nextScene) => {
      const records = nextScene?.catalog?.records ?? [];
      const positions = new Float32Array(records.length * 3);
      const colors = new Float32Array(records.length * 3);
      stars = records.map((record, index) => {
        const dir = skyDirectionOf(nextScene, record);
        const radius = radiusFor(record);
        positions[index * 3] = dir[0] * radius;
        positions[index * 3 + 1] = dir[1] * radius;
        positions[index * 3 + 2] = dir[2] * radius;
        writeShellColor(record, colors, index * 3);
        return { record, dir, radius };
      });
      const nextPoints = new THREE.BufferGeometry();
      nextPoints.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      nextPoints.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      replaceGeometry(points, nextPoints);
      replaceGeometry(grid, buildWireSphere(SPHERE_RADIUS * 1.001));
      setSelected(selectedRef.current);
    };

    /**
     * Show (or hide) the shell band. The outer wireframe sits on the reference
     * sphere; the inner one contracts by rMin/rMax. Rebuilding the point radii is
     * part of the same operation, because a record's radius depends on the band.
     */
    const setShell = (meta) => {
      currentShell = meta ?? null;
      if (!currentShell || !(currentShell.rMax > 0)) {
        shellInner.visible = false;
        shellOuter.visible = false;
      } else {
        const innerRadius = SPHERE_RADIUS * Math.max(0, Math.min(1, currentShell.rMin / currentShell.rMax));
        replaceGeometry(shellInner, buildWireSphere(innerRadius));
        replaceGeometry(shellOuter, buildWireSphere(SPHERE_RADIUS));
        shellInner.visible = innerRadius > 0.002;
        shellOuter.visible = true;
      }
      setCatalog(sceneRef.current);
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
        v.set(star.dir[0], star.dir[1], star.dir[2]).multiplyScalar(star.radius).project(camera);
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

    engineRef.current = { setCatalog, setSelected, setShell };
    updateCamera();
    resize();
    setShell(shellRef.current);
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
