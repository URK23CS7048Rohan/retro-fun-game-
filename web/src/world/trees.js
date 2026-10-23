import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';
import { pbr } from '../engine/pbr.js';

// Stylised broadleaf trees in the anime-background style: a curved bark
// trunk with branches, and canopy clusters of alpha leaf cards whose normals
// point away from each cluster's centre, so the crown shades like soft
// volumes instead of a mess of flat cards. Instanced, with wind sway.

export function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const greens = ['#2c5a1e', '#3c7426', '#4f8c2c', '#6aa436', '#86bc44'];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const x = 20 + rnd() * 216, y = 20 + rnd() * 216;
    const d = Math.hypot(x - 128, y - 128);
    if (d > 118) continue;
    g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI * 2);
    const L = 14 + rnd() * 14;
    g.fillStyle = greens[Math.floor(rnd() * greens.length)];
    g.beginPath(); g.moveTo(0, -L); g.quadraticCurveTo(L * 0.55, 0, 0, L); g.quadraticCurveTo(-L * 0.55, 0, 0, -L); g.fill();
    g.strokeStyle = 'rgba(20,40,10,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -L * 0.9); g.lineTo(0, L * 0.9); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function trunkGeo(rng, h, lean) {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector3(Math.sin(t * 2 + lean) * 0.35 * t, t * h, Math.cos(t * 1.5 + lean) * 0.25 * t)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 10, 0.38, 8, false);
  const p = g.attributes.position;
  // taper toward the top and flare at the roots
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); const t = y / h;
    const c = curve.getPoint(Math.min(1, Math.max(0, t)));
    const k = (1 - t * 0.65) * (1 + Math.max(0, 0.25 - t) * 2.5);
    p.setX(i, c.x + (p.getX(i) - c.x) * k); p.setZ(i, c.z + (p.getZ(i) - c.z) * k);
  }
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h / 1.5);
  g.computeVertexNormals();
  return { g, curve };
}
function branch(from, to, r0) {
  const curve = new THREE.QuadraticBezierCurve3(from, from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.6, 0)), to);
  const g = new THREE.TubeGeometry(curve, 5, r0, 6, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // radius falls off along the branch; approximate by distance from the start
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const t = Math.min(1, v.distanceTo(from) / from.distanceTo(to));
    const c = curve.getPoint(t);
    v.sub(c).multiplyScalar(1 - t * 0.7).add(c); p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function cluster(rng, center, radius, cards) {
  const geos = [];
  for (let i = 0; i < cards; i++) {
    const u = rng.float(-1, 1), a = rng.float(0, Math.PI * 2), sq = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(Math.cos(a) * sq, u * 0.8 + 0.15, Math.sin(a) * sq).normalize();
    const pos = center.clone().addScaledVector(dir, radius * rng.float(0.45, 0.95));
    const size = radius * rng.float(0.8, 1.15);
    const q = new THREE.PlaneGeometry(size, size);
    q.rotateZ(rng.float(0, Math.PI * 2)); q.rotateX(rng.float(-1.2, 1.2)); q.rotateY(rng.float(0, Math.PI * 2));
    q.translate(pos.x, pos.y, pos.z);
    // spherical normals from the cluster centre, nudged upward
    const n = q.attributes.normal, p = q.attributes.position;
    for (let k = 0; k < n.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, k).sub(center).normalize();
      v.y += 0.35; v.normalize(); n.setXYZ(k, v.x, v.y, v.z);
    }
    geos.push(q);
  }
  return geos;
}

function makeVariant(seed, kind) {
  const rng = new RNG(seed);
  if (kind === 'bush') {
    const leaves = cluster(rng, new THREE.Vector3(0, 0.7, 0), 1.0, 22);
    leaves.push(...cluster(rng, new THREE.Vector3(0.6, 0.55, 0.2), 0.7, 12));
    return { trunk: null, leaves: mergeGeometries(leaves) };
  }
  const h = rng.float(3.8, 5.2);
  const { g: tg, curve } = trunkGeo(rng, h, rng.float(0, 6));
  const parts = [tg];
  const leaves = [];
  const top = curve.getPoint(1);
  leaves.push(...cluster(rng, top.clone().add(new THREE.Vector3(0, 1.2, 0)), 2.3, 34));
  const nb = rng.int(3, 5);
  for (let i = 0; i < nb; i++) {
    const t = rng.float(0.55, 0.9);
    const from = curve.getPoint(t);
    const a = (i / nb) * Math.PI * 2 + rng.float(-0.4, 0.4);
    const len = rng.float(1.6, 2.6);
    const to = from.clone().add(new THREE.Vector3(Math.cos(a) * len, rng.float(0.8, 1.6), Math.sin(a) * len));
    parts.push(branch(from, to, 0.16));
    leaves.push(...cluster(rng, to.clone().add(new THREE.Vector3(0, 0.4, 0)), rng.float(1.5, 2.1), 24));
  }
  const trunk = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  return { trunk, leaves: mergeGeometries(leaves) };
}

export class Forest {
  constructor(world, trees, bushes) {
    this.group = new THREE.Group();
    const leafMap = leafTexture();
    this.uTime = { value: 0 };
    const leafMat = new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, envMapIntensity: 0.6 });
    leafMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.uTime;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 ip = vec3(0.0);
          #endif
          float sway = sin(uTime * 1.4 + ip.x * 0.2 + ip.z * 0.15) * 0.5 + sin(uTime * 3.1 + position.y + ip.x) * 0.15;
          transformed.x += sway * 0.12 * max(position.y - 1.5, 0.0) * 0.3;
          transformed.z += sway * 0.08 * max(position.y - 1.5, 0.0) * 0.3;`);
      // keep the outward cluster normals on both sides of each card
      s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.12;');
    };
    const bark = pbr('bark_brown_02', { color: '#a89080' });
    const variants = [0, 1, 2, 3].map((i) => makeVariant(world.seed + i * 31, 'tree'));
    const bushV = makeVariant(world.seed + 99, 'bush');
    const buckets = variants.map(() => []);
    const rng = new RNG(world.seed + 5);
    for (const t of trees) buckets[rng.int(0, 3)].push(t);
    const tint = new THREE.Color();
    const place = (list, v, scaleRange) => {
      if (!list.length) return;
      const o = new THREE.Object3D();
      const tr = v.trunk ? new THREE.InstancedMesh(v.trunk, bark, list.length) : null;
      const lv = new THREE.InstancedMesh(v.leaves, leafMat, list.length);
      list.forEach(([x, z, sc], i) => {
        const s = (sc || 1) * rng.float(scaleRange[0], scaleRange[1]);
        o.position.set(x, world.heightAt(x, z) - 0.15, z); o.rotation.set(0, rng.float(0, 6.28), 0); o.scale.set(s, s * rng.float(0.9, 1.15), s);
        o.updateMatrix();
        if (tr) tr.setMatrixAt(i, o.matrix);
        lv.setMatrixAt(i, o.matrix);
        tint.setHSL(0.25 + rng.float(-0.03, 0.04), rng.float(0.45, 0.65), rng.float(0.42, 0.55));
        lv.setColorAt(i, tint.clone().multiplyScalar(1.9));
      });
      for (const m of [tr, lv]) if (m) { m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    };
    variants.forEach((v, i) => place(buckets[i], v, [0.85, 1.25]));
    place(bushes, bushV, [0.7, 1.3]);
  }
  update(t) { this.uTime.value = t; }
}
