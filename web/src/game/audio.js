// Synthesised sound: every effect is built from oscillators and filtered
// noise at runtime, and the music is a generative loop (a Markov chain over
// scale degrees for the melody, over a fixed chord progression).

export class Audio {
  constructor() { this.ctx = null; this.on = true; this.musicOn = true; this.vol = 0.7; }
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.mus = this.ctx.createGain(); this.mus.gain.value = 0.28; this.mus.connect(this.master);
    // reverb from a decaying noise impulse
    const len = this.ctx.sampleRate * 2.2, ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.verb = this.ctx.createConvolver(); this.verb.buffer = ir;
    const vg = this.ctx.createGain(); vg.gain.value = 0.35; this.verb.connect(vg); vg.connect(this.master);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.startMusic();
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  env(node, t, a, d, peak = 1) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); node.connect(g); return g; }
  noiseBurst(t, dur, f0, f1, q = 1, gain = 0.5, type = 'bandpass') {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    s.connect(f); const g = this.env(f, t, 0.005, dur, gain); g.connect(this.sfx); g.connect(this.verb);
    s.start(t); s.stop(t + dur + 0.05);
  }
  tone(t, f0, f1, dur, type = 'sine', gain = 0.3) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.env(o, t, 0.005, dur, gain); g.connect(this.sfx); g.connect(this.verb);
    o.start(t); o.stop(t + dur + 0.05);
  }
  play(name, k = 1) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'swing': this.noiseBurst(t, 0.16, 1800, 600, 2, 0.35); break;
      case 'whoosh': this.noiseBurst(t, 0.25, 900, 300, 1.5, 0.3); break;
      case 'hit': this.noiseBurst(t, 0.08, 3000, 1200, 1, 0.5); this.tone(t, 220, 90, 0.12, 'triangle', 0.35); break;
      case 'crit': this.noiseBurst(t, 0.1, 5000, 1500, 1, 0.6); this.tone(t, 880, 440, 0.15, 'square', 0.12); this.tone(t, 160, 60, 0.18, 'sine', 0.5); break;
      case 'block': this.tone(t, 1400, 1300, 0.2, 'square', 0.08); this.tone(t, 2100, 2000, 0.25, 'sine', 0.12); this.noiseBurst(t, 0.05, 6000, 4000, 4, 0.3); break;
      case 'parry': this.tone(t, 1760, 1760, 0.5, 'sine', 0.25); this.tone(t, 2637, 2637, 0.5, 'sine', 0.12); break;
      case 'skill': this.tone(t, 300, 1200, 0.3, 'sawtooth', 0.07); this.tone(t, 600, 2400, 0.3, 'sine', 0.12); this.noiseBurst(t + 0.1, 0.3, 4000, 800, 1.5, 0.3); break;
      case 'shatter': for (let i = 0; i < 6; i++) this.tone(t + i * 0.025, 1800 + Math.random() * 2400, 900, 0.35, 'sine', 0.06); this.noiseBurst(t, 0.4, 8000, 3000, 0.7, 0.35, 'highpass'); break;
      case 'hurt': this.tone(t, 180, 80, 0.2, 'sawtooth', 0.12); this.noiseBurst(t, 0.12, 900, 300, 1, 0.4); break;
      case 'roll': this.noiseBurst(t, 0.2, 400, 200, 1, 0.2, 'lowpass'); break;
      case 'heavy': this.tone(t, 90, 40, 0.4, 'sine', 0.6); this.noiseBurst(t, 0.3, 600, 150, 1, 0.5, 'lowpass'); break;
      case 'slam': this.tone(t, 70, 30, 0.7, 'sine', 0.8); this.noiseBurst(t, 0.6, 1200, 100, 0.7, 0.6, 'lowpass'); break;
      case 'growl': this.tone(t, 110, 70, 0.4, 'sawtooth', 0.1); break;
      case 'levelup': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(t + i * 0.09, f, f, 0.5, 'triangle', 0.18)); break;
      case 'potion': [880, 1175, 1568].forEach((f, i) => this.tone(t + i * 0.07, f, f, 0.4, 'sine', 0.15)); break;
      case 'ui': this.tone(t, 1320, 1320, 0.06, 'sine', 0.12); break;
      case 'menu': this.tone(t, 988, 988, 0.08, 'sine', 0.15); this.tone(t + 0.06, 1480, 1480, 0.12, 'sine', 0.12); break;
      case 'gate': [392, 523, 659, 784].forEach((f, i) => this.tone(t + i * 0.12, f, f, 1.2, 'sine', 0.12)); break;
      case 'fanfare': [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.16, f, f, 0.9, 'triangle', 0.16)); break;
    }
  }
  // generative score: pad chords + a Markov melody + soft pulse
  startMusic() {
    const ctx = this.ctx;
    const scale = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15]; // natural minor over two octaves
    const prog = [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]]; // i - VI - III - VII
    // transition matrix favouring steps over leaps
    const T = scale.map((_, i) => scale.map((__, j) => Math.exp(-Math.abs(i - j) * 0.9) * (i === j ? 0.3 : 1)));
    let deg = 4, bar = 0, step = 0;
    const root = 220 * Math.pow(2, -5 / 12); // E3-ish
    const freq = (st) => root * Math.pow(2, st / 12);
    const beat = 60 / 84 / 2;
    let next = ctx.currentTime + 0.3;
    const tick = () => {
      if (!this.ctx) return;
      while (next < ctx.currentTime + 0.5) {
        if (this.musicOn) {
          if (step % 8 === 0) {
            for (const n of prog[bar % 4]) {
              const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq(n);
              const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; o.connect(f);
              const g = ctx.createGain(); g.gain.setValueAtTime(0, next); g.gain.linearRampToValueAtTime(0.05, next + 0.6); g.gain.linearRampToValueAtTime(0.0001, next + beat * 8.5);
              f.connect(g); g.connect(this.mus); g.connect(this.verb); o.start(next); o.stop(next + beat * 9);
            }
            const b = ctx.createOscillator(); b.type = 'triangle'; b.frequency.value = freq(prog[bar % 4][0]) / 2;
            const bg = this.env(b, next, 0.02, beat * 6, 0.18); bg.connect(this.mus); b.start(next); b.stop(next + beat * 7);
          }
          if (step % 2 === 0 && Math.random() < 0.8) {
            const row = T[deg]; let s = 0; for (const v of row) s += v;
            let r = Math.random() * s; for (let j = 0; j < row.length; j++) { r -= row[j]; if (r <= 0) { deg = j; break; } }
            const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq(scale[deg] + 12);
            const g = this.env(o, next, 0.01, beat * 1.8, 0.07); g.connect(this.mus); g.connect(this.verb);
            o.start(next); o.stop(next + beat * 2);
          }
        }
        next += beat; step++; if (step % 8 === 0) bar++;
      }
      setTimeout(tick, 120);
    };
    tick();
  }
}
