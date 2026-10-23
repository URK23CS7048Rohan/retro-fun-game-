import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { PoseDriver, JOINTS } from './anim.js';
import { buildWeaponOn } from './weapons.js';

// VRM characters (VRoid Studio exports, VRoid Hub downloads). Bones are driven
// from the shared pose space; spring bones (hair, skirts, coat tails) and
// expressions (blinking, smiling, wincing) come from the VRM itself.

const BONE = {
  hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
  shL: 'leftUpperArm', elL: 'leftLowerArm', wrL: 'leftHand',
  shR: 'rightUpperArm', elR: 'rightLowerArm', wrR: 'rightHand',
  hipL: 'leftUpperLeg', knL: 'leftLowerLeg', anL: 'leftFoot',
  hipR: 'rightUpperLeg', knR: 'rightLowerLeg', anR: 'rightFoot',
};
// Pose space has limbs hanging straight down (-y). A VRM's rest pose may be
// a T-pose or an A-pose, so each limb segment gets a rest frame C measured
// from the model: C maps -y onto that segment's rest direction. For a chain
// with rest frames C1..Cn the bone rotations are q_i = C_{i-1} * E_i * C_i^-1,
// which makes every segment point where the pose says.
const DOWN = new THREE.Vector3(0, -1, 0);
const RPI = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const CHAINS = [['shL', 'elL', 'wrL'], ['shR', 'elR', 'wrR'], ['hipL', 'knL'], ['hipR', 'knR']];
const CHILD = { shL: 'elL', elL: 'wrL', shR: 'elR', elR: 'wrR', hipL: 'knL', knL: 'anL', hipR: 'knR', knR: 'anR' };

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const cache = new Map();

export async function loadVRM(url) {
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  return vrm;
}

let _ramp = null;
function toonRamp() {
  if (_ramp) return _ramp;
  _ramp = new THREE.DataTexture(new Uint8Array([110, 200, 255]), 3, 1, THREE.RedFormat);
  _ramp.minFilter = _ramp.magFilter = THREE.NearestFilter; _ramp.needsUpdate = true;
  return _ramp;
}
const _e = new THREE.Euler(), _q = new THREE.Quaternion();

export class VRMCharacter {
  constructor(vrm, opts = {}) {
    this.vrm = vrm;
    this.isVRM0 = vrm.meta?.metaVersion === '0';
    this.root = new THREE.Group();
    this.root.add(vrm.scene);
    this.driver = new PoseDriver();
    this.bones = {};
    for (const k of JOINTS) this.bones[k] = vrm.humanoid.getNormalizedBoneNode(BONE[k]);
    this.hipsRest = this.bones.hips.position.clone();
    this.restFrames(vrm);
    this.applyLook(opts);
    this.blinkT = 2 + Math.random() * 3; this.blink = 0;
    this.expr = { happy: 0, angry: 0, sad: 0, surprised: 0 };
    this.exprTarget = { happy: 0, angry: 0, sad: 0, surprised: 0 };
    // weapon held in the right hand, expressed in pose space
    if (opts.weapon) {
      const holder = this.attach('wrR');
      const grip = new THREE.Group(); grip.position.set(0, -0.075, 0.012); holder.add(grip);
      buildWeaponOn(this, grip, opts.weapon);
    }
    this.height = this.measure();
    if (opts.height) { const k = opts.height / this.height; vrm.scene.scale.setScalar(k); this.height = opts.height; this.hipsRest = this.bones.hips.position.clone(); }
    if (opts.gear) this.addGear(opts.gear);
  }
  restFrames(vrm) {
    vrm.scene.updateMatrixWorld(true);
    const wp = (k) => this.bones[k].getWorldPosition(new THREE.Vector3());
    // Directions are measured in the character root's frame (pose space).
    // For VRM 0.x the scene is turned 180 degrees; the final quaternion flip
    // in update() converts pose-space rotations into its bone frames.
    const rootInv = new THREE.Quaternion();
    this.root.getWorldQuaternion(rootInv); rootInv.invert();
    this.C = {}; this.Ci = {};
    for (const k of JOINTS) { this.C[k] = new THREE.Quaternion(); }
    for (const k in CHILD) {
      if (!this.bones[k] || !this.bones[CHILD[k]]) continue;
      const d = wp(CHILD[k]).sub(wp(k)).applyQuaternion(rootInv).normalize();
      this.C[k].setFromUnitVectors(DOWN, d);
    }
    // hands continue along the forearm
    this.C.wrL.copy(this.C.elL); this.C.wrR.copy(this.C.elR);
    for (const k of JOINTS) this.Ci[k] = this.C[k].clone().invert();
    this.parentOf = {};
    for (const ch of CHAINS) ch.forEach((k, i) => { this.parentOf[k] = i ? ch[i - 1] : null; });
  }
  // A group under a bone whose axes are pose space for that limb, so props
  // built with "limb hangs down -y, character faces +z" sit correctly.
  attach(k) {
    const g = new THREE.Group();
    g.quaternion.copy(this.isVRM0 ? RPI : new THREE.Quaternion()).multiply(this.C[k] || new THREE.Quaternion());
    this.bones[k].add(g);
    return g;
  }
  // Placeholder styling: recolour or hide parts by material name.
  applyLook(opts) {
    const tints = opts.tint || [], hide = opts.hide;
    this.vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const name = m.name || '';
        if (hide && hide.test(name)) o.visible = false;
        for (const t of tints) if (t.match.test(name)) {
          if (m.color) m.color.set(t.color);
          if (m.shadeColorFactor && t.shade) m.shadeColorFactor.set(t.shade);
        }
      }
    });
  }
  // Extra clothing pieces parented to humanoid bones, sized from the model's
  // own proportions: boots, a long split coat with a high collar.
  addGear(gear) {
    this.vrm.scene.updateMatrixWorld(true);
    const wp = (k) => this.bones[k].getWorldPosition(new THREE.Vector3());
    const sc = this.vrm.scene.scale.x;
    const hipY = wp('hips').y, kneeY = wp('knL').y, ankleY = wp('anL').y;
    const legGap = Math.abs(wp('hipL').x - wp('hipR').x);
    const toLocal = (v) => v / sc; // bone-local units are pre-scale
    const M = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp(), side: THREE.DoubleSide });
    const lathe = (pts, seg, a = 0, l = Math.PI * 2, zs = 1) => { const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg, a, l); g.scale(1, 1, zs); g.computeVertexNormals(); return g; };
    const mesh = (g, m, parent) => { const o = new THREE.Mesh(g, m); o.castShadow = true; parent.add(o); return o; };
    if (gear.boots) {
      const shin = toLocal(kneeY - ankleY), r = toLocal(legGap * 0.36);
      for (const k of ['knL', 'knR']) {
        const g = lathe([[r * 1.05, -shin * 1.02], [r * 1.0, -shin * 0.7], [r * 0.85, -shin * 0.35], [r * 1.0, -shin * 0.18]], 12);
        mesh(g, M(gear.boots, 0.55), this.attach(k));
      }
      for (const k of ['anL', 'anR']) {
        const f = new THREE.BoxGeometry(r * 1.9, r * 1.1, r * 4.2); f.translate(0, -r * 0.35, r * 1.2);
        const o = mesh(f, M(gear.boots, 0.55), this.attach(k));
        void o;
      }
    }
    if (gear.coat) {
      const waist = toLocal(legGap * 1.05), len = toLocal((hipY - kneeY) * 1.35);
      const tail = new THREE.Group(); this.attach('hips').add(tail); tail.position.y = toLocal((hipY - kneeY) * 0.12);
      const gap = 0.36;
      const pts = [[waist, 0], [waist * 1.15, -len * 0.35], [waist * 1.4, -len * 0.75], [waist * 1.55, -len]];
      const coatM = M(gear.coat, 0.6);
      const trim = M(gear.trim || '#6a7286', 0.5);
      for (const [a, l] of [[gap, Math.PI - gap - 0.05], [Math.PI + 0.05, Math.PI - gap - 0.05]]) {
        mesh(lathe(pts, 10, a, l, 0.78), coatM, tail);
        // seam lines down the panel
        for (const f of [0.3, 0.7]) {
          const ang = a + l * f, x = Math.sin(ang), z = Math.cos(ang) * 0.78;
          const line = new THREE.BoxGeometry(toLocal(0.008), len * 0.95, toLocal(0.008));
          const o = mesh(line, trim, tail); o.position.set(x * waist * 1.32, -len * 0.5, z * waist * 1.32);
          o.rotation.z = -x * 0.16; o.rotation.x = z * 0.16;
        }
      }
      this.coat = tail; this.coatVel = 0; this.coatAng = 0;
      // stand collar around the neck
      const nr = toLocal(legGap * 0.62);
      const collar = lathe([[nr * 0.8, 0], [nr * 0.86, toLocal(0.05)], [nr * 0.92, toLocal(0.085)]], 14, 0.7, Math.PI * 2 - 1.4);
      const c = mesh(collar, coatM, this.attach('neck')); c.position.y = toLocal(-0.03);
    }
  }
  measure() {
    const b = new THREE.Box3().setFromObject(this.vrm.scene);
    return b.max.y - b.min.y;
  }
  // Move instantly without the hair and cloth springs whipping around.
  teleport(x, y, z, ry = this.root.rotation.y) {
    this.root.position.set(x, y, z); this.root.rotation.y = ry;
    this.root.updateMatrixWorld(true);
    this.vrm.springBoneManager?.reset();
  }
  get clip() { return this.driver.clip; }
  play(clip, speed = 1) { this.driver.play(clip, speed); }
  setExpression(name, v) { this.exprTarget[name] = v; }
  lookAt(obj) { if (this.vrm.lookAt) this.vrm.lookAt.target = obj; }

  setGlow(color, k) {
    if (!this.bladeMat) return;
    const b = this.bladeBase;
    this.bladeMat.color.setRGB(b.r + color.r * k * 2.2, b.g + color.g * k * 2.2, b.b + color.b * k * 2.2);
    if (this.bladeMat.emissive) this.bladeMat.emissive.setRGB(color.r * k * 2, color.g * k * 2, color.b * k * 2);
  }

  update(dt, st) {
    const pose = this.driver.update(dt, st);
    for (const k of JOINTS) {
      const bone = this.bones[k]; if (!bone) continue;
      const p = pose[k];
      _e.set(p[0], p[1], p[2], 'XYZ');
      _q.setFromEuler(_e);
      if (k in this.parentOf) {
        const par = this.parentOf[k];
        if (par) bone.quaternion.copy(this.C[par]).multiply(_q).multiply(this.Ci[k]);
        else bone.quaternion.copy(_q).multiply(this.Ci[k]);
      } else bone.quaternion.copy(_q);
      if (this.isVRM0) { bone.quaternion.x *= -1; bone.quaternion.z *= -1; }
    }
    this.bones.hips.position.set(this.hipsRest.x, this.hipsRest.y + this.driver.bob, this.hipsRest.z);
    if (this.coat) {
      // coat tails: damped spring pushed back by speed, kicked by attacks
      const want = Math.min(st.speed, 9) * 0.065 + (this.driver.clip ? 0.25 : 0);
      this.coatVel += (want - this.coatAng) * 80 * dt - this.coatVel * 8 * dt;
      this.coatAng += this.coatVel * dt;
      const legs = Math.max(-this.driver.pose.hipL[0], -this.driver.pose.hipR[0], 0);
      this.coat.rotation.x = this.coatAng + legs * 0.35;
    }

    // blinking and expressions
    const em = this.vrm.expressionManager;
    if (em) {
      this.blinkT -= dt;
      if (this.blinkT < 0) { this.blink = 1; this.blinkT = 2.5 + Math.random() * 4; }
      this.blink = Math.max(0, this.blink - dt * 7);
      const closed = st.dead ? 1 : Math.sin(Math.min(1, this.blink) * Math.PI);
      em.setValue('blink', closed);
      for (const n in this.expr) {
        this.expr[n] += (this.exprTarget[n] - this.expr[n]) * Math.min(1, dt * 8);
        em.setValue(n, this.expr[n]);
      }
    }
    this.vrm.update(dt);
  }
}

export async function makeVRMCharacter(url, opts) {
  const vrm = await loadVRM(url);
  return new VRMCharacter(vrm, opts);
}
