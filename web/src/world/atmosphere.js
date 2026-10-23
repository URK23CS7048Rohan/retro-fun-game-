import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { pbr } from '../engine/pbr.js';

// Life in the air: bird flocks steered by boids (separation, alignment,
// cohesion, plus a wander target), chimney smoke, sunset dust motes around
// the camera, campfire flames, fountain spray, waterfalls pouring off the
// floor's rim, and distant floating islands.

function softDot(color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, color); grd.addColorStop(0.4, color + 'aa'); grd.addColorStop(1, color + '00');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class Particles {
  // CPU particle pool rendered as one Points cloud with per-point size/alpha
  constructor(max, tex, { additive = false, color = '#ffffff', size = 1 } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.alpha = new Float32Array(max); this.size = new Float32Array(max);
    this.p = Array.from({ length: max }, () => ({ life: 0 }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uColor: { value: new THREE.Color(color) }, uScale: { value: size * 300 } },
      vertexShader: `attribute float alpha; attribute float psize; varying float vA; uniform float uScale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 uColor; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(uColor * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.head = 0;
  }
  emit(o) { const i = this.head; this.head = (this.head + 1) % this.max; this.p[i] = { ...o, age: 0 }; }
  update(dt, fn) {
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) { this.alpha[i] = 0; continue; }
      p.age += dt; p.life -= dt;
      if (fn) fn(p, dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const u = p.age / (p.age + Math.max(p.life, 0.0001));
      this.alpha[i] = (p.a ?? 1) * Math.min(1, u * 6) * (1 - u);
      this.size[i] = (p.s0 ?? 1) + ((p.s1 ?? 1) - (p.s0 ?? 1)) * u;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.alpha.needsUpdate = true; g.attributes.psize.needsUpdate = true;
  }
}

function birdGeo() {
  // body + two wings as separate groups so they can flap
  const body = new THREE.ConeGeometry(0.08, 0.5, 4); body.rotateX(Math.PI / 2);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0.75, 0.02, -0.05, 0, 0, -0.14], 3));
  wing.computeVertexNormals();
  return { body, wing };
}

export class Atmosphere {
  constructor(world, scene) {
    this.world = world; this.group = new THREE.Group();
    const r = new RNG(world.seed + 11);
    this.r = r;
    // ---- birds ----
    const { body, wing } = birdGeo();
    const bm = new THREE.MeshStandardMaterial({ color: '#2a2422', roughness: 0.8, side: THREE.DoubleSide });
    this.birds = [];
    for (let f = 0; f < 3; f++) {
      const home = new THREE.Vector3(r.float(-60, 60), r.float(30, 45), r.float(-60, 40));
      for (let i = 0; i < 12; i++) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(body, bm));
        const wl = new THREE.Mesh(wing, bm), wr = new THREE.Mesh(wing, bm); wr.scale.x = -1;
        g.add(wl, wr);
        g.position.copy(home).add(new THREE.Vector3(r.float(-6, 6), r.float(-2, 2), r.float(-6, 6)));
        g.scale.setScalar(1.6);
        this.group.add(g);
        this.birds.push({ g, wl, wr, v: new THREE.Vector3(r.float(-1, 1), 0, r.float(-1, 1)).setLength(6), flock: f, home, phase: r.float(0, 6) });
      }
    }
    // ---- smoke from chimneys ----
    const smokeTex = softDot('#ffffff');
    this.smoke = new Particles(world.chimneys.length * 14 + 10, smokeTex, { color: '#d8ccc0', size: 1 });
    this.group.add(this.smoke.points);
    this.smokeT = 0;
    // ---- dust motes / fireflies around the camera ----
    this.motes = new Particles(260, softDot('#ffd890'), { additive: true, color: '#ffd28a', size: 0.12 });
    this.group.add(this.motes.points);
    // ---- campfire ----
    this.fire = new Particles(90, softDot('#ffb050'), { additive: true, color: '#ff9a3a', size: 0.5 });
    this.group.add(this.fire.points);
    if (world.campfire) {
      this.fireLight = new THREE.PointLight('#ff8a3a', 25, 14, 2);
      this.fireLight.position.copy(world.campfire).add(new THREE.Vector3(0, 0.8, 0));
      this.group.add(this.fireLight);
    }
    // ---- fountain spray ----
    this.spray = new Particles(160, softDot('#ffffff'), { color: '#cfefff', size: 0.16 });
    this.group.add(this.spray.points);
    // ---- waterfalls off the rim ----
    this.falls = [];
    const fallMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        float h(float x){ return fract(sin(x * 91.7) * 4375.5); }
        void main(){ float col = floor(vUv.x * 40.0); float s = fract(vUv.y * 3.0 + uTime * (0.8 + h(col) * 0.6) + h(col + 3.0));
          float streak = smoothstep(0.0, 0.3, s) * smoothstep(1.0, 0.6, s);
          float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
          float fade = smoothstep(0.0, 0.5, vUv.y);
          vec3 c = mix(vec3(0.55, 0.75, 0.85), vec3(1.0), streak);
          gl_FragColor = vec4(c, (0.35 + streak * 0.5) * edge * fade); }`,
    });
    this.fallMat = fallMat;
    for (const a of [0.6, 2.4, 3.6, 5.3]) {
      const R = 117;
      const x = Math.cos(a) * R, z = Math.sin(a) * R, y = world.heightAt(Math.cos(a) * (R - 6), Math.sin(a) * (R - 6));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 90, 1, 1), fallMat);
      m.position.set(x, y - 44, z); m.rotation.y = -a + Math.PI / 2;
      this.group.add(m);
      this.falls.push(new THREE.Vector3(x, y - 2, z));
    }
    this.mist = new Particles(80, smokeTex, { color: '#e8f4ff', size: 3 });
    this.group.add(this.mist.points);
    // ---- floating islands in the distance ----
    const rock = pbr('rock_wall_08', { color: '#8a7a90' });
    const top = new THREE.MeshStandardMaterial({ color: '#4a7a30', roughness: 1 });
    rock.fog = false; top.fog = false;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r.float(-0.2, 0.2), d = r.float(330, 560), s = r.float(14, 40);
      const isl = new THREE.Group();
      const cone = new THREE.ConeGeometry(s, s * 2.2, 9, 3);
      const cp = cone.attributes.position;
      for (let k = 0; k < cp.count; k++) { const q = 0.8 + r.next() * 0.4; if (cp.getY(k) < s * 1.0) { cp.setX(k, cp.getX(k) * q); cp.setZ(k, cp.getZ(k) * q); } }
      cone.computeVertexNormals(); cone.rotateX(Math.PI);
      const cu = cone.attributes.uv; for (let k = 0; k < cu.count; k++) cu.setXY(k, cu.getX(k) * 8, cu.getY(k) * 6);
      isl.add(new THREE.Mesh(cone, rock));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(s * 1.02, s * 0.98, s * 0.2, 9), top); cap.position.y = s * 1.1; isl.add(cap);
      for (let t = 0; t < 4; t++) {
        const tr = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.14, 0), top); tr.position.set(r.float(-s, s) * 0.6, s * 1.3, r.float(-s, s) * 0.6); isl.add(tr);
      }
      isl.position.set(Math.cos(a) * d, r.float(-60, 110), Math.sin(a) * d);
      this.group.add(isl);
    }
    scene.add(this.group);
  }

  update(dt, t, cam) {
    const w = this.world, r = this.r;
    // birds: boids within each flock
    const tmp = new THREE.Vector3(), sep = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3();
    for (const b of this.birds) {
      sep.set(0, 0, 0); ali.set(0, 0, 0); coh.set(0, 0, 0); let n = 0;
      for (const o of this.birds) {
        if (o === b || o.flock !== b.flock) continue;
        const d = b.g.position.distanceTo(o.g.position);
        if (d < 10) { n++; ali.add(o.v); coh.add(o.g.position); if (d < 2.5) sep.add(tmp.copy(b.g.position).sub(o.g.position).divideScalar(d * d + 0.1)); }
      }
      const acc = new THREE.Vector3();
      if (n) { acc.addScaledVector(ali.divideScalar(n).sub(b.v), 0.6); acc.addScaledVector(coh.divideScalar(n).sub(b.g.position), 0.25); }
      acc.addScaledVector(sep, 4);
      // wander around a slowly drifting home point
      const home = tmp.copy(b.home).add(new THREE.Vector3(Math.sin(t * 0.05 + b.flock) * 40, Math.sin(t * 0.13 + b.flock) * 6, Math.cos(t * 0.04 + b.flock * 2) * 40));
      acc.addScaledVector(home.sub(b.g.position), 0.05);
      b.v.addScaledVector(acc, dt); b.v.clampLength(4, 9);
      b.g.position.addScaledVector(b.v, dt);
      b.g.lookAt(b.g.position.clone().add(b.v));
      const flap = Math.sin(t * 9 + b.phase) * 0.7;
      b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
    }
    // smoke
    this.smokeT += dt;
    if (this.smokeT > 0.25) {
      this.smokeT = 0;
      for (const c of w.chimneys) if (r.chance(0.8)) this.smoke.emit({ x: c.x, y: c.y, z: c.z, vx: 0.2, vy: 0.9, vz: 0.1, life: 5, s0: 0.6, s1: 2.6, a: 0.35 });
    }
    this.smoke.update(dt, (p, d) => { p.vx += 0.25 * d; p.vy *= 0.995; });
    // motes drifting around the camera
    for (let k = 0; k < 3; k++) this.motes.emit({ x: cam.x + r.float(-14, 14), y: cam.y + r.float(-2, 5), z: cam.z + r.float(-14, 14), vx: r.float(0.1, 0.4), vy: r.float(-0.05, 0.1), vz: r.float(-0.1, 0.1), life: r.float(3, 6), s0: 1, s1: 1, a: 0.9 });
    this.motes.update(dt, (p, d) => { p.vy += Math.sin(t * 2 + p.x) * 0.02 * d; });
    // campfire
    if (w.campfire) {
      for (let k = 0; k < 3; k++) this.fire.emit({ x: w.campfire.x + r.float(-0.3, 0.3), y: w.campfire.y, z: w.campfire.z + r.float(-0.3, 0.3), vx: r.float(-0.1, 0.1), vy: r.float(1, 2), vz: r.float(-0.1, 0.1), life: r.float(0.4, 0.9), s0: 1.2, s1: 0.2, a: 1 });
      this.fire.update(dt);
      this.fireLight.intensity = 22 + Math.sin(t * 17) * 4 + Math.sin(t * 7.3) * 3;
    }
    // fountain spray: arcs from the statue base into the basin
    const y0 = w.heightAt(0, 0);
    for (let k = 0; k < 4; k++) {
      const a = r.float(0, 6.28);
      this.spray.emit({ x: Math.cos(a) * 0.5, y: y0 + 3.0, z: Math.sin(a) * 0.5, vx: Math.cos(a) * 1.3, vy: r.float(1.2, 2), vz: Math.sin(a) * 1.3, life: 1.0, s0: 1, s1: 1.6, a: 0.8 });
    }
    this.spray.update(dt, (p, d) => { p.vy -= 6 * d; if (p.y < y0 + 0.8) p.life = 0; });
    // waterfalls and their mist
    this.fallMat.uniforms.uTime.value = t;
    if (r.chance(0.5)) { const f = this.falls[r.int(0, this.falls.length - 1)]; this.mist.emit({ x: f.x + r.float(-3, 3), y: f.y, z: f.z + r.float(-3, 3), vx: 0, vy: -1.5, vz: 0, life: 3, s0: 2, s1: 6, a: 0.3 }); }
    this.mist.update(dt);
  }
}
