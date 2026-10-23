import * as THREE from 'three';
import { BeastModel, ConstructHumanoid, SPECIES } from './monsters.js';
import { CLIPS } from '../chars/anim.js';
import { boidSteer } from '../ai/director.js';
import { QLearner, BOSS_MOVES } from '../ai/qlearn.js';
import { angleDiff, damp, clamp } from '../core/rng.js';
import { rollDamage } from './combat.js';
import { makeVRMCharacter } from '../chars/vrmchar.js';

// Field monsters. Their brain is a small state machine whose decisions lean
// on three shared systems:
//  - the floor-wide Markov predictor (what will the player do next?),
//  - the AI Director (how hard should this fight be right now?),
//  - navigation: A* paths around obstacles, boids for wolf packs.

let ID = 0;
const _v = { x: 0, z: 0 };

export class Enemy {
  constructor(game, kind, level, zone) {
    this.id = ++ID;
    this.game = game; this.kind = kind; this.zone = zone;
    this.sp = SPECIES[kind];
    this.name = this.sp.name;
    if (this.sp.vrm) {
      // humanoid monsters from VRM files: an empty stand-in until the model loads
      this.root = new THREE.Group();
      this.model = { root: this.root, update() {}, play() {} };
      this.loading = true;
      makeVRMCharacter(this.sp.vrm, { height: this.sp.height, weapon: this.sp.weapon }).then((m) => {
        if (this.disposed) return;
        this.root.add(m.root); this.model = { root: this.root, update: (dt, st) => m.update(dt, st), play: (c, sp) => m.play(c, sp), vrm: m };
        m.setExpression('angry', 0.7);
        this.loading = false;
      }).catch((e) => console.warn('monster model failed', e));
    } else {
      this.model = kind === 'kobold' ? new ConstructHumanoid('kobold', 'axe') : new BeastModel(kind);
      this.root = this.model.root;
    }
    game.scene.add(this.root);
    this.level = level;
    const k = 1 + (level - 1) * 0.28;
    this.maxHp = Math.round(this.sp.hp * k); this.hp = this.maxHp;
    this.atk = this.sp.atk * (1 + (level - 1) * 0.22); this.def = level * 1.5;
    this.radius = kind === 'kobold' || this.sp.vrm ? 0.5 : 0.7;
    this.x = zone.x; this.z = zone.z; this.y = 0; this.facing = Math.random() * 6;
    this.vx = 0; this.vz = 0; this.speed = 0;
    this.state = 'wander'; this.t = 0; this.target = null;
    this.wanderTo = null; this.path = null; this.pathT = 0;
    this.hurt = 0; this.dead = false; this.deadT = 0; this.stagger = 0;
    this.guarding = false; this.read = null;
    this.engageRange = 2.6 + Math.random();
  }
  place(x, z) { this.x = x; this.z = z; this.y = this.game.world.heightAt(x, z); }

  update(dt) {
    const g = this.game, w = g.world;
    this.t += dt; this.hurt = Math.max(0, this.hurt - dt * 3); this.stagger -= dt;
    if (this.dead) { this.deadT += dt; this.model.update(dt, { speed: 0, dead: true }); return; }
    if (this.loading) { this.y = g.world.heightAt(this.x, this.z); this.root.position.set(this.x, this.y, this.z); return; }
    const party = g.party.filter((p) => !p.dead);
    // aggro: nearest party member in sight; whoever hit us last keeps priority
    let tgt = this.aggro && !this.aggro.dead ? this.aggro : null;
    if (!tgt) {
      let best = 14;
      for (const p of party) { const d = Math.hypot(p.x - this.x, p.z - this.z); if (d < best) { best = d; tgt = p; } }
      if (g.inSafeZone(this.x, this.z)) tgt = null;
    }
    if (tgt && Math.hypot(tgt.x - this.x, tgt.z - this.z) > 26) { tgt = null; this.aggro = null; }
    this.target = tgt;

    let mx = 0, mz = 0, wantSpeed = 0;
    const D = g.director;
    if (this.stagger > 0) { this.state = 'stagger'; }
    else if (this.state === 'stagger') this.state = tgt ? 'chase' : 'wander';
    if (!tgt && !['windup', 'attack', 'recover', 'stagger'].includes(this.state)) this.state = 'wander';

    switch (this.state) {
      case 'wander': {
        if (!this.wanderTo || Math.hypot(this.wanderTo[0] - this.x, this.wanderTo[1] - this.z) < 1 || this.t > 8) {
          const a = Math.random() * 6.28, r = Math.random() * this.zone.r;
          this.wanderTo = [this.zone.x + Math.cos(a) * r, this.zone.z + Math.sin(a) * r]; this.t = 0;
          this.idleFor = Math.random() * 2.5;
        }
        if (this.t > this.idleFor) { const dx = this.wanderTo[0] - this.x, dz = this.wanderTo[1] - this.z, d = Math.hypot(dx, dz); mx = dx / d; mz = dz / d; wantSpeed = 1.6; }
        if (tgt) { this.state = 'chase'; this.t = 0; g.onAggro?.(this, tgt); }
        break;
      }
      case 'chase': {
        const dx = tgt.x - this.x, dz = tgt.z - this.z, d = Math.hypot(dx, dz);
        // path around obstacles when the straight line is blocked
        this.pathT -= dt;
        if (this.pathT <= 0) {
          this.pathT = 0.8;
          const nav = g.nav;
          const [i0, j0] = nav.toCell(this.x, this.z), [i1, j1] = nav.toCell(tgt.x, tgt.z);
          this.path = nav.los(i0, j0, i1, j1) ? null : nav.find(this.x, this.z, tgt.x, tgt.z, 1500);
          if (this.path) this.path.shift();
        }
        let tx = tgt.x, tz = tgt.z;
        if (this.path && this.path.length) { [tx, tz] = this.path[0]; if (Math.hypot(tx - this.x, tz - this.z) < 0.8) this.path.shift(); }
        else if (this.kind === 'wolf') {
          // boids: pack separation/cohesion plus spreading onto slots around the prey
          tgt.packAngle = tgt.packAngle ?? Math.random() * 6;
          boidSteer(this, g.enemies.filter((e) => e.kind === 'wolf' && e.target === tgt), tgt, _v);
          tx = this.x + _v.x; tz = this.z + _v.z;
        }
        const ddx = tx - this.x, ddz = tz - this.z, dd = Math.hypot(ddx, ddz) || 1;
        mx = ddx / dd; mz = ddz / dd;
        wantSpeed = this.sp.speed * (0.8 + D.aggression * 0.4);
        if (d < this.engageRange + 0.5) { this.state = 'circle'; this.t = 0; this.circleDir = Math.random() < 0.5 ? 1 : -1; }
        break;
      }
      case 'circle': {
        // strafe at striking distance, waiting for an opening
        const dx = tgt.x - this.x, dz = tgt.z - this.z, d = Math.hypot(dx, dz);
        const tan = [-dz / d * this.circleDir, dx / d * this.circleDir];
        const radial = (d - this.engageRange) * 1.2;
        mx = tan[0] * 0.6 + (dx / d) * radial; mz = tan[1] * 0.6 + (dz / d) * radial;
        wantSpeed = 2.4;
        if (d > this.engageRange + 3) { this.state = 'chase'; break; }
        const wait = 1.4 - D.aggression * 0.9;
        if (this.t > wait + Math.random() * 0.4 && g.attackTokens > 0) {
          // consult the predictor: if the player is about to roll, feint and wait
          const pred = g.predictor.predict();
          this.read = pred;
          if (pred.action === 'roll' && pred.p > 0.4 && Math.random() < 0.6 && !this.feinted) { this.feinted = true; this.t = 0.2; g.onRead?.(this, 'FEINT'); break; }
          this.feinted = false;
          g.attackTokens--;
          this.state = 'windup'; this.t = 0;
          this.windDur = this.kind === 'kobold' ? 0.55 : 0.45;
        }
        // kobolds raise their guard against a predicted slash
        this.guarding = (this.kind === 'kobold' || this.kind === 'summoner') && g.predictor.lastPrediction?.action === 'slash' && g.predictor.lastPrediction.p > 0.45 && d < 3.5;
        break;
      }
      case 'windup': {
        const a = Math.atan2(tgt.x - this.x, tgt.z - this.z);
        this.facing += angleDiff(this.facing, a) * Math.min(1, dt * 10);
        this.guarding = false;
        if (this.t > this.windDur) { this.state = 'attack'; this.t = 0; this.hitDone = false; if (this.model.play) this.model.play(this.sp.vrm ? CLIPS.slash1 : CLIPS.slash3, 1.1); g.audio?.play(this.kind === 'wolf' ? 'growl' : 'whoosh'); }
        break;
      }
      case 'attack': {
        // lunge forward and strike once
        const k = this.t < 0.18 ? 1 : 0;
        mx = Math.sin(this.facing) * k; mz = Math.cos(this.facing) * k; wantSpeed = this.kind === 'wolf' ? 13 : 10;
        if (!this.hitDone && this.t > 0.16) {
          this.hitDone = true;
          for (const p of g.party) {
            if (p.dead) continue;
            const d = Math.hypot(p.x - this.x, p.z - this.z);
            let da = angleDiff(this.facing, Math.atan2(p.x - this.x, p.z - this.z));
            if (d < this.sp.range + 0.4 && Math.abs(da) < 1.0) {
              const { dmg } = rollDamage(this.atk * g.director.damageMul, 1, p.def);
              p.takeHit(dmg, this, { knock: this.kind === 'boar' ? 7 : 4 });
            }
          }
        }
        if (this.t > 0.45) { this.state = 'recover'; this.t = 0; g.attackTokens++; }
        break;
      }
      case 'recover':
        if (this.t > 0.6) { this.state = tgt ? 'circle' : 'wander'; this.t = 0; }
        break;
      case 'stagger':
        break;
    }
    // separation from other monsters
    for (const o of g.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.x - o.x, dz = this.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.6 && d2 > 0.001) { mx += dx / d2 * 0.4; mz += dz / d2 * 0.4; }
    }
    const m = Math.hypot(mx, mz);
    const tvx = m > 0.01 ? (mx / m) * wantSpeed : 0, tvz = m > 0.01 ? (mz / m) * wantSpeed : 0;
    this.vx = damp(this.vx, this.stagger > 0 ? this.vx * 0.5 : tvx, 8, dt); this.vz = damp(this.vz, this.stagger > 0 ? this.vz * 0.5 : tvz, 8, dt);
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    [nx, nz] = w.resolve(nx, nz, this.radius);
    // monsters never enter town
    if (g.inSafeZone(nx, nz)) { nx = this.x; nz = this.z; }
    this.speed = Math.hypot(nx - this.x, nz - this.z) / dt;
    this.x = nx; this.z = nz;
    if (this.speed > 0.3 && !['windup', 'attack'].includes(this.state)) this.facing += angleDiff(this.facing, Math.atan2(this.vx, this.vz)) * Math.min(1, dt * 8);
    if (this.state === 'circle' && tgt) this.facing += angleDiff(this.facing, Math.atan2(tgt.x - this.x, tgt.z - this.z)) * Math.min(1, dt * 6);
    this.y = damp(this.y, w.heightAt(this.x, this.z), 14, dt);
    this.root.position.set(this.x, this.y, this.z); this.root.rotation.y = this.facing;
    this.model.update(dt, { speed: this.speed, windup: this.state === 'windup', attacking: this.state === 'attack', hurt: this.hurt, dead: false, guard: this.guarding, combat: !!tgt });
  }

  takeHit(dmg, from, opts = {}) {
    if (this.dead) return 0;
    let d = dmg;
    if (this.guarding && Math.abs(angleDiff(this.facing, Math.atan2(from.x - this.x, from.z - this.z))) < 1.2 && !opts.skill) {
      d = Math.round(d * 0.35); this.game.onRead?.(this, 'BLOCK');
    }
    this.hp -= d; this.hurt = 1; this.aggro = from;
    if (opts.skill || opts.combo === 2) { this.stagger = 0.45; const a = Math.atan2(this.x - from.x, this.z - from.z); this.vx = Math.sin(a) * 6; this.vz = Math.cos(a) * 6; if (this.state === 'windup' || this.state === 'attack') { this.state = 'stagger'; this.game.attackTokens++; } }
    this.game.onEnemyHit?.(this, d, from, opts);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.game.onEnemyDeath?.(this, from); if (this.state === 'windup' || this.state === 'attack') this.game.attackTokens++; }
    return d;
  }
  dispose() { this.disposed = true; this.game.scene.remove(this.root); }
}

// The floor boss: a Q-learning agent choosing among six moves. Each move is
// scored by the damage it dealt minus the damage the boss took while doing
// it, and the Q-table persists between attempts.
export class Boss extends Enemy {
  constructor(game, level, arena, qtable) {
    super(game, 'boss', level, { x: arena.x, z: arena.z, r: 4 });
    game.scene.remove(this.root);
    this.model = new ConstructHumanoid('boss', 'axe');
    this.root = this.model.root; game.scene.add(this.root);
    this.radius = 1.3;
    this.maxHp = Math.round(SPECIES.boss.hp * (1 + (level - 1) * 0.12)); this.hp = this.maxHp;
    this.atk = SPECIES.boss.atk * (1 + (level - 1) * 0.12);
    this.bars = 4;
    this.q = new QLearner(); if (qtable) this.q.load(qtable);
    this.move = null; this.moveT = 0; this.dealt = 0; this.taken = 0;
    this.phase = 0; this.active = false;
    this.arena = arena;
    this.place(arena.x, arena.z - 4);
    this.facing = 0;
    this.telegraph = null;
  }
  get bar() { return Math.ceil((this.hp / this.maxHp) * this.bars); }
  stateKey() {
    const p = this.target || this.game.player;
    const d = Math.hypot(p.x - this.x, p.z - this.z);
    const act = { slash: 'slash', rising: 'skill', twinfang: 'skill', comet: 'skill', roll: 'roll', guard: 'guard' }[p.lastAction] || 'idle';
    return QLearner.state({ dist: d, playerAct: act, hpPhase: this.hp / this.maxHp > 0.5 ? 0 : this.hp / this.maxHp > 0.25 ? 1 : 2, playerHp: p.hp / p.maxHp, skillReady: (p.sp || 0) > 30 });
  }
  update(dt) {
    const g = this.game;
    if (this.dead) { super.update(dt); return; }
    if (!this.active) {
      // waits in the arena, breathing, until the party steps inside
      this.root.position.set(this.x, this.y, this.z); this.root.rotation.y = this.facing;
      this.model.update(dt, { speed: 0, combat: false });
      return;
    }
    this.t += dt; this.hurt = Math.max(0, this.hurt - dt * 3); this.stagger -= dt;
    const p = this.aggro && !this.aggro.dead ? this.aggro : g.player;
    this.target = p;
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    const face = Math.atan2(dx, dz);
    if (this.hp / this.maxHp < 0.25 && this.phase === 0) {
      this.phase = 1; this.model.setWeapon('talwar'); g.onBossPhase?.(this);
      this.move = null;
    }
    let mx = 0, mz = 0, spd = 0;
    if (!this.move && this.stagger <= 0) {
      this.s0 = this.stateKey();
      this.a0 = this.q.choose(this.s0);
      this.move = BOSS_MOVES[this.a0]; this.moveT = 0; this.dealt = 0; this.taken = 0; this.struck = false;
      g.onBossMove?.(this, this.move);
    }
    const fast = this.phase ? 1.35 : 1;
    if (this.move) {
      this.moveT += dt * fast;
      const T = this.moveT;
      switch (this.move) {
        case 'cleave': {
          if (T < 0.7) { this.facing += angleDiff(this.facing, face) * Math.min(1, dt * 6); spd = d > 3 ? 3 : 0; mx = dx / d; mz = dz / d; this.wind = true; }
          if (T > 0.7 && !this.struck) { this.struck = true; this.wind = false; this.model.play(CLIPS.slash2, 0.9); this.area(this.sp.range + 0.6, 1.3, 1.2, 5); g.audio?.play('heavy'); }
          if (T > 1.4) this.endMove();
          break;
        }
        case 'slam': {
          if (T < 0.05 && !this.telegraph) this.telegraph = g.fx.rings.spawn(this.x, this.y, this.z, '#ff3a2a', 4.5, 4.5, 99, true), this.telegraph.hold = true;
          this.wind = T < 1.0;
          if (T > 1.0 && !this.struck) { this.struck = true; this.model.play(CLIPS.slash3, 0.8); g.fx.rings.kill(this.telegraph); this.telegraph = null; this.area(4.5, Math.PI, 1.6, 9, true); g.fx.rings.spawn(this.x, this.y, this.z, '#ffb070', 1, 6, 0.5); g.cam.shake(0.5, 0.4); g.audio?.play('slam'); }
          if (T > 1.8) this.endMove();
          break;
        }
        case 'charge': {
          if (T < 0.5) { this.facing += angleDiff(this.facing, face) * Math.min(1, dt * 8); this.wind = true; }
          else if (T < 1.1) { this.wind = false; spd = 15; mx = Math.sin(this.facing); mz = Math.cos(this.facing); if (!this.struck && d < 2.2) { this.struck = true; this.area(2.4, 1.0, 1.4, 10); } }
          if (T > 1.5) this.endMove();
          break;
        }
        case 'guard': this.guarding = true; this.facing += angleDiff(this.facing, face) * Math.min(1, dt * 8); if (T > 1.2) { this.guarding = false; this.endMove(); } break;
        case 'retreat': if (T < 0.5) { spd = 9; mx = -dx / d; mz = -dz / d; } if (T > 0.9) this.endMove(); break;
        case 'roar':
          if (T < 0.1 && !this.struck) { this.struck = true; g.onBossRoar?.(this); g.cam.shake(0.3, 0.8); }
          if (T > 1.3) this.endMove();
          break;
      }
    }
    if (this.move !== 'cleave' && this.move !== 'charge' && !this.wind && d > 3.2 && this.move !== 'retreat' && this.move !== 'guard') { mx = dx / d; mz = dz / d; spd = this.sp.speed * fast; }
    this.vx = damp(this.vx, mx * spd, 8, dt); this.vz = damp(this.vz, mz * spd, 8, dt);
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const ar = Math.hypot(nx - this.arena.x, nz - this.arena.z);
    if (ar > this.arena.r - 1.5) { const k = (this.arena.r - 1.5) / ar; nx = this.arena.x + (nx - this.arena.x) * k; nz = this.arena.z + (nz - this.arena.z) * k; }
    this.speed = Math.hypot(nx - this.x, nz - this.z) / dt;
    this.x = nx; this.z = nz;
    if (!this.wind && this.speed > 0.5 && this.move !== 'retreat') this.facing += angleDiff(this.facing, Math.atan2(this.vx, this.vz)) * Math.min(1, dt * 6);
    this.y = this.game.world.heightAt(this.x, this.z);
    this.root.position.set(this.x, this.y, this.z); this.root.rotation.y = this.facing;
    this.model.update(dt, { speed: this.speed, windup: this.wind, guard: this.guarding, combat: true, hurt: this.hurt * 0.4 });
  }
  area(range, arc, mult, knock, unblockable = false) {
    for (const p of this.game.party) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      const da = angleDiff(this.facing, Math.atan2(p.x - this.x, p.z - this.z));
      if (d < range + 0.5 && Math.abs(da) < arc) {
        const { dmg } = rollDamage(this.atk * this.game.director.damageMul, mult, p.def);
        this.dealt += p.takeHit(dmg, this, { knock, unblockable });
      }
    }
  }
  endMove() {
    // Q-learning update: reward = damage dealt (scaled) - damage taken
    const r = clamp((this.dealt / 80) - (this.taken / 120), -2, 2);
    const s1 = this.stateKey();
    this.q.learn(this.s0, this.a0, r, s1, this.dead);
    this.game.onBossLearn?.(this, this.move, r);
    this.move = null; this.wind = false;
  }
  takeHit(dmg, from, opts = {}) {
    if (!this.active || this.dead) return 0;
    let d = dmg;
    if (this.guarding && Math.abs(angleDiff(this.facing, Math.atan2(from.x - this.x, from.z - this.z))) < 1.3) { d = Math.round(d * 0.15); this.game.onRead?.(this, 'BLOCK'); }
    this.hp -= d; this.taken += d; this.hurt = 1; this.aggro = from;
    this.game.onEnemyHit?.(this, d, from, opts);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; if (this.move) this.endMove(); this.game.onBossDeath?.(this, from); }
    return d;
  }
}
