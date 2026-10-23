import * as THREE from 'three';
import { RNG, Noise2D, poissonDisc, clamp, smooth, lerp } from '../core/rng.js';
import { ps1Material, ps1Basic } from '../render/ps1.js';
import { Tex, solid } from '../render/textures.js';

// One floor of the tower: a floating disc of land with a walled town at the
// centre, open fields, forest, and a boss arena at the foot of the stairway
// pillar. Generated from the floor number alone.

export const BIOMES = [
  { name: 'Verdant Meadow', grass: ['#284a1c', '#3c6b22', '#5a8f2a', '#8cbc3c'], leaves: ['#1c3a1c', '#2c5a22', '#46802a', '#a8c044'],
    skyTop: '#16285a', skyMid: '#4a6aa8', skyLow: '#f29a4a', fog: '#e8a465', glow: '#ffd27a', sun: '#ffd590', amb: '#7f96d0', fill: '#ffe2c0', pine: 0.25,
    cloudLit: '#ffd890', cloudMid: '#f0a090', cloudDark: '#6a5a92' },
  { name: 'Ember Highlands', grass: ['#5a3a1a', '#7a5222', '#a0702a', '#d0a040'], leaves: ['#6a2410', '#9a3a14', '#c8621e', '#f0a030'],
    skyTop: '#2a1a4a', skyMid: '#8a4a7a', skyLow: '#ff8a40', fog: '#e88a5a', glow: '#ffc060', sun: '#ffc888', amb: '#a080b0', fill: '#ffd0b0', pine: 0.1,
    cloudLit: '#ffc070', cloudMid: '#e07070', cloudDark: '#5a3a6a' },
  { name: 'Frostveil Steppe', grass: ['#9aaabb', '#c0ccd8', '#dce4ec', '#f6f9fb'], leaves: ['#1a3a3a', '#24504a', '#30665a', '#4a8a74'],
    skyTop: '#1a2a5a', skyMid: '#6a8ac8', skyLow: '#f0c0b0', fog: '#c8d0e8', glow: '#fff0d0', sun: '#fff4e0', amb: '#a0b4e0', fill: '#f0f0ff', pine: 0.9,
    cloudLit: '#fff0e0', cloudMid: '#e0b8c8', cloudDark: '#7a7aa8' },
  { name: 'Sunken Dunes', grass: ['#a8783a', '#c8944a', '#deb060', '#f0cc80'], leaves: ['#3a6a2a', '#4a8a30', '#62a83a', '#8ac84a'],
    skyTop: '#1a4a8a', skyMid: '#5aa0d0', skyLow: '#ffc070', fog: '#f0c080', glow: '#fff0a0', sun: '#fff2c0', amb: '#a0b0c8', fill: '#fff0d0', pine: 0.0,
    cloudLit: '#ffffff', cloudMid: '#f0d0a0', cloudDark: '#8a9ac0' },
  { name: 'Duskmire', grass: ['#1a3a2c', '#24503a', '#2e6a48', '#4a8a5a'], leaves: ['#14302a', '#1e4436', '#2a5a44', '#3a7a5a'],
    skyTop: '#0e1028', skyMid: '#3a2a5a', skyLow: '#d05a3a', fog: '#5a4a6a', glow: '#ff8050', sun: '#ff9a6a', amb: '#5a6aa0', fill: '#c0a0ff', pine: 0.5,
    cloudLit: '#ff9060', cloudMid: '#a04a6a', cloudDark: '#2a2040' },
];

export const WORLD_R = 118;
const CELL = 2;

export class World {
  constructor(floor) {
    this.floor = floor;
    this.seed = 1000 + floor * 7919;
    this.rng = new RNG(this.seed);
    this.noise = new Noise2D(this.seed);
    this.biome = BIOMES[(floor - 1) % BIOMES.length];
    this.group = new THREE.Group();
    this.colliders = []; // circles {x, z, r}
    this.boxes = []; // oriented boxes for houses {x,z,hw,hd,rot}
    this.townR = 30;
    this.arena = { x: 0, z: -80, r: 16 };
    this.tower = { x: 0, z: -114, r: 14 };
    this.sunDir = new THREE.Vector3(0.18, 0.05, -1).normalize();
    this.spawnZones = [];
    this.npcSpots = [];
    this.gateTo = null;
    this.build();
  }

  // --- height field ---
  pathDist(x, z) {
    // main road: town north gate to the arena, with a gentle S-curve
    const t = clamp((-z - this.townR) / (-this.arena.z - this.townR), 0, 1);
    const px = Math.sin(t * Math.PI * 1.5) * 14;
    const onSeg = -z > this.townR - 2 && -z < -this.arena.z;
    return onSeg ? Math.abs(x - px) : 999;
  }
  rawHeight(x, z) {
    const n = this.noise;
    let h = n.fbm(x * 0.012, z * 0.012, 4) * 14 + n.fbm(x * 0.05, z * 0.05, 2) * 1.6;
    const r = Math.hypot(x, z);
    const town = smooth(clamp((r - this.townR) / 18, 0, 1));
    h = lerp(1.2, h, town);
    const a = Math.hypot(x - this.arena.x, z - this.arena.z);
    h = lerp(2, h, smooth(clamp((a - this.arena.r) / 14, 0, 1)));
    const pd = this.pathDist(x, z);
    if (pd < 12) h = lerp(h * 0.4 + 1, h, smooth(clamp((pd - 3) / 9, 0, 1)));
    // rim: ground falls away at the disc edge
    if (r > WORLD_R - 6) h -= (r - (WORLD_R - 6)) * 3.5;
    return h;
  }
  heightAt(x, z) {
    // bilinear sample of the baked grid so entities sit exactly on the mesh
    const g = this.hgrid, N = this.N, half = (N - 1) * CELL / 2;
    const fx = (x + half) / CELL, fz = (z + half) / CELL;
    const ix = clamp(Math.floor(fx), 0, N - 2), iz = clamp(Math.floor(fz), 0, N - 2);
    const tx = fx - ix, tz = fz - iz;
    const h00 = g[iz * N + ix], h10 = g[iz * N + ix + 1], h01 = g[(iz + 1) * N + ix], h11 = g[(iz + 1) * N + ix + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }
  surface(x, z) {
    const r = Math.hypot(x, z);
    if (r < 13) return 2; // plaza cobble
    if (r < this.townR && (Math.abs(x) < 2.5 || Math.abs(z) < 2.5)) return 2; // town streets
    if (Math.hypot(x - this.arena.x, z - this.arena.z) < this.arena.r) return 2;
    if (this.pathDist(x, z) < 2.6) return 1;
    return 0;
  }

  build() {
    this.buildTerrain();
    this.buildSky();
    this.buildTown();
    this.buildArena();
    this.buildNature();
    this.buildDecor();
    this.buildSpawnZones();
  }

  buildTerrain() {
    const size = 260, N = size / CELL + 1, half = size / 2;
    this.N = N;
    const hg = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hg[j * N + i] = this.rawHeight(i * CELL - half, j * CELL - half);
    this.hgrid = hg;
    // non-indexed quads, grouped by surface so each gets its own texture
    const groups = [[], [], []];
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const x = i * CELL - half, z = j * CELL - half;
      if (Math.hypot(x, z) > WORLD_R + 10) continue;
      groups[this.surface(x + 1, z + 1)].push([i, j]);
    }
    const pos = [], uv = [], geo = new THREE.BufferGeometry();
    let start = 0;
    const mats = [
      ps1Material({ map: Tex.grass(this.biome.grass) }),
      ps1Material({ map: Tex.dirt() }),
      ps1Material({ map: Tex.cobble() }),
    ];
    for (let m = 0; m < 3; m++) {
      for (const [i, j] of groups[m]) {
        const v = (ii, jj) => [ii * CELL - half, hg[jj * N + ii], jj * CELL - half];
        const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
        pos.push(...a, ...c, ...b, ...b, ...c, ...d);
        const s = 0.25;
        uv.push(i * s, j * s, i * s, (j + 1) * s, (i + 1) * s, j * s, (i + 1) * s, j * s, i * s, (j + 1) * s, (i + 1) * s, (j + 1) * s);
      }
      const count = groups[m].length * 6;
      geo.addGroup(start, count, m); start += count;
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mats);
    this.group.add(mesh);
    this.terrain = mesh;

    // underside of the floating disc: a jagged rock cone
    const under = new THREE.ConeGeometry(WORLD_R + 2, 60, 24, 3, true);
    const up = under.attributes.position;
    for (let i = 0; i < up.count; i++) {
      const y = up.getY(i);
      if (y > -29 && y < 29) { up.setX(i, up.getX(i) * (0.9 + this.rng.next() * 0.2)); up.setZ(i, up.getZ(i) * (0.9 + this.rng.next() * 0.2)); }
    }
    under.computeVertexNormals();
    const um = new THREE.Mesh(under, ps1Material({ map: Tex.rock(), side: THREE.BackSide }));
    um.rotation.x = Math.PI; um.position.y = -32;
    um.geometry.attributes.uv.array.forEach((v, i, a) => (a[i] = v * 8));
    this.group.add(um);
  }

  buildSky() {
    const b = this.biome;
    const geo = new THREE.SphereGeometry(400, 32, 20);
    const top = new THREE.Color(b.skyTop), mid = new THREE.Color(b.skyMid), low = new THREE.Color(b.skyLow), fogC = new THREE.Color(b.fog), glow = new THREE.Color(b.glow);
    const cols = [];
    const p = geo.attributes.position;
    const dir = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      dir.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const y = dir.y;
      let c;
      if (y > 0.3) c = mid.clone().lerp(top, clamp((y - 0.3) / 0.5, 0, 1));
      else if (y > 0.03) c = low.clone().lerp(mid, smooth((y - 0.03) / 0.27));
      else c = fogC.clone().lerp(low, clamp((y + 0.1) / 0.13, 0, 1));
      const sd = Math.max(0, dir.dot(this.sunDir));
      c.lerp(glow, Math.pow(sd, 6) * 0.85 * (1 - clamp(y, 0, 1)));
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(geo, ps1Basic({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    this.sky = sky;
    this.group.add(sky);

    // sun: a hot core inside a soft halo
    this.sunPos = this.sunDir.clone().multiplyScalar(380);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(46, 20), ps1Basic({ color: b.glow, transparent: true, opacity: 0.35, fog: false, depthWrite: false }));
    const core = new THREE.Mesh(new THREE.CircleGeometry(15, 16), ps1Basic({ color: '#fffbea', fog: false, depthWrite: false }));
    for (const [m, o] of [[halo, -9.5], [core, -9]]) { m.position.copy(this.sunPos); m.lookAt(0, 0, 0); m.renderOrder = o; this.group.add(m); }

    // clouds: several dithered textures lit from below by the low sun
    const r = this.rng;
    const makeCloud = (lit, midc, dark, seed) => {
      const cc = document.createElement('canvas'); cc.width = 96; cc.height = 32;
      const g = cc.getContext('2d');
      const rr = new RNG(seed);
      const blobs = [];
      for (let i = 0; i < 14; i++) blobs.push([10 + rr.next() * 76, 12 + rr.next() * 10, 3 + rr.next() * 7]);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 96; x++) {
        let d = 0;
        for (const [bx, by, br] of blobs) d = Math.max(d, 1 - Math.hypot((x - bx) / 1.8, y - by) / br);
        if (d <= 0) continue;
        if (d < 0.18 && (x + y) % 2) continue; // dithered edge
        const v = y / 32 + (1 - d) * 0.15;
        g.fillStyle = v > 0.62 ? lit : v > 0.45 ? midc : dark;
        g.fillRect(x, y, 1, 1);
      }
      const t = new THREE.CanvasTexture(cc); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const near = [0, 1, 2].map((i) => makeCloud('#fff4d0', b.cloudLit, b.cloudMid, this.seed + i));
    const far = [0, 1, 2].map((i) => makeCloud(b.cloudLit, b.cloudMid, b.cloudDark, this.seed + 10 + i));
    this.clouds = [];
    const sunA = Math.atan2(this.sunDir.z, this.sunDir.x);
    for (let i = 0; i < 46; i++) {
      const a = r.float(0, Math.PI * 2), d = r.float(220, 340);
      const toSun = Math.abs(Math.atan2(Math.sin(a - sunA), Math.cos(a - sunA)));
      const tex = toSun < 0.9 ? near[i % 3] : far[i % 3];
      const sz = r.float(40, 90);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz / 3), ps1Basic({ map: tex, transparent: true, alphaTest: 0.5, fog: false, depthWrite: false }));
      const hgt = r.float(25, 140);
      m.position.set(Math.cos(a) * d, hgt, Math.sin(a) * d);
      m.lookAt(0, hgt * 0.5, 0);
      m.renderOrder = -8;
      this.group.add(m); this.clouds.push({ m, a, d, s: r.float(0.002, 0.006) });
    }
  }

  buildTower() {
    // The labyrinth tower: stacked tiers with glowing windows, ring ledges,
    // outrigger arms hung with spikes, and a needle spire.
    const { x, z } = this.tower;
    const base = this.heightAt(x, Math.max(z, -110)) - 6;
    const g = new THREE.Group(); g.position.set(x, base, z); this.group.add(g);
    // the tower sits beyond the fog range, so it gets its own haze colour
    const wall = ps1Material({ map: Tex.towerWall(), fog: false, color: '#b8a8c8' });
    const trim = ps1Material({ map: Tex.towerTrim(), fog: false, color: '#b0a0c0' });
    const glowM = ps1Basic({ color: '#ffb850' });
    let r = 15, y = 0;
    const tiers = 10;
    for (let i = 0; i < tiers; i++) {
      const h = 13 - i * 0.5;
      const cyl = new THREE.CylinderGeometry(r * 0.93, r, h, 16, 1, true);
      cyl.attributes.uv.array.forEach((v, k, arr) => (arr[k] = k % 2 ? v * h / 6 : v * r * 0.9));
      const m = new THREE.Mesh(cyl, wall); m.position.y = y + h / 2; g.add(m);
      const ledge = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.93 + 1.4, r * 0.93 + 0.6, 1.1, 16), trim);
      ledge.position.y = y + h; g.add(ledge);
      for (let k = 0; k < 16; k += 2) {
        const a = (k / 16) * Math.PI * 2;
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 4), trim);
        tooth.rotation.x = Math.PI; tooth.position.set(Math.cos(a) * (r * 0.93 + 1.1), y + h - 1.5, Math.sin(a) * (r * 0.93 + 1.1)); g.add(tooth);
      }
      if (i === 2 || i === 4 || i === 6) {
        const n = i === 4 ? 2 : 4;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + (i === 4 ? 0 : Math.PI / 4) + 0.3;
          const L = 22 - i;
          const arm = new THREE.Group(); arm.position.y = y + h * 0.6; arm.rotation.y = -a; g.add(arm);
          const beam = new THREE.Mesh(new THREE.BoxGeometry(L, 1.4, 2), trim); beam.position.x = r + L / 2 - 2; arm.add(beam);
          const brace = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.8, 1.2), trim); brace.position.set(r + L * 0.3, -3, 0); brace.rotation.z = 0.35; arm.add(brace);
          const end = r + L - 2;
          const hang = new THREE.Mesh(new THREE.ConeGeometry(1.6, 14, 6), wall); hang.rotation.x = Math.PI; hang.position.set(end, -7, 0); arm.add(hang);
          const up = new THREE.Mesh(new THREE.ConeGeometry(0.9, 12, 6), trim); up.position.set(end, 6.5, 0); arm.add(up);
          for (let q = 1; q < 4; q++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.7, 5, 4), wall); sp.rotation.x = Math.PI; sp.position.set(r + (L * q) / 4 - 2, -3.2, 0); arm.add(sp); }
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glowM); lamp.position.set(end, -1.2, 0); arm.add(lamp);
        }
      }
      y += h; r *= 0.84;
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(r, 40, 12), trim); spire.position.y = y + 20; g.add(spire);
    const needle = new THREE.Mesh(new THREE.ConeGeometry(0.6, 16, 6), trim); needle.position.y = y + 46; g.add(needle);
    const doorZ = z + this.tower.r + 0.6;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 8), ps1Basic({ map: Tex.towerDoor() }));
    door.position.set(x, this.heightAt(x, doorZ) + 4, doorZ); this.group.add(door);
    this.bossDoor = door;
    this.addCollider(x, z, this.tower.r + 1);
  }

  buildDecor() {
    // red banners with the white cross along the plaza and the north gate,
    // and the floor signpost
    const pole = ps1Material({ map: Tex.wood() });
    const banner = ps1Material({ map: Tex.banner(), side: THREE.DoubleSide });
    const spots = [[-5.5, -this.townR + 2], [5.5, -this.townR + 2], [-6, -12], [6, -12], [-12.5, 3], [12.5, 3]];
    for (const [x, z] of spots) {
      const y = this.heightAt(x, z);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 6, 5), pole); p.position.set(x, y + 3, z); this.group.add(p);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), pole); arm.position.set(x, y + 5.8, z); this.group.add(arm);
      const bg = new THREE.PlaneGeometry(1.4, 2.8, 1, 3); bg.translate(0, -1.4, 0);
      const bp = bg.attributes.position; for (let i = 0; i < bp.count; i++) bp.setZ(i, Math.sin(-bp.getY(i) * 1.5) * 0.12);
      const b = new THREE.Mesh(bg, banner); b.position.set(x, y + 5.75, z); b.rotation.y = Math.atan2(-x, -z) + Math.PI / 2; this.group.add(b);
      this.addCollider(x, z, 0.3);
      (this.banners || (this.banners = [])).push(b);
    }
    // signpost at the north gate
    const sx = 6.5, sz = -this.townR + 5, sy = this.heightAt(sx, sz);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, 0.22), pole); post.position.set(sx, sy + 1.8, sz); this.group.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 0.12), [pole, pole, pole, pole, ps1Material({ map: Tex.sign(this.floor) }), pole]);
    board.position.set(sx - 1.1, sy + 2.7, sz); this.group.add(board);
    this.addCollider(sx, sz, 0.3);
  }

  boxUV(w, h, d, tpm = 0.5) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    // faces: +x,-x (d,h) ; +y,-y (w,d) ; +z,-z (w,h)
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] * tpm, uv.getY(i) * dims[f][1] * tpm);
    }
    return g;
  }

  addCollider(x, z, r) { this.colliders.push({ x, z, r }); }

  buildHouse(x, z, rot, w, d, floors) {
    const g = new THREE.Group();
    const h = 3.2 * floors;
    const y = this.heightAt(x, z);
    const plaster = ps1Material({ map: Tex.plaster() });
    const stone = ps1Material({ map: Tex.stoneWall() });
    // stone footing, plaster upper walls
    const base = new THREE.Mesh(this.boxUV(w + 0.2, 1.2, d + 0.2, 0.5), stone); base.position.y = 0.4; g.add(base);
    const walls = new THREE.Mesh(this.boxUV(w, h, d, 1 / 3.2), plaster); walls.position.y = h / 2 + 0.6; g.add(walls);
    // gable roof
    const rh = 2.4;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - 0.5, 0); shape.lineTo(w / 2 + 0.5, 0); shape.lineTo(0, rh); shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + 1, bevelEnabled: false });
    roofGeo.translate(0, 0, -(d + 1) / 2);
    const ruv = roofGeo.attributes.uv; for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 0.4, ruv.getY(i) * 0.4);
    const roof = new THREE.Mesh(roofGeo, [ps1Material({ map: Tex.plaster() }), ps1Material({ map: Tex.roof() })]);
    roof.position.y = h + 0.6; g.add(roof);
    // chimney
    if (this.rng.chance(0.6)) {
      const ch = new THREE.Mesh(this.boxUV(0.7, 2.2, 0.7, 0.5), stone);
      ch.position.set(w * 0.25, h + 1.8, d * 0.2); g.add(ch);
    }
    // door and windows on the front face (+z)
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), ps1Material({ map: Tex.door() }));
    door.position.set(0, 1.65, d / 2 + 0.02); g.add(door);
    const winM = ps1Basic({ map: Tex.window() });
    for (let f = 0; f < floors; f++) for (const sx of [-1, 1]) {
      if (f === 0 && w < 4) continue;
      const wi = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), winM);
      wi.position.set(sx * w * 0.3, 2.2 + f * 3.2, d / 2 + 0.02); g.add(wi);
    }
    for (let f = 0; f < floors; f++) {
      const wi = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), winM);
      wi.position.set(w / 2 + 0.02, 2.2 + f * 3.2, 0); wi.rotation.y = Math.PI / 2; g.add(wi);
      const wj = wi.clone(); wj.position.x = -w / 2 - 0.02; wj.rotation.y = -Math.PI / 2; g.add(wj);
    }
    // awning crate/barrel clutter
    if (this.rng.chance(0.5)) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 7), ps1Material({ map: Tex.wood() }));
      barrel.position.set(w / 2 - 0.4, 1.05, d / 2 + 0.6); g.add(barrel);
    }
    g.position.set(x, y - 0.4, z);
    g.rotation.y = rot;
    this.group.add(g);
    this.boxes.push({ x, z, hw: w / 2 + 0.3, hd: d / 2 + 0.3, rot });
  }

  buildTown() {
    const r = this.rng;
    // fountain
    const y0 = this.heightAt(0, 0);
    const stone = ps1Material({ map: Tex.stoneWall() });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 1, 8, 1, true), stone);
    basin.position.set(0, y0 + 0.5, 0); this.group.add(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.3, 4, 8), stone);
    rim.rotation.x = Math.PI / 2; rim.position.set(0, y0 + 1, 0); this.group.add(rim);
    const water = new THREE.Mesh(new THREE.CircleGeometry(4.2, 8), ps1Material({ map: Tex.water() }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, y0 + 0.75, 0); this.group.add(water);
    this.water = water;

    // teleport gate: a stone arch with a turning ring of light
    const gateG = new THREE.Group();
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(this.boxUV(1, 7, 1, 0.5), stone); pil.position.set(s * 3, 3.5, 0); gateG.add(pil);
    }
    const lintel = new THREE.Mesh(this.boxUV(7.4, 1, 1.2, 0.5), stone); lintel.position.y = 7.2; gateG.add(lintel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.18, 4, 16), ps1Basic({ map: Tex.gate(), fog: false }));
    ring.position.y = 3.5; gateG.add(ring);
    const portal = new THREE.Mesh(new THREE.CircleGeometry(2.1, 16), ps1Basic({ color: 0x7fd0f0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false, depthWrite: false }));
    portal.position.y = 3.5; gateG.add(portal);
    gateG.position.set(0, y0, -9);
    this.group.add(gateG);
    this.gate = { group: gateG, ring, portal, x: 0, z: -9 };
    this.addCollider(-3, -9, 0.8); this.addCollider(3, -9, 0.8);
    this.addCollider(0, 0, 4.6);

    // lamp posts around the plaza
    const iron = ps1Material({ color: 0x2b2b2e });
    const glow = ps1Basic({ color: 0xffd27a });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * 11.5, z = Math.sin(a) * 11.5;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 5), iron);
      post.position.set(x, this.heightAt(x, z) + 1.6, z); this.group.add(post);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), glow);
      lamp.position.set(x, this.heightAt(x, z) + 3.3, z); this.group.add(lamp);
      this.addCollider(x, z, 0.3);
    }

    // houses on two rings, facing the plaza, avoiding the four streets
    for (const ringR of [17, 25]) {
      const n = ringR === 17 ? 10 : 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (ringR === 25 ? 0.12 : 0);
        const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
        if (Math.abs(x) < 5.5 || Math.abs(z) < 5.5) continue;
        const w = r.float(4, 6.5), d = r.float(4, 5.5);
        this.buildHouse(x, z, Math.atan2(-x, -z), w, d, r.chance(0.4) ? 2 : 1);
      }
    }
    // market stalls in the plaza
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * 0.3 + i * 0.5;
      const x = Math.cos(a) * 8.5, z = Math.sin(a) * 8.5;
      this.buildStall(x, z, Math.atan2(-x, -z), ['#9a3a2e', '#2e5a7a', '#c9a24a'][i]);
    }

    // town wall with north and south gates
    const wallM = ps1Material({ map: Tex.stoneWall() });
    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, am = (a0 + a1) / 2;
      const mx = Math.cos(am) * this.townR, mz = Math.sin(am) * this.townR;
      if (Math.abs(mx) < 4) continue; // gaps north and south
      const len = 2 * this.townR * Math.sin(Math.PI / segs) + 0.3;
      const wall = new THREE.Mesh(this.boxUV(len, 3.2, 1, 0.5), wallM);
      wall.position.set(mx, this.heightAt(mx, mz) + 1.2, mz);
      wall.rotation.y = -am + Math.PI / 2;
      this.group.add(wall);
      const cren = new THREE.Mesh(this.boxUV(len * 0.4, 0.6, 1.1, 0.5), wallM);
      cren.position.set(mx, this.heightAt(mx, mz) + 3.1, mz); cren.rotation.y = wall.rotation.y;
      this.group.add(cren);
      for (let k = -1; k <= 1; k++) this.addCollider(mx + Math.cos(am + Math.PI / 2) * k * len / 3, mz + Math.sin(am + Math.PI / 2) * k * len / 3, 0.9);
    }
    // gate towers
    for (const gz of [-this.townR, this.townR]) for (const s of [-1, 1]) {
      const tw = new THREE.Mesh(this.boxUV(2.4, 6, 2.4, 0.5), wallM);
      tw.position.set(s * 4.4, this.heightAt(s * 4.4, gz) + 2.6, gz); this.group.add(tw);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2, 2.2, 4), ps1Material({ map: Tex.roof() }));
      cap.position.set(s * 4.4, this.heightAt(s * 4.4, gz) + 6.7, gz); cap.rotation.y = Math.PI / 4; this.group.add(cap);
      this.addCollider(s * 4.4, gz, 1.6);
    }

    // NPC idle spots: plaza edge and streets
    for (let i = 0; i < 9; i++) {
      const a = r.float(0, Math.PI * 2), d = r.float(6, 12);
      this.npcSpots.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    this.spawnPoint = [0, 6];
  }

  buildStall(x, z, rot, color) {
    const g = new THREE.Group();
    const wood = ps1Material({ map: Tex.wood() });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), wood); p.position.set(sx * 1.2, 1.2, sz * 0.7); g.add(p);
    }
    const counter = new THREE.Mesh(this.boxUV(2.5, 0.9, 1.4, 0.5), wood); counter.position.y = 0.45; g.add(counter);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.06, 1.9), ps1Material({ map: Tex.cloth(color, shadeHex(color, -0.1), shadeHex(color, 0.1)) }));
    awn.position.y = 2.45; awn.rotation.x = 0.15; g.add(awn);
    // produce
    const cols = ['#c9402e', '#e0a13a', '#6f9a3a'];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), ps1Material({ color: cols[i % 3] }));
      b.position.set(-0.9 + i * 0.45, 1.0, 0.2); g.add(b);
    }
    g.position.set(x, this.heightAt(x, z), z); g.rotation.y = rot;
    this.group.add(g);
    this.addCollider(x, z, 1.4);
  }

  buildArena() {
    const { x, z, r } = this.arena;
    const y = this.heightAt(x, z);
    const stone = ps1Material({ map: Tex.stoneWall() });
    // ring of broken pillars
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (Math.abs(a - Math.PI / 2) < 0.4) continue; // entrance faces the road (south)
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const h = 5 + this.rng.float(0, 5);
      const p = new THREE.Mesh(this.boxUV(1.6, h, 1.6, 0.5), stone);
      p.position.set(px, y + h / 2 - 0.5, pz); p.rotation.y = a; this.group.add(p);
      this.addCollider(px, pz, 1.2);
    }
    this.buildTower();
  }

  buildNature() {
    const r = this.rng, b = this.biome;
    const keep = (x, z) => {
      const R = Math.hypot(x, z);
      if (R < this.townR + 4 || R > WORLD_R - 8) return false;
      if (this.pathDist(x, z) < 5) return false;
      if (Math.hypot(x - this.arena.x, z - this.arena.z) < this.arena.r + 6) return false;
      if (Math.hypot(x - this.tower.x, z - this.tower.z) < this.tower.r + 8) return false;
      return true;
    };
    const pts = poissonDisc(r, 236, 236, 4.2, (x, z) => keep(x - 118, z - 118)).map(([x, z]) => [x - 118, z - 118]);
    const trees = [], rocks = [];
    for (const [x, z] of pts) {
      const forest = this.noise.fbm(x * 0.02 + 50, z * 0.02 + 50, 3);
      if (forest > 0.12 || (forest > -0.05 && r.chance(0.15))) trees.push([x, z]);
      else if (r.chance(0.04)) rocks.push([x, z]);
    }
    this.treeList = trees;

    const bark = ps1Material({ map: Tex.bark() });
    const leaf = ps1Material({ map: Tex.leaves(b.leaves) });
    const pines = [], oaks = [];
    for (const t of trees) (r.chance(b.pine) ? pines : oaks).push(t);

    const inst = (geo, m, list, fn) => {
      const im = new THREE.InstancedMesh(geo, m, list.length);
      const o = new THREE.Object3D();
      list.forEach((p, i) => { fn(o, p, i); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      this.group.add(im); return im;
    };
    const scales = new Map();
    const sc = (p) => { if (!scales.has(p)) scales.set(p, 0.8 + r.next() * 0.6); return scales.get(p); };
    const trunk = new THREE.CylinderGeometry(0.22, 0.38, 3, 5); trunk.translate(0, 1.5, 0);
    inst(trunk, bark, trees, (o, [x, z]) => { const s = sc([x, z].join()); o.position.set(x, this.heightAt(x, z) - 0.2, z); o.scale.set(s, s, s); o.rotation.set(0, x, 0); });
    for (let k = 0; k < 3; k++) {
      const cone = new THREE.ConeGeometry(2.4 - k * 0.6, 2.8, 6); cone.translate(0, 3 + k * 1.5, 0);
      inst(cone, leaf, pines, (o, [x, z]) => { const s = sc([x, z].join()); o.position.set(x, this.heightAt(x, z) - 0.2, z); o.scale.set(s, s * 1.1, s); o.rotation.set(0, x * 3 + k, 0); });
    }
    const blob = new THREE.IcosahedronGeometry(2.1, 0);
    for (let k = 0; k < 3; k++) {
      const off = [[0, 4.2, 0], [0.9, 3.6, 0.5], [-0.8, 3.7, -0.6]][k];
      inst(blob, leaf, oaks, (o, [x, z]) => {
        const s = sc([x, z].join()) * (k ? 0.72 : 1);
        o.position.set(x + off[0] * s, this.heightAt(x, z) - 0.2 + off[1] * s, z + off[2] * s);
        o.scale.set(s, s * 0.85, s); o.rotation.set(x, z, 0);
      });
    }
    for (const [x, z] of trees) this.addCollider(x, z, 0.5);

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    inst(rockGeo, ps1Material({ map: Tex.rock() }), rocks, (o, [x, z]) => {
      const s = 0.8 + r.next() * 1.4;
      o.position.set(x, this.heightAt(x, z) + s * 0.3, z); o.scale.set(s * 1.3, s, s); o.rotation.set(r.next(), r.next() * 6, 0);
    });
    for (const [x, z] of rocks) this.addCollider(x, z, 1.2);

    // grass tufts: crossed quads with a cut-out texture
    const tc = document.createElement('canvas'); tc.width = 16; tc.height = 16;
    const tg = tc.getContext('2d');
    for (let i = 0; i < 9; i++) {
      const x = 1 + i * 1.7, hgt = 6 + Math.floor(r.next() * 9);
      tg.fillStyle = b.grass[2 + (i % 2)]; tg.fillRect(Math.floor(x), 16 - hgt, 1, hgt);
      tg.fillStyle = b.grass[1]; tg.fillRect(Math.floor(x), 16 - Math.floor(hgt / 3), 1, Math.floor(hgt / 3));
    }
    const tt = new THREE.CanvasTexture(tc); tt.magFilter = tt.minFilter = THREE.NearestFilter; tt.colorSpace = THREE.SRGBColorSpace;
    const tuftGeo = new THREE.PlaneGeometry(1, 0.8); tuftGeo.translate(0, 0.4, 0);
    const tuftGeo2 = tuftGeo.clone().rotateY(Math.PI / 2);
    const merged = mergeGeos([tuftGeo, tuftGeo2]);
    const tuftPts = poissonDisc(r, 236, 236, 2.2, (x, z) => {
      x -= 118; z -= 118;
      const R = Math.hypot(x, z);
      return R > 14 && R < WORLD_R - 6 && this.surface(x, z) === 0 && !(R < this.townR + 1 && R > this.townR - 1.5);
    }).map(([x, z]) => [x - 118, z - 118]);
    inst(merged, ps1Material({ map: tt, alphaTest: 0.5, side: THREE.DoubleSide }), tuftPts, (o, [x, z]) => {
      o.position.set(x, this.heightAt(x, z) - 0.05, z); o.rotation.set(0, r.next() * 3, 0); const s = 0.8 + r.next() * 0.8; o.scale.set(s, s, s);
    });
    // flowers
    const fl = tuftPts.filter(() => r.chance(0.25));
    const fGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14); fGeo.translate(0, 0.55, 0);
    const fCol = ['#e8e0c8', '#d8a83a', '#b8506a', '#8a7ac8'][this.floor % 4];
    inst(fGeo, ps1Basic({ color: fCol }), fl, (o, [x, z]) => { o.position.set(x + 0.3, this.heightAt(x, z), z); });
  }

  buildRim() {
    // outer support pillars climbing to the floor above
    const stone = ps1Material({ map: Tex.stoneWall() });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * (WORLD_R + 40), z = Math.sin(a) * (WORLD_R + 40);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 260, 6), stone);
      p.geometry.attributes.uv.array.forEach((v, j, arr) => (arr[j] = j % 2 ? v * 50 : v * 4));
      p.position.set(x, 30, z); this.group.add(p);
    }
  }

  buildSpawnZones() {
    // field zones: boars near town, wolves in the forest, kobolds near the arena
    const r = this.rng;
    const zones = [];
    for (let i = 0; i < 9; i++) {
      const a = r.float(0, Math.PI * 2), d = r.float(this.townR + 14, WORLD_R - 20);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x - this.arena.x, z - this.arena.z) < 30) { i--; continue; }
      const forest = this.noise.fbm(x * 0.02 + 50, z * 0.02 + 50, 3);
      zones.push({ x, z, r: 10, kind: forest > 0.1 ? 'wolf' : 'boar', max: forest > 0.1 ? 3 : 2 });
    }
    zones.push({ x: this.arena.x - 22, z: this.arena.z + 28, r: 8, kind: 'kobold', max: 2 });
    zones.push({ x: this.arena.x + 22, z: this.arena.z + 28, r: 8, kind: 'kobold', max: 2 });
    this.spawnZones = zones;
  }

  // --- collision ---
  blocked(x, z, rad = 0.4) {
    if (Math.hypot(x, z) > WORLD_R - 3) return true;
    for (const c of this.colliders) {
      const dx = x - c.x, dz = z - c.z, rr = c.r + rad;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    for (const b of this.boxes) {
      const dx = x - b.x, dz = z - b.z;
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hw + rad && Math.abs(lz) < b.hd + rad) return true;
    }
    return false;
  }
  // push a circle out of colliders; returns corrected [x, z]
  resolve(x, z, rad = 0.4) {
    for (const c of this.colliders) {
      const dx = x - c.x, dz = z - c.z, rr = c.r + rad;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); x = c.x + (dx / d) * rr; z = c.z + (dz / d) * rr; }
    }
    for (const b of this.boxes) {
      const dx = x - b.x, dz = z - b.z;
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      let lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ox = b.hw + rad - Math.abs(lx), oz = b.hd + rad - Math.abs(lz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) lx += Math.sign(lx) * ox; else lz += Math.sign(lz) * oz;
        const c2 = Math.cos(b.rot), s2 = Math.sin(b.rot);
        x = b.x + lx * c2 - lz * s2; z = b.z + lx * s2 + lz * c2;
      }
    }
    const R = Math.hypot(x, z), lim = WORLD_R - 3;
    if (R > lim) { x *= lim / R; z *= lim / R; }
    return [x, z];
  }

  update(dt, t) {
    for (const c of this.clouds) {
      c.a += c.s * dt;
      c.m.position.x = Math.cos(c.a) * c.d; c.m.position.z = Math.sin(c.a) * c.d;
      c.m.lookAt(0, c.m.position.y * 0.6, 0);
    }
    if (this.gate) { this.gate.ring.rotation.z = t * 0.8; this.gate.portal.material.opacity = 0.25 + Math.sin(t * 2) * 0.1; }
    if (this.water) this.water.material.map.offset.set(t * 0.05, t * 0.03);
  }
}

function shadeHex(hex, k) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, k); return '#' + c.getHexString(); }

function mergeGeos(geos) {
  const pos = [], uv = [], nor = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array); uv.push(...ng.attributes.uv.array); nor.push(...ng.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
