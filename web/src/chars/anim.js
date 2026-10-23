import { damp, lerp } from '../core/rng.js';

// Pose-space animation shared by every rig. Poses are Euler angles per joint
// in a "limbs hang down, character faces +z" frame; each rig converts them to
// its own bones (VRM humanoid bones, or the legacy segmented rig).

export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'hipL', 'knL', 'anL', 'hipR', 'knR', 'anR'];

export class PoseDriver {
  constructor() {
    this.pose = {};
    for (const k of JOINTS) this.pose[k] = [0, 0, 0];
    this.time = Math.random() * 10;
    this.clip = null; this.clipT = 0; this.clipSpeed = 1;
    this.phase = 0; this.bob = 0; this.lean = 0;
  }
  play(clip, speed = 1) { this.clip = clip; this.clipT = 0; this.clipSpeed = speed; }
  update(dt, st) {
    this.time += dt;
    const target = {};
    const base = st.dead ? POSES.dead : st.guard ? POSES.guard : st.combat ? POSES.ready : POSES.idle;
    for (const k of JOINTS) target[k] = (base[k] || [0, 0, 0]).slice();
    const br = Math.sin(this.time * 2.2) * 0.025;
    target.chest[0] += br; target.neck[0] -= br * 0.5;
    if (!st.dead && !st.combat) { target.head[1] += Math.sin(this.time * 0.37) * 0.15; target.neck[0] += Math.sin(this.time * 0.23) * 0.04; }

    const sp = Math.min(st.speed / 6, 1.3);
    if (sp > 0.02 && !st.dead) {
      this.phase += dt * (5 + sp * 6.5);
      const s = Math.sin(this.phase), c = Math.cos(this.phase);
      const a = 0.85 * sp;
      target.hipL[0] = -s * a - 0.1 * sp; target.hipR[0] = s * a - 0.1 * sp;
      target.knL[0] = Math.max(0, c) * 1.5 * sp + 0.2 * sp; target.knR[0] = Math.max(0, -c) * 1.5 * sp + 0.2 * sp;
      target.anL[0] = -0.25 * sp + Math.max(0, -s) * 0.3; target.anR[0] = -0.25 * sp + Math.max(0, s) * 0.3;
      target.shL[0] = s * a * 0.9; target.shL[2] = 0.15; target.elL[0] = -0.5 - sp * 0.6;
      if (!st.guard) { target.shR[0] = -s * a * 0.5 - 0.15; target.elR[0] = -0.5 - sp * 0.4; }
      target.spine[0] = 0.12 * sp; target.spine[1] = s * 0.12 * sp; target.chest[1] = -s * 0.1 * sp;
      target.hips[1] = -s * 0.12 * sp;
      target.head[1] = 0;
      this.bob = Math.abs(c) * 0.06 * sp - 0.03 * sp;
    } else this.bob = damp(this.bob, 0, 10, dt);

    let clipOn = false;
    if (this.clip) {
      this.clipT += dt * this.clipSpeed;
      const res = sampleClip(this.clip, this.clipT);
      if (res) { clipOn = true; for (const k in res) if (target[k]) target[k] = res[k]; }
      else this.clip = null;
    }
    if (st.hurt > 0) { target.spine[0] -= 0.35 * st.hurt; target.neck[0] -= 0.3 * st.hurt; }
    const rate = clipOn ? 26 : st.dead ? 6 : 11;
    for (const k of JOINTS) {
      const p = this.pose[k], t = target[k];
      for (let i = 0; i < 3; i++) p[i] = damp(p[i], t[i], rate, dt);
    }
    return this.pose;
  }
}

// ---------- poses (Euler x,y,z per joint) ----------
const P = (o) => o;
export const POSES = {
  ready: P({
    hips: [0, 0.35, 0], spine: [0.12, -0.25, 0], chest: [0.02, -0.12, 0], neck: [0, 0.25, 0], head: [0.05, 0.1, 0],
    shL: [-0.2, 0, 0.25], elL: [-0.7, 0, 0], wrL: [0, 0, 0],
    shR: [-0.75, 0.2, -0.25], elR: [-0.7, 0, 0], wrR: [-0.6, 0, 0.6],
    hipL: [-0.45, 0, 0.12], knL: [0.55, 0, 0], anL: [-0.1, 0, 0],
    hipR: [0.25, 0, -0.12], knR: [0.45, 0, 0], anR: [-0.15, 0, 0],
  }),
  idle: P({
    hips: [0, 0.25, 0], spine: [0.05, -0.15, 0], chest: [0, -0.1, 0], neck: [0, 0, 0], head: [0, 0, 0],
    shL: [0.1, 0, 0.12], elL: [-0.25, 0, 0], wrL: [0, 0, 0],
    shR: [-0.35, 0, -0.15], elR: [-0.6, 0, 0], wrR: [-1.0, 0, 0.2], weapon: [0, 0, 0],
    hipL: [-0.15, 0, 0.05], knL: [0.25, 0, 0], anL: [-0.1, 0, 0],
    hipR: [0.15, 0, -0.08], knR: [0.18, 0, 0], anR: [-0.05, 0, 0], tail: [0, 0, 0],
  }),
  guard: P({
    hips: [0, 0.4, 0], spine: [0.1, -0.3, 0], chest: [0, -0.15, 0], neck: [0, 0.3, 0], head: [0, 0.1, 0],
    shL: [-0.6, 0, 0.3], elL: [-1.2, 0, 0], wrL: [0, 0, 0],
    shR: [-1.2, 0.3, -0.2], elR: [-0.6, 0, 0], wrR: [-0.3, 0, 1.4], weapon: [0, 0, 0],
    hipL: [-0.4, 0, 0.1], knL: [0.5, 0, 0], anL: [-0.1, 0, 0],
    hipR: [0.3, 0, -0.1], knR: [0.4, 0, 0], anR: [-0.1, 0, 0], tail: [0, 0, 0],
  }),
  dead: P({
    hips: [0, 0, 0], spine: [0.6, 0, 0], chest: [0.4, 0, 0], neck: [0.5, 0, 0], head: [0, 0, 0],
    shL: [0.2, 0, 0.3], elL: [-0.2, 0, 0], wrL: [0, 0, 0],
    shR: [0.2, 0, -0.3], elR: [-0.2, 0, 0], wrR: [-0.5, 0, 0], weapon: [0, 0, 0],
    hipL: [-1.3, 0, 0], knL: [2.2, 0, 0], anL: [0, 0, 0],
    hipR: [-1.4, 0, 0], knR: [2.2, 0, 0], anR: [0, 0, 0], tail: [0, 0, 0],
  }),
};

// Clips: arrays of {t, pose-overrides}; joints absent from a key fall back to idle.
function key(t, o) { return { t, o }; }
export function sampleClip(clip, t) {
  const keys = clip.keys;
  if (t > keys[keys.length - 1].t) return null;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const span = b.t - a.t || 1;
  let u = Math.min(1, Math.max(0, (t - a.t) / span));
  u = u * u * (3 - 2 * u);
  const out = {};
  const names = new Set([...Object.keys(a.o), ...Object.keys(b.o)]);
  for (const n of names) {
    const pa = a.o[n] || clip.base[n] || POSES.idle[n];
    const pb = b.o[n] || clip.base[n] || POSES.idle[n];
    out[n] = [lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u), lerp(pa[2], pb[2], u)];
  }
  return out;
}

const atkBase = {};
export const CLIPS = {
  // basic 3-hit chain
  slash1: { base: atkBase, hitAt: 0.13, dur: 0.38, keys: [
    key(0, { shR: [-2.2, 0.6, -0.6], elR: [-0.8, 0, 0], wrR: [-1.4, 0, 0.6], spine: [0, -0.6, 0], hips: [0, -0.3, 0] }),
    key(0.1, { shR: [-1.5, -0.6, -0.2], elR: [-0.2, 0, 0], wrR: [-1.5, 0, -0.4], spine: [0.15, 0.5, 0], hips: [0, 0.3, 0] }),
    key(0.22, { shR: [-0.6, -0.9, 0], elR: [-0.3, 0, 0], wrR: [-1.2, 0, -0.6], spine: [0.2, 0.7, 0], hips: [0, 0.4, 0] }),
    key(0.38, { }),
  ] },
  slash2: { base: atkBase, hitAt: 0.12, dur: 0.38, keys: [
    key(0, { shR: [-1.4, -1.0, -0.2], elR: [-0.4, 0, 0], wrR: [-1.5, 0, -1.0], spine: [0, 0.6, 0], hips: [0, 0.3, 0] }),
    key(0.1, { shR: [-1.5, 0.6, -0.9], elR: [-0.1, 0, 0], wrR: [-1.5, 0, 1.0], spine: [0.1, -0.6, 0], hips: [0, -0.3, 0] }),
    key(0.22, { shR: [-1.1, 0.9, -1.2], elR: [-0.2, 0, 0], wrR: [-1.3, 0, 1.2], spine: [0.1, -0.7, 0] }),
    key(0.38, { }),
  ] },
  slash3: { base: atkBase, hitAt: 0.16, dur: 0.5, keys: [
    key(0, { shR: [-3.0, 0, -0.1], elR: [-0.6, 0, 0], wrR: [-0.8, 0, 0], spine: [-0.2, -0.2, 0], hipL: [-0.6, 0, 0], knL: [0.6, 0, 0] }),
    key(0.14, { shR: [-0.9, 0, 0], elR: [-0.1, 0, 0], wrR: [-1.7, 0, 0], spine: [0.5, 0, 0], chest: [0.2, 0, 0], hipL: [-0.9, 0, 0], knL: [1.0, 0, 0], hipR: [0.5, 0, 0], knR: [0.6, 0, 0] }),
    key(0.3, { shR: [-0.5, 0, 0], elR: [-0.1, 0, 0], wrR: [-1.6, 0, 0], spine: [0.55, 0, 0], hipL: [-0.9, 0, 0], knL: [1.0, 0, 0], hipR: [0.5, 0, 0], knR: [0.6, 0, 0] }),
    key(0.5, { }),
  ] },
  // sword skills: longer, wider poses
  rising: { base: atkBase, hitAt: 0.2, dur: 0.7, keys: [
    key(0, { shR: [-0.2, 0.3, -0.4], elR: [-0.3, 0, 0], wrR: [-2.2, 0, 0.4], spine: [0.5, -0.5, 0], hipL: [-1.0, 0, 0], knL: [1.3, 0, 0], hipR: [0.4, 0, 0], knR: [1.0, 0, 0] }),
    key(0.2, { shR: [-2.9, -0.2, -0.2], elR: [-0.1, 0, 0], wrR: [-0.6, 0, -0.2], spine: [-0.25, 0.3, 0], hipL: [-0.3, 0, 0], knL: [0.2, 0, 0] }),
    key(0.45, { shR: [-3.0, -0.2, -0.2], elR: [-0.1, 0, 0], wrR: [-0.5, 0, 0], spine: [-0.25, 0.3, 0] }),
    key(0.7, {}),
  ] },
  twinfang: { base: atkBase, hitAt: 0.12, hitAt2: 0.36, dur: 0.72, keys: [
    key(0, { shR: [-1.6, 0.9, -1.0], wrR: [-1.5, 0, 1.0], spine: [0, -0.8, 0] }),
    key(0.12, { shR: [-1.5, -0.9, -0.1], wrR: [-1.5, 0, -1.0], spine: [0.1, 0.8, 0] }),
    key(0.24, { shR: [-1.4, -1.0, -0.1], wrR: [-1.5, 0, -1.2], spine: [0.1, 0.9, 0] }),
    key(0.36, { shR: [-1.5, 0.9, -1.0], wrR: [-1.5, 0, 1.2], spine: [0.1, -0.9, 0] }),
    key(0.5, { shR: [-1.3, 1.0, -1.1], wrR: [-1.4, 0, 1.2], spine: [0.1, -0.9, 0] }),
    key(0.72, {}),
  ] },
  comet: { base: atkBase, hitAt: 0.22, dur: 0.75, keys: [
    key(0, { shR: [0.6, 0, -0.3], elR: [-1.6, 0, 0], wrR: [-1.6, 0, 0], spine: [0.3, -0.4, 0], shL: [-1.2, 0, 0.3], hipL: [-0.9, 0, 0], knL: [1.2, 0, 0], hipR: [0.5, 0, 0], knR: [0.9, 0, 0] }),
    key(0.15, { shR: [0.6, 0, -0.3], elR: [-1.6, 0, 0], wrR: [-1.6, 0, 0], spine: [0.3, -0.4, 0], shL: [-1.2, 0, 0.3], hipL: [-0.9, 0, 0], knL: [1.2, 0, 0], hipR: [0.5, 0, 0], knR: [0.9, 0, 0] }),
    key(0.25, { shR: [-1.6, 0, 0], elR: [0, 0, 0], wrR: [-1.6, 0, 0], spine: [0.4, 0.2, 0], shL: [0.6, 0, 0.4], hipL: [-1.1, 0, 0], knL: [0.6, 0, 0], hipR: [0.8, 0, 0], knR: [0.2, 0, 0] }),
    key(0.5, { shR: [-1.6, 0, 0], elR: [0, 0, 0], wrR: [-1.6, 0, 0], spine: [0.4, 0.2, 0], shL: [0.6, 0, 0.4], hipL: [-1.1, 0, 0], knL: [0.6, 0, 0], hipR: [0.8, 0, 0], knR: [0.2, 0, 0] }),
    key(0.75, {}),
  ] },
  roll: { base: atkBase, dur: 0.45, keys: [
    key(0, { spine: [0.9, 0, 0], chest: [0.5, 0, 0], neck: [0.6, 0, 0], hipL: [-1.6, 0, 0], knL: [2.0, 0, 0], hipR: [-1.4, 0, 0], knR: [2.1, 0, 0], shL: [-1, 0, 0], shR: [-1, 0, 0] }),
    key(0.32, { spine: [0.9, 0, 0], chest: [0.5, 0, 0], neck: [0.6, 0, 0], hipL: [-1.6, 0, 0], knL: [2.0, 0, 0], hipR: [-1.4, 0, 0], knR: [2.1, 0, 0], shL: [-1, 0, 0], shR: [-1, 0, 0] }),
    key(0.45, {}),
  ] },
  potion: { base: atkBase, dur: 0.8, keys: [
    key(0, { shL: [-1.2, 0, 0.2], elL: [-1.8, 0, 0], neck: [0, 0, 0] }),
    key(0.3, { shL: [-1.5, 0, 0.3], elL: [-2.2, 0, 0], neck: [-0.5, 0, 0] }),
    key(0.6, { shL: [-1.5, 0, 0.3], elL: [-2.2, 0, 0], neck: [-0.5, 0, 0] }),
    key(0.8, {}),
  ] },
  wave: { base: atkBase, dur: 1.4, keys: [
    key(0, { shL: [-0.2, 0, 2.6], elL: [-0.3, 0, 0] }),
    key(0.35, { shL: [-0.2, 0, 2.9], elL: [-0.8, 0, 0] }),
    key(0.7, { shL: [-0.2, 0, 2.6], elL: [-0.2, 0, 0] }),
    key(1.05, { shL: [-0.2, 0, 2.9], elL: [-0.8, 0, 0] }),
    key(1.4, {}),
  ] },
};
