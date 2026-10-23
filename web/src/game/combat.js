import * as THREE from 'three';

// Combat rules shared by the player, the companion, monsters and bosses.

export const SKILLS = {
  sonic: { id: 'sonic', name: 'Sonic Leap', clip: 'rising', sp: 20, cd: 3.5, mult: 2.2, hits: [0.2], dash: 6, range: 2.8, arc: 1.3, color: '#6ad4ff', post: 0.25 },
  hsquare: { id: 'hsquare', name: 'Horizontal Square', clip: 'twinfang', sp: 30, cd: 6, mult: 1.35, hits: [0.12, 0.36], dash: 1.5, range: 3.0, arc: Math.PI, color: '#ffd24a', post: 0.3 },
  vorpal: { id: 'vorpal', name: 'Vorpal Strike', clip: 'comet', sp: 45, cd: 9, mult: 3.4, hits: [0.22], dash: 7.5, range: 3.6, arc: 0.8, color: '#ff4a3a', post: 0.45 },
};
export const SKILL_SLOTS = ['sonic', 'hsquare', 'vorpal'];

export const COMBO = [
  { clip: 'slash1', mult: 1.0, hitAt: 0.13, dur: 0.36, window: 0.5, dash: 1.2 },
  { clip: 'slash2', mult: 1.1, hitAt: 0.12, dur: 0.36, window: 0.5, dash: 1.2 },
  { clip: 'slash3', mult: 1.6, hitAt: 0.16, dur: 0.48, window: 0.0, dash: 2.0 },
];

export function playerStats(level) {
  return { maxHp: 220 + level * 28, maxSp: 100 + level * 4, atk: 16 + level * 3.2, def: 4 + level * 1.2 };
}
export function xpToNext(level) { return Math.round(40 * Math.pow(level, 1.6)); }

export function rollDamage(atk, mult, def, rng = Math.random) {
  const crit = rng() < 0.12;
  let d = atk * mult * (0.9 + rng() * 0.2) * (crit ? 1.6 : 1) - def * 0.5;
  return { dmg: Math.max(1, Math.round(d)), crit };
}

// targets in front of `a` within range and half-angle `arc`
export function inArc(a, targets, range, arc) {
  const out = [];
  for (const t of targets) {
    if (t.dead) continue;
    const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz);
    if (d > range + (t.radius || 0.5)) continue;
    let da = Math.atan2(dx, dz) - a.facing;
    while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) <= arc || d < 0.8) out.push(t);
  }
  return out;
}

export const SHARD_COLORS = (seam, body) => [seam, '#ffffff', body, seam, '#bfe8ff'];
export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
