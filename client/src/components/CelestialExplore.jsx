import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { raDecToSkyDirection } from '../lib/sky-coordinates.js';

// Bright-star reference positions (ICRS/J2000; approximate catalog values).
// Procedural background points are decorative only and are never presented as catalog objects.
const BRIGHT_STARS = [
  { id: 'HIP-32349', name: 'Sirius', aliases: ['Alpha Canis Majoris'], type: 'Star', ra: 101.2872, dec: -16.7161, mag: -1.46, color: '#c9e3ff', description: "The brightest star in Earth's night sky." },
  { id: 'HIP-30438', name: 'Canopus', aliases: ['Alpha Carinae'], type: 'Star', ra: 95.9879, dec: -52.6957, mag: -0.74, color: '#fff0d5', description: 'A luminous star in the constellation Carina.' },
  { id: 'HIP-69673', name: 'Arcturus', aliases: ['Alpha Boötis'], type: 'Star', ra: 213.9153, dec: 19.1824, mag: -0.05, color: '#ffd3a1', description: 'A bright orange giant in Boötes.' },
  { id: 'HIP-71683', name: 'Alpha Centauri', aliases: ['Rigil Kentaurus'], type: 'Star system', ra: 219.9021, dec: -60.8339, mag: -0.27, color: '#fff0cf', description: 'The nearest star system to the Sun.' },
  { id: 'HIP-91262', name: 'Vega', aliases: ['Alpha Lyrae'], type: 'Star', ra: 279.2347, dec: 38.7837, mag: 0.03, color: '#c8e2ff', description: 'A bright blue-white star in Lyra.' },
  { id: 'HIP-97649', name: 'Altair', aliases: ['Alpha Aquilae'], type: 'Star', ra: 297.6958, dec: 8.8683, mag: 0.77, color: '#f4f4ff', description: 'A rapidly rotating star in Aquila.' },
  { id: 'HIP-102098', name: 'Deneb', aliases: ['Alpha Cygni'], type: 'Star', ra: 310.3579, dec: 45.2803, mag: 1.25, color: '#d9e9ff', description: 'A luminous supergiant in Cygnus.' },
  { id: 'HIP-24608', name: 'Capella', aliases: ['Alpha Aurigae'], type: 'Star system', ra: 79.1723, dec: 45.9979, mag: 0.08, color: '#fff0cf', description: 'A bright multiple-star system in Auriga.' },
  { id: 'HIP-24436', name: 'Rigel', aliases: ['Beta Orionis'], type: 'Star', ra: 78.6345, dec: -8.2016, mag: 0.13, color: '#c7e2ff', description: 'A blue-white supergiant in Orion.' },
  { id: 'HIP-27989', name: 'Betelgeuse', aliases: ['Alpha Orionis'], type: 'Star', ra: 88.7929, dec: 7.4071, mag: 0.50, color: '#ffb38b', description: 'A red supergiant in Orion.' },
  { id: 'HIP-37279', name: 'Procyon', aliases: ['Alpha Canis Minoris'], type: 'Star', ra: 114.8255, dec: 5.2249, mag: 0.34, color: '#fff3dc', description: 'A bright star in Canis Minor.' },
  { id: 'HIP-37826', name: 'Pollux', aliases: ['Beta Geminorum'], type: 'Star', ra: 116.3289, dec: 28.0262, mag: 1.14, color: '#ffd4a3', description: 'An orange giant in Gemini.' },
  { id: 'HIP-49669', name: 'Regulus', aliases: ['Alpha Leonis'], type: 'Star', ra: 152.0929, dec: 11.9672, mag: 1.35, color: '#d7e8ff', description: 'The brightest star in Leo.' },
  { id: 'HIP-65474', name: 'Spica', aliases: ['Alpha Virginis'], type: 'Star', ra: 201.2983, dec: -11.1613, mag: 0.97, color: '#bcdcff', description: 'A close binary system in Virgo.' },
  { id: 'HIP-80763', name: 'Antares', aliases: ['Alpha Scorpii'], type: 'Star', ra: 247.3519, dec: -26.4320, mag: 1.06, color: '#ff9a78', description: 'A red supergiant in Scorpius.' },
  { id: 'HIP-11767', name: 'Polaris', aliases: ['North Star', 'Alpha Ursae Minoris'], type: 'Star', ra: 37.9546, dec: 89.2641, mag: 1.98, color: '#fff4df', description: 'A star located close to the north celestial pole.' },
  { id: 'HIP-9884', name: 'Hamal', aliases: ['Alpha Arietis'], type: 'Star', ra: 31.7934, dec: 23.4624, mag: 2.00, color: '#ffd4a3', description: 'The brightest star in Aries.' },
  { id: 'HIP-85927', name: 'Shaula', aliases: ['Lambda Scorpii'], type: 'Star', ra: 263.4022, dec: -37.1038, mag: 1.62, color: '#c8e1ff', description: 'A hot multiple-star system in Scorpius.' },
  { id: 'HIP-113368', name: 'Fomalhaut', aliases: ['Alpha Piscis Austrini'], type: 'Star', ra: 344.4127, dec: -29.6222, mag: 1.16, color: '#e2edff', description: 'A bright star surrounded by a debris disk.' },
  { id: 'HIP-26311', name: 'Alnilam', aliases: ['Epsilon Orionis'], type: 'Star', ra: 84.0534, dec: -1.2019, mag: 1.69, color: '#c9e2ff', description: 'The middle star in Orion’s Belt.' },
  { id: 'HIP-26727', name: 'Alnitak', aliases: ['Zeta Orionis'], type: 'Star', ra: 85.1897, dec: -1.9426, mag: 1.77, color: '#c6e1ff', description: 'The easternmost star in Orion’s Belt.' },
  { id: 'HIP-25930', name: 'Mintaka', aliases: ['Delta Orionis'], type: 'Star', ra: 83.0017, dec: -0.2991, mag: 2.23, color: '#d1e6ff', description: 'The westernmost star in Orion’s Belt.' },
  { id: 'HIP-67301', name: 'Alkaid', aliases: ['Eta Ursae Majoris'], type: 'Star', ra: 206.8852, dec: 49.3133, mag: 1.86, color: '#cbe3ff', description: 'A blue-white star at the end of the Big Dipper’s handle.' },
  { id: 'HIP-57632', name: 'Denebola', aliases: ['Beta Leonis'], type: 'Star', ra: 177.2649, dec: 14.5721, mag: 2.14, color: '#e5eeff', description: 'A white star marking the tail of Leo.' },
  { id: 'HIP-78401', name: 'Dschubba', aliases: ['Delta Scorpii'], type: 'Star', ra: 240.0834, dec: -22.6217, mag: 2.32, color: '#d5e7ff', description: 'A hot star near the head of Scorpius.' },
];function directionFromRaDec(raDeg, decDeg, radius = 100) {
  return new THREE.Vector3(...raDecToSkyDirection(raDeg, decDeg)).multiplyScalar(radius);
}

function formatRa(deg) {
  const hours = ((deg / 15) % 24 + 24) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const s = Math.round((((hours - h) * 60) - m) * 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}
function formatDec(deg) {
  const sign = deg < 0 ? '−' : '+';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′`;
}

export default function CelestialExplore() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [magnitudeLimit, setMagnitudeLimit] = useState(5.5);
  const [starScale, setStarScale] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [helpVisible, setHelpVisible] = useState(true);
  const [notice, setNotice] = useState('Drag to look around · Scroll to zoom');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BRIGHT_STARS.slice(0, 7);
    return BRIGHT_STARS.filter((s) => `${s.name} ${s.id} ${s.aliases.join(' ')}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onStarSelected = (event) => {
      const star = event.detail;
      setSelected(star || null);
      if (star) { setQuery(star.name); setSearchOpen(false); setNotice(`${star.name} selected`); }
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

    // A faint nebular haze is a visual atmosphere, not a scientific Milky Way survey layer.
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

    // Deterministic procedural points fill the view but are intentionally not selectable or identified as catalog stars.
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

    const positions = [];
    const colors = [];
    const sizes = [];
    BRIGHT_STARS.forEach((star) => {
      const p = directionFromRaDec(star.ra, star.dec, 96);
      positions.push(p.x, p.y, p.z);
      const c = new THREE.Color(star.color);
      colors.push(c.r, c.g, c.b);
      sizes.push(Math.max(1.7, 5.5 - star.mag * 1.05));
    });
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    starGeometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    const starMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 1 }, uBrightness: { value: 1 } },
      vertexShader: `attribute float size; attribute vec3 color; uniform float uScale; varying vec3 vColor; varying float vAlpha; void main(){ vColor=color; vAlpha=length(color)>0.001?1.0:0.0; vec4 mvPosition=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mvPosition; gl_PointSize=max(0.0,size*uScale); }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha; uniform float uBrightness; void main(){ vec2 p=gl_PointCoord-vec2(0.5); float d=length(p); float a=1.0-smoothstep(0.22,0.5,d); if(a<0.02 || vAlpha<0.5) discard; gl_FragColor=vec4(vColor*uBrightness,a); }`,
    });
    const catalogPoints = new THREE.Points(starGeometry, starMaterial);
    catalogPoints.userData.catalogStars = BRIGHT_STARS;
    scene.add(catalogPoints);

    // Soft glow sprite for the brighter catalog stars.
    const glowCanvas = document.createElement('canvas'); glowCanvas.width = 64; glowCanvas.height = 64;
    const gctx = glowCanvas.getContext('2d');
    const glow = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)'); glow.addColorStop(0.12, 'rgba(170,205,255,0.45)'); glow.addColorStop(1, 'rgba(80,130,255,0)');
    gctx.fillStyle = glow; gctx.fillRect(0, 0, 64, 64);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const glowSprites = new THREE.Group();
    BRIGHT_STARS.filter((s) => s.mag < 1.2).forEach((star) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: star.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
      sprite.position.copy(directionFromRaDec(star.ra, star.dec, 95));
      sprite.scale.setScalar(1.3 + Math.max(0, 1 - star.mag) * 1.4);
      sprite.userData.starId = star.id;
      glowSprites.add(sprite);
    });
    scene.add(glowSprites);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 1.15;
    const pointer = new THREE.Vector2();
    let yaw = 0, pitch = 0, dragging = false, lastX = 0, lastY = 0, startX = 0, startY = 0, disposed = false, frame = 0;
    let targetYaw = 0, targetPitch = 0;
    const selectedMarker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 32), new THREE.MeshBasicMaterial({ color: 0xffa14a, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
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
        const hits = raycaster.intersectObject(catalogPoints);
        if (hits.length) {
          const star = BRIGHT_STARS[hits[0].index];
          if (star && star.mag <= (catalogPoints.userData.magnitudeLimit ?? 5.5)) canvas.dispatchEvent(new CustomEvent('sky-star-select', { detail: star }));
        }
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.025, 28, 88);
      camera.updateProjectionMatrix();
    };
    const onSelect = (e) => {
      const star = e.detail;
      if (!star) { selectedMarker.visible = false; return; }
      selectedMarker.position.copy(directionFromRaDec(star.ra, star.dec, 94.4));
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
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('sky-star-select', onSelect);
    window.addEventListener('keydown', onKeyDown);

    const resize = () => {
      const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(resize); ro.observe(wrap); resize();
    const compass = wrap.querySelector('.celestial-compass');
    const compassNeedle = wrap.querySelector('.compass-needle');
    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      yaw += (targetYaw - yaw) * 0.18;
      pitch += (targetPitch - pitch) * 0.18;
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      selectedMarker.quaternion.copy(camera.quaternion);
      if (compassNeedle) {
        // Compass points toward celestial north; yaw 0 is toward RA=0h (Dec=0)
        // North celestial pole is at dec=+90; in our mapping, +Y is north
        // Needle rotation: in CSS, 0deg points up (north). We rotate based on yaw.
        const rot = (-yaw * 180 / Math.PI + 360) % 360;
        compassNeedle.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);
    catalogPoints.userData.magnitudeLimit = 5.5;
    engineRef.current = { camera, renderer, catalogPoints, starMaterial, bgMaterial, selectedMarker, scene, setTarget: (star) => { targetYaw = -THREE.MathUtils.degToRad(star.ra); targetPitch = THREE.MathUtils.degToRad(star.dec); } };

    return () => {
      disposed = true; cancelAnimationFrame(frame); ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
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
    const sizeAttr = engine.catalogPoints.geometry.attributes.size;
    BRIGHT_STARS.forEach((star, i) => {
      sizeAttr.array[i] = star.mag <= magnitudeLimit ? Math.max(1.7, 5.5 - star.mag * 1.05) : 0;
    });
    sizeAttr.needsUpdate = true;
    engine.catalogPoints.userData.magnitudeLimit = magnitudeLimit;
    engine.starMaterial.uniforms.uScale.value = starScale;
    engine.starMaterial.uniforms.uBrightness.value = starScale;
    engine.bgMaterial.opacity = Math.min(0.98, 0.76 * starScale);
  }, [magnitudeLimit, starScale]);

  const selectStar = (star) => {
    setSelected(star); setQuery(star.name); setSearchOpen(false);
    setNotice(`${star.name} selected`);
    const engine = engineRef.current;
    if (engine) {
      engine.selectedMarker.position.copy(directionFromRaDec(star.ra, star.dec, 94.4));
      engine.selectedMarker.visible = true;
      engine.setTarget(star);
    }
  };

  const clearSelection = () => {
    setSelected(null);
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
            {results.length ? results.map((star) => <button key={star.id} className="explore-search-result" onMouseDown={(e) => e.preventDefault()} onClick={() => selectStar(star)}><span className="result-star-dot" style={{ background: star.color }} /><span><strong>{star.name}</strong><small>{star.aliases[0]} · Mag {star.mag.toFixed(2)}</small></span><span className="result-arrow">↗</span></button>) : <div className="explore-no-results">No matching catalog star in this preview.</div>}
          </div>}
        </div>
        {showSettings && <div className="explore-settings">
          <div className="explore-settings-head"><strong>VIEW SETTINGS</strong><button onClick={() => setShowSettings(false)} aria-label="Close settings">×</button></div>
          <label>Star visibility <span>magnitude ≤ {magnitudeLimit.toFixed(1)}</span><input type="range" min="0" max="6.5" step="0.5" value={magnitudeLimit} onChange={(e) => setMagnitudeLimit(Number(e.target.value))} /></label>
          <label>Star intensity <span>{starScale.toFixed(1)}×</span><input type="range" min="0.5" max="2.5" step="0.1" value={starScale} onChange={(e) => setStarScale(Number(e.target.value))} /></label>
          <p>Coordinate grids and axes are intentionally hidden in Explore mode.</p>
        </div>}
        {selected && <aside className="explore-object-card">
          <div className="explore-object-head"><span className="object-kicker">SELECTED OBJECT</span><button onClick={clearSelection} aria-label="Close object details">×</button></div>
          <div className="explore-object-title"><span className="object-color-dot" style={{ background: selected.color, boxShadow: `0 0 14px ${selected.color}` }} /><div><h3>{selected.name}</h3><p>{selected.type} <span>·</span> {selected.aliases[0]}</p></div></div>
          <p className="explore-object-description">{selected.description}</p>
          <div className="explore-object-stats"><div><small>Apparent brightness</small><strong>{selected.mag.toFixed(2)} mag</strong></div><div><small>Right ascension</small><strong>{formatRa(selected.ra)}</strong></div><div><small>Declination</small><strong>{formatDec(selected.dec)}</strong></div><div><small>Catalog ID</small><strong>{selected.id}</strong></div></div>
          <p className="explore-data-note">Approximate J2000/ICRS reference values. This initial preview contains a curated bright-star list; the background star field is procedural and is not a scientific catalog.</p>
        </aside>}
        {helpVisible && !selected && <div className="explore-welcome"><button className="explore-welcome-close" onClick={() => setHelpVisible(false)} aria-label="Dismiss welcome">×</button><span className="welcome-kicker">WELCOME TO NOVOCHAR</span><h3>Look around.</h3><p>Explore the star field. Search for a known star or select a bright catalog object to learn more.</p><div><span>DRAG</span> Look around <span>SCROLL</span> Zoom</div></div>}
      </div>
      <div className="explore-footer"><span><i /> EXPLORE MODE ACTIVE</span><span>SCIENTIFIC GRIDS OFF <b>·</b> OBJECT INSPECTION ON DEMAND</span></div>
    </section>
  );
}
