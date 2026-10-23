import * as THREE from 'three';
import { damp } from '../core/rng.js';
import { PoseDriver, JOINTS } from '../chars/anim.js';

// Monsters are "constructs" spawned by the floor's system: faceted obsidian
// bodies with glowing seams along their hard edges. When they die they break
// into polygon shards. Each species has its own palette and silhouette.

export const SPECIES = {
  boar: { name: 'Frenzy Boar', body: '#3a2a24', seam: '#ff6a2a', hp: 60, atk: 9, speed: 5.5, range: 2.2, xp: 14, col: 12 },
  wolf: { name: 'Dire Wolf', body: '#262c3a', seam: '#5ad8ff', hp: 48, atk: 8, speed: 7.5, range: 2.0, xp: 16, col: 14 },
  kobold: { name: 'Ruin Kobold Trooper', body: '#3a3426', seam: '#ffd23a', hp: 90, atk: 12, speed: 4.2, range: 2.4, xp: 26, col: 30 },
  boss: { name: 'Illfang the Kobold Lord', body: '#2a1414', seam: '#ff2a3a', hp: 1400, atk: 24, speed: 4.6, range: 3.6, xp: 600, col: 1200 },
};

function facet(rx, ry, rz, detail = 1, jitter = 0.12, seed = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [1 + rnd() * jitter * 2, 1 + rnd() * jitter * 2]);
    const [a, b] = seen.get(key);
    p.setXYZ(i, p.getX(i) * rx * a, p.getY(i) * ry * b, p.getZ(i) * rz * a);
  }
  g.computeVertexNormals();
  return g;
}
function spike(r, h, sides = 4) { const g = new THREE.ConeGeometry(r, h, sides); g.translate(0, h / 2, 0); return g; }
function limb(r0, r1, len, sides = 5) { const g = new THREE.CylinderGeometry(r0, r1, len, sides); g.translate(0, -len / 2, 0); return g; }

function makeMats(sp) {
  const body = new THREE.MeshStandardMaterial({ color: sp.body, roughness: 0.32, metalness: 0.45, flatShading: true, envMapIntensity: 1.2 });
  const seam = new THREE.LineBasicMaterial({ color: new THREE.Color(sp.seam).multiplyScalar(2.2), transparent: true, opacity: 0.9 });
  const glow = new THREE.MeshStandardMaterial({ color: '#000', emissive: sp.seam, emissiveIntensity: 4 });
  const plate = new THREE.MeshStandardMaterial({ color: '#7a7a84', roughness: 0.35, metalness: 0.9, flatShading: true });
  return { body, seam, glow, plate };
}

class Part {
  // a mesh plus its glowing seam lines
  static add(parent, geo, M, mat, x = 0, y = 0, z = 0, seams = true) {
    const m = new THREE.Mesh(geo, mat || M.body);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    if (seams) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), M.seam));
    return m;
  }
}

export class BeastModel {
  // boar / wolf: body, neck+head, four two-segment legs, tail
  constructor(kind) {
    const sp = SPECIES[kind];
    const M = (this.M = makeMats(sp));
    const boar = kind === 'boar';
    this.root = new THREE.Group();
    const body = new THREE.Group(); body.position.y = boar ? 0.72 : 0.78; this.root.add(body); this.body = body;
    Part.add(body, facet(boar ? 0.48 : 0.34, boar ? 0.42 : 0.32, boar ? 0.78 : 0.72, 1, 0.1, boar ? 3 : 5), M);
    if (boar) {
      for (let i = 0; i < 7; i++) { const s = Part.add(body, spike(0.08, 0.32 - Math.abs(i - 3) * 0.04), M, M.body, 0, 0.34, 0.45 - i * 0.14); s.rotation.x = -0.5; }
    } else {
      Part.add(body, facet(0.4, 0.38, 0.32, 1, 0.12, 9), M, M.body, 0, 0.06, 0.42);
      for (let i = 0; i < 5; i++) { const s = Part.add(body, spike(0.06, 0.24), M, M.body, 0, 0.3, 0.4 - i * 0.16); s.rotation.x = -0.9; }
    }
    const head = new THREE.Group(); head.position.set(0, boar ? 0.08 : 0.2, boar ? 0.78 : 0.74); body.add(head); this.head = head;
    Part.add(head, facet(boar ? 0.3 : 0.2, boar ? 0.28 : 0.18, 0.28, 1, 0.1, 11), M);
    const snout = Part.add(head, facet(boar ? 0.2 : 0.11, boar ? 0.16 : 0.09, boar ? 0.22 : 0.26, 0, 0.05, 13), M, M.body, 0, -0.05, boar ? 0.26 : 0.3);
    void snout;
    for (const s of [1, -1]) {
      Part.add(head, new THREE.OctahedronGeometry(0.045), M, M.glow, s * (boar ? 0.17 : 0.1), 0.07, 0.2, false);
      const ear = Part.add(head, spike(boar ? 0.07 : 0.06, boar ? 0.18 : 0.24, 3), M, M.body, s * (boar ? 0.17 : 0.1), boar ? 0.2 : 0.16, -0.05);
      ear.rotation.z = -s * 0.4;
      if (boar) { const t = Part.add(head, spike(0.04, 0.32, 4), M, M.plate, s * 0.14, -0.12, 0.36); t.rotation.set(-1.0, 0, s * 0.3); }
      else { const f = Part.add(head, spike(0.015, 0.06, 3), M, M.plate, s * 0.05, -0.13, 0.5, false); f.rotation.x = Math.PI; }
    }
    if (!boar) { this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.1, 0.15); head.add(this.jaw); Part.add(this.jaw, facet(0.08, 0.035, 0.18, 0, 0.05, 17), M, M.body, 0, 0, 0.16); }
    const tail = new THREE.Group(); tail.position.set(0, 0.12, -0.72); body.add(tail); this.tail = tail;
    const tg = boar ? limb(0.03, 0.01, 0.3, 4) : limb(0.09, 0.02, 0.6, 5); tg.rotateX(-Math.PI / 2 - 0.4);
    Part.add(tail, tg, M);
    this.legs = [];
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const hip = new THREE.Group(); hip.position.set(sx * (boar ? 0.28 : 0.2), -0.12, sz * 0.46); body.add(hip);
      Part.add(hip, limb(boar ? 0.11 : 0.08, boar ? 0.08 : 0.06, 0.34), M);
      const knee = new THREE.Group(); knee.position.y = -0.32; hip.add(knee);
      Part.add(knee, limb(boar ? 0.075 : 0.055, boar ? 0.06 : 0.04, 0.3), M);
      Part.add(knee, new THREE.BoxGeometry(boar ? 0.12 : 0.09, 0.06, boar ? 0.15 : 0.14), M, M.plate, 0, -0.3, 0.02, false);
      this.legs.push({ hip, knee, front: sz > 0, side: sx });
    }
    this.phase = Math.random() * 6; this.lunge = 0; this.time = 0;
    this.baseY = body.position.y;
  }
  update(dt, st) {
    this.time += dt;
    const sp = Math.min(st.speed / 7, 1.4);
    this.phase += dt * (3 + sp * 10);
    for (const L of this.legs) {
      const off = (L.front ? 0 : Math.PI) + (L.side > 0 ? 0 : Math.PI * 0.5);
      const s = Math.sin(this.phase + off);
      L.hip.rotation.x = damp(L.hip.rotation.x, st.dead ? (L.front ? -1.2 : 1.2) : s * 0.75 * sp, 14, dt);
      L.knee.rotation.x = damp(L.knee.rotation.x, st.dead ? 0.4 : Math.max(0, Math.cos(this.phase + off)) * (L.front ? -0.8 : 0.8) * sp, 14, dt);
    }
    this.lunge = damp(this.lunge, st.windup ? -0.35 : st.attacking ? 0.28 : 0, 16, dt);
    this.body.rotation.x = this.lunge + Math.sin(this.phase * 2) * 0.04 * sp - (st.hurt || 0) * 0.3;
    this.body.position.y = this.baseY + Math.abs(Math.sin(this.phase)) * 0.06 * sp;
    this.body.rotation.z = damp(this.body.rotation.z, st.dead ? 1.4 : 0, st.dead ? 5 : 10, dt);
    this.head.rotation.x = damp(this.head.rotation.x, st.windup ? 0.3 : st.attacking ? -0.25 : Math.sin(this.time * 1.5) * 0.06, 12, dt);
    this.tail.rotation.y = Math.sin(this.time * (st.speed > 1 ? 14 : 4)) * 0.35;
    if (this.jaw) this.jaw.rotation.x = damp(this.jaw.rotation.x, st.attacking ? 0.6 : st.windup ? 0.3 : 0, 20, dt);
    const g = st.windup ? 1 + Math.sin(this.time * 40) * 0.5 : 0;
    this.M.glow.emissiveIntensity = 4 + g * 6;
  }
}

export class ConstructHumanoid {
  // kobolds and the floor boss: digitigrade-ish humanoid with a snouted head
  constructor(kind, weapon = 'axe') {
    const sp = SPECIES[kind];
    const M = (this.M = makeMats(sp));
    const S = kind === 'boss' ? 2.3 : 1;
    this.root = new THREE.Group();
    const inner = new THREE.Group(); inner.scale.setScalar(S); this.root.add(inner);
    this.j = {};
    const J = (n, p, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); this.j[n] = g; return g; };
    const hips = J('hips', inner, 0, 0.92, 0);
    Part.add(hips, facet(0.17, 0.12, 0.12, 1, 0.1, 21), M);
    const spine = J('spine', hips, 0, 0.08, 0);
    Part.add(spine, facet(0.16, 0.14, 0.12, 1, 0.1, 22), M, M.body, 0, 0.1, 0);
    const chest = J('chest', spine, 0, 0.2, 0);
    Part.add(chest, facet(0.26, 0.2, 0.17, 1, 0.1, 23), M, M.body, 0, 0.14, 0.01);
    for (const s of [1, -1]) Part.add(chest, facet(0.12, 0.08, 0.13, 0, 0.1, 30 + s), M, M.plate, s * 0.25, 0.3, 0); // pauldrons
    if (kind === 'boss') for (let i = 0; i < 5; i++) { const k = Part.add(chest, spike(0.05, 0.28), M, M.plate, (i - 2) * 0.09, 0.34, -0.12); k.rotation.x = -0.5; }
    const neck = J('neck', chest, 0, 0.3, 0.02);
    const head = J('head', neck, 0, 0.06, 0.02);
    Part.add(head, facet(0.13, 0.12, 0.14, 1, 0.1, 24), M, M.body, 0, 0.1, 0);
    Part.add(head, facet(0.08, 0.06, 0.12, 0, 0.05, 25), M, M.body, 0, 0.05, 0.16);
    for (const s of [1, -1]) {
      Part.add(head, new THREE.OctahedronGeometry(0.03), M, M.glow, s * 0.06, 0.13, 0.12, false);
      const ear = Part.add(head, spike(0.05, 0.2, 3), M, M.body, s * 0.1, 0.2, -0.02); ear.rotation.z = -s * 0.5;
    }
    for (const side of [1, -1]) {
      const s = side === 1 ? 'L' : 'R';
      const sh = J('sh' + s, chest, side * 0.25, 0.24, 0);
      Part.add(sh, limb(0.07, 0.055, 0.28), M);
      const el = J('el' + s, sh, 0, -0.27, 0);
      Part.add(el, limb(0.055, 0.045, 0.25), M);
      const wr = J('wr' + s, el, 0, -0.25, 0);
      Part.add(wr, facet(0.05, 0.06, 0.045, 0, 0.1, 40), M);
      const hp = J('hip' + s, hips, side * 0.1, -0.05, 0);
      Part.add(hp, limb(0.085, 0.065, 0.42), M);
      const kn = J('kn' + s, hp, 0, -0.42, 0);
      Part.add(kn, limb(0.06, 0.045, 0.4), M);
      const an = J('an' + s, kn, 0, -0.41, 0);
      const foot = new THREE.BoxGeometry(0.11, 0.07, 0.22); foot.translate(0, -0.03, 0.05);
      Part.add(an, foot, M, M.plate, 0, 0, 0, false);
    }
    // weapon
    const grip = new THREE.Group(); grip.position.set(0, -0.06, 0.01); this.j.wrR.add(grip);
    this.weaponGroup = grip;
    this.setWeapon(weapon);
    if (kind === 'boss') { // buckler on the left arm
      const b = Part.add(this.j.elL, new THREE.CylinderGeometry(0.24, 0.24, 0.05, 8), M, M.plate, 0.08, -0.15, 0); b.rotation.z = Math.PI / 2;
    }
    this.driver = new PoseDriver();
    this.scale = S;
  }
  setWeapon(kind) {
    const g = this.weaponGroup, M = this.M;
    while (g.children.length) g.remove(g.children[0]);
    let len;
    if (kind === 'axe') {
      Part.add(g, limb(0.025, 0.025, 0.85, 6), M, M.plate, 0, 0.15, 0, false);
      const head = new THREE.Shape(); head.moveTo(0, 0.12); head.quadraticCurveTo(0.28, 0.2, 0.3, -0.05); head.quadraticCurveTo(0.2, -0.15, 0, -0.1); head.closePath();
      const hg = new THREE.ExtrudeGeometry(head, { depth: 0.03, bevelEnabled: false }); hg.translate(0, 0, -0.015); hg.rotateY(-Math.PI / 2);
      this.blade = Part.add(g, hg, M, M.plate, 0, -0.62, 0.03);
      len = 0.8;
    } else {
      // curved talwar for the boss's final phase
      const s = new THREE.Shape(); s.moveTo(-0.04, 0); s.lineTo(-0.05, -1.0); s.quadraticCurveTo(-0.02, -1.35, 0.12, -1.45); s.quadraticCurveTo(0.1, -1.0, 0.05, 0); s.closePath();
      const bg = new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.005, bevelSegments: 1 });
      bg.translate(0, -0.1, -0.008);
      this.blade = Part.add(g, bg, M, M.plate);
      Part.add(g, limb(0.025, 0.025, 0.22, 6), M, M.body, 0, 0.1, 0, false);
      len = 1.5;
    }
    this.bladeMat = this.blade.material;
    this.tip = new THREE.Object3D(); this.tip.position.y = -len; g.add(this.tip);
    this.hiltRef = new THREE.Object3D(); this.hiltRef.position.y = -0.15; g.add(this.hiltRef);
  }
  get clip() { return this.driver.clip; }
  play(c, s) { this.driver.play(c, s); }
  update(dt, st) {
    const pose = this.driver.update(dt, st);
    for (const k of JOINTS) { const j = this.j[k]; if (j) j.rotation.set(pose[k][0], pose[k][1], pose[k][2]); }
    this.j.hips.position.y = 0.92 + this.driver.bob;
    const g = st.windup ? 1 + Math.sin(this.driver.time * 40) * 0.5 : 0;
    this.M.glow.emissiveIntensity = 4 + g * 6;
    this.M.seam.opacity = 0.75 + g * 0.25;
  }
}
