// Seeded randomness and noise. Every floor is generated from one integer seed,
// so the same floor number always produces the same world.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) { this.next = mulberry32(seed); }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  // Weighted choice: items = [{w, ...}]
  weighted(items) {
    let total = 0;
    for (const it of items) total += it.w;
    let r = this.next() * total;
    for (const it of items) { if ((r -= it.w) <= 0) return it; }
    return items[items.length - 1];
  }
}

// 2D gradient noise (Perlin-style) with a seeded permutation table.
export class Noise2D {
  constructor(seed) {
    const r = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y;
      case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x;
      case 6: return y; default: return -y;
    }
  }
  noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const P = this.perm;
    const aa = P[P[X] + Y], ab = P[P[X] + Y + 1];
    const ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
    const x1 = this.grad(aa, xf, yf) + u * (this.grad(ba, xf - 1, yf) - this.grad(aa, xf, yf));
    const x2 = this.grad(ab, xf, yf - 1) + u * (this.grad(bb, xf - 1, yf - 1) - this.grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  }
  // Fractional Brownian motion: several octaves summed.
  fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.noise(x * f, y * f);
      n += a; a *= gain; f *= lac;
    }
    return s / n;
  }
}

// Bridson's Poisson-disc sampling: evenly spread points with a minimum gap.
// Used to scatter trees, rocks and spawn points without clumping.
export function poissonDisc(rng, w, h, minDist, accept = () => true, k = 20) {
  const cell = minDist / Math.SQRT2;
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [], active = [];
  const add = (x, y) => {
    const i = pts.length;
    pts.push([x, y]); active.push(i);
    grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = i;
  };
  add(rng.float(0, w), rng.float(0, h));
  while (active.length) {
    const ai = Math.floor(rng.next() * active.length);
    const [px, py] = pts[active[ai]];
    let found = false;
    for (let n = 0; n < k; n++) {
      const ang = rng.float(0, Math.PI * 2), rad = rng.float(minDist, 2 * minDist);
      const x = px + Math.cos(ang) * rad, y = py + Math.sin(ang) * rad;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      let ok = true;
      for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2) && ok; yy++)
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
          const j = grid[yy * gw + xx];
          if (j >= 0) {
            const dx = pts[j][0] - x, dy = pts[j][1] - y;
            if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
          }
        }
      if (ok) { add(x, y); found = true; break; }
    }
    if (!found) active.splice(ai, 1);
  }
  return pts.filter(([x, y]) => accept(x, y));
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function damp(cur, target, lambda, dt) {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}
