// Three.js / WebGL2 engine for the four-epoch SPHEREx sky.
//
// The engine is deliberately renderer-only: React owns the timeline, the HUD
// and the loading/error copy. This module owns:
//
//   * a camera inside a sphere with custom yaw/pitch/fov controls;
//   * a low-resolution equirectangular base per epoch (always covers the sky);
//   * HEALPix NEST tangent-plane patches, progressively refined near the view;
//   * a worker-backed tile loader and an LRU texture budget;
//   * a GPU-instanced source layer with a custom shader;
//   * adaptive pixel ratio / detail order based on measured frame time.
//
// It is not a measurement engine. The tiles it draws are the illustrative
// prototype products described in server/spherex/sky-tiles.js.

import * as THREE from 'three';
import { nside2resolRad, order2nside, pixelCenterRaDec, tileHalfAngleRad } from '@novochar/astro';
import { raDecToSkyDirection } from './sky-coordinates.js';
import { SkyTileLoader } from './sky-tile-loader.js';
import {
  SKY_TILE_BYTES,
  SkyTextureCache,
  baseUrl,
  detailTilesForView,
  tileKey,
  tileUrl,
} from './sky-tiles.js';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const BASE_RADIUS = 1.04;
const TILE_RADIUS = 1.0;
const MAX_PIXEL_RATIO = 2;

function normalizeRa(ra) {
  return ((ra % 360) + 360) % 360;
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function isTransientError(error) {
  return error?.name === 'AbortError';
}

// A sphere whose UVs are defined from the same RA/Dec convention as the tiles.
// j=0 is the south pole, j=lat is the north pole; the server base image row 0 is
// north, which Three.js maps to v=1 with the default flipY.
function createSphereGeometry(radius, lonSegments = 96, latSegments = 48) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= latSegments; j++) {
    const v = j / latSegments;
    const dec = -90 + v * 180;
    for (let i = 0; i <= lonSegments; i++) {
      const u = i / lonSegments;
      const ra = u * 360;
      const dir = raDecToSkyDirection(ra, dec);
      positions.push(dir[0] * radius, dir[1] * radius, dir[2] * radius);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < latSegments; j++) {
    for (let i = 0; i < lonSegments; i++) {
      const a = j * (lonSegments + 1) + i;
      const b = a + 1;
      const c = a + lonSegments + 1;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// A HEALPix tile as a tangent-plane patch. The server samples the same
// (center + east*u*half + north*v*half) grid, so texture and geometry agree.
function createTileGeometry(order, ipix, segments = 10) {
  const half = tileHalfAngleRad(order);
  const center = pixelCenterRaDec(order, ipix);
  const centerDir = new THREE.Vector3(...raDecToSkyDirection(center.ra, center.dec));
  const raRad = center.ra * DEG;
  const decRad = center.dec * DEG;
  const east = new THREE.Vector3(Math.cos(raRad), 0, Math.sin(raRad));
  const north = new THREE.Vector3(
    -Math.sin(decRad) * Math.sin(raRad),
    Math.cos(decRad),
    Math.sin(decRad) * Math.cos(raRad),
  );

  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= segments; j++) {
    const v = (j / segments) * 2 - 1; // south -> north
    for (let i = 0; i <= segments; i++) {
      const u = (i / segments) * 2 - 1; // west -> east
      const dir = centerDir.clone()
        .addScaledVector(east, u * half)
        .addScaledVector(north, v * half)
        .normalize();
      // Higher orders sit a hair closer to the camera so they win the depth
      // test against the parent layer without moving perceptibly.
      const radius = TILE_RADIUS - order * 0.0008;
      positions.push(dir.x * radius, dir.y * radius, dir.z * radius);
      // Image row 0 is north; with UV v=1 at north and flipY=true the texture
      // is upright in the renderer.
      uvs.push(i / segments, j / segments);
    }
  }
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry };
}

function createStarfield(radius = 4, count = 2600) {
  let seed = 0x8f31c2;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const z = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    positions[index * 3] = Math.cos(theta) * ring * radius;
    positions[index * 3 + 1] = z * radius;
    positions[index * 3 + 2] = Math.sin(theta) * ring * radius;
    const warmth = rand();
    const intensity = 0.3 + rand() * 0.7;
    colors[index * 3] = intensity * (0.8 + warmth * 0.2);
    colors[index * 3 + 1] = intensity * 0.9;
    colors[index * 3 + 2] = intensity;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.018,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = -100;
  points.frustumCulled = false;
  return points;
}

function createGraticule(radius = 0.992) {
  const vertices = [];
  const push = (ra, dec) => {
    const dir = raDecToSkyDirection(ra, dec);
    vertices.push(dir[0] * radius, dir[1] * radius, dir[2] * radius);
  };
  // Meridians every 30 degrees.
  for (let ra = 0; ra < 360; ra += 30) {
    for (let dec = -80; dec < 80; dec += 5) {
      push(ra, dec);
      push(ra, dec + 5);
    }
  }
  // Parallels every 30 degrees.
  for (let dec = -60; dec <= 60; dec += 30) {
    for (let ra = 0; ra < 360; ra += 5) {
      push(ra, dec);
      push(ra + 5, dec);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x3d7896,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 40;
  lines.frustumCulled = false;
  return lines;
}

function makeSourceLayer(count) {
  const base = new THREE.PlaneGeometry(2, 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setAttribute('uv', base.getAttribute('uv'));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const visible = new Float32Array(count);
  const selected = new Float32Array(count);
  geometry.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(positions, 3));
  geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(sizes, 1));
  geometry.setAttribute('instanceVisible', new THREE.InstancedBufferAttribute(visible, 1));
  geometry.setAttribute('instanceSelected', new THREE.InstancedBufferAttribute(selected, 1));
  geometry.instanceCount = count;
  base.dispose();

  const material = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uScale: { value: 1 } },
    vertexShader: `
      attribute vec3 instancePosition;
      attribute vec3 instanceColor;
      attribute float instanceSize;
      attribute float instanceVisible;
      attribute float instanceSelected;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vVisible;
      varying float vSelected;
      uniform float uScale;
      void main() {
        vUv = uv;
        vColor = instanceColor;
        vVisible = instanceVisible;
        vSelected = instanceSelected;
        vec4 mv = modelViewMatrix * vec4(instancePosition, 1.0);
        // uScale tracks tan(fov/2), so a marker keeps roughly the same screen
        // size as the user zooms instead of growing into a huge disc.
        mv.xy += position.xy * instanceSize * uScale;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vVisible;
      varying float vSelected;
      uniform float uOpacity;
      void main() {
        if (vVisible < 0.5) discard;
        vec2 p = vUv - vec2(0.5);
        float r = length(p) * 2.0;
        float ring = smoothstep(0.6, 0.72, r) * (1.0 - smoothstep(0.86, 1.0, r));
        float core = 1.0 - smoothstep(0.0, 0.42, r);
        float halo = (1.0 - smoothstep(0.0, 1.0, r)) * 0.18;
        float alpha = (ring * 0.9 + core * 0.85 + halo) * uOpacity;
        if (vSelected > 0.5) alpha = max(alpha, (1.0 - smoothstep(0.0, 1.0, r)) * 0.28);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor * (1.0 + vSelected * 0.7), alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 60;
  mesh.userData = { positions, colors, sizes, visible, selected, count };
  return mesh;
}

function measurementFor(candidate, epochIndex) {
  return candidate.epochs.find((epoch) => epoch.index === epochIndex) ?? null;
}

/**
 * Create the 3D sky engine.
 */
export function createSky3DEngine({
  canvas,
  wrap,
  meta,
  quality,
  initialEpoch = 0,
  onStats = null,
  onView = null,
  onSourceSelect = null,
  onReady = null,
  onError = null,
}) {
  if (!canvas || !wrap) throw new Error('createSky3DEngine requires a canvas and a wrapper');
  if (!meta?.epochs?.length) throw new Error('sky engine requires an epoch index');

  const epochs = meta.epochs;
  const baseOrder = meta.tiles?.baseOrder ?? 1;
  const configuredMaxOrder = Math.min(meta.tiles?.maxOrder ?? 4, quality.maxOrder ?? 4);
  const tileTemplate = meta.tiles?.urlTemplate;
  const baseTemplate = meta.tiles?.base?.urlTemplate;
  if (!tileTemplate || !baseTemplate) throw new Error('sky index is missing tile URL templates');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.antialias,
    alpha: false,
    powerPreference: 'high-performance',
  });
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    throw new Error('This view requires WebGL2. The rest of Novochar remains available.');
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x02040a, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap ?? MAX_PIXEL_RATIO));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);
  const camera = new THREE.PerspectiveCamera(quality.initialFov ?? 62, 1, 0.01, 20);
  camera.position.set(0, 0, 0);
  camera.rotation.order = 'YXZ';

  const backgroundStars = createStarfield();
  scene.add(backgroundStars);
  const graticule = createGraticule();
  scene.add(graticule);

  // Declared before the loader: the loader emits its first stats synchronously
  // from its constructor, and that callback marks the render loop dirty.
  let dirty = true;

  const loader = new SkyTileLoader({
    workerCount: quality.workerCount ?? 2,
    maxConcurrent: (quality.workerCount ?? 2) * 2,
    onStats: () => { dirty = true; },
  });

  const tileTextures = new SkyTextureCache({
    max: quality.maxTextures ?? 192,
    maxBytes: quality.maxBytes ?? Infinity,
    dispose: (texture, key) => {
      texture?.dispose?.();
      // ImageBitmap is not released by Texture.dispose; close it so evicting a
      // tile actually frees its decoded pixels.
      texture?.image?.close?.();
      // A disposed texture must never remain attached to a visible mesh.
      for (const state of epochStates.values()) {
        const mesh = state.meshes.get(key);
        if (!mesh) continue;
        state.group.remove(mesh);
        mesh.geometry?.dispose?.();
        mesh.material?.dispose?.();
        state.meshes.delete(key);
      }
    },
  });

  const epochStates = new Map();
  const baseTextures = new Map();
  const basePromises = new Map();
  const tilePromises = new Map();
  const readyEpochs = new Set();
  let activeEpochIndex = clamp(initialEpoch, 0, epochs.length - 1);
  let activeEpoch = epochs[activeEpochIndex];
  let disposed = false;
  let frame = 0;
  let lastFrameTime = performance.now();
  let lastStatsTime = 0;
  let lastViewTime = 0;
  let lastLodTime = 0;
  let slowFrames = 0;
  let fastFrames = 0;
  let adaptiveMaxOrder = configuredMaxOrder;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap ?? MAX_PIXEL_RATIO);
  let pendingPrefetch = 0;
  let lastError = null;
  let selectedSourceId = null;
  let sourceData = null;
  let sourceLayer = null;
  let sourceCandidates = [];
  let showSources = true;

  const look = {
    yaw: 0,
    pitch: 0,
    fov: quality.initialFov ?? 62,
    targetYaw: 0,
    targetPitch: 0,
    targetFov: quality.initialFov ?? 62,
  };

  const tileStats = {
    loaded: 0,
    pending: 0,
    failed: 0,
    textures: 0,
    bytes: 0,
    workers: quality.workerCount ?? 2,
  };

  function emitStats(now = performance.now()) {
    const fps = frameTimeSamples.length
      ? 1000 / (frameTimeSamples.reduce((sum, value) => sum + value, 0) / frameTimeSamples.length)
      : 0;
    const order = currentDetailOrder();
    onStats?.({
      fps: +fps.toFixed(1),
      pixelRatio: +pixelRatio.toFixed(2),
      maxOrder: adaptiveMaxOrder,
      order,
      resolutionDeg: +(nside2resolRad(order2nside(order)) * RAD).toFixed(2),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      tiles: { ...tileStats, textures: tileTextures.size, bytes: tileTextures.bytes },
      loader: {
        completed: loader.completed,
        active: loader.active.size,
        queued: loader.queue.length,
        failed: loader.failed,
        aborted: loader.aborted,
        bytes: loader.bytes,
      },
      sourcesVisible: showSources,
      activeEpoch: activeEpoch.id,
      lastError,
      at: now,
    });
  }

  const frameTimeSamples = [];
  function recordFrame(dtMs) {
    frameTimeSamples.push(dtMs);
    if (frameTimeSamples.length > 40) frameTimeSamples.shift();
  }

  function currentDetailOrder() {
    const fov = look.targetFov;
    if (fov <= 24 && adaptiveMaxOrder >= 4) return 4;
    if (fov <= 42 && adaptiveMaxOrder >= 3) return 3;
    if (fov <= 72 && adaptiveMaxOrder >= 2) return 2;
    return baseOrder;
  }

  function viewRaDec() {
    return {
      ra: normalizeRa(-look.yaw * RAD),
      dec: clamp(look.pitch * RAD, -90, 90),
    };
  }

  function emitView(now = performance.now(), force = false) {
    if (!force && now - lastViewTime < 100) return;
    lastViewTime = now;
    const { ra, dec } = viewRaDec();
    onView?.({ ra, dec, fov: look.targetFov, order: currentDetailOrder() });
  }

  function makeTexture(bitmap) {
    const texture = new THREE.Texture(bitmap);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    // decodeSkyTile already flipped the rows for a v=1 north UV. ImageBitmap
    // uploads ignore UNPACK_FLIP_Y_WEBGL, so leaving this true would be a no-op
    // on some engines and a double flip on others.
    texture.flipY = false;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  function getEpochState(epochId) {
    if (epochStates.has(epochId)) return epochStates.get(epochId);
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    const state = {
      epochId,
      group,
      meshes: new Map(),
      desired: new Set(),
      baseMesh: null,
      baseReady: false,
    };
    const geometry = createSphereGeometry(BASE_RADIUS);
    const material = new THREE.MeshBasicMaterial({
      color: 0x0b1020,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      alphaTest: 0.01,
    });
    const baseMesh = new THREE.Mesh(geometry, material);
    baseMesh.renderOrder = 0;
    baseMesh.frustumCulled = false;
    group.add(baseMesh);
    state.baseMesh = baseMesh;
    epochStates.set(epochId, state);
    return state;
  }

  function attachBaseTexture(state, texture) {
    const material = state.baseMesh.material;
    material.map = texture;
    material.color.set(0xffffff);
    material.opacity = 1;
    material.needsUpdate = true;
    state.baseReady = true;
    if (state.epochId === activeEpoch.id) updateSourcePositions();
    dirty = true;
  }

  function loadBaseTexture(epochId, priority = 5000) {
    if (baseTextures.has(epochId)) return Promise.resolve(baseTextures.get(epochId));
    if (basePromises.has(epochId)) return basePromises.get(epochId);
    const promise = loader.request({
      key: `base:${epochId}`,
      url: baseUrl(baseTemplate, epochId),
      priority,
    }).then((bitmap) => {
      if (disposed) {
        bitmap?.close?.();
        throw new Error('engine disposed');
      }
      const texture = makeTexture(bitmap);
      // The equirectangular base has a real RA=0/360 seam; wrap it so mipmap
      // filtering blends the two edges instead of clamping them.
      texture.wrapS = THREE.RepeatWrapping;
      baseTextures.set(epochId, texture);
      dirty = true;
      return texture;
    }).catch((error) => {
      basePromises.delete(epochId);
      if (isTransientError(error)) throw error;
      lastError = { code: 'base_failed', message: error.message, epoch: epochId };
      // A failed idle prefetch must not raise a warning over the epoch the user
      // is actually looking at, and a late failure must not touch a disposed
      // engine.
      if (!disposed && activeEpoch.id === epochId) onError?.(lastError);
      throw error;
    });
    basePromises.set(epochId, promise);
    return promise;
  }

  function showEpochState(state) {
    for (const [epochId, other] of epochStates) {
      if (epochId !== state.epochId) other.group.visible = false;
    }
    state.group.visible = true;
    // Sources are epoch-specific. The switch is atomic: once the active epoch
    // changes, only that epoch's group and markers may be visible, even while
    // its base texture is still in flight.
    updateSourcePositions();
    dirty = true;
  }

  function requestTile(epochId, order, ipix, priority) {
    const key = tileKey(epochId, order, ipix);
    const cached = tileTextures.get(key);
    if (cached) return Promise.resolve(cached);
    if (tilePromises.has(key)) return tilePromises.get(key);
    const promise = loader.request({
      key,
      url: tileUrl(tileTemplate, { epoch: epochId, order, ipix }),
      priority,
    }).then((bitmap) => {
      if (disposed) {
        bitmap?.close?.();
        return null;
      }
      const texture = makeTexture(bitmap);
      tileTextures.set(key, texture, { bytes: SKY_TILE_BYTES });
      return texture;
    }).catch((error) => {
      if (isTransientError(error)) return null;
      tileStats.failed += 1;
      lastError = { code: 'tile_failed', message: error.message, epoch: epochId, order, ipix };
      return null;
    });
    tilePromises.set(key, promise);
    promise.then(() => tilePromises.delete(key));
    return promise;
  }

  function buildTileMesh(state, order, ipix, texture) {
    const key = tileKey(state.epochId, order, ipix);
    const existing = state.meshes.get(key);
    if (existing) {
      // The LRU can evict a texture while its mesh is still in the scene. When
      // the texture is fetched again, reattach it instead of leaving a disposed
      // map bound to the old material.
      if (existing.material.map !== texture) {
        existing.material.map = texture;
        existing.material.needsUpdate = true;
      }
      existing.visible = true;
      return existing;
    }
    const { geometry } = createTileGeometry(order, ipix);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.01,
      depthWrite: true,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 10 + order;
    mesh.frustumCulled = false;
    mesh.userData = { key, order, ipix };
    state.group.add(mesh);
    state.meshes.set(key, mesh);
    dirty = true;
    return mesh;
  }

  function ensureTile(state, order, ipix, priority, buildMesh) {
    const key = tileKey(state.epochId, order, ipix);
    const cached = tileTextures.get(key);
    if (cached) {
      if (buildMesh) buildTileMesh(state, order, ipix, cached);
      return;
    }
    // `requestTile` dedupes by key in the loader.
    requestTile(state.epochId, order, ipix, priority).then((texture) => {
      if (!texture || disposed) return;
      const stillDesired = state.desired.has(key);
      if (buildMesh && stillDesired && state.epochId === activeEpoch.id) {
        buildTileMesh(state, order, ipix, texture);
      }
      dirty = true;
    }).catch(() => {});
  }

  function updateDesiredTiles(force = false) {
    if (disposed) return;
    const now = performance.now();
    if (!force && now - lastLodTime < 160) return;
    lastLodTime = now;
    const state = getEpochState(activeEpoch.id);
    const { ra, dec } = viewRaDec();
    const tiles = detailTilesForView({
      ra,
      dec,
      fovDeg: look.targetFov,
      baseOrder,
      maxOrder: adaptiveMaxOrder,
      detailParents: quality.tier === 'low'
        ? { 2: 4, 3: 2, 4: 0 }
        : { 2: 8, 3: 4, 4: 3 },
    });
    const desired = new Set(tiles.map((tile) => tileKey(activeEpoch.id, tile.order, tile.ipix)));
    state.desired = desired;

    // Cancel queued/in-flight detail requests that the new view no longer
    // needs. Base textures (priority >= 5000) and idle prefetch (negative
    // priority) are deliberately exempt, so switching epochs cannot strand the
    // next epoch's warm start.
    loader.cancel((job) => {
      const key = String(job.key);
      if (key.startsWith('base:') || job.priority < 0) return false;
      return !desired.has(key);
    });

    // Touch every desired texture before requesting anything, so the LRU
    // cannot evict what is currently on screen.
    for (const key of desired) tileTextures.get(key);

    for (const tile of tiles) {
      ensureTile(state, tile.order, tile.ipix, tile.priority, state.group.visible || state.epochId === activeEpoch.id);
    }

    // Drop meshes that are no longer part of the view. Textures stay in the LRU
    // so rotating back is instant.
    for (const [key, mesh] of [...state.meshes]) {
      if (desired.has(key)) continue;
      state.group.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
      state.meshes.delete(key);
    }
  }

  function markEpochReady(epochId) {
    if (readyEpochs.has(epochId)) return;
    readyEpochs.add(epochId);
    onReady?.({ epoch: epochId });
  }

  function activateEpoch(index) {
    const nextIndex = clamp(index, 0, epochs.length - 1);
    const nextState = epochStates.get(epochs[nextIndex].id);
    if (
      nextIndex === activeEpochIndex &&
      nextState?.group?.visible &&
      (nextState.baseReady || basePromises.has(epochs[nextIndex].id))
    ) {
      return;
    }
    activeEpochIndex = nextIndex;
    activeEpoch = epochs[nextIndex];
    const state = getEpochState(activeEpoch.id);
    const cachedBase = baseTextures.get(activeEpoch.id);
    if (cachedBase) {
      attachBaseTexture(state, cachedBase);
      showEpochState(state);
      markEpochReady(activeEpoch.id);
    } else {
      // Do not leave the previous epoch's sky on screen under the new epoch's
      // label while the base loads. The dark placeholder base plus any cached
      // detail tiles stay epoch-consistent; a failure leaves the same new
      // epoch visible and surfaces a warning instead of silently reverting.
      showEpochState(state);
      loadBaseTexture(activeEpoch.id, 6000).then((texture) => {
        if (disposed || activeEpoch.id !== state.epochId) return;
        attachBaseTexture(state, texture);
        showEpochState(state);
        markEpochReady(activeEpoch.id);
      }).catch(() => {
        // `loadBaseTexture` reports active-epoch failures through onError; the
        // already-visible placeholder keeps the HUD and sky in agreement.
      });
    }
    updateDesiredTiles(true);
    updateSourcePositions();
    emitView(performance.now(), true);
    dirty = true;
  }

  // --- source layer ----------------------------------------------------------

  function rebuildSourceLayer(data) {
    sourceData = data;
    sourceCandidates = Array.isArray(data?.candidates) ? data.candidates : [];
    if (sourceLayer) {
      scene.remove(sourceLayer);
      sourceLayer.geometry?.dispose?.();
      sourceLayer.material?.dispose?.();
      sourceLayer = null;
    }
    if (sourceCandidates.length === 0) {
      dirty = true;
      return;
    }
    sourceLayer = makeSourceLayer(sourceCandidates.length);
    sourceLayer.visible = showSources;
    scene.add(sourceLayer);
    updateSourcePositions();
  }

  function updateSourcePositions() {
    if (!sourceLayer) return;
    const { positions, colors, sizes, visible, selected, count } = sourceLayer.userData;
    const color = new THREE.Color();
    // The active epoch group can be hidden briefly before its first activation
    // or during disposal. In that case hide every marker rather than
    // mislabeling another epoch's sky.
    if (!epochStates.get(activeEpoch.id)?.group?.visible) {
      visible.fill(0);
      sourceLayer.geometry.getAttribute('instanceVisible').needsUpdate = true;
      dirty = true;
      return;
    }
    for (let index = 0; index < count; index++) {
      const candidate = sourceCandidates[index];
      const measurement = measurementFor(candidate, activeEpochIndex);
      if (!measurement) {
        visible[index] = 0;
        continue;
      }
      const dir = raDecToSkyDirection(measurement.ra, measurement.dec);
      positions[index * 3] = dir[0] * 0.965;
      positions[index * 3 + 1] = dir[1] * 0.965;
      positions[index * 3 + 2] = dir[2] * 0.965;
      color.set(candidate.color || '#8fd8ff');
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      const isSelected = candidate.id === selectedSourceId;
      const baseSize = candidate.kind === 'transient' ? 0.0065 : 0.0045;
      sizes[index] = baseSize * (isSelected ? 1.9 : 1);
      visible[index] = measurement.visible ? 1 : 0;
      selected[index] = isSelected ? 1 : 0;
    }
    sourceLayer.geometry.getAttribute('instancePosition').needsUpdate = true;
    sourceLayer.geometry.getAttribute('instanceColor').needsUpdate = true;
    sourceLayer.geometry.getAttribute('instanceSize').needsUpdate = true;
    sourceLayer.geometry.getAttribute('instanceVisible').needsUpdate = true;
    sourceLayer.geometry.getAttribute('instanceSelected').needsUpdate = true;
    dirty = true;
  }

  function selectSource(id) {
    selectedSourceId = id ?? null;
    updateSourcePositions();
  }

  function focusSource(id) {
    if (!epochStates.get(activeEpoch.id)?.group?.visible) return;
    const candidate = sourceCandidates.find((item) => item.id === id);
    if (!candidate) return;
    const measurement = measurementFor(candidate, activeEpochIndex);
    if (!measurement?.visible) return;
    selectedSourceId = id;
    look.targetYaw = -measurement.ra * DEG;
    // Choose the shortest yaw path so focusing across RA=0 does not spin the
    // long way around.
    const current = look.yaw;
    const target = look.targetYaw;
    look.targetYaw = current + Math.atan2(Math.sin(target - current), Math.cos(target - current));
    look.targetPitch = clamp(measurement.dec * DEG, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    look.targetFov = 24;
    updateSourcePositions();
    updateDesiredTiles(true);
    dirty = true;
  }

  function setSources(data) {
    rebuildSourceLayer(data);
  }

  function setShowSources(value) {
    showSources = Boolean(value);
    if (sourceLayer) sourceLayer.visible = showSources;
    dirty = true;
  }

  function pickSource(clientX, clientY) {
    if (!sourceLayer || !showSources) return null;
    // Instance visibility is hidden during an epoch handoff; picking must obey
    // the same rule or the cursor can select an invisible marker.
    if (!epochStates.get(activeEpoch.id)?.group?.visible) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let bestDistance = 20;
    const vector = new THREE.Vector3();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    for (const candidate of sourceCandidates) {
      const measurement = measurementFor(candidate, activeEpochIndex);
      if (!measurement?.visible) continue;
      const dir = raDecToSkyDirection(measurement.ra, measurement.dec);
      // A point behind the camera can project into the viewport after the
      // perspective divide; reject it before comparing screen distances.
      if (dir[0] * forward.x + dir[1] * forward.y + dir[2] * forward.z <= 0) continue;
      vector.set(dir[0] * 0.965, dir[1] * 0.965, dir[2] * 0.965).project(camera);
      if (vector.z > 1) continue;
      const sx = (vector.x * 0.5 + 0.5) * rect.width;
      const sy = (-vector.y * 0.5 + 0.5) * rect.height;
      const distance = Math.hypot(sx - x, sy - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  // --- controls --------------------------------------------------------------

  const pointers = new Map();
  let dragging = false;
  let dragMoved = 0;
  let lastX = 0;
  let lastY = 0;
  let pinchDistance = 0;
  let pinched = false;

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return;
    canvas.focus?.();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) {
      dragging = true;
      dragMoved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.classList.add('is-dragging');
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      // Lifting the second finger leaves one pointer down; suppress the
      // synthetic tap so a pinch never selects the candidate under the finger.
      pinched = true;
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1 && dragging) {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      dragMoved += Math.hypot(dx, dy);
      look.targetYaw -= dx * 0.0032;
      look.targetPitch = clamp(look.targetPitch + dy * 0.0032, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      dirty = true;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0 && distance > 0) {
        const ratio = pinchDistance / distance;
        look.targetFov = clamp(look.targetFov * ratio, 12, 100);
        pinchDistance = distance;
        dirty = true;
      }
    }
  }

  function onPointerUp(event) {
    const wasDragging = dragging;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      dragging = false;
      const wasPinch = pinched;
      pinched = false;
      canvas.classList.remove('is-dragging');
      if (wasDragging && !wasPinch && dragMoved < 6) {
        const hit = pickSource(event.clientX, event.clientY);
        if (hit) onSourceSelect?.(hit);
        else onSourceSelect?.(null);
      }
    } else if (pointers.size === 1) {
      const [a] = [...pointers.values()];
      lastX = a.x;
      lastY = a.y;
      dragMoved = 0;
      pinchDistance = 0;
    }
  }

  function onPointerCancel(event) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      dragging = false;
      pinched = false;
      canvas.classList.remove('is-dragging');
    }
  }

  function onWheel(event) {
    event.preventDefault();
    const direction = event.deltaY > 0 ? 1 : -1;
    look.targetFov = clamp(look.targetFov * (1 + direction * 0.09), 12, 100);
    dirty = true;
  }

  function onKeyDown(event) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = 0.06;
    let handled = true;
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      look.targetYaw += step;
      dirty = true;
    } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      look.targetYaw -= step;
      dirty = true;
    } else if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
      look.targetPitch = clamp(look.targetPitch + step, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      dirty = true;
    } else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
      look.targetPitch = clamp(look.targetPitch - step, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      dirty = true;
    } else if (event.key === '+' || event.key === '=') {
      look.targetFov = clamp(look.targetFov * 0.86, 12, 100);
      dirty = true;
    } else if (event.key === '-' || event.key === '_') {
      look.targetFov = clamp(look.targetFov * 1.14, 12, 100);
      dirty = true;
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);

  // --- resize + render loop --------------------------------------------------

  function resize() {
    if (disposed) return;
    const width = Math.max(1, wrap.clientWidth);
    const height = Math.max(1, wrap.clientHeight);
    const aspect = width / height;
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    dirty = true;
  }

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => resize())
    : null;
  resizeObserver?.observe(wrap);
  resize();

  function maybeAdapt(now, dtMs, loading) {
    recordFrame(dtMs);
    if (loading) {
      slowFrames = 0;
      fastFrames = 0;
      return;
    }
    if (dtMs > 42) {
      slowFrames += 1;
      fastFrames = 0;
    } else if (dtMs < 19) {
      fastFrames += 1;
      slowFrames = 0;
    } else {
      slowFrames = 0;
      fastFrames = 0;
    }
    if (slowFrames > 90 && pixelRatio > 1.05) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      slowFrames = 0;
      resize();
    } else if (slowFrames > 150 && adaptiveMaxOrder > baseOrder + 1) {
      adaptiveMaxOrder -= 1;
      slowFrames = 0;
      updateDesiredTiles(true);
    } else if (fastFrames > 240 && pixelRatio < Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap ?? MAX_PIXEL_RATIO)) {
      pixelRatio = Math.min(quality.pixelRatioCap ?? MAX_PIXEL_RATIO, pixelRatio + 0.25);
      fastFrames = 0;
      resize();
    }
  }

  function schedulePrefetch() {
    if (!quality.prefetch || disposed || document.hidden) return;
    const next = epochs[(activeEpochIndex + 1) % epochs.length];
    if (!next || next.id === activeEpoch.id) return;
    const run = () => {
      if (disposed || activeEpoch.id === next.id) return;
      // One small base texture plus the nearest twelve order-1 tiles. This is
      // intentionally cheap: the next epoch becomes instant without competing
      // with the current view's detail requests.
      if (!baseTextures.has(next.id) && !basePromises.has(next.id)) {
        loadBaseTexture(next.id, -80).then((texture) => {
          if (!baseTextures.has(next.id)) baseTextures.set(next.id, texture);
        }).catch(() => {});
      }
      const nearest = detailTilesForView({
        ra: viewRaDec().ra,
        dec: viewRaDec().dec,
        fovDeg: 100,
        baseOrder,
        maxOrder: baseOrder,
      }).slice(0, 12);
      for (const tile of nearest) {
        pendingPrefetch += 1;
        requestTile(next.id, tile.order, tile.ipix, -60).finally(() => {
          pendingPrefetch = Math.max(0, pendingPrefetch - 1);
        });
      }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 2500);
  }

  let prefetchTimer = 0;
  function armPrefetch() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(schedulePrefetch, 2600);
  }

  function animate() {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
    const dtMs = Math.min(250, Math.max(0, now - lastFrameTime));
    lastFrameTime = now;

    if (document.hidden) return;

    const easing = 1 - Math.exp(-12 * dt);
    const previousYaw = look.yaw;
    const previousPitch = look.pitch;
    const previousFov = look.fov;
    look.yaw += (look.targetYaw - look.yaw) * easing;
    look.pitch += (look.targetPitch - look.pitch) * easing;
    look.fov += (look.targetFov - look.fov) * easing;

    const moved = Math.abs(look.yaw - previousYaw) > 1e-5 ||
      Math.abs(look.pitch - previousPitch) > 1e-5;
    const zoomed = Math.abs(look.fov - previousFov) > 1e-3;
    if (moved || zoomed) dirty = true;

    if (dirty) {
      camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
      if (Math.abs(camera.fov - look.fov) > 1e-4) {
        camera.fov = look.fov;
        camera.updateProjectionMatrix();
      }
      if (sourceLayer) {
        sourceLayer.material.uniforms.uScale.value = Math.tan(look.fov * DEG * 0.5) / Math.tan(31 * DEG);
      }
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      dirty = false;
      maybeAdapt(now, dtMs, loader.active.size + loader.queue.length > 0);
    }

    if (moved || zoomed) {
      emitView(now);
      updateDesiredTiles(false);
    }
    if (now - lastStatsTime > 500) {
      lastStatsTime = now;
      tileStats.loaded = [...epochStates.values()].reduce((sum, state) => sum + state.meshes.size, 0);
      tileStats.pending = loader.active.size + loader.queue.length;
      tileStats.bytes = loader.bytes;
      emitStats(now);
    }
  }

  // Start on the first epoch, then let React attach the sources and timeline.
  activateEpoch(activeEpochIndex);
  emitView(performance.now(), true);
  armPrefetch();
  frame = requestAnimationFrame(animate);

  return {
    setEpoch(index) {
      clearTimeout(prefetchTimer);
      activateEpoch(index);
      armPrefetch();
    },
    setSources,
    setShowSources,
    selectSource,
    focusSource,
    pickSource,
    zoomBy(factor) {
      look.targetFov = clamp(look.targetFov * factor, 12, 100);
      dirty = true;
      updateDesiredTiles(true);
    },
    resetView() {
      look.targetYaw = 0;
      look.targetPitch = 0;
      look.targetFov = quality.initialFov ?? 62;
      dirty = true;
      updateDesiredTiles(true);
    },
    getView() {
      return { ...viewRaDec(), fov: look.targetFov };
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(prefetchTimer);
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      loader.dispose();
      tileTextures.clear();
      tilePromises.clear();
      for (const texture of baseTextures.values()) {
        texture.dispose();
        texture.image?.close?.();
      }
      baseTextures.clear();
      basePromises.clear();
      for (const state of epochStates.values()) {
        for (const mesh of state.meshes.values()) {
          mesh.geometry?.dispose?.();
          mesh.material?.dispose?.();
        }
        state.meshes.clear();
        state.baseMesh?.geometry?.dispose?.();
        state.baseMesh?.material?.dispose?.();
        scene.remove(state.group);
      }
      epochStates.clear();
      if (sourceLayer) {
        scene.remove(sourceLayer);
        sourceLayer.geometry?.dispose?.();
        sourceLayer.material?.dispose?.();
        sourceLayer = null;
      }
      scene.remove(backgroundStars);
      backgroundStars.geometry.dispose();
      backgroundStars.material.dispose();
      scene.remove(graticule);
      graticule.geometry.dispose();
      graticule.material.dispose();
      renderer.dispose();
    },
  };
}
