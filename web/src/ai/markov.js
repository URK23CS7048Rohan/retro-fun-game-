// Variable-order Markov predictor (n-gram with back-off).
// Every monster on a floor shares one instance, so the whole floor learns your
// habits: if you always open with a lunge, the third wolf will see it coming.

export const ACTIONS = ['slash', 'rising', 'twinfang', 'comet', 'roll', 'guard'];

export class MarkovPredictor {
  constructor(maxOrder = 3, decay = 0.995) {
    this.maxOrder = maxOrder;
    this.decay = decay;
    this.tables = Array.from({ length: maxOrder + 1 }, () => new Map());
    this.history = [];
    this.hits = 0; this.total = 0;
    this.lastPrediction = null;
  }
  observe(action) {
    // score the previous prediction before learning from this action
    if (this.lastPrediction) { this.total++; if (this.lastPrediction.action === action) this.hits++; }
    for (let k = 0; k <= this.maxOrder; k++) {
      if (this.history.length < k) break;
      const ctx = this.history.slice(this.history.length - k).join('>');
      let row = this.tables[k].get(ctx);
      if (!row) { row = {}; this.tables[k].set(ctx, row); }
      for (const a in row) row[a] *= this.decay; // recency weighting
      row[action] = (row[action] || 0) + 1;
    }
    this.history.push(action);
    if (this.history.length > 32) this.history.shift();
    this.lastPrediction = this.predict();
  }
  // Blend orders: longer contexts get more weight the more evidence they have.
  distribution() {
    const dist = {};
    for (const a of ACTIONS) dist[a] = 0.02;
    let wsum = 0;
    for (let k = this.maxOrder; k >= 0; k--) {
      if (this.history.length < k) continue;
      const ctx = this.history.slice(this.history.length - k).join('>');
      const row = this.tables[k].get(ctx);
      if (!row) continue;
      let n = 0; for (const a in row) n += row[a];
      const w = (k + 1) * (n / (n + 2));
      for (const a in row) dist[a] += (w * row[a]) / n;
      wsum += w;
    }
    let s = 0; for (const a in dist) s += dist[a];
    for (const a in dist) dist[a] /= s;
    return dist;
  }
  predict() {
    const d = this.distribution();
    let best = null, bp = 0;
    for (const a in d) if (d[a] > bp) { bp = d[a]; best = a; }
    return { action: best, p: bp, dist: d };
  }
  accuracy() { return this.total ? this.hits / this.total : 0; }
  toJSON() {
    return { t: this.tables.map((m) => [...m.entries()]), h: this.history, hits: this.hits, total: this.total };
  }
  load(o) {
    if (!o || !o.t) return;
    this.tables = o.t.map((e) => new Map(e));
    while (this.tables.length < this.maxOrder + 1) this.tables.push(new Map());
    this.history = o.h || []; this.hits = o.hits || 0; this.total = o.total || 0;
  }
}
