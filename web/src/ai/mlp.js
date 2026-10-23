// A small multilayer perceptron trained online with SGD + momentum.
// The companion uses it for behaviour cloning: every half-second of combat we
// record (situation -> what the player chose) and train on it, so she gradually
// fights the way you fight: aggressive players get an aggressive partner.

export class MLP {
  constructor(sizes, seed = 7) {
    this.sizes = sizes;
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
    this.W = []; this.b = []; this.vW = []; this.vb = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const n = sizes[l], m = sizes[l + 1];
      const scale = Math.sqrt(2 / n);
      this.W.push(Float32Array.from({ length: n * m }, () => rnd() * 2 * scale));
      this.b.push(new Float32Array(m));
      this.vW.push(new Float32Array(n * m));
      this.vb.push(new Float32Array(m));
    }
    this.loss = 1;
    this.steps = 0;
  }
  forward(x) {
    const acts = [Float32Array.from(x)];
    for (let l = 0; l < this.W.length; l++) {
      const n = this.sizes[l], m = this.sizes[l + 1], W = this.W[l], b = this.b[l], a = acts[l];
      const out = new Float32Array(m);
      for (let j = 0; j < m; j++) {
        let z = b[j];
        for (let i = 0; i < n; i++) z += a[i] * W[i * m + j];
        out[j] = l < this.W.length - 1 ? (z > 0 ? z : 0.01 * z) : z; // leaky ReLU hidden
      }
      acts.push(out);
    }
    return acts;
  }
  static softmax(z) {
    let mx = -Infinity; for (const v of z) mx = Math.max(mx, v);
    const e = z.map((v) => Math.exp(v - mx)); let s = 0; for (const v of e) s += v;
    return e.map((v) => v / s);
  }
  predict(x) { return MLP.softmax(Array.from(this.forward(x).at(-1))); }
  // one SGD step on a mini-batch of {x, y(index)} with cross-entropy loss
  train(batch, lr = 0.03, mom = 0.9) {
    const L = this.W.length;
    const gW = this.W.map((w) => new Float32Array(w.length));
    const gb = this.b.map((b) => new Float32Array(b.length));
    let loss = 0;
    for (const { x, y } of batch) {
      const acts = this.forward(x);
      const p = MLP.softmax(Array.from(acts[L]));
      loss += -Math.log(Math.max(p[y], 1e-7));
      let delta = Float32Array.from(p); delta[y] -= 1;
      for (let l = L - 1; l >= 0; l--) {
        const n = this.sizes[l], m = this.sizes[l + 1], a = acts[l], W = this.W[l];
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) gW[l][i * m + j] += a[i] * delta[j];
        for (let j = 0; j < m; j++) gb[l][j] += delta[j];
        if (l > 0) {
          const prev = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            let s = 0; for (let j = 0; j < m; j++) s += W[i * m + j] * delta[j];
            prev[i] = s * (a[i] > 0 ? 1 : 0.01);
          }
          delta = prev;
        }
      }
    }
    const k = 1 / batch.length;
    for (let l = 0; l < L; l++) {
      for (let i = 0; i < this.W[l].length; i++) { this.vW[l][i] = mom * this.vW[l][i] - lr * gW[l][i] * k; this.W[l][i] += this.vW[l][i]; }
      for (let i = 0; i < this.b[l].length; i++) { this.vb[l][i] = mom * this.vb[l][i] - lr * gb[l][i] * k; this.b[l][i] += this.vb[l][i]; }
    }
    this.loss = this.loss * 0.9 + (loss * k) * 0.1;
    this.steps++;
    return loss * k;
  }
  toJSON() { return { s: this.sizes, W: this.W.map((w) => Array.from(w)), b: this.b.map((b) => Array.from(b)), loss: this.loss, steps: this.steps }; }
  load(o) {
    if (!o || JSON.stringify(o.s) !== JSON.stringify(this.sizes)) return;
    this.W = o.W.map((w) => Float32Array.from(w)); this.b = o.b.map((b) => Float32Array.from(b));
    this.vW = this.W.map((w) => new Float32Array(w.length)); this.vb = this.b.map((b) => new Float32Array(b.length));
    this.loss = o.loss; this.steps = o.steps;
  }
}

// Replay buffer with reservoir sampling so old habits aren't forgotten instantly.
export class Replay {
  constructor(cap = 400) { this.cap = cap; this.items = []; this.seen = 0; }
  push(it) {
    this.seen++;
    if (this.items.length < this.cap) this.items.push(it);
    else { const j = Math.floor(Math.random() * this.seen); if (j < this.cap) this.items[j] = it; }
  }
  sample(n) { const out = []; for (let i = 0; i < n && this.items.length; i++) out.push(this.items[Math.floor(Math.random() * this.items.length)]); return out; }
}
