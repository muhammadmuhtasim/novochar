import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { api } from '../lib/api.js';
import { raDecToSkyDirection } from '../lib/sky-coordinates.js';

const CATEGORY_COLORS = {
  TNO: '#58D9FF',
  AST: '#FFB547',
  HPM: '#D792FF',
};
const AU_PER_LIGHT_YEAR = 63241.077;
const MIN_VIEW_DISTANCE_LY = 1e-6;
const PICK_RADIUS_PX = 7;

function categoryColor(object) {
  return CATEGORY_COLORS[object.type] || object.color || '#F4F7FF';
}

function directionFromRaDec(raDeg, decDeg, radius = 100) {
  return new THREE.Vector3(...raDecToSkyDirection(raDeg, decDeg)).multiplyScalar(radius);
}

function formatRa(deg) {
  const totalSeconds = Math.round((((deg / 15) % 24 + 24) % 24) * 3600) % 86400;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function formatDec(deg) {
  const sign = deg < 0 ? '−' : '+';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′`;
}

function distanceLy(object) {
  if (object.distanceLy !== null && object.distanceLy !== undefined && object.distanceLy !== '' && Number.isFinite(Number(object.distanceLy)) && Number(object.distanceLy) >= 0) {
    return Number(object.distanceLy);
  }
  if (object.distancePc !== null && object.distancePc !== undefined && Number.isFinite(Number(object.distancePc)) && Number(object.distancePc) >= 0) {
    return Number(object.distancePc) * 3.26156;
  }
  return null;
}

function apparentCoordinates(object, epochJD) {
  const ra = Number(object.ra);
  const dec = Number(object.dec);
  const motion = Number(object.motion);
  const pa = Number(object.pa);
  const hasEpoch = object.epochOfDiscovery !== null && object.epochOfDiscovery !== undefined && Number.isFinite(Number(object.epochOfDiscovery));
  const elapsedDays = hasEpoch && Number.isFinite(epochJD)
    ? Math.max(0, epochJD - Number(object.epochOfDiscovery))
    : 0;
  if (!Number.isFinite(motion) || motion <= 0 || !Number.isFinite(pa) || elapsedDays === 0) return { ra, dec };

  const alpha = THREE.MathUtils.degToRad(ra);
  const delta = THREE.MathUtils.degToRad(dec);
  const position = new THREE.Vector3(Math.cos(delta) * Math.sin(alpha), Math.sin(delta), -Math.cos(delta) * Math.cos(alpha));
  const east = new THREE.Vector3(Math.cos(alpha), 0, Math.sin(alpha));
  const north = new THREE.Vector3(-Math.sin(delta) * Math.sin(alpha), Math.cos(delta), Math.sin(delta) * Math.cos(alpha));
  const angle = motion * elapsedDays * (Math.PI / (180 * 3600 * 1000));
  const bearing = THREE.MathUtils.degToRad(pa);
  const tangent = east.multiplyScalar(Math.sin(bearing)).add(north.multiplyScalar(Math.cos(bearing)));
  position.multiplyScalar(Math.cos(angle)).addScaledVector(tangent, Math.sin(angle)).normalize();
  return {
    ra: (THREE.MathUtils.radToDeg(Math.atan2(position.x, -position.z)) + 360) % 360,
    dec: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(position.y, -1, 1))),
  };
}

function sliderToDistance(value, maximum) {
  return MIN_VIEW_DISTANCE_LY * (maximum / MIN_VIEW_DISTANCE_LY) ** (Number(value) / 1000);
}

function distanceToSlider(distance, maximum) {
  return THREE.MathUtils.clamp(
    Math.round(1000 * Math.log(Math.max(MIN_VIEW_DISTANCE_LY, distance) / MIN_VIEW_DISTANCE_LY) / Math.log(maximum / MIN_VIEW_DISTANCE_LY)),
    0,
    1000,
  );
}

function formatDistance(distanceLy) {
  if (distanceLy < 1) return `${(distanceLy * AU_PER_LIGHT_YEAR).toPrecision(3)} AU`;
  return `${distanceLy < 10 ? distanceLy.toPrecision(3) : Math.round(distanceLy)} ly`;
}

function refreshVisibleCatalog(engine) {
  if (!engine) return;
  const camera = engine.camera;
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
  const visible = engine.catalogObjects
    .map((object) => {
      const coordinates = apparentCoordinates(object, engine.epochJD);
      return { object, coordinates, position: directionFromRaDec(coordinates.ra, coordinates.dec, 96), distance: distanceLy(object) };
    })
    .filter(({ position, distance }) => distance !== null && distance <= engine.viewRangeLy && frustum.containsPoint(position))
    .sort((a, b) => b.distance - a.distance || a.object.id.localeCompare(b.object.id))
    .slice(0, engine.maxCount);

  const geometry = engine.catalogPoints.geometry;
  const capacity = engine.catalogObjects.length;
  if (engine.catalogCapacity !== capacity) {
    geometry.dispose();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute('brightness', new THREE.BufferAttribute(new Float32Array(capacity), 1));
    engine.catalogCapacity = capacity;
  }

  const positions = geometry.attributes.position.array;
  const colors = geometry.attributes.color.array;
  const sizes = geometry.attributes.size.array;
  const brightnesses = geometry.attributes.brightness.array;
  const selectedObjects = [];
  visible.forEach(({ object, coordinates, position }, index) => {
    const offset = index * 3;
    positions[offset] = position.x;
    positions[offset + 1] = position.y;
    positions[offset + 2] = position.z;
    const color = new THREE.Color(categoryColor(object));
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    const magnitude = Number.isFinite(Number(object.mag)) ? Number(object.mag) : 10;
    const relativeFlux = 10 ** (-0.4 * (magnitude - 5));
    const perceptualFlux = Math.max(0.4, Math.min(1, relativeFlux ** 0.06));
    sizes[index] = 2.8 + 2.2 * Math.max(0.25, Math.min(1, relativeFlux ** 0.08));
    brightnesses[index] = perceptualFlux;
    selectedObjects.push({ ...object, ...coordinates });
  });
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
  geometry.attributes.size.needsUpdate = true;
  geometry.attributes.brightness.needsUpdate = true;
  geometry.setDrawRange(0, visible.length);
  engine.catalogPoints.userData.catalogStars = selectedObjects;
  if (engine.visibleCount !== visible.length) {
    engine.visibleCount = visible.length;
    engine.onVisibleCount?.(visible.length);
  }

  const glowCandidates = visible;
  const glowIds = new Set(glowCandidates.map(({ object }) => object.id));
  for (const [id, sprite] of engine.glowById) {
    if (!glowIds.has(id)) {
      engine.glowSprites.remove(sprite);
      sprite.material.dispose();
      engine.glowById.delete(id);
    }
  }
  glowCandidates.forEach(({ object, coordinates }) => {
    let sprite = engine.glowById.get(object.id);
    if (!sprite) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: engine.glowTexture,
        color: categoryColor(object),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.9,
        toneMapped: false,
      }));
      engine.glowById.set(object.id, sprite);
      engine.glowSprites.add(sprite);
    }
    sprite.position.copy(directionFromRaDec(coordinates.ra, coordinates.dec, 95));
    const magnitude = Number.isFinite(Number(object.mag)) ? Number(object.mag) : 10;
    sprite.material.color.set(categoryColor(object));
    const relativeFlux = 10 ** (-0.4 * (magnitude - 5));
    const perceptualFlux = Math.max(0.4, Math.min(1, relativeFlux ** 0.06));
    sprite.userData.baseOpacity = 0.45 + 0.45 * perceptualFlux;
    sprite.material.opacity = THREE.MathUtils.clamp(sprite.userData.baseOpacity * (engine.glowIntensityScale || 1), 0, 1);
    sprite.scale.setScalar(2.1 + Math.max(0, 8 - magnitude) * 0.16);
  });
}
export default function CelestialExplore({ selectedId = null, onSelect = () => {}, onTarget = () => {} }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  // Keep the latest onSelect without re-subscribing the canvas listener.
  const onSelectRef = useRef(onSelect);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [starScale, setStarScale] = useState(2);
  const [showSettings, setShowSettings] = useState(false);
  const [helpVisible, setHelpVisible] = useState(true);
  const [notice, setNotice] = useState('Drag to look around · Scroll to zoom');
  const [catalog, setCatalog] = useState([]);
  const [categories, setCategories] = useState(['ALL']);
  const [maxCount, setMaxCount] = useState(20);
  const [viewRangeLy, setViewRangeLy] = useState(180);
  const [timeOffsetYears, setTimeOffsetYears] = useState(0);
  const [visibleObjectCount, setVisibleObjectCount] = useState(0);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    api.objects().then((d) => {
      const all = d.objects || [];
      setCatalog(all);
    }).catch(() => {});
  }, []);

  const toggleCategory = (key) => {
    if (key === 'ALL') {
      setCategories(['ALL']);
      return;
    }
    setCategories((prev) => {
      const has = prev.includes(key);
      let next = has ? prev.filter((c) => c !== key) : [...prev.filter((c) => c !== 'ALL'), key];
      if (next.length === 0) next = ['ALL'];
      return next;
    });
  };

  const filtered = useMemo(() => {
    let list = catalog.slice();
    if (!categories.includes('ALL')) {
      list = list.filter((o) => categories.includes(o.type));
    }
    return list;
  }, [catalog, categories]);

  const categoryOptions = useMemo(() => {
    const byType = new Map();
    catalog.forEach((object) => {
      if (!byType.has(object.type)) {
        byType.set(object.type, {
          key: object.type,
          label: object.typeLabel || object.type,
          color: categoryColor(object),
        });
      }
    });
    return [{ key: 'ALL', label: 'All Objects', color: '#ffffff' }, ...byType.values()];
  }, [catalog]);

  const maximumDistanceLy = useMemo(
    () => Math.max(180, ...catalog.map(distanceLy).filter(Number.isFinite)),
    [catalog],
  );
  const referenceEpochJD = useMemo(
    () => Math.max(2460000, ...catalog.map((object) => Number(object.epochOfDiscovery)).filter(Number.isFinite)),
    [catalog],
  );
  const viewEpochJD = referenceEpochJD + timeOffsetYears * 365.25;
  const selectedAtEpoch = useMemo(() => {
    if (!selected) return null;
    const source = catalog.find((object) => object.id === selected.id) || selected;
    return { ...source, ...apparentCoordinates(source, viewEpochJD) };
  }, [selected, catalog, viewEpochJD]);

  // Adopt a target chosen in another view (Comparator / Catalogue / Spectra).
  // The selection is shared through App, so this only mirrors it locally.
  useEffect(() => {
    if (!selectedId || !catalog.length) return;
    if (selected && selected.id === selectedId) return;
    const object = catalog.find((o) => o.id === selectedId);
    if (!object) return;
    setSelected({ ...object, ...apparentCoordinates(object, viewEpochJD) });
    setQuery(object.name || object.id);
    setSearchOpen(false);
    setNotice(`${object.name || object.id} selected`);
  }, [selectedId, catalog, selected, viewEpochJD]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filtered.slice(0, 8);
    return filtered.filter((s) => `${s.name || ''} ${s.id || ''} ${(s.aliases || []).join(' ')}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query, filtered]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onStarSelected = (event) => {
      const star = event.detail;
      setSelected(star || null);
      onSelectRef.current(star ? star.id : null);
      if (star) { setQuery(star.name || star.id); setSearchOpen(false); setNotice(`${star.name || star.id} selected`); }
    };
    canvas.addEventListener('sky-star-select', onStarSelected);
    return () => canvas.removeEventListener('sky-star-select', onStarSelected);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02030a);
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 180);
    camera.position.set(0, 0, 0);
    camera.rotation.order = 'YXZ';

    const hazeCanvas = document.createElement('canvas');
    hazeCanvas.width = 1024; hazeCanvas.height = 512;
    const ctx = hazeCanvas.getContext('2d');
    const haze = ctx.createRadialGradient(520, 265, 8, 520, 265, 430);
    haze.addColorStop(0, 'rgba(48,74,132,0.16)');
    haze.addColorStop(0.35, 'rgba(35,53,108,0.08)');
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haze; ctx.fillRect(0, 0, 1024, 512);
    const hazeTexture = new THREE.CanvasTexture(hazeCanvas);
    const hazeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(99.3, 48, 24),
      new THREE.MeshBasicMaterial({ map: hazeTexture, side: THREE.BackSide, transparent: true, depthWrite: false }),
    );
    scene.add(hazeMesh);

    let seed = 738291;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const bgCount = 5600;
    const bgPositions = new Float32Array(bgCount * 3);
    const bgColors = new Float32Array(bgCount * 3);
    const bgSizes = new Float32Array(bgCount);
    for (let i = 0; i < bgCount; i++) {
      const y = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      bgPositions[i * 3] = Math.cos(theta) * ring * 98;
      bgPositions[i * 3 + 1] = y * 98;
      bgPositions[i * 3 + 2] = Math.sin(theta) * ring * 98;
      const warmth = rand();
      const intensity = 0.36 + rand() * 0.64;
      bgColors[i * 3] = intensity;
      bgColors[i * 3 + 1] = intensity * (0.88 + warmth * 0.1);
      bgColors[i * 3 + 2] = intensity * (0.82 + (1 - warmth) * 0.18);
      bgSizes[i] = 0.4 + rand() * 1.2;
    }
    const bgGeometry = new THREE.BufferGeometry();
    bgGeometry.setAttribute('position', new THREE.BufferAttribute(bgPositions, 3));
    bgGeometry.setAttribute('color', new THREE.BufferAttribute(bgColors, 3));
    bgGeometry.setAttribute('size', new THREE.BufferAttribute(bgSizes, 1));
    const bgMaterial = new THREE.PointsMaterial({ size: 0.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.76, depthWrite: false });
    const backgroundStars = new THREE.Points(bgGeometry, bgMaterial);
    scene.add(backgroundStars);

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(0), 3));
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(0), 3));
    starGeometry.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(0), 1));
    starGeometry.setAttribute('brightness', new THREE.Float32BufferAttribute(new Float32Array(0), 1));
    const starMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 1 }, uBrightness: { value: 2 } },
      vertexShader: `attribute float size; attribute float brightness; attribute vec3 color; uniform float uScale; varying vec3 vColor; varying float vAlpha; varying float vBrightness; void main(){ vColor=color; vBrightness=brightness; vAlpha=length(color)>0.001?1.0:0.0; vec4 mvPosition=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mvPosition; gl_PointSize=max(0.0,size*uScale); }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vBrightness;
        uniform float uBrightness;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float a = 1.0 - smoothstep(0.34, 0.5, d);
          if (a < 0.02 || vAlpha < 0.5) discard;
          float core = 1.0 - smoothstep(0.0, 0.34, d);
          vec3 light = min(vec3(1.0), vColor * uBrightness * vBrightness + vec3(core * 0.8));
          gl_FragColor = vec4(light, a);
          #include <colorspace_fragment>
        }
      `,
      toneMapped: false,
    });
    const catalogPoints = new THREE.Points(starGeometry, starMaterial);
    catalogPoints.userData.catalogStars = [];
    scene.add(catalogPoints);

    const glowCanvas = document.createElement('canvas'); glowCanvas.width = 64; glowCanvas.height = 64;
    const gctx = glowCanvas.getContext('2d');
    const glow = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)'); glow.addColorStop(0.12, 'rgba(170,205,255,0.45)'); glow.addColorStop(1, 'rgba(80,130,255,0)');
    gctx.fillStyle = glow; gctx.fillRect(0, 0, 64, 64);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    const glowSprites = new THREE.Group();
    scene.add(glowSprites);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let yaw = 0, pitch = 0, dragging = false, lastX = 0, lastY = 0, startX = 0, startY = 0, disposed = false, frame = 0;
    let targetYaw = 0, targetPitch = 0;
    const selectedMarker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 32), new THREE.MeshBasicMaterial({ color: 0xffa14a, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
    selectedMarker.scale.setScalar(1.8);
    selectedMarker.visible = false; scene.add(selectedMarker);

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY; startX = e.clientX; startY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
      canvas.classList.add('is-dragging');
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      targetYaw -= dx * 0.0035;
      targetPitch = THREE.MathUtils.clamp(targetPitch + dy * 0.0035, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    };
    const onPointerUp = (e) => {
      if (!dragging) return;
      dragging = false; canvas.classList.remove('is-dragging');
      const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (moved < 5) {
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const angularPickRadius = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * PICK_RADIUS_PX / Math.max(1, rect.height);
        raycaster.params.Points.threshold = 96 * angularPickRadius;
        const hits = raycaster.intersectObject(catalogPoints).sort((a, b) => a.distanceToRay - b.distanceToRay);
        if (hits.length) {
          const star = catalogPoints.userData.catalogStars[hits[0].index];
          if (star) canvas.dispatchEvent(new CustomEvent('sky-star-select', { detail: star }));
        }
      }
    };
    const onPointerCancel = () => {
      dragging = false;
      canvas.classList.remove('is-dragging');
    };
    const onWheel = (e) => {
      e.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.025, 30, 150);
      camera.updateProjectionMatrix();
      refreshVisibleCatalog(engineRef.current);
    };
    const onSelect = (e) => {
      const star = e.detail;
      if (!star) { selectedMarker.visible = false; return; }
      selectedMarker.position.copy(directionFromRaDec(star.ra, star.dec, 94.4));
      selectedMarker.material.color.set(categoryColor(star));
      selectedMarker.quaternion.copy(camera.quaternion);
      selectedMarker.visible = true;
    };
    const onKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const step = 0.055;
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') targetYaw += step;
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') targetYaw -= step;
      if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') targetPitch = THREE.MathUtils.clamp(targetPitch + step, -1.55, 1.55);
      if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') targetPitch = THREE.MathUtils.clamp(targetPitch - step, -1.55, 1.55);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('sky-star-select', onSelect);
    window.addEventListener('keydown', onKeyDown);

    const resize = () => {
      const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
      refreshVisibleCatalog(engineRef.current);
    };
    const ro = new ResizeObserver(resize); ro.observe(wrap); resize();
    const compass = wrap.querySelector('.celestial-compass');
    const compassNeedle = wrap.querySelector('.compass-needle');
    const engine = {
      camera, renderer, catalogPoints, starMaterial, bgMaterial, selectedMarker, scene, glowSprites, glowTexture,
      catalogObjects: [], maxCount: 20, viewRangeLy: 180, catalogCapacity: 0, glowById: new Map(), visibleCount: -1,
      epochJD: 2460000, glowIntensityScale: 1,
      onVisibleCount: setVisibleObjectCount,
      setTarget: (star) => {
        const target = -THREE.MathUtils.degToRad(star.ra);
        targetYaw = yaw + Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
        targetPitch = THREE.MathUtils.degToRad(star.dec);
      },
    };
    engineRef.current = engine;
    let lastCatalogRefresh = 0;
    let lastCatalogYaw = NaN;
    let lastCatalogPitch = NaN;
    let lastFrameTime = performance.now();
    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const now = performance.now();
      const elapsedSeconds = Math.min(0.1, Math.max(0, now - lastFrameTime) / 1000);
      lastFrameTime = now;
      const easing = 1 - Math.exp(-11.9 * elapsedSeconds);
      yaw += (targetYaw - yaw) * easing;
      pitch += (targetPitch - pitch) * easing;
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const viewMoved = Math.abs(yaw - lastCatalogYaw) > 0.0015 || Math.abs(pitch - lastCatalogPitch) > 0.0015;
      if (viewMoved && now - lastCatalogRefresh >= 100) {
        refreshVisibleCatalog(engine);
        lastCatalogRefresh = now;
        lastCatalogYaw = yaw;
        lastCatalogPitch = pitch;
      }
      selectedMarker.quaternion.copy(camera.quaternion);
      if (compassNeedle) {
        const rot = (-yaw * 180 / Math.PI + 360) % 360;
        compassNeedle.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      disposed = true; cancelAnimationFrame(frame); ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('sky-star-select', onSelect);
      window.removeEventListener('keydown', onKeyDown);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      });
      hazeTexture.dispose(); glowTexture.dispose(); renderer.dispose(); engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.catalogObjects = filtered;
    engine.maxCount = maxCount;
    engine.viewRangeLy = viewRangeLy;
    engine.epochJD = viewEpochJD;
    refreshVisibleCatalog(engine);
  }, [filtered, maxCount, viewRangeLy, viewEpochJD]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !selectedAtEpoch) return;
    engine.selectedMarker.position.copy(directionFromRaDec(selectedAtEpoch.ra, selectedAtEpoch.dec, 94.4));
    engine.selectedMarker.material.color.set(categoryColor(selectedAtEpoch));
    engine.selectedMarker.visible = true;
    engine.setTarget(selectedAtEpoch);
  }, [selectedAtEpoch]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.starMaterial.uniforms.uScale.value = 1;
    engine.starMaterial.uniforms.uBrightness.value = starScale;
    engine.glowIntensityScale = starScale / 2;
    engine.glowById.forEach((sprite) => {
      sprite.material.opacity = THREE.MathUtils.clamp(sprite.userData.baseOpacity * engine.glowIntensityScale, 0, 1);
    });
    engine.bgMaterial.opacity = 0.76;
  }, [starScale]);

  const selectStar = (star) => {
    const selectedObject = { ...star, ...apparentCoordinates(star, viewEpochJD) };
    setSelected(selectedObject); setQuery(star.name || star.id); setSearchOpen(false);
    setNotice(`${star.name || star.id} selected`);
    onSelect(star.id);
    const engine = engineRef.current;
    if (engine) {
      engine.selectedMarker.position.copy(directionFromRaDec(selectedObject.ra, selectedObject.dec, 94.4));
      engine.selectedMarker.material.color.set(categoryColor(selectedObject));
      engine.selectedMarker.visible = true;
      engine.setTarget(selectedObject);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    onSelect(null);
    const canvas = canvasRef.current;
    if (canvas) canvas.dispatchEvent(new CustomEvent('sky-star-select', { detail: null }));
  };

  return (
    <section className="panel viewer-panel explore-panel">
      <div className="panel-head explore-head">
        <div><h2>SKY VIEWER</h2><div className="explore-subtitle">MODE A / EXPLORE THE CELESTIAL SPHERE</div></div>
        <div className="viewer-tools">
          <span className="tag">IMMERSIVE</span>
          <button className="btn sm" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>⚙ SETTINGS</button>
        </div>
      </div>
      <div className="celestial-explore" ref={wrapRef}>
        <canvas ref={canvasRef} className="celestial-canvas" aria-label="Immersive celestial sphere. Drag to look around and select catalog stars." />
        <div className="explore-vignette" aria-hidden="true" />
        <div className="explore-top-left"><span className="explore-live-dot" /> SKY FIELD <span className="explore-divider">/</span> CATALOG PREVIEW</div>
        <div className="explore-top-right">RA / DEC BASED <span className="explore-divider">·</span> GRIDS HIDDEN</div>
        <div className="explore-center-reticle" aria-hidden="true"><span /></div>
        <div className="celestial-compass" aria-hidden="true">
          <div className="compass-ring" />
          <div className="compass-north">N</div>
          <div className="compass-south">S</div>
          <div className="compass-east">E</div>
          <div className="compass-west">W</div>
          <div className="compass-needle" />
        </div>
        <div className="explore-bottom-left">DRAG TO LOOK <span>·</span> SCROLL TO ZOOM <span>·</span> WASD / ARROWS</div>
        <div className="explore-bottom-right">{notice}</div>
        <div className="explore-search">
          <span className="explore-search-icon">⌕</span>
          <input value={query} onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) selectStar(results[0]); if (e.key === 'Escape') setSearchOpen(false); }} placeholder="Find a star…" aria-label="Search stars by name or catalog ID" />
          {query && <button className="explore-clear" onClick={() => { setQuery(''); setSearchOpen(true); }} aria-label="Clear search">×</button>}
          {searchOpen && <div className="explore-search-results">
            {results.length ? results.map((star) => <button key={star.id} className="explore-search-result" onMouseDown={(e) => e.preventDefault()} onClick={() => selectStar(star)}><span className="result-star-dot" style={{ background: categoryColor(star), boxShadow: `0 0 9px ${categoryColor(star)}` }} /><span><strong>{star.name || star.id}</strong><small>{star.type} · Mag {(star.mag || 0).toFixed(2)}</small></span><span className="result-arrow">↗</span></button>) : <div className="explore-no-results">No matching object in selected categories.</div>}
          </div>}
        </div>
        {showSettings && <div className="explore-settings">
          <div className="explore-settings-head"><strong>VIEW SETTINGS</strong><button onClick={() => setShowSettings(false)} aria-label="Close settings">×</button></div>
          <label>Categories</label>
          <div className="category-grid">
            {categoryOptions.map((cat) => (
              <button key={cat.key} className={`category-btn${categories.includes('ALL') || categories.includes(cat.key) ? ' active' : ''}`} onClick={() => toggleCategory(cat.key)}>
                <span className="cat-dot" style={{ background: cat.color }} /> {cat.label}
              </button>
            ))}
          </div>
          <label>Max objects displayed <span>{maxCount}</span><input type="range" min="1" max="100" step="1" value={maxCount} onChange={(e) => setMaxCount(Number(e.target.value))} /></label>
          <label>Maximum object distance <span>{formatDistance(viewRangeLy)}</span><input type="range" min="0" max="1000" step="1" value={distanceToSlider(viewRangeLy, maximumDistanceLy)} onChange={(e) => setViewRangeLy(sliderToDistance(e.target.value, maximumDistanceLy))} /></label>
          <label>Simulated time offset <span>+{timeOffsetYears} years</span><input type="range" min="0" max="100" step="1" value={timeOffsetYears} onChange={(e) => setTimeOffsetYears(Number(e.target.value))} /></label>
          <label>Catalog object intensity <span>{starScale.toFixed(1)}×</span><input type="range" min="0.5" max="3" step="0.1" value={starScale} onChange={(e) => setStarScale(Number(e.target.value))} /></label>
          <p>Showing {visibleObjectCount} of up to {maxCount} farthest objects in view. Distance is a catalog cutoff; object depth is not to scale. Solar-system distances are heliocentric estimates. The time offset advances positions along stored motion vectors, not full orbital integrations.</p>
        </div>}
        {selectedAtEpoch && <aside className="explore-object-card">
          <div className="explore-object-head"><span className="object-kicker">SELECTED OBJECT</span><button onClick={clearSelection} aria-label="Close object details">×</button></div>
          <div className="explore-object-title"><span className="object-color-dot" style={{ background: categoryColor(selectedAtEpoch), boxShadow: `0 0 14px ${categoryColor(selectedAtEpoch)}` }} /><div><h3>{selectedAtEpoch.name || selectedAtEpoch.id}</h3><p>{selectedAtEpoch.type} <span>·</span> {selectedAtEpoch.id}</p></div></div>
          <p className="explore-object-description">{selectedAtEpoch.note || selectedAtEpoch.description || ''}</p>
          <div className="explore-object-stats"><div><small>Simulated apparent magnitude</small><strong>{(selectedAtEpoch.mag || 0).toFixed(2)} mag</strong></div><div><small>Right ascension</small><strong>{formatRa(selectedAtEpoch.ra)}</strong></div><div><small>Declination</small><strong>{formatDec(selectedAtEpoch.dec)}</strong></div><div><small>Catalog ID</small><strong>{selectedAtEpoch.id}</strong></div></div>
          <div className="explore-object-actions">
            <button className="btn sm" onClick={() => onTarget('catalogue', selectedAtEpoch.id)}>CATALOGUE ≋</button>
            <button className="btn sm" onClick={() => onTarget('blink', selectedAtEpoch.id)}>BLINK ⧗</button>
            <button className="btn primary sm" onClick={() => onTarget('spectra', selectedAtEpoch.id)}>SPECTRA ∿</button>
          </div>
        </aside>}
        {helpVisible && !selected && <div className="explore-welcome"><button className="explore-welcome-close" onClick={() => setHelpVisible(false)} aria-label="Dismiss welcome">×</button><span className="welcome-kicker">WELCOME TO NOVOCHAR</span><h3>Look around.</h3><p>Explore the star field. Filter by object type, adjust object count and view range to see distant objects.</p><div><span>DRAG</span> Look around <span>SCROLL</span> Zoom</div></div>}
      </div>
      <div className="explore-footer"><span><i /> EXPLORE MODE ACTIVE</span><span>IN VIEW {visibleObjectCount} · OBJECT LIMIT {maxCount}</span></div>
    </section>
  );
}
