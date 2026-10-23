import * as THREE from 'three';
import { ps1Material } from './ps1.js';
import { Tex, solid } from './textures.js';
import { damp } from '../core/rng.js';

// Four-legged monsters: a jointed body with a gallop cycle and a lunge pose.

function box(w, h, d, taperFront = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) { p.setX(i, p.getX(i) * taperFront); p.setY(i, p.getY(i) * taperFront); }
  g.computeVertexNormals();
  return g;
}

export class Quadruped {
  constructor(kind) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.j = {};
    const boar = kind === 'boar';
    const fur = boar ? Tex.fur('#6a4a34', '#4e3524', '#87604a') : Tex.fur('#6b6e74', '#4a4c52', '#9a9da3');
    const m = ps1Material({ map: fur });
    const dark = ps1Material({ map: solid(boar ? '#3a281c' : '#2e3034') });
    const tusk = ps1Material({ map: solid('#e8e0c8') });
    const eye = ps1Material({ map: solid(boar ? '#e04a2a' : '#e8c33a') });
    const L = boar ? 1.0 : 0.95;
    const body = new THREE.Group(); body.position.y = boar ? 0.62 : 0.68; this.root.add(body); this.j.body = body;
    body.add(new THREE.Mesh(box(boar ? 0.7 : 0.48, boar ? 0.62 : 0.46, 1.15 * L, boar ? 1.1 : 0.9), m));
    if (boar) { // bristle ridge
      const ridge = new THREE.Mesh(box(0.14, 0.18, 1.0, 1), dark); ridge.position.set(0, 0.36, 0); body.add(ridge);
    } else {
      const ruff = new THREE.Mesh(box(0.56, 0.52, 0.4, 1), m); ruff.position.set(0, 0.04, 0.38); body.add(ruff);
    }
    const head = new THREE.Group(); head.position.set(0, boar ? 0.05 : 0.18, 0.62 * L); body.add(head); this.j.head = head;
    head.add(new THREE.Mesh(box(boar ? 0.48 : 0.32, boar ? 0.44 : 0.3, 0.42, boar ? 0.85 : 0.8), m));
    const snout = new THREE.Mesh(box(boar ? 0.3 : 0.16, boar ? 0.26 : 0.14, boar ? 0.26 : 0.36, 0.85), m);
    snout.position.set(0, boar ? -0.05 : -0.05, boar ? 0.32 : 0.36); head.add(snout);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(boar ? 0.22 : 0.08, boar ? 0.16 : 0.06, 0.04), dark);
    nose.position.set(0, boar ? -0.05 : -0.02, boar ? 0.46 : 0.55); head.add(nose);
    for (const s of [1, -1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), eye); e.position.set(s * (boar ? 0.17 : 0.11), 0.07, 0.22); head.add(e);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(boar ? 0.08 : 0.07, boar ? 0.16 : 0.2, 4), m);
      ear.position.set(s * (boar ? 0.18 : 0.1), boar ? 0.26 : 0.22, -0.05); ear.rotation.z = -s * 0.4; head.add(ear);
      if (boar) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 4), tusk);
        t.position.set(s * 0.13, -0.08, 0.42); t.rotation.set(-0.9, 0, s * 0.3); head.add(t);
      } else {
        const fang = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.06, 3), tusk); fang.position.set(s * 0.05, -0.12, 0.5); fang.rotation.x = Math.PI; head.add(fang);
      }
    }
    if (!boar) { // jaw for the bite
      const jaw = new THREE.Group(); jaw.position.set(0, -0.12, 0.18); head.add(jaw); this.j.jaw = jaw;
      const jm = new THREE.Mesh(box(0.14, 0.06, 0.34, 0.9), m); jm.position.z = 0.17; jaw.add(jm);
    }
    // tail
    const tail = new THREE.Group(); tail.position.set(0, boar ? 0.15 : 0.12, -0.58 * L); body.add(tail); this.j.tail = tail;
    const tm = new THREE.Mesh(box(boar ? 0.05 : 0.12, boar ? 0.05 : 0.12, boar ? 0.25 : 0.55, 0.6), m);
    tm.position.z = boar ? -0.12 : -0.27; tail.add(tm);
    // legs: hip joint, upper, lower with hoof/paw
    const legs = [];
    for (const [sx, sz, n] of [[1, 1, 'FL'], [-1, 1, 'FR'], [1, -1, 'BL'], [-1, -1, 'BR']]) {
      const hip = new THREE.Group(); hip.position.set(sx * (boar ? 0.24 : 0.17), -0.12, sz * 0.4 * L); body.add(hip);
      const up = new THREE.Mesh(box(boar ? 0.16 : 0.12, 0.3, boar ? 0.2 : 0.14), m); up.position.y = -0.13; hip.add(up);
      const knee = new THREE.Group(); knee.position.y = -0.27; hip.add(knee);
      const lo = new THREE.Mesh(box(boar ? 0.12 : 0.08, 0.24, boar ? 0.13 : 0.09), boar ? m : m); lo.position.y = -0.11; knee.add(lo);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(boar ? 0.13 : 0.1, 0.06, boar ? 0.15 : 0.14), dark); foot.position.set(0, -0.23, 0.02); knee.add(foot);
      legs.push({ hip, knee, front: sz > 0, side: sx });
      this.j[n] = hip;
    }
    this.legs = legs;
    this.phase = Math.random() * 6;
    this.lunge = 0; this.time = 0;
  }
  update(dt, st) {
    this.time += dt;
    const sp = Math.min(st.speed / 7, 1.4);
    this.phase += dt * (3 + sp * 10);
    const b = this.j.body;
    for (const L of this.legs) {
      const off = (L.front ? 0 : Math.PI) + (L.side > 0 ? 0 : Math.PI * 0.5);
      const s = Math.sin(this.phase + off);
      const tgt = st.dead ? (L.front ? -1.2 : 1.2) : s * 0.75 * sp;
      L.hip.rotation.x = damp(L.hip.rotation.x, tgt, 14, dt);
      L.knee.rotation.x = damp(L.knee.rotation.x, st.dead ? 0.4 : Math.max(0, Math.cos(this.phase + off)) * (L.front ? -0.8 : 0.8) * sp, 14, dt);
    }
    // lunge pose: rear up and snap forward
    this.lunge = damp(this.lunge, st.windup ? -0.35 : st.attacking ? 0.25 : 0, 16, dt);
    b.rotation.x = this.lunge + Math.sin(this.phase * 2) * 0.04 * sp;
    b.position.y = (this.kind === 'boar' ? 0.62 : 0.68) + Math.abs(Math.sin(this.phase)) * 0.06 * sp - (st.dead ? 0.35 : 0);
    b.rotation.z = st.dead ? damp(b.rotation.z, 1.4, 5, dt) : damp(b.rotation.z, 0, 10, dt);
    this.j.head.rotation.x = damp(this.j.head.rotation.x, st.windup ? 0.3 : st.attacking ? -0.25 : Math.sin(this.time * 1.5) * 0.06, 12, dt);
    this.j.tail.rotation.y = Math.sin(this.time * (st.speed > 1 ? 14 : 4)) * 0.35;
    if (this.j.jaw) this.j.jaw.rotation.x = damp(this.j.jaw.rotation.x, st.attacking ? 0.6 : st.windup ? 0.3 : 0, 20, dt);
    if (st.hurt > 0) b.rotation.x -= st.hurt * 0.3;
  }
}
