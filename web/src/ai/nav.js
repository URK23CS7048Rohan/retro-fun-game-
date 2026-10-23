// Navigation: an occupancy grid baked from world colliders, A* with an octile
// heuristic and a binary-heap open set, then string-pulling so paths become a
// few straight segments instead of a staircase.

class Heap {
  constructor() { this.a = []; this.f = []; }
  push(n, f) {
    const a = this.a, F = this.f; a.push(n); F.push(f);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= F[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [F[p], F[i]] = [F[i], F[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, F = this.f, top = a[0];
    const ln = a.pop(), lf = F.pop();
    if (a.length) {
      a[0] = ln; F[0] = lf;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && F[l] < F[m]) m = l;
        if (r < a.length && F[r] < F[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [F[m], F[i]] = [F[i], F[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

export class NavGrid {
  constructor(world, cell = 1, half = 120) {
    this.cell = cell; this.half = half;
    this.n = Math.ceil((half * 2) / cell);
    this.block = new Uint8Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const [x, z] = this.toWorld(i, j);
      this.block[j * this.n + i] = world.blocked(x, z, 0.45) ? 1 : 0;
    }
    this.g = new Float32Array(this.n * this.n);
    this.came = new Int32Array(this.n * this.n);
    this.stamp = new Uint32Array(this.n * this.n);
    this.closed = new Uint32Array(this.n * this.n);
    this.gen = 1;
    this.lastExpanded = 0;
  }
  toCell(x, z) { return [Math.floor((x + this.half) / this.cell), Math.floor((z + this.half) / this.cell)]; }
  toWorld(i, j) { return [(i + 0.5) * this.cell - this.half, (j + 0.5) * this.cell - this.half]; }
  free(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n && !this.block[j * this.n + i]; }

  // Bresenham walk to test straight-line walkability (used for smoothing).
  los(i0, j0, i1, j1) {
    let dx = Math.abs(i1 - i0), dy = -Math.abs(j1 - j0);
    const sx = i0 < i1 ? 1 : -1, sy = j0 < j1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (!this.free(i0, j0)) return false;
      if (i0 === i1 && j0 === j1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; i0 += sx; }
      if (e2 <= dx) { err += dx; j0 += sy; }
    }
  }

  nearestFree(i, j) {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++)
      if (this.free(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }

  find(x0, z0, x1, z1, maxNodes = 4000) {
    let s = this.nearestFree(...this.toCell(x0, z0));
    let t = this.nearestFree(...this.toCell(x1, z1));
    if (!s || !t) return null;
    const n = this.n, gen = ++this.gen;
    const si = s[1] * n + s[0], ti = t[1] * n + t[0];
    const h = (i) => {
      const dx = Math.abs((i % n) - t[0]), dy = Math.abs(((i / n) | 0) - t[1]);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    const open = new Heap();
    this.g[si] = 0; this.stamp[si] = gen; this.came[si] = -1;
    open.push(si, h(si));
    let expanded = 0, found = false;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (open.size) {
      const cur = open.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === ti) { found = true; break; }
      if (++expanded > maxNodes) break;
      const ci = cur % n, cj = (cur / n) | 0;
      for (const [di, dj, c] of D) {
        const ni = ci + di, nj = cj + dj;
        if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue; // no corner cutting
        const k = nj * n + ni;
        const g2 = this.g[cur] + c;
        if (this.stamp[k] !== gen || g2 < this.g[k]) {
          this.stamp[k] = gen; this.g[k] = g2; this.came[k] = cur;
          open.push(k, g2 + h(k));
        }
      }
    }
    this.lastExpanded = expanded;
    if (!found) return null;
    const cells = [];
    for (let c = ti; c !== -1; c = this.came[c]) cells.push([c % n, (c / n) | 0]);
    cells.reverse();
    // string pulling
    const out = [cells[0]];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      if (!this.los(cells[anchor][0], cells[anchor][1], cells[i][0], cells[i][1])) {
        out.push(cells[i - 1]); anchor = i - 1;
      }
    }
    out.push(cells[cells.length - 1]);
    return out.map(([i, j]) => this.toWorld(i, j));
  }
}
