import * as THREE from 'three';
import { ps1Basic } from './ps1.js';

// Effects: sword-skill ribbons, hit sparks, the polygon shatter when anything
// dies, rings for ground telegraphs, and level-up pillars.

export class Trail {
  // A ribbon between the hilt and the tip, sampled each frame.
  constructor(scene, n = 14) {
    this.n = n;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('a', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uK: { value: 0 } },
      vertexShader: 'attribute float a; varying float vA; void main(){ vA=a; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 uColor; uniform float uK; varying float vA; void main(){ float a=vA*uK; if(a<0.05) discard; gl_FragColor=vec4(mix(uColor,vec3(1.0),a*a*0.6), a*0.85);}',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.pts = [];
    this.k = 0;
  }
  push(a, b, active, color, dt) {
    this.k = Math.max(0, active ? 1 : this.k - dt * 5);
    if (color) this.mat.uniforms.uColor.value.copy(color);
    this.mat.uniforms.uK.value = this.k;
    this.pts.unshift([a.x, a.y, a.z, b.x, b.y, b.z]);
    if (this.pts.length > this.n) this.pts.length = this.n;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, this.pts.length - 1)];
      this.pos.set(p.slice(0, 3), i * 6); this.pos.set(p.slice(3), i * 6 + 3);
      const al = 1 - i / (this.n - 1);
      this.alpha[i * 2] = al * 0.4; this.alpha[i * 2 + 1] = al;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.a.needsUpdate = true;
  }
}

export class Shards {
  // Instanced tetrahedra; each burst reuses slots in a ring buffer.
  constructor(scene, max = 400) {
    this.max = max;
    const geo = new THREE.TetrahedronGeometry(0.12, 0);
    this.mesh = new THREE.InstancedMesh(geo, ps1Basic({ color: 0xffffff, transparent: true, opacity: 0.95, fog: false }), max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.p = Array.from({ length: max }, () => ({ life: 0 }));
    this.head = 0;
    this.o = new THREE.Object3D();
    this.hide();
  }
  hide() { for (let i = 0; i < this.max; i++) { this.o.scale.setScalar(0); this.o.updateMatrix(); this.mesh.setMatrixAt(i, this.o.matrix); } this.mesh.instanceMatrix.needsUpdate = true; }
  burst(x, y, z, n, colors, power = 1, size = 1) {
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.max;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u);
      const v = (2 + Math.random() * 4) * power;
      this.p[i] = {
        life: 0.9 + Math.random() * 0.7, max: 1.4, x: x + (Math.random() - 0.5) * 0.5, y: y + (Math.random() - 0.3) * 0.8, z: z + (Math.random() - 0.5) * 0.5,
        vx: Math.cos(a) * s * v, vy: Math.abs(u) * v * 0.8 + 1.5, vz: Math.sin(a) * s * v,
        rx: Math.random() * 6, ry: Math.random() * 6, sp: (Math.random() - 0.5) * 20, size: (0.6 + Math.random() * 1.2) * size,
      };
      c.set(colors[k % colors.length]);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const o = this.o;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= 3.5 * dt; p.vx *= 0.97; p.vz *= 0.97;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.sp * dt; p.ry += p.sp * 0.7 * dt;
      o.position.set(p.x, p.y, p.z); o.rotation.set(p.rx, p.ry, 0);
      o.scale.setScalar(Math.max(0, Math.min(1, p.life)) * p.size);
      o.updateMatrix(); this.mesh.setMatrixAt(i, o.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Rings {
  // expanding ground rings: boss telegraphs, skill impacts, level up
  constructor(scene) {
    this.scene = scene; this.list = [];
    this.geo = new THREE.RingGeometry(0.85, 1, 24);
    this.geo.rotateX(-Math.PI / 2);
  }
  spawn(x, y, z, color, from, to, life, fill = false) {
    const m = new THREE.Mesh(fill ? new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2) : this.geo,
      ps1Basic({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(x, y + 0.08, z);
    this.scene.add(m);
    const r = { m, from, to, life, t: 0 };
    this.list.push(r);
    return r;
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i]; r.t += dt;
      const u = Math.min(1, r.t / r.life);
      const s = r.from + (r.to - r.from) * u;
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = r.hold ? 0.35 + 0.25 * Math.sin(r.t * 20) : 0.8 * (1 - u);
      if (u >= 1 && !r.hold) { this.scene.remove(r.m); r.m.material.dispose(); this.list.splice(i, 1); }
    }
  }
  kill(r) { const i = this.list.indexOf(r); if (i >= 0) { this.scene.remove(r.m); this.list.splice(i, 1); } }
}

export class Pillar {
  constructor(scene) {
    this.scene = scene;
    this.m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 6, 10, 1, true),
      ps1Basic({ color: 0xf0c45a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    scene.add(this.m); this.t = 9;
  }
  fire(x, y, z, color) { this.m.position.set(x, y + 3, z); this.m.material.color.set(color); this.t = 0; }
  update(dt) {
    this.t += dt;
    const u = this.t / 1.4;
    this.m.visible = u < 1;
    if (u < 1) { this.m.material.opacity = 0.6 * (1 - u); this.m.scale.set(1 + u, 1 + u * 0.5, 1 + u); this.m.rotation.y += dt * 4; }
  }
}
