import { MLP, Replay } from '../ai/mlp.js';
import { SKILL_SLOTS, SKILLS } from './combat.js';

// The companion's brain. Two signals are blended:
//  1. Behaviour cloning: an MLP trained online on (situation -> what YOU did),
//     sampled from your own fights, so she drifts toward your play style.
//  2. Utility scoring: hand-written needs (heal a dying partner, block a
//     telegraphed hit, keep distance when hurt) that keep her sensible while
//     the network is still learning.

export const INTENTS = ['attack', 'skill', 'guard', 'reposition', 'support'];

export function features(self, target, partner, game) {
  const d = target ? Math.hypot(target.x - self.x, target.z - self.z) : 20;
  const near = game.enemies.filter((e) => !e.dead && Math.hypot(e.x - self.x, e.z - self.z) < 8).length;
  return [
    Math.min(1, d / 10),
    target ? target.hp / target.maxHp : 0,
    self.hp / self.maxHp,
    partner ? partner.hp / partner.maxHp : 1,
    target && (target.state === 'windup' || target.wind) ? 1 : 0,
    Math.min(1, near / 4),
    self.sp / self.maxSp,
    target && target.kind === 'boss' ? 1 : 0,
    1,
  ];
}

export class CompanionBrain {
  constructor(saved) {
    this.net = new MLP([9, 16, 12, INTENTS.length], 11);
    if (saved) this.net.load(saved);
    this.replay = new Replay(500);
    this.trainT = 0; this.thinkT = 0;
    this.intent = 'attack'; this.lastProbs = INTENTS.map(() => 1 / INTENTS.length);
    this.supportCd = 0; this.switchT = 0;
    this.samples = 0;
  }
  // called by the game whenever the player commits to something in combat
  record(x, intent) {
    const y = INTENTS.indexOf(intent);
    if (y < 0) return;
    this.replay.push({ x, y }); this.samples++;
  }
  train(dt) {
    this.trainT -= dt;
    if (this.trainT > 0 || this.replay.items.length < 12) return;
    this.trainT = 0.4;
    for (let k = 0; k < 2; k++) this.net.train(this.replay.sample(16), 0.03);
  }
  decide(self, target, partner, game) {
    const x = features(self, target, partner, game);
    const p = this.net.predict(x);
    // utility terms, weighted down as the network gains experience
    const trust = Math.min(0.75, this.net.steps / 400);
    const u = [0.5, self.sp > 30 && target ? 0.35 : 0, x[4] * 0.9, self.hp / self.maxHp < 0.3 ? 0.7 : 0.05, partner && partner.hp / partner.maxHp < 0.35 && this.supportCd <= 0 ? 1.2 : 0];
    const score = p.map((pi, i) => pi * trust + u[i] * (1 - trust));
    this.lastProbs = p;
    let best = 0; for (let i = 1; i < score.length; i++) if (score[i] > score[best]) best = i;
    this.intent = INTENTS[best];
    return this.intent;
  }
}

// Drives the companion Fighter each frame.
export function companionUpdate(c, brain, game, dt) {
  const player = game.player;
  brain.train(dt);
  brain.supportCd -= dt; brain.switchT -= dt;
  if (c.dead) { c.downT -= dt; if (c.downT <= 0 && !player.dead) { c.revive(0.4); game.log(`${c.name} is back on her feet`); } c.update(dt, { x: 0, z: 0 }, null); return; }
  // target: the switch target, else whatever is fighting the party nearest to us
  let target = brain.switchTarget && !brain.switchTarget.dead ? brain.switchTarget : null;
  if (!target) {
    let best = 12;
    for (const e of game.enemies) {
      if (e.dead || (e.kind === 'boss' && !e.active)) continue;
      const d = Math.hypot(e.x - c.x, e.z - c.z), dp = Math.hypot(e.x - player.x, e.z - player.z);
      if ((e.target || dp < 10) && d < best) { best = d; target = e; }
    }
  }
  c.target = target;
  let mx = 0, mz = 0;
  const toP = Math.hypot(player.x - c.x, player.z - c.z);
  if (!target) {
    // follow: stay at the player's back-left shoulder
    const fx = player.x - Math.sin(player.facing) * 1.6 + Math.cos(player.facing) * 1.2;
    const fz = player.z - Math.cos(player.facing) * 1.6 - Math.sin(player.facing) * 1.2;
    const dx = fx - c.x, dz = fz - c.z, d = Math.hypot(dx, dz);
    if (d > 0.8) { const k = Math.min(1, d / 3) * (d > 6 ? 1 : 0.7); mx = (dx / d) * k; mz = (dz / d) * k; }
    if (toP > 30) c.place(player.x - 1, player.z - 1);
    c.update(dt, { x: mx, z: mz }, null);
    return;
  }
  brain.thinkT -= dt;
  if (brain.thinkT <= 0 || brain.switchT > 0) { brain.thinkT = 0.35; brain.decide(c, target, player, game); }
  const intent = brain.switchT > 0 ? 'skill' : brain.intent;
  const dx = target.x - c.x, dz = target.z - c.z, d = Math.hypot(dx, dz) || 1;
  if (intent === 'support' && player.hp / player.maxHp < 0.35 && brain.supportCd <= 0) {
    if (toP < 3) { brain.supportCd = 18; player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.3); game.onHeal(player, player.maxHp * 0.3, c); game.log(`${c.name} used a Healing Crystal on you`); }
    else { mx = (player.x - c.x) / toP; mz = (player.z - c.z) / toP; }
  } else if (intent === 'reposition') {
    // flank: move to the far side of the target from the player
    const ax = target.x + (target.x - player.x), az = target.z + (target.z - player.z);
    const ex = ax - c.x, ez = az - c.z, ed = Math.hypot(ex, ez) || 1;
    const back = d < 2.5 ? -1 : 0;
    mx = (ex / ed) * 0.8 + (dx / d) * back; mz = (ez / ed) * 0.8 + (dz / d) * back;
  } else if (intent === 'guard') {
    c.act('guard', true);
    if (d > 3) { mx = dx / d * 0.5; mz = dz / d * 0.5; }
  } else {
    if (c.state.type === 'guard') c.act('guard', false);
    if (d > 2.2) { mx = dx / d; mz = dz / d; }
    else if (intent === 'skill' || brain.switchT > 0) {
      const id = SKILL_SLOTS.find((s) => c.ready(s) && c.sp >= SKILLS[s].sp) ;
      if (id) { c.act('skill', id); brain.switchT = 0; }
      else c.act('attack');
    } else c.act('attack');
  }
  if (intent !== 'guard' && c.state.type === 'guard') c.act('guard', false);
  c.update(dt, { x: mx, z: mz }, target);
}
