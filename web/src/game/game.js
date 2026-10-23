import * as THREE from 'three';
import { Renderer } from '../engine/renderer.js';
import { Sky } from '../engine/sky.js';
import { setAnisotropy } from '../engine/pbr.js';
import { HDWorld } from '../world/hdworld.js';
import { PropLibrary, PROP_IDS } from '../world/props.js';
import { dressWorld, buildStrings } from '../world/dressing.js';
import { Atmosphere } from '../world/atmosphere.js';
import { NavGrid } from '../ai/nav.js';
import { MarkovPredictor } from '../ai/markov.js';
import { Director } from '../ai/director.js';
import { Fighter } from './fighter.js';
import { CompanionBrain, companionUpdate, features } from './companion.js';
import { Enemy, Boss } from './enemies.js';
import { SKILL_SLOTS, xpToNext, SHARD_COLORS } from './combat.js';
import { SPECIES } from './monsters.js';
import { Input } from './input.js';
import { FollowCam } from './camera.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { Shards, Rings, Pillar, Popups } from './fx.js';
import { NPCs } from './npc.js';
import { RNG, angleDiff } from '../core/rng.js';

const SAVE_KEY = 'spire-online-save-v1';

export function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.v === 1) return s; } catch {}
  return null;
}
export function newSave(hero) {
  return { v: 1, hero, level: 1, xp: 0, col: 300, potions: 5, crystals: 2, floor: 1, maxFloor: 1, kills: 0, models: {}, settings: null };
}

export class Game {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts;
    this.save = opts.save;
    this.settings = Object.assign({ quality: opts.quality || 'medium', retro: false, music: true, sfx: true, aiPopups: true }, this.save.settings || {});
    this.renderer = new Renderer(canvas, { quality: this.settings.quality });
    setAnisotropy(Math.min(8, this.renderer.r.capabilities.getMaxAnisotropy()));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
    this.renderer.setup(this.scene, this.camera);
    this.applyQuality();
    this.audio = new Audio();
    this.input = new Input(document.getElementById('ui'));
    this.hud = new HUD(this);
    this.predictor = new MarkovPredictor(3);
    this.predictor.load(this.save.models.markov);
    this.director = new Director(); this.director.load(this.save.models.director);
    this.companionBrain = new CompanionBrain(this.save.models.mlp);
    this.enemies = []; this.npcs = []; this.party = [];
    this.attackTokens = 2;
    this.t = 0; this.paused = false; this.hitstop = 0;
    this.lib = new PropLibrary('props/');
    addEventListener('resize', () => this.resize());
  }
  applyQuality() {
    const q = this.settings.quality;
    this.renderer.maxPR = q === 'high' ? 1.6 : q === 'medium' ? 1.15 : 0.8;
    this.grassDensity = q === 'high' ? 1 : q === 'medium' ? 0.55 : 0.3;
    this.renderer.r.shadowMap.enabled = q !== 'low';
    this.renderer.bloom.enabled = q !== 'low';
    this.renderer.setRetro(!!this.settings.retro);
  }
  setSetting(k, v) {
    this.settings[k] = v;
    if (k === 'quality') { this.applyQuality(); this.resize(); this.log('Graphics quality changes fully apply on the next floor load'); }
    if (k === 'retro') this.renderer.setRetro(v);
    if (k === 'music') this.audio.musicOn = v;
    if (k === 'sfx') this.audio.on = v;
    this.save.settings = this.settings;
    this.saveGame();
  }
  resize() { this.renderer.resize(innerWidth, innerHeight); }
  log(t) { this.hud.log(t); }

  async init(progress) {
    progress(0.05, 'Loading props');
    await this.lib.load(PROP_IDS);
    progress(0.35, 'Loading characters');
    const { makeVRMCharacter } = await import('../chars/vrmchar.js');
    const H = this.opts.heroes;
    const me = H[this.save.hero], mate = H[this.save.hero === 'kirito' ? 'asuna' : 'kirito'];
    const pm = await makeVRMCharacter(me.url, me.opts);
    progress(0.5, 'Loading characters');
    const cm = await makeVRMCharacter(mate.url, mate.opts);
    this.player = new Fighter(this, pm, { name: me.name, level: this.save.level, color: me.color });
    this.player.xp = this.save.xp;
    this.companion = new Fighter(this, cm, { name: mate.name, level: Math.max(1, this.save.level), color: mate.color });
    this.party = [this.player, this.companion];
    this.scene.add(pm.root, cm.root);
    this.cam = null;
    progress(0.6, 'Generating floor');
    await this.loadFloor(this.save.floor, progress);
    this.npcSystem = new NPCs(this);
    await this.npcSystem.spawn(this.opts.townsfolk || [], this.settings.quality === 'low' ? 2 : this.settings.quality === 'medium' ? 4 : 7);
    progress(1, 'Link start');
  }

  async loadFloor(n, progress = () => {}) {
    if (this.world) {
      this.scene.remove(this.world.group, this.dressing, this.strings, this.atmo.group, this.sky.mesh);
      for (const e of this.enemies) e.dispose();
      this.enemies = [];
      this.lib.chunks = [];
    }
    this.floor = n;
    this.save.floor = n;
    const sky = (this.sky = new Sky());
    this.scene.add(sky.mesh);
    this.scene.environment = sky.envMap(this.renderer.r);
    this.scene.fog = new THREE.FogExp2('#e9a86c', 0.0058);
    progress(0.65, 'Generating floor ' + n);
    await new Promise((r) => setTimeout(r, 0));
    const w = (this.world = new HDWorld(n, { grassDensity: this.grassDensity }));
    this.scene.add(w.group);
    w.grass.setLighting({ sunDir: sky.sunDir, sunCol: '#ffbe78', amb: '#7080b0', fogColor: '#e9a86c', fogDensity: 0.0058 });
    progress(0.78, 'Dressing the town');
    await new Promise((r) => setTimeout(r, 0));
    this.dressing = dressWorld(w, this.lib); this.scene.add(this.dressing);
    this.strings = buildStrings(w); this.scene.add(this.strings);
    this.atmo = new Atmosphere(w, this.scene);
    progress(0.86, 'Baking navigation');
    await new Promise((r) => setTimeout(r, 0));
    this.nav = new NavGrid(w, 1.5, 120);
    if (!this.lights) {
      this.hemi = new THREE.HemisphereLight('#9fb0e8', '#6a5030', 1.1);
      this.sun = new THREE.DirectionalLight('#ffc888', 3.2);
      this.sun.castShadow = true;
      const sz = this.settings.quality === 'high' ? 2048 : 1024;
      this.sun.shadow.mapSize.set(sz, sz);
      const sc = this.sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 260;
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
      this.fill = new THREE.DirectionalLight('#ffe0c8', 0.9);
      this.scene.add(this.hemi, this.sun, this.sun.target, this.fill);
      this.lights = true;
    }
    if (!this.cam) this.cam = new FollowCam(this.camera, w); else this.cam.world = w;
    this.fx = { shards: new Shards(this.scene), rings: new Rings(this.scene), pillar: new Pillar(this.scene), popups: new Popups(document.getElementById('overlay'), this.camera) };
    // spawn party in the plaza
    const [sx, sz] = w.spawnPoint;
    this.player.place(sx, sz, Math.PI);
    this.companion.place(sx - 1.2, sz + 1.2, Math.PI);
    for (const p of this.party) if (p.dead) p.revive(1);
    // monsters and the boss
    this.spawnT = 0;
    this.boss = new Boss(this, n * 3 + 5, w.arena, this.save.models['boss' + ((n - 1) % 5)]);
    this.boss.name = n === 1 ? 'Illfang the Kobold Lord' : ['Asterius the Taurus King', 'Nerius the Evil Treant', 'Wythege the Hippocampus', 'Fuscus the Vacant Colossus'][(n - 2) % 4];
    this.bossQ = this.boss.q;
    this.enemies.push(this.boss);
    for (const z of w.spawnZones) for (let i = 0; i < z.max; i++) this.spawnIn(z);
    this.cleared = !!(this.save.cleared || {})[n];
    if (this.cleared) { this.boss.dead = true; this.boss.root.visible = false; }
    this.hud?.toast(`FLOOR ${n}`, n === 1 ? 'TOWN OF BEGINNINGS' : w.biome?.name?.toUpperCase?.() || '');
  }
  spawnIn(z) {
    const lvl = this.floor * 3 - 2 + ({ kobold: 3, wolf: 1, scarecrow: 1, summoner: 5 }[z.kind] || 0) + Math.round(this.director.skill);
    const e = new Enemy(this, z.kind, Math.max(1, lvl), z);
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * 6.28, r = Math.random() * z.r;
      const x = z.x + Math.cos(a) * r, zz = z.z + Math.sin(a) * r;
      if (!this.world.blocked(x, zz, 0.8)) { e.place(x, zz); break; }
    }
    this.enemies.push(e);
    return e;
  }

  // ---------- queries ----------
  foesOf(f) { return f.team === 'party' ? this.enemies.filter((e) => !e.dead && (e.kind !== 'boss' || e.active)) : this.party; }
  inSafeZone(x, z) { return Math.hypot(x, z) < this.world.townR + 1; }
  areaName(x, z) {
    const w = this.world;
    if (this.inSafeZone(x, z)) return this.floor === 1 ? 'Town of Beginnings' : `Floor ${this.floor} Town`;
    if (Math.hypot(x - w.arena.x, z - w.arena.z) < w.arena.r + 6) return 'Labyrinth Gate';
    if (w.pathDist(x, z) < 6) return 'Pilgrim Road';
    return w.noise.fbm(x * 0.02 + 50, z * 0.02 + 50, 3) > 0.1 ? 'Whispering Woods' : 'Western Fields';
  }

  // ---------- combat events ----------
  popup(obj, text, cls, y = 1.9) { this.fx.popups.spawn(new THREE.Vector3(obj.x, obj.y + y, obj.z), text, cls); }
  onSkill(f, sk) {
    this.audio.play('skill');
    this.popup(f, sk.name.toUpperCase(), 'skill', 2.3);
    if (f === this.player) this.recordPlayer(sk.id === 'hsquare' ? 'twinfang' : sk.clip, 'skill');
  }
  onStrike(f, hits) { this.cam.shake(0.08, 0.1); }
  onEnemyHit(e, d, from, opts) {
    this.popup(e, String(d), opts.crit ? 'crit' : '', e.kind === 'boss' ? 3.8 : 1.6);
    this.audio.play(opts.crit ? 'crit' : 'hit');
    this.hitstop = opts.skill ? 0.07 : 0.04;
    this.fx.shards.burst(e.x, e.y + (e.kind === 'boss' ? 2.5 : 0.9), e.z, opts.skill ? 10 : 4, [SPECIES[e.kind].seam, '#ffffff'], 0.6, 0.6);
    if (from === this.player) this.lock = e.kind === 'boss' ? null : e;
  }
  onEnemyDeath(e, from) {
    this.audio.play('shatter');
    const sp = SPECIES[e.kind];
    this.fx.shards.burst(e.x, e.y + 0.8, e.z, 70, SHARD_COLORS(sp.seam, sp.body), 1.2, 1.2);
    setTimeout(() => { e.root.visible = false; }, 60);
    const xp = Math.round(sp.xp * (1 + e.level * 0.15)), col = Math.round(sp.col * (0.8 + Math.random() * 0.5));
    this.grantXP(xp); this.save.col += col; this.save.kills++;
    this.popup(e, `+${xp} EXP  +${col} Col`, 'xp', 1.2);
    // drops with a pity counter so dry streaks don't last
    this.pity = (this.pity || 0) + 1;
    if (Math.random() < 0.18 + this.pity * 0.04) { this.pity = 0; this.save.potions++; this.log('Dropped: Healing Potion'); }
    // director: how cleanly was it won? (hp lost during the fight)
    const lost = (this.fightStartHp ?? this.player.hp) - this.player.hp;
    this.director.observe(Math.max(0, 1 - lost / (this.player.maxHp * 0.4)), (e.level - this.player.level) * 0.25);
    this.fightStartHp = this.player.hp;
    if (this.lock === e) this.lock = null;
    setTimeout(() => { const i = this.enemies.indexOf(e); if (i >= 0) { e.dispose(); this.enemies.splice(i, 1); } }, 1500);
  }
  onDamaged(f, d, from) {
    if (f === this.player) {
      this.popup(f, String(d), 'hurt', 1.9);
      this.audio.play('hurt'); this.cam.shake(0.25, 0.25);
      this.hurtFlash = 1;
      this.director.hurt(d / f.maxHp);
      if (from.kind === 'boss' && this.boss) this.boss.dealt += 0; // counted in Boss.area
    } else this.popup(f, String(d), 'hurt', 1.8);
  }
  onParry(f, from) {
    this.audio.play('parry');
    this.popup(f, 'PARRY', 'read', 2.2);
    from.stagger = 1.0;
    if (from.state === 'attack' || from.state === 'windup') { from.state = 'stagger'; this.attackTokens++; }
    this.fx.shards.burst(f.x, f.y + 1.3, f.z, 14, ['#ffffff', '#9ce8ff'], 0.6, 0.5);
    this.hitstop = 0.12;
  }
  onHeal(f, amt) { this.popup(f, '+' + Math.round(amt), 'heal', 2); this.audio.play('potion'); }
  onRead(e, what) { if (this.settings.aiPopups) this.popup(e, what === 'FEINT' ? 'READ: FEINT' : what, 'read', e.kind === 'boss' ? 4 : 1.8); }
  onAggro(e) { if (!this.fightStartHp) this.fightStartHp = this.player.hp; }
  onDeath(f) {
    if (f === this.player) {
      this.hud.toast('YOU DIED', 'RESPAWNING IN TOWN');
      this.director.observe(0, 1);
      setTimeout(() => { this.save.col = Math.floor(this.save.col * 0.85); this.toTown(); this.player.revive(1); }, 3500);
    } else { f.downT = 12; this.log(`${f.name} has fallen`); }
  }
  onBossMove(b, m) { if (this.settings.aiPopups && Math.random() < 0.35) this.popup(b, 'Q: ' + m.toUpperCase(), 'read', 4.4); }
  onBossLearn() {}
  onBossPhase(b) { this.hud.toast(b.name.toUpperCase(), 'SWITCHES TO A TALWAR'); this.audio.play('heavy'); }
  onBossRoar(b) {
    this.log(`${b.name} calls for help`);
    for (let i = 0; i < 2; i++) { const e = this.spawnIn({ x: b.x, z: b.z, r: 6, kind: 'kobold', max: 1 }); e.aggro = this.player; e.state = 'chase'; }
  }
  onBossDeath(b) {
    this.audio.play('fanfare');
    this.fx.shards.burst(b.x, b.y + 2.5, b.z, 260, SHARD_COLORS('#ff2a3a', '#2a1414'), 2.2, 2);
    setTimeout(() => (b.root.visible = false), 80);
    this.grantXP(SPECIES.boss.xp * this.floor); this.save.col += SPECIES.boss.col * this.floor;
    this.save.cleared = this.save.cleared || {}; this.save.cleared[this.floor] = true;
    this.save.maxFloor = Math.max(this.save.maxFloor, this.floor + 1);
    this.cleared = true;
    this.hud.toast('CONGRATULATIONS', `FLOOR ${this.floor} CLEARED · FLOOR ${this.floor + 1} UNLOCKED AT THE TELEPORT GATE`);
    this.log(`Last attack bonus: ${this.player.name}`);
    this.saveGame();
  }
  grantXP(x) {
    const p = this.player;
    p.xp += x;
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.setLevel(p.level + 1); p.hp = p.maxHp; p.sp = p.maxSp;
      this.companion.setLevel(p.level);
      this.fx.pillar.fire(p.x, p.y, p.z, '#ffd27a');
      this.audio.play('levelup');
      this.hud.toast('LEVEL UP', `LV ${p.level}`);
    }
    this.save.level = p.level; this.save.xp = p.xp;
  }
  recordPlayer(action, intent) {
    this.predictor.observe(action);
    const t = this.lock || this.nearestEnemy(this.player, 10);
    if (t) this.companionBrain.record(features(this.player, t, this.companion, this), intent);
  }
  nearestEnemy(f, maxD = 12, front = false) {
    let best = null, bd = maxD;
    for (const e of this.enemies) {
      if (e.dead || (e.kind === 'boss' && !e.active)) continue;
      const d = Math.hypot(e.x - f.x, e.z - f.z);
      const da = Math.abs(angleDiff(f.facing, Math.atan2(e.x - f.x, e.z - f.z)));
      const score = d + (front ? da * 3 : 0);
      if (d < maxD && score < bd) { bd = score; best = e; }
    }
    return best;
  }
  toTown() { const [x, z] = this.world.spawnPoint; this.player.place(x, z, Math.PI); this.companion.place(x - 1, z + 1, Math.PI); this.lock = null; if (this.boss?.active && !this.boss.dead) this.resetBoss(); }
  resetBoss() { const b = this.boss; b.active = false; b.hp = b.maxHp; b.phase = 0; b.model.setWeapon('axe'); b.place(this.world.arena.x, this.world.arena.z - 4); b.move = null; }
  async changeFloor(n) {
    this.paused = true;
    const L = document.getElementById('loading'); L.classList.remove('hidden');
    const bar = L.querySelector('.b i'), txt = L.querySelector('.s');
    this.saveGame();
    await this.loadFloor(n, (k, s) => { bar.style.width = k * 100 + '%'; txt.textContent = s; });
    L.classList.add('hidden');
    this.paused = false;
    this.audio.play('gate');
  }
  saveGame() {
    const s = this.save;
    s.level = this.player.level; s.xp = this.player.xp;
    s.models.markov = this.predictor.toJSON();
    s.models.mlp = this.companionBrain.net.toJSON();
    s.models.director = this.director.toJSON();
    if (this.boss) s.models['boss' + ((this.floor - 1) % 5)] = this.boss.q.toJSON();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { console.warn('save failed', e); }
  }

  // ---------- frame ----------
  update(dt) {
    const inp = this.input, p = this.player;
    if (inp.pressed.has('menu')) this.hud.toggleMenu();
    if (this.paused) { inp.endFrame(); return; }
    this.t += dt;
    let sdt = dt;
    if (this.hitstop > 0) { this.hitstop -= dt; sdt = dt * 0.08; }
    // camera-relative movement
    const look = inp.consumeLook();
    const mv = inp.moveVec;
    const { f, r } = this.cam.basis();
    const move = { x: f.x * -mv.y + r.x * mv.x, z: f.z * -mv.y + r.z * mv.x };
    // actions
    const P = inp.pressed;
    if (P.has('lock')) { this.lock = this.lock ? null : this.nearestEnemy(p, 16, true); this.audio.play('ui'); }
    if (this.lock && (this.lock.dead || Math.hypot(this.lock.x - p.x, this.lock.z - p.z) > 22)) this.lock = null;
    const target = this.lock || (this.boss?.active && !this.boss.dead ? this.boss : null);
    const autoFace = target || this.nearestEnemy(p, 4, true);
    if (P.has('attack')) { if (p.act('attack')) this.recordPlayer('slash', 'attack'); }
    SKILL_SLOTS.forEach((id, i) => { if (P.has('skill' + (i + 1))) p.act('skill', id); });
    if (P.has('roll')) { if (p.act('roll', Math.hypot(move.x, move.z) > 0.1 ? move : null)) this.recordPlayer('roll', 'reposition'); }
    const guardHeld = inp.held.has('guard');
    if (guardHeld && p.state.type !== 'guard') { if (p.act('guard', true)) this.recordPlayer('guard', 'guard'); }
    else if (!guardHeld && p.state.type === 'guard') p.act('guard', false);
    if (P.has('potion') && this.save.potions > 0 && p.hp < p.maxHp) { if (p.act('potion', 0.4)) { this.save.potions--; this.recordPlayer('roll', 'support'); } }
    if (P.has('switch') && this.companion && !this.companion.dead) {
      const t = target || this.nearestEnemy(p, 10);
      if (t) {
        this.companionBrain.switchTarget = t; this.companionBrain.switchT = 1.2;
        t.aggro = this.companion;
        p.iframes = 0.5; p.act('roll', { x: -Math.sin(p.facing), z: -Math.cos(p.facing) });
        this.popup(this.companion, 'SWITCH!', 'skill', 2.3);
        this.audio.play('skill');
      }
    }
    if (P.has('interact') && this.interaction) this.interaction.run();

    p.update(sdt, move, autoFace);
    companionUpdate(this.companion, this.companionBrain, this, sdt);
    // boss arena trigger
    const b = this.boss, w = this.world;
    if (b && !b.dead && !b.active && Math.hypot(p.x - w.arena.x, p.z - w.arena.z) < w.arena.r - 3) {
      b.active = true; this.fightStartHp = p.hp;
      this.hud.toast(b.name.toUpperCase(), 'BOSS BATTLE');
      this.audio.play('heavy');
      this.log('The arena seals behind you');
    }
    if (b && b.active && !b.dead) {
      // keep the party inside the ring while the fight is on
      for (const m of this.party) {
        const d = Math.hypot(m.x - w.arena.x, m.z - w.arena.z), lim = w.arena.r - 1;
        if (d > lim) { m.x = w.arena.x + (m.x - w.arena.x) * lim / d; m.z = w.arena.z + (m.z - w.arena.z) * lim / d; }
      }
      if (p.dead) this.resetBoss();
    }
    for (const e of this.enemies) e.update(sdt);
    this.attackTokens = Math.max(0, Math.min(2 + Math.round(this.director.aggression * 2), this.attackTokens));
    // respawn the field slowly, more when the director thinks you're doing well
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 6;
      for (const z of w.spawnZones) {
        const alive = this.enemies.filter((e) => e.zone === z && !e.dead).length;
        const want = Math.round(z.max * this.director.densityMul);
        if (alive < want && Math.hypot(p.x - z.x, p.z - z.z) > 25) this.spawnIn(z);
      }
    }
    this.director.update(dt);
    this.npcSystem?.update(dt);
    // interactions: teleport gate, merchant
    this.nearGate = Math.hypot(p.x - w.gate.x, p.z - w.gate.z) < 4;
    this.nearMerchant = w.stalls.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < 2.6);
    this.interaction = this.nearGate ? { label: 'Teleport Gate — tap to choose a floor', run: () => this.hud.openTeleport() }
      : this.nearMerchant ? { label: 'Merchant — tap to trade', run: () => { this.hud.tab = 'items'; this.hud.toggleMenu(true); } } : null;
    if (this.interaction && P.has('attack') && false) this.interaction.run();

    // camera, lights, world
    this.cam.update(dt, p, look, this.lock, Math.hypot(move.x, move.z) > 0.2);
    this.sun.position.set(p.x, p.y, p.z).addScaledVector(this.sky.sunDir, 120);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sky.update(dt, this.camera);
    w.update(dt, this.t);
    w.grass.update(this.t, p.root.position, this.camera.position);
    this.lib.update(this.camera.position);
    this.atmo.update(dt, this.t, this.camera.position);
    this.fx.shards.update(sdt); this.fx.rings.update(dt); this.fx.pillar.update(dt);
    this.fx.popups.update(dt, innerWidth, innerHeight);
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 2);
    const lowHp = p.hp / p.maxHp < 0.25 ? 0.35 + Math.sin(this.t * 6) * 0.15 : 0;
    this.renderer.grade.uniforms.uHurt.value = Math.max(this.hurtFlash, lowHp);
    this.renderer.setSun(this.sky.sunPos.clone().add(this.camera.position));
    this.hud.update(dt);
    this.autosaveT = (this.autosaveT || 0) + dt;
    if (this.autosaveT > 30) { this.autosaveT = 0; this.saveGame(); }
    inp.endFrame();
  }
  render() { this.renderer.render(); }
}
