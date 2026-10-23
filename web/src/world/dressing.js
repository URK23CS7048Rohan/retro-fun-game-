import * as THREE from 'three';
import { RNG, poissonDisc } from '../core/rng.js';

// Set dressing: everything that makes the floor feel lived in. Props are
// placed relative to the buildings the world generator recorded, then
// nature props are scattered with Poisson-disc sampling by terrain type.

export function dressWorld(world, lib) {
  const g = new THREE.Group();
  const r = new RNG(world.seed + 77);
  const H = (x, z) => world.heightAt(x, z);
  const P = {};
  const put = (id, x, z, opt = {}) => { (P[id] || (P[id] = [])).push({ x, y: (opt.y ?? H(x, z)) + (opt.dy || 0), z, ry: opt.ry ?? r.float(0, 6.28), s: opt.s || 1, rx: opt.rx, rz: opt.rz }); };
  // local -> world for a building footprint
  const L = (b, lx, lz) => { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; };

  // ---- around houses ----
  for (const b of world.houses || []) {
    const front = b.hd + 0.25;
    const side = r.chance(0.5) ? 1 : -1;
    // barrels and crates stacked beside the door
    const [bx, bz] = L(b, side * (b.hw - 0.6), front + 0.5);
    if (r.chance(0.75)) put(r.chance(0.5) ? 'Barrel_01' : 'wine_barrel_01', bx, bz, { s: 1 });
    if (r.chance(0.6)) { const [cx, cz] = L(b, side * (b.hw - 1.5), front + 0.55); put('wooden_crate_01', cx, cz, { ry: b.rot + r.float(-0.3, 0.3) }); if (r.chance(0.5)) put('wooden_crate_02', cx, cz, { dy: 0.55, ry: b.rot + r.float(-0.5, 0.5), s: 0.8 }); }
    if (r.chance(0.5)) { const [px, pz] = L(b, -side * (b.hw - 0.5), front + 0.4); put(r.chance(0.5) ? 'planter_pot_clay' : 'potted_plant_01', px, pz); }
    if (r.chance(0.45)) { const [px, pz] = L(b, -side * 1.1, front + 0.35); put('wooden_bucket_01', px, pz); }
    if (r.chance(0.35)) { const [px, pz] = L(b, side * 0.2, front + 1.6); put('painted_wooden_bench', px, pz, { ry: b.rot }); }
    if (r.chance(0.5)) { const [px, pz] = L(b, side * 1.3, front + 0.1); put('wooden_lantern_01', px, pz, { y: H(px, pz) + 2.35, s: 1.2 }); }
    // round the back: firewood and jars
    if (r.chance(0.5)) { const [px, pz] = L(b, r.float(-1, 1) * (b.hw - 0.8), -b.hd - 0.6); put('dry_branches_medium_01', px, pz, { s: 0.8 }); }
    if (r.chance(0.4)) { const [px, pz] = L(b, b.hw + 0.5, r.float(-1, 1)); put('ceramic_vase_01', px, pz, { s: 1.4 }); }
  }

  // ---- plaza: café tables, benches facing the fountain, fruit baskets ----
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI * 0.75 + i * 0.32;
    const x = Math.cos(a) * 10.4, z = Math.sin(a) * 10.4;
    put('WoodenTable_01', x, z, { ry: a });
    put('painted_wooden_bench', x + Math.cos(a + 1.57) * 0.9, z + Math.sin(a + 1.57) * 0.9, { ry: a });
    put('jug_01', x + 0.15, z, { y: H(x, z) + 0.78 });
    if (i % 2) put('wooden_lantern_01', x - 0.2, z + 0.1, { y: H(x, z) + 0.78, s: 0.8 });
    world.addCollider(x, z, 0.9);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 6.2, z = Math.sin(a) * 6.2;
    if (Math.abs(Math.atan2(z, x) + Math.PI / 2) < 0.5) continue; // keep the gate approach clear
    put('painted_wooden_bench', x, z, { ry: -a + Math.PI / 2 });
  }
  // market stall produce
  for (const st of world.stalls || []) {
    for (let k = 0; k < 2; k++) {
      const [x, z] = L(st, -0.6 + k * 1.2, 0.95);
      put('wicker_basket_01', x, z, { s: 1.2 });
      for (let q = 0; q < 3; q++) put('food_apple_01', x + r.float(-0.1, 0.1), z + r.float(-0.1, 0.1), { dy: 0.12 + q * 0.02, s: 1.1 });
    }
    const [bx, bz] = L(st, 1.6, 0.2); put('barrel_03', bx, bz);
  }
  // hanging lanterns on the gate arch, statue on the fountain
  put('horse_statue_01', 0, 0, { y: H(0, 0) + 3.8, s: 2.2, ry: Math.PI * 0.5 });
  for (const s of [-1, 1]) put('lantern_chandelier_01', s * 2.4, -9, { y: H(0, -9) + 6.3, s: 1.1, ry: 0 });
  // shields on the guild hall front
  if (world.guild) for (let k = -1; k <= 1; k++) { const [x, z] = L(world.guild, k * 2.2, world.guild.hd + 0.12); put('kite_shield', x, z, { y: H(x, z) + 4.2, ry: world.guild.rot, rx: -0.1, s: 1.3 }); }

  // ---- campfire camp outside the south gate ----
  const cx = 14, cz = world.townR + 12, cy = H(cx, cz);
  put('stone_fire_pit', cx, cz, { s: 1.2 });
  for (let i = 0; i < 3; i++) { const a = i * 2.1; put('painted_wooden_bench', cx + Math.cos(a) * 2, cz + Math.sin(a) * 2, { ry: -a + Math.PI / 2 }); }
  put('Barrel_01', cx + 2.8, cz - 1.2); put('wooden_crate_01', cx + 3.1, cz + 0.4);
  world.addCollider(cx, cz, 1.2);
  world.campfire = new THREE.Vector3(cx, cy + 0.5, cz);

  // ---- nature ----
  const keep = (x, z, minTown = 4) => {
    const R = Math.hypot(x, z);
    return R > world.townR + minTown && R < 114 && world.pathDist(x, z) > 2.5 && !world.blocked(x, z, 0.6);
  };
  const scat = (dist, fn) => poissonDisc(r, 232, 232, dist, (x, z) => fn(x - 116, z - 116)).map(([x, z]) => [x - 116, z - 116]);
  // flower meadows: patches by noise
  for (const [x, z] of scat(3.5, (x, z) => keep(x, z) && world.noise.fbm(x * 0.04 + 9, z * 0.04, 2) > 0.22)) put('flower_gazania', x, z, { s: r.float(1.4, 2.2) });
  // ferns and shrubs in woods, rocks with dry branches
  for (const [x, z] of scat(3.2, (x, z) => keep(x, z) && world.noise.fbm(x * 0.02 + 50, z * 0.02 + 50, 3) > 0.05)) put(r.chance(0.6) ? 'fern_02' : 'shrub_03', x, z, { s: r.float(1.2, 2.2) });
  for (const [x, z] of scat(9, (x, z) => keep(x, z, 8))) {
    const s = r.float(1.2, 3.2);
    put(r.chance(0.5) ? 'rock_07' : 'rock_09', x, z, { s, dy: -0.15 * s });
    world.addCollider(x, z, 0.5 * s);
    if (r.chance(0.4)) put('dry_branches_medium_01', x + 1.2, z + 0.4, { s: 0.7 });
  }
  // shrubs along the town wall and the road edges
  for (let i = 0; i < 60; i++) {
    const a = r.float(0, 6.28), d = world.townR + r.float(1.5, 3);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(x) > 7) put('shrub_03', x, z, { s: r.float(1, 1.8) });
  }
  for (let z = -world.townR - 4; z > world.arena.z + world.arena.r + 3; z -= 3.2) {
    const px = world.pathCenter(z);
    for (const s of [-1, 1]) if (r.chance(0.45)) put('shrub_03', px + s * r.float(3.2, 4.5), z, { s: r.float(1, 1.6) });
  }

  const view = { flower_empodium: 55, flower_gazania: 45, fern_02: 70, shrub_03: 80, food_apple_01: 35, jug_01: 35, wooden_bucket_01: 50, ceramic_vase_01: 50, dry_branches_medium_01: 60 };
  for (const id in P) lib.scatter(g, id, P[id], { viewDist: view[id] || 110, cast: !['flower_empodium', 'flower_gazania', 'food_apple_01', 'jug_01'].includes(id) });
  return g;
}

// Bunting and lantern strings: catenary curves strung across the streets
// with small cloth flags and glowing bulbs.
export function buildStrings(world) {
  const g = new THREE.Group();
  const r = new RNG(world.seed + 3);
  const flags = [], bulbs = [], ropes = [];
  const span = (a, b, sag) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * sag; pts.push(p); }
    return pts;
  };
  const pairs = [];
  const R = world.townR;
  // across the north/south and east/west streets between house rings
  for (const d of [15.5, 22, 27]) {
    pairs.push([[-4.2, -d], [4.2, -d]], [[-4.2, d], [4.2, d]], [[-d, -4.2], [-d, 4.2]], [[d, -4.2], [d, 4.2]]);
  }
  // radial spokes over the plaza from the gate arch
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; pairs.push([[0, -9], [Math.cos(a) * 12, Math.sin(a) * 12]]); }
  for (const [[x0, z0], [x1, z1]] of pairs) {
    if (Math.hypot(x1, z1) > R + 1) continue;
    const a = new THREE.Vector3(x0, world.heightAt(x0, z0) + 5.2, z0), b = new THREE.Vector3(x1, world.heightAt(x1, z1) + 5.2, z1);
    if (x0 === 0 && z0 === -9) a.y = world.heightAt(0, -9) + 8;
    const pts = span(a, b, a.distanceTo(b) * 0.08);
    ropes.push(pts);
    const lantern = r.chance(0.4);
    for (let i = 1; i < pts.length - 1; i++) (lantern ? bulbs : flags).push({ p: pts[i], dir: pts[i + 1].clone().sub(pts[i - 1]).normalize(), c: i % 4 });
  }
  // rope lines
  const rp = [];
  for (const pts of ropes) for (let i = 0; i < pts.length - 1; i++) rp.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#3a2a1e' })));
  // flags: triangles, instanced, coloured per flag
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.18, 0, 0, 0.18, 0, 0, 0, -0.42, 0], 3));
  tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const fm = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
  const fi = new THREE.InstancedMesh(tri, fm, flags.length);
  const cols = ['#c8302a', '#f0e8d8', '#2a5a9a', '#e8b030'].map((c) => new THREE.Color(c));
  const o = new THREE.Object3D();
  flags.forEach((f, i) => {
    o.position.copy(f.p); o.lookAt(f.p.clone().add(new THREE.Vector3(-f.dir.z, 0, f.dir.x)));
    o.updateMatrix(); fi.setMatrixAt(i, o.matrix); fi.setColorAt(i, cols[f.c]);
  });
  g.add(fi);
  const bi = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffd8a0', emissive: '#ffb050', emissiveIntensity: 5 }), bulbs.length);
  bulbs.forEach((b, i) => { o.position.copy(b.p); o.position.y -= 0.12; o.rotation.set(0, 0, 0); o.updateMatrix(); bi.setMatrixAt(i, o.matrix); });
  g.add(bi);
  return g;
}
