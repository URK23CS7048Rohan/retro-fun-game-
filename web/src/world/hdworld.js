import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, Noise2D, poissonDisc, clamp, smooth, lerp } from '../core/rng.js';
import { pbr, texSet } from '../engine/pbr.js';
import { GrassField } from './grass.js';
import { Forest, leafTexture } from './trees.js';

// One floor of the tower, HD version. Layout: walled town at the centre with
// a plaza, fountain and teleport gate; meadows and woods around it; a road
// north to the boss arena at the foot of the labyrinth tower.

export const WORLD_R = 118;
const CELL = 2;

// Collects geometry per material and merges it, so a whole town is a few
// draw calls instead of thousands.
class Batcher {
  constructor() { this.buckets = new Map(); }
  add(geo, mat, matrix) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(matrix);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
  }
  flush(group, { cast = true, receive = true } = {}) {
    for (const [mat, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      group.add(mesh);
    }
    this.buckets.clear();
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function mat4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
// Box with UVs in metres (texture tiles every `tile` metres).
function box(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g;
}
function cyl(rt, rb, h, seg, tile = 1, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const uv = g.attributes.uv, circ = Math.PI * 2 * Math.max(rt, rb);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / tile, uv.getY(i) * h / tile);
  return g;
}

function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class HDWorld {
  constructor(floor, opts = {}) {
    this.floor = floor;
    this.opts = opts;
    this.seed = 1000 + floor * 7919;
    this.rng = new RNG(this.seed);
    this.noise = new Noise2D(this.seed);
    this.group = new THREE.Group();
    this.colliders = []; this.boxes = [];
    this.townR = 30;
    this.arena = { x: 0, z: -80, r: 16 };
    this.tower = { x: 0, z: -118, r: 15 };
    this.spawnZones = []; this.npcSpots = [];
    this.houses = []; this.stalls = []; this.chimneys = []; this.ivy = [];
    this.animated = [];
    this.mats = {
      plaster: ['#fbf3e4', '#f6e6c8', '#f3dcc0', '#ece4d8'].map((c) => pbr('plastered_wall_04', { color: c, normalScale: 0.6 })),
      timber: pbr('medieval_wood', { color: '#8a6a52' }),
      timberDark: pbr('medieval_wood', { color: '#5a4434' }),
      roof: pbr('clay_roof_tiles_02', { color: '#ffffff', normalScale: 1.2 }),
      roofDark: pbr('clay_roof_tiles_02', { color: '#c8a090', normalScale: 1.2 }),
      stone: pbr('medieval_blocks_02', { color: '#e8e0d4' }),
      stoneDark: pbr('medieval_blocks_02', { color: '#a89c90' }),
      cobble: pbr('cobblestone_floor_08'),
      slate: pbr('castle_wall_slates', { color: '#8890a8' }),
      rock: pbr('rock_wall_08', { color: '#b8b0a4' }),
      iron: new THREE.MeshStandardMaterial({ color: '#2a2a2e', metalness: 0.8, roughness: 0.45 }),
      brass: new THREE.MeshStandardMaterial({ color: '#c8a050', metalness: 1, roughness: 0.3 }),
      glass: new THREE.MeshStandardMaterial({ color: '#2a1a10', emissive: '#ffb060', emissiveIntensity: 1.6, roughness: 0.2 }),
      glassDim: new THREE.MeshStandardMaterial({ color: '#2a2a34', emissive: '#4a3a30', emissiveIntensity: 0.4, roughness: 0.1, metalness: 0.2 }),
      lampGlow: new THREE.MeshStandardMaterial({ color: '#ffd8a0', emissive: '#ffb050', emissiveIntensity: 4 }),
      cloth: ['#a8262a', '#2a4a7a', '#c8902a', '#3a6a3a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide })),
    };
    this.build();
  }

  // ---------------- height field ----------------
  pathCenter(z) {
    const t = clamp((-z - this.townR) / (-this.arena.z - this.townR), 0, 1);
    return Math.sin(t * Math.PI * 1.5) * 14;
  }
  pathDist(x, z) {
    if (-z < this.townR - 2 || -z > -this.arena.z) return 999;
    return Math.abs(x - this.pathCenter(z));
  }
  rawHeight(x, z) {
    const n = this.noise;
    let h = n.fbm(x * 0.011, z * 0.011, 4) * 15 + n.fbm(x * 0.045, z * 0.045, 2) * 1.4;
    const r = Math.hypot(x, z);
    h = lerp(1.0, h, smooth(clamp((r - this.townR) / 20, 0, 1)));
    const a = Math.hypot(x - this.arena.x, z - this.arena.z);
    h = lerp(2.5, h, smooth(clamp((a - this.arena.r) / 16, 0, 1)));
    const pd = this.pathDist(x, z);
    if (pd < 14) h = lerp(h * 0.35 + 1.2, h, smooth(clamp((pd - 3) / 11, 0, 1)));
    const ang = Math.atan2(z, x);
    const north = Math.abs(ang + Math.PI / 2) < 0.55;
    if (!north && r > 82) {
      const ridge = Math.max(0, this.noise.fbm(Math.cos(ang) * 3 + 11, Math.sin(ang) * 3 + 7, 4) + 0.15);
      h += smooth(clamp((r - 82) / 26, 0, 1)) * ridge * 70 * (0.6 + 0.4 * Math.abs(this.noise.noise(x * 0.06, z * 0.06)));
    }
    if (r > WORLD_R - 4) h -= Math.pow((r - (WORLD_R - 4)) / 6, 2) * 30;
    return h;
  }
  heightAt(x, z) {
    const g = this.hgrid, N = this.N, half = (N - 1) * CELL / 2;
    const fx = (x + half) / CELL, fz = (z + half) / CELL;
    const ix = clamp(Math.floor(fx), 0, N - 2), iz = clamp(Math.floor(fz), 0, N - 2);
    const tx = clamp(fx - ix, 0, 1), tz = clamp(fz - iz, 0, 1);
    return lerp(lerp(g[iz * N + ix], g[iz * N + ix + 1], tx), lerp(g[(iz + 1) * N + ix], g[(iz + 1) * N + ix + 1], tx), tz);
  }
  // splat weights: [grass, forest floor, dirt path, cobble]
  splat(x, z) {
    const r = Math.hypot(x, z);
    let cob = 1 - smooth(clamp((r - 13) / 1.5, 0, 1));
    if (r < this.townR + 1 && (Math.abs(x) < 3 || Math.abs(z) < 3)) cob = Math.max(cob, 1 - smooth(clamp((Math.min(Math.abs(x), Math.abs(z)) - 2.4) / 0.8, 0, 1)));
    const a = Math.hypot(x - this.arena.x, z - this.arena.z);
    cob = Math.max(cob, 1 - smooth(clamp((a - this.arena.r + 2) / 2, 0, 1)));
    const pd = this.pathDist(x, z);
    let dirt = 1 - smooth(clamp((pd - 2.2) / 1.6, 0, 1));
    dirt += Math.max(0, this.noise.fbm(x * 0.3, z * 0.3, 2)) * dirt;
    // worn grass ring inside the town wall
    if (r > 13 && r < this.townR) dirt = Math.max(dirt, clamp(this.noise.fbm(x * 0.15, z * 0.15, 2) * 1.5 - 0.1, 0, 0.6));
    const forest = clamp(this.noise.fbm(x * 0.02 + 50, z * 0.02 + 50, 3) * 3 - 0.2, 0, 1) * 0.8;
    let grass = 1;
    const w = [grass, forest, dirt, cob * 1.5];
    // normalise with priority to cobble, then dirt
    w[2] *= 1 - Math.min(1, w[3]); w[1] *= 1 - Math.min(1, w[2] + w[3]); w[0] *= 1 - Math.min(1, w[1] + w[2] + w[3]);
    const s = w[0] + w[1] + w[2] + w[3];
    return w.map((v) => v / s);
  }

  build() {
    this.buildTerrain();
    this.buildTown();
    this.buildArena();
    this.buildTower();
    this.buildNature();
    this.buildSpawnZones();
  }

  buildTerrain() {
    const size = 268, N = size / CELL + 1, half = size / 2;
    this.N = N;
    const hg = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hg[j * N + i] = this.rawHeight(i * CELL - half, j * CELL - half);
    this.hgrid = hg;
    // finer render mesh: 1m cells, heights bilinear from the grid plus micro noise
    const RES = 1, M = size / RES + 1;
    const pos = [], uv = [], spl = [], idx = [];
    const vid = new Int32Array(M * M).fill(-1);
    let n = 0;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = i * RES - half, z = j * RES - half;
      if (Math.hypot(x, z) > WORLD_R + 4) continue;
      const y = this.heightAt(x, z);
      pos.push(x, y, z); uv.push(x, z); spl.push(...this.splat(x, z));
      vid[j * M + i] = n++;
    }
    for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
      const a = vid[j * M + i], b = vid[j * M + i + 1], c = vid[(j + 1) * M + i], d = vid[(j + 1) * M + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('splat', new THREE.Float32BufferAttribute(spl, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, terrainMaterial());
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrain = mesh;

    // rock skirt under the disc edge
    const under = new THREE.CylinderGeometry(WORLD_R + 4, 20, 70, 40, 6, true);
    const up = under.attributes.position;
    const r = this.rng;
    for (let i = 0; i < up.count; i++) {
      const y = up.getY(i); const k = 0.85 + r.next() * 0.3;
      if (y < 34) { up.setX(i, up.getX(i) * k); up.setZ(i, up.getZ(i) * k); }
    }
    under.computeVertexNormals();
    const uu = under.attributes.uv; for (let i = 0; i < uu.count; i++) uu.setXY(i, uu.getX(i) * 60, uu.getY(i) * 8);
    const um = new THREE.Mesh(under, pbr('rock_wall_08', { color: '#9a9080' }));
    um.position.y = -38; this.group.add(um);
  }

  // ---------------- town ----------------
  buildTown() {
    const B = new Batcher();
    const M = this.mats;
    const y0 = this.heightAt(0, 0);
    // fountain: two-tier basin with a central column
    B.add(cyl(4.6, 4.9, 0.9, 16, 1), M.stone, mat4(0, y0 + 0.45, 0));
    B.add(cyl(4.9, 4.9, 0.25, 16, 1), M.stoneDark, mat4(0, y0 + 0.95, 0));
    B.add(cyl(0.6, 0.8, 2.6, 10, 1), M.stone, mat4(0, y0 + 1.3, 0));
    B.add(cyl(1.6, 1.2, 0.35, 12, 1), M.stone, mat4(0, y0 + 2.5, 0));
    B.add(cyl(0.3, 0.4, 1.2, 8, 1), M.stone, mat4(0, y0 + 3.2, 0));
    const water = new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), new THREE.MeshStandardMaterial({ color: '#2a5a6a', roughness: 0.05, metalness: 0.1, envMapIntensity: 1.4, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, y0 + 0.78, 0); this.group.add(water);
    const water2 = new THREE.Mesh(new THREE.CircleGeometry(1.45, 20), water.material);
    water2.rotation.x = -Math.PI / 2; water2.position.set(0, y0 + 2.66, 0); this.group.add(water2);
    this.addCollider(0, 0, 5);

    // teleport gate: stone arch with a glowing ring
    const gz = -9;
    for (const s of [-1, 1]) {
      B.add(box(1.2, 7.5, 1.2, 1.5), M.stone, mat4(s * 3.2, y0 + 3.75, gz));
      B.add(box(1.6, 0.6, 1.6, 1.5), M.stoneDark, mat4(s * 3.2, y0 + 0.3, gz));
      B.add(box(1.5, 0.5, 1.5, 1.5), M.stoneDark, mat4(s * 3.2, y0 + 7.6, gz));
    }
    B.add(box(8, 1, 1.5, 1.5), M.stone, mat4(0, y0 + 8.1, gz));
    B.add(box(3, 0.8, 1.6, 1.5), M.stoneDark, mat4(0, y0 + 8.9, gz));
    const ringMat = new THREE.MeshStandardMaterial({ color: '#a0e8ff', emissive: '#40b8ff', emissiveIntensity: 2.5, metalness: 0.3, roughness: 0.3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.12, 8, 48), ringMat); ring.position.set(0, y0 + 4, gz); this.group.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.05, 6, 48), ringMat); ring2.position.set(0, y0 + 4, gz); this.group.add(ring2);
    const portal = new THREE.Mesh(new THREE.CircleGeometry(2.3, 48), new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
          float swirl = sin(a * 6.0 + r * 10.0 - uTime * 3.0) * 0.5 + 0.5;
          float k = smoothstep(1.0, 0.2, r) * (0.25 + swirl * 0.35) + smoothstep(0.85, 1.0, r) * smoothstep(1.02, 0.95, r) * 0.8;
          gl_FragColor = vec4(vec3(0.35, 0.8, 1.0) * k, 1.0); }`,
    }));
    portal.position.set(0, y0 + 4, gz); this.group.add(portal);
    this.gate = { ring, ring2, portal, x: 0, z: gz };
    this.animated.push((t) => { ring.rotation.z = t * 0.5; ring2.rotation.z = -t * 0.8; portal.material.uniforms.uTime.value = t; });
    this.addCollider(-3.2, gz, 0.9); this.addCollider(3.2, gz, 0.9);

    // lamp posts with lanterns
    this.lamps = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const x = Math.cos(a) * 12, z = Math.sin(a) * 12, y = this.heightAt(x, z);
      this.lampPost(B, x, y, z);
    }
    for (const z of [-16, -22, 16, 22]) for (const s of [-1, 1]) this.lampPost(B, s * 3.6, this.heightAt(s * 3.6, z), z);

    // houses: two rings facing the plaza, gaps for the streets
    const r = this.rng;
    const gA = Math.PI * 0.27, gx = Math.cos(gA) * 18.8, gz2 = Math.sin(gA) * 18.8;
    this.guildHall(B, gx, gz2, Math.atan2(-gx, -gz2));
    for (const [ringR, n, off] of [[18.5, 13, 0], [25.8, 18, 0.1]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + off;
        const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
        if (Math.abs(x) < 6.2 || Math.abs(z) < 6.2) continue;
        if (Math.hypot(x - gx, z - gz2) < 9) continue;
        const w = r.float(4.2, 5.4), d = r.float(4.2, 5.2);
        const fl = ringR > 20 ? (r.chance(0.35) ? 3 : 2) : (r.chance(0.6) ? 2 : 1);
        this.house(B, x, z, Math.atan2(-x, -z) + r.float(-0.06, 0.06), w, d, fl);
      }
    }
    // market stalls
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * 0.18 + i * 0.42;
      const x = Math.cos(a) * 9, z = Math.sin(a) * 9;
      this.stall(B, x, z, Math.atan2(-x, -z), i);
    }
    this.townWall(B);
    this.banners(B);
    this.signpost(B);
    B.flush(this.group);
    this.buildIvy();

    for (let i = 0; i < 12; i++) {
      const a = r.float(0, Math.PI * 2), d = r.float(6.5, 12);
      this.npcSpots.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    this.spawnPoint = [0, 7];
  }

  lampPost(B, x, y, z) {
    const M = this.mats;
    B.add(cyl(0.09, 0.13, 3.4, 8), M.iron, mat4(x, y + 1.7, z));
    B.add(cyl(0.2, 0.25, 0.25, 8), M.iron, mat4(x, y + 0.12, z));
    B.add(box(0.5, 0.06, 0.06), M.iron, mat4(x, y + 3.3, z));
    B.add(cyl(0.18, 0.12, 0.5, 6), M.lampGlow, mat4(x, y + 3.62, z));
    B.add(new THREE.ConeGeometry(0.26, 0.3, 6), M.iron, mat4(x, y + 4.0, z));
    this.addCollider(x, z, 0.25);
    this.lamps.push(new THREE.Vector3(x, y + 3.6, z));
  }

  house(B, x, z, rot, w, d, floors) {
    const M = this.mats, r = this.rng;
    const y = this.heightAt(x, z) - 0.25;
    const base = mat4(x, y, z, 0, rot, 0);
    const T = (lx, ly, lz, rx = 0, ry = 0, rz = 0) => base.clone().multiply(mat4(lx, ly, lz, rx, ry, rz));
    const plaster = M.plaster[r.int(0, 3)];
    const timber = r.chance(0.5) ? M.timber : M.timberDark;
    const fh = 3.1, plinth = 0.9, H = plinth + fh * floors;
    // stone plinth and plastered walls; upper floor jetties out slightly
    B.add(box(w + 0.24, plinth, d + 0.24, 1.2), M.stoneDark, T(0, plinth / 2, 0));
    B.add(box(w, fh, d, 2.5), plaster, T(0, plinth + fh / 2, 0));
    if (floors === 2) {
      B.add(box(w + 0.4, fh, d + 0.4, 2.5), plaster, T(0, plinth + fh * 1.5, 0));
      B.add(box(w + 0.6, 0.22, d + 0.6, 1), timber, T(0, plinth + fh, 0));
    }
    // timber framing on all four faces
    const beam = 0.16;
    for (let f = 0; f < floors; f++) {
      const ww = w + (f ? 0.4 : 0), dd = d + (f ? 0.4 : 0), by = plinth + fh * f;
      for (const [fw, fd, ry] of [[ww, dd, 0], [ww, dd, Math.PI], [dd, ww, Math.PI / 2], [dd, ww, -Math.PI / 2]]) {
        const F = (lx, ly, rz = 0, len = fh, thick = beam) => {
          const g = box(thick, len, 0.08, 1);
          B.add(g, timber, T(0, 0, 0).multiply(mat4(0, 0, 0, 0, ry, 0)).multiply(mat4(lx, by + ly, fd / 2 + 0.03, 0, 0, rz)));
        };
        F(-fw / 2 + beam / 2, fh / 2); F(fw / 2 - beam / 2, fh / 2);
        const posts = Math.max(1, Math.round(fw / 1.6));
        for (let k = 1; k < posts; k++) F(-fw / 2 + (fw * k) / posts, fh / 2);
        // horizontal rails
        const rail = (ly) => B.add(box(fw, beam, 0.08, 1), timber, T(0, 0, 0).multiply(mat4(0, 0, 0, 0, ry, 0)).multiply(mat4(0, by + ly, fd / 2 + 0.035)));
        rail(0.1); rail(fh - 0.1); rail(fh * 0.38);
        // diagonal braces in the end panels
        const pw = fw / posts, ang = Math.atan2(fh * 0.6, pw);
        const dl = Math.hypot(pw, fh * 0.6);
        F(-fw / 2 + pw / 2, fh * 0.68, -(Math.PI / 2 - ang), dl, beam * 0.8);
        F(fw / 2 - pw / 2, fh * 0.68, Math.PI / 2 - ang, dl, beam * 0.8);
      }
    }
    // windows (front and sides), with frames, sills, shutters and flower boxes
    const win = (face, lx, ly, lit) => {
      const ry = [0, Math.PI / 2, -Math.PI / 2, Math.PI][face];
      const fd = (face === 0 || face === 3) ? d / 2 : w / 2;
      const off = ly > plinth + fh ? 0.2 : 0;
      const W = T(0, 0, 0).multiply(mat4(0, 0, 0, 0, ry, 0));
      const at = (px, py, pz, rx = 0, ryy = 0) => W.clone().multiply(mat4(lx + px, ly + py, fd + off + pz, rx, ryy));
      B.add(box(0.9, 1.1, 0.04), lit ? M.glass : M.glassDim, at(0, 0, 0.0));
      B.add(box(1.06, 0.1, 0.12), timber, at(0, 0.6, 0.04)); B.add(box(1.12, 0.1, 0.2), timber, at(0, -0.6, 0.08));
      B.add(box(0.08, 1.2, 0.12), timber, at(-0.5, 0, 0.04)); B.add(box(0.08, 1.2, 0.12), timber, at(0.5, 0, 0.04));
      B.add(box(0.06, 1.1, 0.1), timber, at(0, 0, 0.04)); B.add(box(0.9, 0.06, 0.1), timber, at(0, 0.05, 0.04));
      // open shutters
      for (const s of [-1, 1]) B.add(box(0.45, 1.1, 0.05, 0.5), M.cloth[(face + 1) % 4] === undefined ? timber : timber, at(s * 0.8, 0, 0.25, 0, s * 1.2));
      if (r.chance(0.6)) {
        B.add(box(1.0, 0.22, 0.25), M.timberDark, at(0, -0.78, 0.18));
        const fm = M.cloth[r.int(0, 3)];
        for (let k = 0; k < 6; k++) B.add(new THREE.IcosahedronGeometry(0.09, 0), fm, at(-0.4 + k * 0.16, -0.6, 0.18 + (k % 2) * 0.05));
        for (let k = 0; k < 5; k++) B.add(new THREE.IcosahedronGeometry(0.1, 0), this.leafMat || (this.leafMat = new THREE.MeshStandardMaterial({ color: '#3a6a28', roughness: 0.8 })), at(-0.35 + k * 0.18, -0.68, 0.22));
      }
    };
    for (let f = 0; f < floors; f++) {
      const ly = plinth + fh * f + 1.6;
      const n = Math.max(1, Math.floor(w / 2.2));
      for (let k = 0; k < n; k++) {
        const lx = -w / 2 + (w * (k + 0.5)) / n;
        if (f === 0 && Math.abs(lx) < 0.9) continue;
        win(0, lx, ly, r.chance(0.6));
      }
      win(1, 0, ly, r.chance(0.5)); win(2, 0, ly, r.chance(0.5));
    }
    // door with frame and a little awning
    const dW = T(0, 0, 0);
    const at = (px, py, pz, rx = 0) => dW.clone().multiply(mat4(px, py, d / 2 + pz, rx));
    B.add(box(1.2, 2.3, 0.08, 1), M.timberDark, at(0, plinth + 1.15 - 0.4, 0.03));
    B.add(box(1.5, 0.18, 0.18), timber, at(0, plinth + 2.35 - 0.4, 0.06));
    for (const s of [-1, 1]) B.add(box(0.16, 2.4, 0.16), timber, at(s * 0.68, plinth + 1.2 - 0.4, 0.06));
    B.add(box(0.06, 0.06, 0.06), M.brass, at(0.4, plinth + 1.0 - 0.4, 0.1));
    B.add(box(1.9, 0.08, 1.0), M.roofDark, at(0, plinth + 2.7 - 0.4, 0.4, 0.35));
    B.add(box(1.4, 0.35, 0.8, 1), M.stoneDark, at(0, 0.18, 0.45));
    // gable roof: two thick tiled slabs with overhang, ridge cap
    const rh = Math.min(w, d) * 0.55 + 0.8;
    const span = w / 2 + 0.6;
    const slope = Math.atan2(rh, span);
    const slab = Math.hypot(span, rh) + 0.15;
    for (const s of [-1, 1]) {
      B.add(box(slab, 0.18, d + 1.2 + (floors === 2 ? 0.4 : 0), 1.6), M.roof, T(s * span / 2, H + rh / 2 - 0.1, 0, 0, 0, -s * slope));
    }
    B.add(box(0.3, 0.24, d + 1.3), M.roofDark, T(0, H + rh + 0.02, 0));
    // gable ends: triangles of plaster with a king post
    const tri = new THREE.Shape(); tri.moveTo(-w / 2 - 0.2, 0); tri.lineTo(w / 2 + 0.2, 0); tri.lineTo(0, rh - 0.05); tri.closePath();
    const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false });
    const tuv = tg.attributes.uv; for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) / 2.5, tuv.getY(i) / 2.5);
    const gd = d / 2 + (floors === 2 ? 0.2 : 0);
    B.add(tg, plaster, T(0, H, gd - 0.1)); B.add(tg, plaster, T(0, H, -gd));
    for (const zz of [gd + 0.02, -gd - 0.02]) {
      B.add(box(beam, rh - 0.2, 0.06), timber, T(0, H + rh / 2 - 0.1, zz));
      B.add(box(w + 0.3, beam, 0.06), timber, T(0, H + 0.05, zz));
    }
    // chimney
    if (r.chance(0.65)) {
      const cx = w * (r.chance(0.5) ? 0.22 : -0.22);
      B.add(box(0.7, 2.6, 0.7, 1), M.stone, T(cx, H + rh * 0.55 + 0.5, -d * 0.15));
      B.add(box(0.85, 0.15, 0.85, 1), M.stoneDark, T(cx, H + rh * 0.55 + 1.8, -d * 0.15));
      this.chimneys.push(new THREE.Vector3(cx, H + rh * 0.55 + 2.0, -d * 0.15).applyMatrix4(base));
    }
    // clutter
    if (r.chance(0.6)) {
      B.add(cyl(0.34, 0.3, 0.9, 10, 1), M.timber, T(w / 2 - 0.3, 0.45 + 0.25, d / 2 + 0.6));
      B.add(cyl(0.36, 0.36, 0.06, 10, 1), M.iron, T(w / 2 - 0.3, 0.75 + 0.25, d / 2 + 0.6));
    }
    if (r.chance(0.5)) B.add(box(0.7, 0.7, 0.7, 0.7), M.timber, T(-w / 2 + 0.3, 0.35 + 0.25, d / 2 + 0.6, 0, 0.3));
    this.boxes.push({ x, z, hw: w / 2 + 0.4, hd: d / 2 + 0.4, rot });
    this.houses.push({ x, z, hw: w / 2, hd: d / 2, rot, H });
    // ivy climbing a corner of some houses
    if (r.chance(0.45)) {
      const sx = r.chance(0.5) ? 1 : -1;
      this.ivy.push({ m: base.clone(), lx: sx * (w / 2 - 0.6), lz: d / 2 + 0.06, h: plinth + fh * floors * r.float(0.5, 0.95), face: 0 });
    }
  }

  guildHall(B, x, z, rot) {
    const M = this.mats;
    this.house(B, x, z, rot, 9.5, 7, 3);
    this.guild = this.houses[this.houses.length - 1];
    // bell tower rising from the back corner
    const base = mat4(x, this.heightAt(x, z) - 0.25, z, 0, rot, 0);
    const T = (lx, ly, lz, ry = 0) => base.clone().multiply(mat4(lx, ly, lz, 0, ry, 0));
    const tx = 3.2, tz = -2.2, th = 19;
    B.add(box(3.2, th, 3.2, 2), M.stone, T(tx, th / 2, tz));
    B.add(box(3.6, 0.4, 3.6, 2), M.stoneDark, T(tx, th - 3.6, tz));
    for (const [px, pz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) B.add(box(0.45, 3, 0.45, 1), M.stone, T(tx + px, th + 1.5, tz + pz));
    B.add(box(3.6, 0.5, 3.6, 2), M.stoneDark, T(tx, th + 3.2, tz));
    const roof = new THREE.ConeGeometry(2.9, 5.5, 4, 1);
    const ru = roof.attributes.uv; for (let k = 0; k < ru.count; k++) ru.setXY(k, ru.getX(k) * 6, ru.getY(k) * 3.5);
    B.add(roof, M.roof, T(tx, th + 6.2, tz, Math.PI / 4));
    B.add(new THREE.ConeGeometry(0.12, 1.6, 6), M.brass, T(tx, th + 9.6, tz));
    // the bell
    const bell = new THREE.LatheGeometry([new THREE.Vector2(0.01, 0.9), new THREE.Vector2(0.35, 0.85), new THREE.Vector2(0.45, 0.4), new THREE.Vector2(0.7, 0.0), new THREE.Vector2(0.72, -0.05)], 14);
    B.add(bell, M.brass, T(tx, th + 0.9, tz));
    // clock face
    const clock = new THREE.CircleGeometry(0.9, 24);
    B.add(clock, this.mats.glassDim, T(tx, th - 2.2, tz + 1.62));
    B.add(new THREE.TorusGeometry(0.92, 0.08, 6, 24), M.brass, T(tx, th - 2.2, tz + 1.64));
    const [wx, wz] = [x + tx * Math.cos(rot) + tz * Math.sin(rot), z - tx * Math.sin(rot) + tz * Math.cos(rot)];
    this.addCollider(wx, wz, 2.4);
  }

  stall(B, x, z, rot, i) {
    const M = this.mats; const y = this.heightAt(x, z);
    const base = mat4(x, y, z, 0, rot, 0);
    const T = (lx, ly, lz, rx = 0, ry = 0, rz = 0) => base.clone().multiply(mat4(lx, ly, lz, rx, ry, rz));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(box(0.12, 2.6, 0.12), M.timber, T(sx * 1.3, 1.3, sz * 0.8));
    B.add(box(2.7, 0.9, 1.4, 1), M.timberDark, T(0, 0.45, 0.1));
    B.add(box(2.8, 0.08, 1.5), M.timber, T(0, 0.92, 0.1));
    // striped awning
    const cl = M.cloth[i % 4];
    B.add(box(3.1, 0.05, 2.1), cl, T(0, 2.55, 0.2, 0.18));
    B.add(box(3.1, 0.35, 0.03), cl, T(0, 2.38, 1.22));
    // produce crates
    const fruit = [new THREE.MeshStandardMaterial({ color: '#c8382a', roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: '#e8a83a', roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: '#7aa83a', roughness: 0.6 })];
    for (let k = 0; k < 3; k++) {
      B.add(box(0.7, 0.25, 0.5), M.timber, T(-0.9 + k * 0.9, 1.08, 0.2));
      for (let q = 0; q < 6; q++) B.add(new THREE.IcosahedronGeometry(0.09, 1), fruit[(k + i) % 3], T(-1.1 + k * 0.9 + (q % 3) * 0.2, 1.26, 0.08 + Math.floor(q / 3) * 0.22));
    }
    this.addCollider(x, z, 1.5);
    this.stalls.push({ x, z, rot, hw: 1.4, hd: 0.8 });
  }

  townWall(B) {
    const M = this.mats;
    const segs = 36, R = this.townR;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, am = (a0 + a1) / 2;
      const mx = Math.cos(am) * R, mz = Math.sin(am) * R;
      if (Math.abs(mx) < 5.5) continue;
      const len = 2 * R * Math.sin(Math.PI / segs) + 0.4;
      const y = this.heightAt(mx, mz);
      const ry = -am + Math.PI / 2;
      B.add(box(len, 4.2, 1.4, 2), M.stone, mat4(mx, y + 1.6, mz, 0, ry));
      B.add(box(len + 0.1, 0.3, 1.7, 2), M.stoneDark, mat4(mx, y + 3.75, mz, 0, ry));
      // crenellations
      for (let k = -1; k <= 1; k += 2) {
        const ox = Math.cos(ry) * k * len * 0.25, oz = -Math.sin(ry) * k * len * 0.25;
        B.add(box(len * 0.3, 0.9, 1.5, 2), M.stone, mat4(mx + ox, y + 4.3, mz + oz, 0, ry));
      }
      for (let k = -1; k <= 1; k++) this.addCollider(mx + Math.cos(am + Math.PI / 2) * k * len / 3, mz + Math.sin(am + Math.PI / 2) * k * len / 3, 1.0);
    }
    // gate towers with conical roofs
    for (const gz of [-R, R]) for (const s of [-1, 1]) {
      const x = s * 5.2, y = this.heightAt(x, gz);
      B.add(cyl(1.7, 1.9, 8, 14, 2), M.stone, mat4(x, y + 3.6, gz));
      B.add(cyl(2.0, 2.0, 0.4, 14, 2), M.stoneDark, mat4(x, y + 7.8, gz));
      const cone = new THREE.ConeGeometry(2.3, 3.8, 14, 1, true);
      const cu = cone.attributes.uv; for (let k = 0; k < cu.count; k++) cu.setXY(k, cu.getX(k) * 9, cu.getY(k) * 2.5);
      B.add(cone, M.roof, mat4(x, y + 9.9, gz));
      for (let k = 0; k < 3; k++) {
        const wa = k * 2.1 + (s > 0 ? 0.6 : 3.6);
        B.add(box(0.35, 0.8, 0.1), M.glass, mat4(x + Math.cos(wa) * 1.78, y + 5.6, gz + Math.sin(wa) * 1.78, 0, -wa + Math.PI / 2));
      }
      this.addCollider(x, gz, 2.1);
    }
    // arch over each gate
    for (const gz of [-R, R]) {
      const y = this.heightAt(0, gz);
      B.add(box(8.5, 1.4, 1.6, 2), M.stone, mat4(0, y + 6.3, gz));
      B.add(box(8.8, 0.3, 1.9, 2), M.stoneDark, mat4(0, y + 7.1, gz));
    }
  }

  banners(B) {
    const M = this.mats;
    const tex = canvasTexture(128, 256, (g) => {
      const grd = g.createLinearGradient(0, 0, 128, 0); grd.addColorStop(0, '#6a1012'); grd.addColorStop(0.5, '#a8201f'); grd.addColorStop(1, '#6a1012');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 256);
      g.fillStyle = '#e8c060'; g.fillRect(0, 0, 128, 10); g.fillRect(6, 10, 2, 220); g.fillRect(120, 10, 2, 220);
      g.fillStyle = '#f4ece0'; g.fillRect(56, 44, 16, 140); g.fillRect(24, 76, 80, 16);
      g.strokeStyle = '#e8c060'; g.lineWidth = 2; g.strokeRect(54, 42, 20, 144); g.strokeRect(22, 74, 84, 20);
      g.clearRect(0, 232, 128, 24);
      g.fillStyle = '#a8201f'; g.beginPath(); g.moveTo(0, 232); g.lineTo(64, 256); g.lineTo(128, 232); g.fill();
    });
    const bm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
    bm.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.timeU || (this.timeU = { value: 0 });
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat k = (1.0 - uv.y); transformed.z += sin(uTime * 2.2 + position.y * 2.5 + position.x) * 0.12 * k;');
    };
    const spots = [[-7.5, -this.townR + 2.5], [7.5, -this.townR + 2.5], [-5.5, -12.5], [5.5, -12.5], [-12.8, 4], [12.8, 4], [-5, this.townR - 2.5], [5, this.townR - 2.5]];
    for (const [x, z] of spots) {
      const y = this.heightAt(x, z);
      B.add(cyl(0.08, 0.11, 7, 8), M.timberDark, mat4(x, y + 3.5, z));
      B.add(new THREE.SphereGeometry(0.15, 8, 6), M.brass, mat4(x, y + 7.1, z));
      const ry = Math.atan2(-x, -z) + Math.PI / 2;
      B.add(box(1.9, 0.08, 0.08), M.timberDark, mat4(x, y + 6.7, z, 0, ry));
      const g = new THREE.PlaneGeometry(1.5, 3, 4, 8); g.translate(0, -1.5, 0);
      const m = new THREE.Mesh(g, bm); m.position.set(x, y + 6.65, z); m.rotation.y = ry; m.castShadow = true;
      this.group.add(m);
      this.addCollider(x, z, 0.25);
    }
  }

  signpost(B) {
    const M = this.mats;
    const sx = 7.5, sz = -this.townR + 6, sy = this.heightAt(sx, sz);
    B.add(box(0.24, 3.8, 0.24, 1), M.timberDark, mat4(sx, sy + 1.9, sz));
    B.add(box(0.12, 0.7, 0.12), M.iron, mat4(sx - 0.6, sy + 3.3, sz));
    B.add(box(0.12, 0.7, 0.12), M.iron, mat4(sx - 2.0, sy + 3.3, sz));
    B.add(box(2.4, 0.1, 0.1), M.timberDark, mat4(sx - 1.2, sy + 3.65, sz));
    const tex = canvasTexture(256, 128, (g) => {
      g.fillStyle = '#5a3a22'; g.fillRect(0, 0, 256, 128);
      for (let y = 0; y < 128; y += 4) { g.fillStyle = `rgba(0,0,0,${0.08 + ((y * 37) % 11) / 100})`; g.fillRect(0, y, 256, 2); }
      g.strokeStyle = '#2a1a10'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 122);
      g.fillStyle = '#f0e2c4'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 34px Georgia, serif'; g.fillText(ordinal(this.floor) + ' Floor', 128, 40);
      g.font = '24px Georgia, serif'; g.fillText(this.floor === 1 ? 'Town of Beginnings' : 'Floor ' + this.floor + ' Town', 128, 88);
    });
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.1), [M.timberDark, M.timberDark, M.timberDark, M.timberDark, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), M.timberDark]);
    board.position.set(sx - 1.3, sy + 2.55, sz); board.castShadow = true; board.rotation.y = 0.35; this.group.add(board);
    this.addCollider(sx, sz, 0.3);
  }

  buildIvy() {
    const tex = leafTexture();
    const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, color: '#9ab870' });
    const geos = [];
    const r = this.rng;
    for (const iv of this.ivy) {
      const n = Math.floor(iv.h * 6);
      for (let k = 0; k < n; k++) {
        const y = r.float(0.3, iv.h) , spread = 0.4 + (1 - y / iv.h) * 0.9;
        const q = new THREE.PlaneGeometry(0.7, 0.7);
        q.rotateZ(r.float(0, 6.28));
        q.translate(iv.lx + r.float(-spread, spread), y, iv.lz + r.float(0, 0.05));
        q.applyMatrix4(iv.m);
        geos.push(q);
      }
    }
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // ---------------- arena + tower ----------------
  buildArena() {
    const B = new Batcher(), M = this.mats;
    const { x, z, r } = this.arena, y = this.heightAt(x, z);
    B.add(cyl(r, r + 0.5, 0.6, 32, 2), M.stoneDark, mat4(x, y - 0.1, z));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      if (Math.abs(a - Math.PI / 2) < 0.35) continue;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const broken = this.rng.chance(0.35);
      const h = broken ? this.rng.float(2.5, 5) : 8;
      B.add(cyl(0.75, 0.85, h, 10, 1.5), M.stone, mat4(px, y + h / 2, pz));
      B.add(box(2, 0.6, 2, 1.5), M.stoneDark, mat4(px, y + 0.3, pz));
      if (!broken) B.add(box(2, 0.6, 2, 1.5), M.stoneDark, mat4(px, y + h + 0.3, pz));
      this.addCollider(px, pz, 1.1);
    }
    // braziers flanking the entrance
    for (const s of [-1, 1]) {
      const bx = x + s * 3.5, bz = z + r + 1;
      B.add(cyl(0.5, 0.3, 1.2, 10, 1), M.iron, mat4(bx, this.heightAt(bx, bz) + 0.6, bz));
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 8), new THREE.MeshBasicMaterial({ color: '#ffb040' }));
      fire.position.set(bx, this.heightAt(bx, bz) + 1.6, bz); this.group.add(fire);
      this.animated.push((t) => { fire.scale.set(1 + Math.sin(t * 13 + s) * 0.1, 1 + Math.sin(t * 9 + s) * 0.25, 1); });
      this.addCollider(bx, bz, 0.5);
    }
    B.flush(this.group);
  }

  buildTower() {
    const B = new Batcher(), M = this.mats;
    const { x, z } = this.tower;
    const base = this.heightAt(x, -112) - 8;
    // emissive window pattern
    const winTex = canvasTexture(256, 256, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
        if (((row * 7 + col * 13) % 5) > 2) continue;
        const wx = col * 32 + 11, wy = row * 64 + 18;
        g.fillStyle = '#ff9a40'; g.fillRect(wx, wy + 6, 10, 22); g.beginPath(); g.arc(wx + 5, wy + 6, 5, Math.PI, 0); g.fill();
        g.fillStyle = '#ffd890'; g.fillRect(wx + 3, wy + 10, 4, 12);
      }
    });
    winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
    const wall = pbr('castle_wall_slates', { color: '#4a5070' });
    wall.fog = false;
    wall.emissiveMap = winTex; wall.emissive = new THREE.Color('#ffffff'); wall.emissiveIntensity = 1.4;
    const trim = pbr('medieval_blocks_02', { color: '#565a74' });
    trim.fog = false;
    let r = 16, y = 0;
    for (let i = 0; i < 11; i++) {
      const h = 15 - i * 0.6;
      const g = new THREE.CylinderGeometry(r * 0.94, r, h, 24, 1, true);
      const uv = g.attributes.uv, circ = Math.PI * 2 * r;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * circ / 8, uv.getY(k) * h / 8);
      B.add(g, wall, mat4(x, base + y + h / 2, z));
      B.add(cyl(r * 0.94 + 1.6, r * 0.94 + 0.6, 1.3, 24, 3), trim, mat4(x, base + y + h, z));
      for (let k = 0; k < 24; k += 2) {
        const a = (k / 24) * Math.PI * 2 + i * 0.13;
        B.add(new THREE.ConeGeometry(0.55, 2.6, 5), trim, mat4(x + Math.cos(a) * (r * 0.94 + 1.2), base + y + h - 1.9, z + Math.sin(a) * (r * 0.94 + 1.2), Math.PI));
      }
      if (i === 2 || i === 4 || i === 6 || i === 8) {
        const n = i === 8 ? 2 : 4;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + (i % 4 === 0 ? 0.3 : Math.PI / 4 + 0.3);
          const L = 26 - i * 1.5;
          const ay = base + y + h * 0.6;
          const A = mat4(x, ay, z, 0, -a, 0);
          const at = (px, py, pz, rx = 0, ry = 0, rz = 0) => A.clone().multiply(mat4(px, py, pz, rx, ry, rz));
          B.add(box(L, 1.6, 2.2, 3), trim, at(r + L / 2 - 2, 0, 0));
          B.add(box(L * 0.75, 0.9, 1.3, 3), trim, at(r + L * 0.32, -3.4, 0, 0, 0, 0.38));
          const end = r + L - 2;
          B.add(new THREE.ConeGeometry(2.0, 16, 8), wall, at(end, -8.5, 0, Math.PI));
          B.add(cyl(1.4, 1.6, 4, 8, 3), wall, at(end, 1.5, 0));
          B.add(new THREE.ConeGeometry(1.2, 14, 8), trim, at(end, 10.5, 0));
          for (let q = 1; q < 4; q++) B.add(new THREE.ConeGeometry(0.7, 5.5, 5), wall, at(r + (L * q) / 4 - 2, -3.6, 0, Math.PI));
          B.add(box(1.2, 1.2, 1.2), M.lampGlow, at(end, -1.4, 0));
        }
      }
      y += h; r *= 0.85;
    }
    B.add(new THREE.ConeGeometry(r, 46, 16), trim, mat4(x, base + y + 23, z));
    B.add(new THREE.ConeGeometry(0.7, 20, 8), M.brass, mat4(x, base + y + 55, z));
    // the door at the base, warm light spilling out
    const dz = z + 16.2;
    const dy = this.heightAt(x, dz);
    B.add(box(7, 10, 1.2, 2), trim, mat4(x, dy + 4, dz - 0.4));
    const door = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 7), new THREE.MeshStandardMaterial({ color: '#1a1010', emissive: '#ff8a30', emissiveIntensity: 1.6 }));
    door.position.set(x, dy + 3.5, dz + 0.25); this.group.add(door);
    this.bossDoor = door;
    B.flush(this.group, { cast: false });
    this.addCollider(x, z, this.tower.r + 1.5);
  }

  // ---------------- nature ----------------
  buildNature() {
    const r = this.rng;
    const keep = (x, z) => {
      const R = Math.hypot(x, z);
      if (R < this.townR + 5 || R > WORLD_R - 6) return false;
      if (this.pathDist(x, z) < 6) return false;
      if (Math.hypot(x - this.arena.x, z - this.arena.z) < this.arena.r + 7) return false;
      if (Math.hypot(x - this.tower.x, z - this.tower.z) < this.tower.r + 10) return false;
      if (this.heightAt(x, z) > 22) return false;
      return true;
    };
    const pts = poissonDisc(r, 236, 236, 4.5, (x, z) => keep(x - 118, z - 118)).map(([x, z]) => [x - 118, z - 118]);
    const trees = [], rocks = [], bushes = [];
    for (const [x, z] of pts) {
      const forest = this.noise.fbm(x * 0.02 + 50, z * 0.02 + 50, 3);
      if (forest > 0.1 || (forest > -0.08 && r.chance(0.12))) trees.push([x, z]);
      else if (r.chance(0.05)) rocks.push([x, z]);
      else if (r.chance(0.12)) bushes.push([x, z]);
    }
    // a few trees inside the town's green ring
    for (let i = 0; i < 8; i++) { const a = r.float(0, Math.PI * 2); const d = r.float(14, 15.5); const x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(x) > 4 && Math.abs(z) > 4) trees.push([x, z, 0.7]); }
    this.forest = new Forest(this, trees, bushes);
    this.group.add(this.forest.group);
    for (const [x, z, s] of trees) this.addCollider(x, z, 0.6 * (s || 1));

    // rocks: displaced icospheres with the rock PBR set
    const rockGeo = new THREE.IcosahedronGeometry(1, 3);
    const p = rockGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const k = 1 + this.noise.fbm(v.x * 1.7 + 3, v.z * 1.7 + v.y * 1.3, 3) * 0.55;
      v.multiplyScalar(k); v.y *= 0.7; p.setXYZ(i, v.x, v.y, v.z);
    }
    rockGeo.computeVertexNormals();
    const ruv = rockGeo.attributes.uv; for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 4, ruv.getY(i) * 2);
    const rocksIM = new THREE.InstancedMesh(rockGeo, this.mats.rock, rocks.length);
    rocks.forEach(([x, z], i) => {
      const s = r.float(0.8, 2.2);
      rocksIM.setMatrixAt(i, mat4(x, this.heightAt(x, z) + s * 0.2, z, r.next(), r.next() * 6, r.next() * 0.3, s * 1.3, s, s * 1.1));
      this.addCollider(x, z, s * 1.1);
    });
    rocksIM.castShadow = rocksIM.receiveShadow = true;
    this.group.add(rocksIM);

    this.grass = new GrassField(this, this.opts.grassDensity ?? 1);
    this.group.add(this.grass.mesh);
  }

  buildSpawnZones() {
    const r = this.rng;
    for (let i = 0; i < 10; i++) {
      const a = r.float(0, Math.PI * 2), d = r.float(this.townR + 14, WORLD_R - 18);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x - this.arena.x, z - this.arena.z) < 30) { i--; continue; }
      const forest = this.noise.fbm(x * 0.02 + 50, z * 0.02 + 50, 3);
      this.spawnZones.push({ x, z, r: 10, kind: forest > 0.1 ? 'wolf' : 'boar', max: forest > 0.1 ? 3 : 2 });
    }
    this.spawnZones.push({ x: this.arena.x - 22, z: this.arena.z + 28, r: 8, kind: 'kobold', max: 2 });
    this.spawnZones.push({ x: this.arena.x + 22, z: this.arena.z + 28, r: 8, kind: 'kobold', max: 2 });
  }

  addCollider(x, z, r) { this.colliders.push({ x, z, r }); }
  blocked(x, z, rad = 0.4) {
    if (Math.hypot(x, z) > WORLD_R - 4) return true;
    for (const c of this.colliders) { const dx = x - c.x, dz = z - c.z, rr = c.r + rad; if (dx * dx + dz * dz < rr * rr) return true; }
    for (const b of this.boxes) {
      const dx = x - b.x, dz = z - b.z, c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hw + rad && Math.abs(lz) < b.hd + rad) return true;
    }
    return false;
  }
  resolve(x, z, rad = 0.4) {
    for (const c of this.colliders) {
      const dx = x - c.x, dz = z - c.z, rr = c.r + rad, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); x = c.x + (dx / d) * rr; z = c.z + (dz / d) * rr; }
    }
    for (const b of this.boxes) {
      const dx = x - b.x, dz = z - b.z, c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      let lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ox = b.hw + rad - Math.abs(lx), oz = b.hd + rad - Math.abs(lz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) lx += Math.sign(lx) * ox; else lz += Math.sign(lz) * oz;
        const c2 = Math.cos(b.rot), s2 = Math.sin(b.rot);
        x = b.x + lx * c2 - lz * s2; z = b.z + lx * s2 + lz * c2;
      }
    }
    const R = Math.hypot(x, z), lim = WORLD_R - 4;
    if (R > lim) { x *= lim / R; z *= lim / R; }
    return [x, z];
  }

  update(dt, t, playerPos) {
    if (this.timeU) this.timeU.value = t;
    for (const f of this.animated) f(t);
    if (this.grass) this.grass.update(t, playerPos);
    if (this.forest) this.forest.update(t);
  }
}

function ordinal(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'); }

// Terrain: four PBR layers blended by per-vertex splat weights, with a
// per-layer tiling scale. Albedo, normals and roughness are all blended.
function terrainMaterial() {
  const L = ['leafy_grass', 'forest_ground_04', 'grass_path_2', 'cobblestone_floor_08'].map((id) => texSet(id));
  const scales = [0.32, 0.25, 0.3, 0.42];
  const m = new THREE.MeshStandardMaterial({ map: L[0].map, normalMap: L[0].normalMap, roughness: 1, metalness: 0, envMapIntensity: 0.5 });
  m.onBeforeCompile = (s) => {
    for (let i = 0; i < 4; i++) { s.uniforms['tD' + i] = { value: L[i].map }; s.uniforms['tN' + i] = { value: L[i].normalMap }; s.uniforms['tA' + i] = { value: L[i].arm }; }
    s.uniforms.uScale = { value: new THREE.Vector4(...scales) };
    const rock = texSet('rock_wall_08');
    s.uniforms.tD4 = { value: rock.map }; s.uniforms.tN4 = { value: rock.normalMap }; s.uniforms.tA4 = { value: rock.arm };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vWUv;\nvarying float vRock;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat; vWUv = uv; vRock = smoothstep(0.82, 0.62, normal.y) + smoothstep(14.0, 30.0, position.y) * 0.6;');
    const decl = [0, 1, 2, 3, 4].map((i) => `uniform sampler2D tD${i}; uniform sampler2D tN${i}; uniform sampler2D tA${i};`).join('\n');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}\nuniform vec4 uScale;\nvarying vec4 vSplat;\nvarying vec2 vWUv;\nvarying float vRock;
        vec4 sp(){ vec4 w = vSplat; return w / max(0.0001, w.x + w.y + w.z + w.w); }`)
      .replace('#include <map_fragment>', `
        vec4 w = sp();
        vec3 alb = texture2D(tD0, vWUv * uScale.x).rgb * vec3(0.78, 1.08, 0.5) * w.x + texture2D(tD1, vWUv * uScale.y).rgb * w.y
                 + texture2D(tD2, vWUv * uScale.z).rgb * w.z + texture2D(tD3, vWUv * uScale.w).rgb * w.w;
        // large-scale tint variation breaks up tiling on the meadow
        float big = sin(vWUv.x * 0.031) * sin(vWUv.y * 0.027 + 1.3) * 0.5 + 0.5;
        alb *= mix(vec3(0.92, 1.0, 0.82), vec3(1.08, 1.02, 0.86), big * w.x + 0.5 * (1.0 - w.x));
        float rk = clamp(vRock, 0.0, 1.0);
        alb = mix(alb, texture2D(tD4, vWUv * 0.12).rgb * vec3(1.0, 0.95, 0.9), rk);
        diffuseColor.rgb *= alb;`)
      .replace('#include <roughnessmap_fragment>', `
        vec4 w2 = sp();
        float roughnessFactor = roughness * (texture2D(tA0, vWUv * uScale.x).g * w2.x + texture2D(tA1, vWUv * uScale.y).g * w2.y
          + texture2D(tA2, vWUv * uScale.z).g * w2.z + texture2D(tA3, vWUv * uScale.w).g * w2.w);
        roughnessFactor = mix(roughnessFactor, texture2D(tA4, vWUv * 0.12).g, clamp(vRock, 0.0, 1.0));`)
      .replace('#include <normal_fragment_maps>', `
        vec4 w3 = sp();
        vec3 mapN = (texture2D(tN0, vWUv * uScale.x).xyz * w3.x + texture2D(tN1, vWUv * uScale.y).xyz * w3.y
          + texture2D(tN2, vWUv * uScale.z).xyz * w3.z + texture2D(tN3, vWUv * uScale.w).xyz * w3.w) * 2.0 - 1.0;
        mapN = mix(mapN, texture2D(tN4, vWUv * 0.12).xyz * 2.0 - 1.0, clamp(vRock, 0.0, 1.0));
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);`);
  };
  return m;
}
