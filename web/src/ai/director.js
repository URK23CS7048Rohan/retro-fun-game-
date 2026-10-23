// The AI Director estimates your skill with a one-dimensional Kalman filter
// (an Elo-like rating with uncertainty) and tunes the floor: how many monsters
// roam, how aggressive they are, and how hard they hit.

export class Director {
  constructor() {
    this.skill = 0;    // mean estimate, 0 = average
    this.var = 1.0;    // uncertainty
    this.processNoise = 0.02;
    this.tension = 0;  // short-term stress, decays over time
    this.log = [];
  }
  // outcome in [0,1]: 1 = won cleanly, 0 = got wrecked. difficulty is the
  // encounter's own rating on the same scale as skill.
  observe(outcome, difficulty) {
    const expected = 1 / (1 + Math.exp(-(this.skill - difficulty) * 1.5));
    const R = 0.25; // measurement noise
    this.var += this.processNoise;
    const K = this.var / (this.var + R);
    this.skill += K * (outcome - expected) * 2;
    this.var *= 1 - K;
    this.log.push({ outcome: +outcome.toFixed(2), expected: +expected.toFixed(2), skill: +this.skill.toFixed(2) });
    if (this.log.length > 30) this.log.shift();
  }
  hurt(frac) { this.tension = Math.min(1, this.tension + frac * 1.5); }
  update(dt) { this.tension = Math.max(0, this.tension - dt * 0.05); }
  // knobs consumed by the spawner and monster AI
  get aggression() { return Math.min(1, Math.max(0.2, 0.5 + this.skill * 0.25 - this.tension * 0.4)); }
  get densityMul() { return Math.min(1.6, Math.max(0.6, 1 + this.skill * 0.2 - this.tension * 0.5)); }
  get damageMul() { return Math.min(1.5, Math.max(0.7, 1 + this.skill * 0.12)); }
  toJSON() { return { s: this.skill, v: this.var }; }
  load(o) { if (o) { this.skill = o.s; this.var = o.v; } }
}

// Boids: separation, alignment, cohesion, plus an encircling term that spreads
// a wolf pack around its prey on evenly spaced angular slots.
export function boidSteer(self, pack, target, out) {
  let sx = 0, sz = 0, ax = 0, az = 0, cx = 0, cz = 0, n = 0;
  for (const o of pack) {
    if (o === self || o.dead) continue;
    const dx = self.x - o.x, dz = self.z - o.z, d2 = dx * dx + dz * dz;
    if (d2 > 144) continue;
    n++;
    if (d2 < 4) { sx += dx / (d2 + 0.01); sz += dz / (d2 + 0.01); }
    ax += o.vx; az += o.vz; cx += o.x; cz += o.z;
  }
  out.x = sx * 1.6; out.z = sz * 1.6;
  if (n) {
    out.x += (ax / n - self.vx) * 0.1 + (cx / n - self.x) * 0.05;
    out.z += (az / n - self.vz) * 0.1 + (cz / n - self.z) * 0.05;
  }
  if (target) {
    const alive = pack.filter((p) => !p.dead);
    const idx = alive.indexOf(self);
    const slot = (idx / Math.max(1, alive.length)) * Math.PI * 2 + (target.packAngle || 0);
    const r = self.engageRange || 3;
    out.x += (target.x + Math.cos(slot) * r - self.x) * 0.6;
    out.z += (target.z + Math.sin(slot) * r - self.z) * 0.6;
  }
  return out;
}
