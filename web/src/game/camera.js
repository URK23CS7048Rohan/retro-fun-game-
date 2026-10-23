import * as THREE from 'three';
import { damp, clamp, angleDiff } from '../core/rng.js';

// Third-person follow camera: orbits on drag, drifts back behind the player
// while running, frames the lock-on target, never dips under the terrain, and
// shakes on heavy hits.

export class FollowCam {
  constructor(cam, world) {
    this.cam = cam; this.world = world;
    this.yaw = Math.PI; this.pitch = 0.32; this.dist = 4.6;
    this.focus = new THREE.Vector3();
    this.shakeT = 0; this.shakeK = 0;
    this.idleT = 0;
  }
  shake(k = 0.3, t = 0.25) { this.shakeK = Math.max(this.shakeK, k); this.shakeT = Math.max(this.shakeT, t); }
  update(dt, player, look, target, moving) {
    if (look.x || look.y) { this.yaw -= look.x * 0.006; this.pitch = clamp(this.pitch + look.y * 0.004, -0.15, 1.1); this.idleT = 0; }
    else this.idleT += dt;
    // auto-align behind the player when running and not dragging
    if (moving && this.idleT > 0.6) this.yaw += angleDiff(this.yaw, player.facing + Math.PI) * Math.min(1, dt * 1.2);
    if (target) {
      const ang = Math.atan2(target.x - player.x, target.z - player.z) + Math.PI;
      this.yaw += angleDiff(this.yaw, ang) * Math.min(1, dt * 3);
    }
    const fx = target ? player.x * 0.75 + target.x * 0.25 : player.x;
    const fz = target ? player.z * 0.75 + target.z * 0.25 : player.z;
    this.focus.x = damp(this.focus.x, fx, 10, dt); this.focus.z = damp(this.focus.z, fz, 10, dt);
    this.focus.y = damp(this.focus.y, player.y + 1.45, 8, dt);
    let dist = target ? this.dist + 1 : this.dist;
    // pull in when something solid sits between the player and the camera
    const sx = Math.sin(this.yaw) * Math.cos(this.pitch), sz = Math.cos(this.yaw) * Math.cos(this.pitch);
    for (let d = 0.6; d < dist; d += 0.25) {
      if (this.world.blocked(this.focus.x + sx * d, this.focus.z + sz * d, 0.15)) { dist = Math.max(1.2, d - 0.35); break; }
    }
    this.curDist = damp(this.curDist ?? dist, dist, dist < (this.curDist ?? dist) ? 20 : 3, dt);
    dist = this.curDist;
    let cx = this.focus.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist;
    let cz = this.focus.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist;
    let cy = this.focus.y + Math.sin(this.pitch) * dist;
    const g = this.world.heightAt(cx, cz) + 0.5;
    if (cy < g) cy = g;
    this.cam.position.set(cx, cy, cz);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = this.shakeK * Math.max(0, this.shakeT) * 4;
      this.cam.position.x += (Math.random() - 0.5) * k; this.cam.position.y += (Math.random() - 0.5) * k;
      if (this.shakeT <= 0) this.shakeK = 0;
    }
    this.cam.lookAt(this.focus);
  }
  // movement basis on the ground plane relative to the camera
  basis() {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    return { f, r };
  }
}
