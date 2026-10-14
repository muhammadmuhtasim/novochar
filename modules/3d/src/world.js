import * as THREE from 'three';

// Infinite-feeling world: only nearby sectors exist in memory. Each sector is
// seeded from its integer coordinates, so revisiting it regenerates the same geometry.
export class ProceduralWorld {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.sectorSize = options.sectorSize ?? 72;
    this.viewRadius = options.viewRadius ?? 1;
    this.sectors = new Map();
    this.materials = [
      new THREE.LineBasicMaterial({ color: 0x39dfff, transparent: true, opacity: 0.78 }),
      new THREE.LineBasicMaterial({ color: 0x688bff, transparent: true, opacity: 0.65 }),
      new THREE.LineBasicMaterial({ color: 0xc16bff, transparent: true, opacity: 0.62 }),
      new THREE.LineBasicMaterial({ color: 0x45ffd0, transparent: true, opacity: 0.48 })
    ];
    this.starMaterial = new THREE.PointsMaterial({ color: 0x82cfff, size: 0.12, transparent: true, opacity: 0.7, sizeAttenuation: true });
  }

  key(x, y, z) { return `${x},${y},${z}`; }
  coord(value) { return Math.floor(value / this.sectorSize); }

  update(position) {
    const cx = this.coord(position.x), cy = this.coord(position.y), cz = this.coord(position.z);
    const needed = new Set();
    for (let x = cx - this.viewRadius; x <= cx + this.viewRadius; x++) {
      for (let y = cy - this.viewRadius; y <= cy + this.viewRadius; y++) {
        for (let z = cz - this.viewRadius; z <= cz + this.viewRadius; z++) {
          const key = this.key(x, y, z); needed.add(key);
          if (!this.sectors.has(key)) this.sectors.set(key, this.createSector(x, y, z));
        }
      }
    }
    for (const [key, group] of this.sectors) {
      if (!needed.has(key)) {
        this.scene.remove(group);
        group.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
        });
        this.sectors.delete(key);
      }
    }
    return this.sectors.size;
  }

  createSector(sx, sy, sz) {
    const size = this.sectorSize;
    const origin = new THREE.Vector3(sx * size, sy * size, sz * size);
    const group = new THREE.Group();
    group.position.copy(origin);
    group.userData.sector = [sx, sy, sz];
    const rand = makeRandom(hash3(sx, sy, sz));

    // A faint orthogonal grid makes depth and direction legible without a floor.
    const gridPositions = [];
    const divisions = 6, step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
      const p = i * step;
      // Grid on the sector's XY, XZ and YZ faces, repeated in each sector.
      gridPositions.push(0,p,0, size,p,0, 0,p,size, size,p,size);
      gridPositions.push(p,0,0, p,size,0, p,0,size, p,size,size);
      gridPositions.push(0,0,p, size,0,p, 0,size,p, size,size,p);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
    const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x174466, transparent: true, opacity: 0.22 }));
    group.add(grid);

    // Procedural wireframe primitives scattered in 3D, not on a ground plane.
    const count = 13;
    for (let i = 0; i < count; i++) {
      const type = Math.floor(rand() * 4);
      const sizeObj = 1.3 + Math.pow(rand(), 2) * 7.5;
      let geometry;
      if (type === 0) geometry = new THREE.BoxGeometry(sizeObj, sizeObj * (0.55 + rand()), sizeObj * (0.55 + rand()));
      else if (type === 1) geometry = new THREE.IcosahedronGeometry(sizeObj * 0.68, 1);
      else if (type === 2) geometry = new THREE.OctahedronGeometry(sizeObj * 0.8, 0);
      else geometry = new THREE.TorusKnotGeometry(sizeObj * 0.32, Math.max(0.09, sizeObj * 0.035), 48, 5, 2 + Math.floor(rand()*3), 3);
      const edges = new THREE.EdgesGeometry(geometry, 13);
      geometry.dispose();
      const mesh = new THREE.LineSegments(edges, this.materials[Math.floor(rand() * this.materials.length)]);
      mesh.position.set(5 + rand() * (size - 10), 5 + rand() * (size - 10), 5 + rand() * (size - 10));
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      group.add(mesh);
    }

    // Tiny distant points add a sense of scale without expensive lighting.
    const starCount = 34, starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPositions[i*3] = rand() * size;
      starPositions[i*3+1] = rand() * size;
      starPositions[i*3+2] = rand() * size;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    group.add(new THREE.Points(starGeo, this.starMaterial));

    this.scene.add(group);
    return group;
  }

  dispose() {
    for (const group of this.sectors.values()) {
      this.scene.remove(group);
      group.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
    }
    this.sectors.clear();
    for (const material of this.materials) material.dispose();
    this.starMaterial.dispose();
  }
}

function hash3(x, y, z) {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ z, 0x27d4eb2f);
  return h >>> 0;
}
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
