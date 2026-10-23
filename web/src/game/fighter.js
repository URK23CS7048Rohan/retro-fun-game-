import * as THREE from 'three';
import { CLIPS } from '../chars/anim.js';
import { SKILLS, COMBO, playerStats, rollDamage, inArc } from './combat.js';
import { Trail } from './fx.js';
import { angleDiff, damp } from '../core/rng.js';

// A sword-user: the player and the companion are both Fighters. Control comes
// from outside (touch input or the companion AI) through move()/act(); the
// Fighter owns the action state machine, sword skills, cooldowns, i-frames,
// guarding, and drives the character model's animation.

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Fighter {
  constructor(game, model, { name, level = 1, team = 'party', color = '#ffffff' } = {}) {
    this.game = game; this.model = model; this.name = name; this.team = team;
    this.root = model.root;
    this.x = 0; this.z = 0; this.y = 0; this.facing = 0;
    this.vx = 0; this.vz = 0; this.speed = 0;
    this.level = level; this.xp = 0;
    this.setLevel(level);
    this.hp = this.maxHp; this.sp = this.maxSp;
    this.state = { type: 'free', t: 0 };
    this.combo = 0; this.comboT = 0;
    this.cooldowns = {}; this.iframes = 0; this.hurt = 0; this.guarding = false; this.guardT = 0;
    this.radius = 0.4; this.dead = false; this.downT = 0;
    this.combatT = 0;
    this.trail = new Trail(game.scene, 16);
    this.trailColor = new THREE.Color(color);
    this.glowK = 0;
    this.lastAction = null;
  }
  setLevel(l) {
    this.level = l;
    const s = playerStats(l);
    const ratio = this.maxHp ? this.hp / this.maxHp : 1;
    Object.assign(this, s);
    this.hp = Math.round(this.maxHp * ratio);
  }
  place(x, z, facing = this.facing) {
    this.x = x; this.z = z; this.facing = facing;
    this.y = this.game.world.heightAt(x, z);
    if (this.model.teleport) this.model.teleport(x, this.y, z, facing);
  }
  get busy() { return this.state.type !== 'free' && this.state.type !== 'guard'; }
  ready(id) { return (this.cooldowns[id] || 0) <= 0; }

  // ---------- commands ----------
  act(action, arg) {
    if (this.dead) return false;
    const st = this.state;
    if (action === 'attack') {
      if (st.type === 'attack' && st.t > COMBO[st.i].hitAt + 0.05 && this.combo < 2) { this.queued = 'attack'; return true; }
      if (this.busy) return false;
      const i = this.comboT > 0 ? Math.min(2, this.combo + 1) : 0;
      this.startAttack(i);
      return true;
    }
    if (action === 'skill') {
      const sk = SKILLS[arg];
      if (!sk || this.busy || !this.ready(sk.id) || this.sp < sk.sp) return false;
      this.sp -= sk.sp; this.cooldowns[sk.id] = sk.cd;
      this.state = { type: 'skill', t: 0, sk, hit: 0, pre: 0.18 };
      this.model.play(CLIPS[sk.clip], 1);
      this.glowK = 1;
      this.game.onSkill?.(this, sk);
      this.lastAction = sk.clip;
      return true;
    }
    if (action === 'roll') {
      if ((this.busy && this.state.type !== 'attack') || !this.ready('roll')) return false;
      const dir = arg && (arg.x || arg.z) ? Math.atan2(arg.x, arg.z) : this.facing + Math.PI;
      this.facing = dir; this.cooldowns.roll = 0.55;
      this.state = { type: 'roll', t: 0, dir };
      this.iframes = 0.38;
      this.model.play(CLIPS.roll, 1.1);
      this.lastAction = 'roll';
      this.game.audio?.play('roll');
      return true;
    }
    if (action === 'guard') {
      if (arg && !this.busy) { if (!this.guarding) this.guardT = 0; this.guarding = true; this.state = { type: 'guard', t: 0 }; this.lastAction = 'guard'; }
      else if (!arg && this.state.type === 'guard') { this.guarding = false; this.state = { type: 'free', t: 0 }; }
      return true;
    }
    if (action === 'potion') {
      if (this.busy || !this.ready('potion')) return false;
      this.cooldowns.potion = 1.2;
      this.state = { type: 'potion', t: 0, healed: false, amount: arg || 0.4 };
      this.model.play(CLIPS.potion, 1);
      return true;
    }
    return false;
  }
  startAttack(i) {
    const c = COMBO[i];
    this.combo = i; this.comboT = 0;
    this.state = { type: 'attack', t: 0, i, hit: false };
    this.model.play(CLIPS[c.clip], 1);
    this.lastAction = 'slash';
    this.game.audio?.play('swing');
  }

  // ---------- simulation ----------
  update(dt, move, faceTarget) {
    const st = this.state; st.t += dt;
    for (const k in this.cooldowns) this.cooldowns[k] -= dt;
    this.iframes -= dt; this.hurt = Math.max(0, this.hurt - dt * 3);
    this.comboT -= dt; this.combatT -= dt;
    if (this.guarding) this.guardT += dt;
    this.sp = Math.min(this.maxSp, this.sp + dt * (this.combatT > 0 ? 4 : 10));
    if (this.combatT < -6) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.01 * dt);

    let speed = 0, mvx = 0, mvz = 0;
    if (this.dead) {
      this.downT -= dt;
    } else if (st.type === 'free' || st.type === 'guard') {
      const m = Math.hypot(move.x, move.z);
      if (m > 0.05) {
        const want = Math.atan2(move.x, move.z);
        const sp = st.type === 'guard' ? 2.2 : 6.6 * Math.min(1, m * 1.15);
        mvx = (move.x / m) * sp * Math.min(1, m); mvz = (move.z / m) * sp * Math.min(1, m);
        if (st.type !== 'guard' || !faceTarget) this.facing += angleDiff(this.facing, want) * Math.min(1, dt * 14);
      }
      if (faceTarget) this.facing += angleDiff(this.facing, Math.atan2(faceTarget.x - this.x, faceTarget.z - this.z)) * Math.min(1, dt * (st.type === 'guard' ? 12 : 4));
    } else if (st.type === 'attack') {
      const c = COMBO[st.i];
      if (faceTarget && st.t < c.hitAt) this.facing += angleDiff(this.facing, Math.atan2(faceTarget.x - this.x, faceTarget.z - this.z)) * Math.min(1, dt * 16);
      if (st.t < c.hitAt + 0.05) { const k = c.dash * 4; mvx = Math.sin(this.facing) * k * (1 - st.t / (c.hitAt + 0.05)); mvz = Math.cos(this.facing) * k * (1 - st.t / (c.hitAt + 0.05)); }
      if (!st.hit && st.t >= c.hitAt) { st.hit = true; this.strike(c.mult, 2.5, 1.1, { combo: st.i }); }
      if (st.t >= c.dur) {
        this.comboT = c.window; this.state = { type: 'free', t: 0 };
        if (this.queued === 'attack' && st.i < 2) { this.queued = null; this.startAttack(st.i + 1); }
        else if (st.i === 2) { this.combo = 0; this.comboT = 0; }
        this.queued = null;
      }
    } else if (st.type === 'skill') {
      const sk = st.sk, clipDur = CLIPS[sk.clip].keys.at(-1).t;
      if (faceTarget && st.t < 0.15) this.facing += angleDiff(this.facing, Math.atan2(faceTarget.x - this.x, faceTarget.z - this.z)) * Math.min(1, dt * 20);
      const h0 = sk.hits[0];
      if (st.t > h0 - 0.12 && st.t < sk.hits.at(-1) + 0.06) { const k = (sk.dash / 0.2); mvx = Math.sin(this.facing) * k * 0.5; mvz = Math.cos(this.facing) * k * 0.5; }
      while (st.hit < sk.hits.length && st.t >= sk.hits[st.hit]) { this.strike(sk.mult, sk.range, sk.arc, { skill: sk }); st.hit++; }
      this.glowK = 1;
      if (st.t >= clipDur + sk.post) this.state = { type: 'free', t: 0 };
    } else if (st.type === 'roll') {
      const k = st.t < 0.32 ? 9.5 * (1 - st.t / 0.4) : 0;
      mvx = Math.sin(st.dir) * k; mvz = Math.cos(st.dir) * k;
      if (st.t > 0.45) this.state = { type: 'free', t: 0 };
    } else if (st.type === 'potion') {
      if (!st.healed && st.t > 0.45) { st.healed = true; this.hp = Math.min(this.maxHp, this.hp + this.maxHp * st.amount); this.game.onHeal?.(this, this.maxHp * st.amount); }
      if (st.t > 0.8) this.state = { type: 'free', t: 0 };
    } else if (st.type === 'stagger') {
      mvx = this.vx * 0.9; mvz = this.vz * 0.9;
      if (st.t > (st.dur || 0.35)) this.state = { type: 'free', t: 0 };
    }
    // integrate with collision
    this.vx = damp(this.vx, mvx, 18, dt); this.vz = damp(this.vz, mvz, 18, dt);
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    [nx, nz] = this.game.world.resolve(nx, nz, this.radius);
    speed = Math.hypot(nx - this.x, nz - this.z) / Math.max(dt, 1e-4);
    this.x = nx; this.z = nz;
    this.y = damp(this.y, this.game.world.heightAt(nx, nz), 20, dt);
    this.speed = speed;
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.facing;

    // sword glow and trail
    this.glowK = Math.max(0, this.glowK - dt * 2.5);
    const sk = st.type === 'skill' ? st.sk : null;
    this.model.setGlow?.(sk ? new THREE.Color(sk.color) : this.trailColor, this.glowK);
    if (this.model.tip && this.model.hiltRef) {
      this.model.tip.getWorldPosition(_a); this.model.hiltRef.getWorldPosition(_b);
      const active = st.type === 'attack' ? st.t > 0.04 && st.t < COMBO[st.i].hitAt + 0.15 : st.type === 'skill';
      this.trail.push(_b, _a, active, sk ? new THREE.Color(sk.color).multiplyScalar(1.4) : this.trailColor, dt);
    }
    this.model.update(dt, { speed: st.type === 'roll' ? 0 : speed, guard: st.type === 'guard', combat: this.combatT > 0, hurt: this.hurt, dead: this.dead });
  }

  strike(mult, range, arc, info) {
    const foes = this.game.foesOf(this);
    const hits = inArc(this, foes, range, arc);
    for (const t of hits) {
      const { dmg, crit } = rollDamage(this.atk, mult, t.def || 0);
      t.takeHit(dmg, this, { crit, skill: info.skill, combo: info.combo });
    }
    if (hits.length) { this.combatT = 6; this.game.onStrike?.(this, hits, info); }
    return hits.length;
  }

  takeHit(dmg, from, opts = {}) {
    if (this.dead || this.iframes > 0) { if (this.iframes > 0) this.game.popup?.(this, 'DODGE', 'miss'); return 0; }
    this.combatT = 6;
    let d = dmg;
    const facingFrom = Math.abs(angleDiff(this.facing, Math.atan2(from.x - this.x, from.z - this.z))) < 1.4;
    if (this.state.type === 'guard' && facingFrom && !opts.unblockable) {
      if (this.guardT < 0.22) { // perfect guard: parry
        this.game.onParry?.(this, from);
        return 0;
      }
      d = Math.round(d * 0.3);
      this.sp = Math.max(0, this.sp - 6);
    } else {
      this.hurt = 1;
      if (opts.knock) {
        const a = Math.atan2(this.x - from.x, this.z - from.z);
        this.vx = Math.sin(a) * opts.knock; this.vz = Math.cos(a) * opts.knock;
        this.state = { type: 'stagger', t: 0, dur: 0.4 }; this.guarding = false;
      }
    }
    this.hp -= d;
    this.game.onDamaged?.(this, d, from, opts);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.state = { type: 'dead', t: 0 }; this.guarding = false; this.game.onDeath?.(this, from); }
    return d;
  }
  revive(frac = 0.5) { this.dead = false; this.hp = Math.round(this.maxHp * frac); this.state = { type: 'free', t: 0 }; this.iframes = 2; }
}
