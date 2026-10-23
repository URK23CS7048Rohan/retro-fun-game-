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
      const hand = this.bones.wrR;
      const holder = new THREE.Group(); holder.quaternion.copy(this.C.wrR); hand.add(holder);
      const grip = new THREE.Group(); grip.position.set(0, -0.075, 0.012); holder.add(grip);
      buildWeaponOn(this, grip, opts.weapon);
    }
    this.height = this.measure();
  }
  restFrames(vrm) {
    vrm.scene.updateMatrixWorld(true);
    const wp = (k) => this.bones[k].getWorldPosition(new THREE.Vector3());
    const rootInv = new THREE.Quaternion();
    vrm.scene.getWorldQuaternion(rootInv); rootInv.invert();
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
