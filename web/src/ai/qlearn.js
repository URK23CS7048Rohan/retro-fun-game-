// Tabular Q-learning for floor bosses. The boss observes a coarse state
// (distance band, what you're doing, its HP phase, your HP band, whether your
// sword skill is on cooldown), picks a move epsilon-greedily, and is rewarded
// for damage dealt and penalised for damage taken. The table is saved, so a
// boss that killed you remembers what worked.

export const BOSS_MOVES = ['cleave', 'slam', 'charge', 'guard', 'retreat', 'roar'];

export class QLearner {
  constructor({ alpha = 0.25, gamma = 0.85, epsilon = 0.25, moves = BOSS_MOVES } = {}) {
    this.alpha = alpha; this.gamma = gamma; this.epsilon = epsilon;
    this.moves = moves;
    this.Q = new Map();
    this.prev = null; // {s, a}
    this.updates = 0;
    this.lastQ = null;
  }
  static state({ dist, playerAct, hpPhase, playerHp, skillReady }) {
    const d = dist < 3 ? 0 : dist < 7 ? 1 : 2;
    const p = playerHp > 0.6 ? 2 : playerHp > 0.3 ? 1 : 0;
    return `${d}|${playerAct}|${hpPhase}|${p}|${skillReady ? 1 : 0}`;
  }
  row(s) {
    let r = this.Q.get(s);
    if (!r) {
      // prior: sensible defaults so an untrained boss is not random noise
      const d = +s[0];
      r = this.moves.map((m) => {
        if (m === 'cleave' || m === 'slam') return d === 0 ? 0.6 : -0.3;
        if (m === 'charge') return d === 2 ? 0.6 : d === 1 ? 0.3 : -0.2;
        if (m === 'guard') return s.includes('|slash|') || s.includes('|comet|') ? 0.4 : 0;
        if (m === 'retreat') return 0;
        return 0.1;
      });
      this.Q.set(s, r);
    }
    return r;
  }
  choose(s, rand = Math.random) {
    const r = this.row(s);
    this.lastQ = { s, r: r.slice() };
    if (rand() < this.epsilon) return Math.floor(rand() * this.moves.length);
    let bi = 0; for (let i = 1; i < r.length; i++) if (r[i] > r[bi]) bi = i;
    return bi;
  }
  // Called when a move finishes; reward is the outcome of that move.
  learn(s, a, reward, s2, terminal = false) {
    const r = this.row(s);
    const next = terminal ? 0 : Math.max(...this.row(s2));
    r[a] += this.alpha * (reward + this.gamma * next - r[a]);
    this.updates++;
    // anneal exploration as the boss gains experience
    this.epsilon = Math.max(0.06, this.epsilon * 0.997);
  }
  toJSON() { return { Q: [...this.Q.entries()], e: this.epsilon, u: this.updates }; }
  load(o) { if (!o) return; this.Q = new Map(o.Q); this.epsilon = o.e ?? this.epsilon; this.updates = o.u || 0; }
}
