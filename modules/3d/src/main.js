import * as THREE from 'three';
import { ProceduralWorld } from './world.js';
import { FreeFlightControls } from './controls.js';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050811);
scene.fog = new THREE.FogExp2(0x050811, 0.00125);
const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.08, 900);
camera.position.set(0, 0, 0);
camera.rotation.order = 'YXZ';

// Subtle color atmosphere, no physical lights needed for line-based materials.
const world = new ProceduralWorld(scene, { sectorSize: 72, viewRadius: 1 });
const controls = new FreeFlightControls(camera, canvas);
world.update(camera.position);

const $ = id => document.getElementById(id);
const posX = $('posX'), posY = $('posY'), posZ = $('posZ');
const fpsEl = $('fps'), chunksEl = $('chunks'), statusEl = $('status'), toast = $('toast');
let previous = performance.now(), elapsed = 0, frames = 0, fps = 0, toastTimer;
let sectorCount = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1900);
}
canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) showToast('CLICK TO CAPTURE POINTER · ESC TO RELEASE');
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  statusEl.textContent = locked ? 'FLIGHT ACTIVE' : 'WORLD ONLINE';
  if (locked) showToast('FLIGHT CONTROL ENABLED');
});
$('hideHelp').addEventListener('click', () => { $('controlsCard').hidden = true; $('showHelp').hidden = false; });
$('showHelp').addEventListener('click', () => { $('controlsCard').hidden = false; $('showHelp').hidden = true; });

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  elapsed += dt; frames++;
  controls.update(dt);
  sectorCount = world.update(camera.position);
  renderer.render(scene, camera);

  if (elapsed >= 0.25) {
    fps = Math.round(frames / elapsed);
    fpsEl.textContent = `${fps} FPS`;
    posX.textContent = formatCoord(camera.position.x);
    posY.textContent = formatCoord(camera.position.y);
    posZ.textContent = formatCoord(camera.position.z);
    chunksEl.textContent = `${sectorCount} ACTIVE SECTORS`;
    elapsed = 0; frames = 0;
  }
}
function formatCoord(n) { return (n < 0 ? '−' : '') + Math.abs(n).toFixed(1).padStart(5, '0'); }
function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => { controls.dispose(); world.dispose(); renderer.dispose(); });
requestAnimationFrame(animate);
