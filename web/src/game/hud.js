import * as THREE from 'three';
import { SKILLS, SKILL_SLOTS, xpToNext } from './combat.js';
import { INTENTS } from './companion.js';
import { ACTIONS } from '../ai/markov.js';
import { BOSS_MOVES } from '../ai/qlearn.js';

// HUD: status panel with HP/SP, party list, floor/area panel, target or boss
// bars, system log, cursors above heads, touch buttons with cooldown sweeps,
// and the menu (status, items, AI Lab, settings, teleport).

const $ = (s, r = document) => r.querySelector(s);
const pct = (v) => Math.max(0, Math.min(100, v * 100)) + '%';

function setBar(el, frac) {
  const i = el.querySelector('i'), b = el.querySelector('b');
  i.style.width = pct(frac); if (b) b.style.width = pct(frac);
  el.classList.toggle('mid', frac <= 0.5 && frac > 0.2); el.classList.toggle('low', frac <= 0.2);
}

export class HUD {
  constructor(game) {
    this.g = game;
    this.ui = $('#ui');
    this.overlay = $('#overlay');
    this.cursors = new Map();
    this.v = new THREE.Vector3();
    this.logLines = [];
    this.menuOpen = false; this.tab = 'status';
    $('#menuBtn').addEventListener('click', () => this.toggleMenu());
    $('#menu').addEventListener('pointerdown', (e) => { if (e.target.id === 'menu') this.toggleMenu(false); });
    this.labT = 0;
  }
  log(text) {
    const el = $('#log');
    const d = document.createElement('div'); d.textContent = text;
    el.appendChild(d);
    while (el.children.length > 6) el.removeChild(el.firstChild);
    [...el.children].forEach((c, i, a) => c.classList.toggle('old', i < a.length - 3));
  }
  toast(big, small = '') {
    const t = $('#toast');
    t.innerHTML = `<div class="big"></div><div class="small"></div>`;
    t.querySelector('.big').textContent = big; t.querySelector('.small').textContent = small;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }
  update(dt) {
    const g = this.g, p = g.player;
    // status
    $('#s-name').textContent = p.name; $('#s-lv').textContent = 'LV ' + p.level;
    setBar($('#s-hp'), p.hp / p.maxHp); $('#s-hpn').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    setBar($('#s-sp'), p.sp / p.maxSp); $('#s-spn').textContent = `${Math.floor(p.sp)} / ${p.maxSp}`;
    setBar($('#s-xp'), p.xp / xpToNext(p.level));
    const c = g.companion;
    if (c) { $('#m-name').textContent = c.name + (c.dead ? '  (down)' : ''); setBar($('#m-hp'), c.hp / c.maxHp); }
    // area
    const safe = g.inSafeZone(p.x, p.z);
    $('#a-floor').textContent = `Floor ${g.floor}`;
    $('#a-area').textContent = 'Area : ' + g.areaName(p.x, p.z);
    const sz = $('#a-safe'); sz.textContent = safe ? 'In Safe Zone' : 'Outside Safe Zone'; sz.className = safe ? 'safe' : 'danger';
    $('#a-col').textContent = `${g.save.col.toLocaleString()} Col`;
    // target / boss
    const boss = g.boss && g.boss.active && !g.boss.dead ? g.boss : null;
    $('#boss').classList.toggle('hidden', !boss);
    if (boss) {
      $('#b-name').textContent = boss.name;
      const bars = boss.bars, per = boss.maxHp / bars;
      [...$('#boss .bars').children].forEach((el, i) => setBar(el, Math.max(0, Math.min(1, (boss.hp - (bars - 1 - i) * per) / per))));
    }
    const t = !boss && g.lock && !g.lock.dead ? g.lock : null;
    $('#target').classList.toggle('hidden', !t);
    if (t) { $('#t-name').innerHTML = ''; $('#t-name').append(t.name); const em = document.createElement('em'); em.textContent = 'LV ' + t.level; $('#t-name').append(em); setBar($('#t-hp'), t.hp / t.maxHp); }
    // buttons
    SKILL_SLOTS.forEach((id, i) => {
      const b = $('#b-s' + (i + 1)), sk = SKILLS[id], cd = Math.max(0, p.cooldowns[id] || 0);
      b.querySelector('.cd').style.background = cd > 0 ? `conic-gradient(rgba(0,0,0,0.6) ${(cd / sk.cd) * 360}deg, transparent 0)` : '';
      b.classList.toggle('off', p.sp < sk.sp);
    });
    $('#b-potion .count').textContent = g.save.potions;
    $('#b-potion').classList.toggle('off', g.save.potions <= 0);
    $('#b-switch').classList.toggle('off', !c || c.dead);
    // interaction prompt
    const ia = g.interaction;
    $('#interact').classList.toggle('hidden', !ia);
    if (ia) $('#interact').textContent = ia.label;
    this.updateCursors();
    if (this.menuOpen && this.tab === 'lab') { this.labT -= dt; if (this.labT <= 0) { this.labT = 0.25; this.drawLab(); } }
  }
  updateCursors() {
    const g = this.g, w = innerWidth, h = innerHeight, cam = g.camera;
    const live = new Set();
    const show = (key, obj, y, cls, label, frac) => {
      this.v.set(obj.x, obj.y + y, obj.z).project(cam);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) return;
      const d = Math.hypot(obj.x - cam.position.x, obj.z - cam.position.z);
      if (d > 32) return;
      live.add(key);
      let c = this.cursors.get(key);
      if (!c) {
        c = { el: document.createElement('div'), tag: document.createElement('div'), mini: document.createElement('div') };
        c.el.className = 'cursor'; c.tag.className = 'tag'; c.mini.className = 'mini'; c.mini.innerHTML = '<i></i>';
        this.overlay.append(c.el, c.tag, c.mini); this.cursors.set(key, c);
      }
      const x = (this.v.x * 0.5 + 0.5) * w, yy = (-this.v.y * 0.5 + 0.5) * h;
      c.el.className = 'cursor ' + cls;
      c.el.style.transform = `translate(${x}px, ${yy}px)`;
      c.tag.textContent = label; c.tag.style.transform = `translate(${x}px, ${yy - 16}px) translate(-50%, -100%)`;
      c.tag.style.opacity = d < 14 ? 1 : 0;
      c.mini.style.display = frac !== undefined && frac < 1 ? 'block' : 'none';
      c.mini.style.transform = `translate(${x}px, ${yy + 4}px)`;
      if (frac !== undefined) c.mini.firstChild.style.width = pct(frac);
    };
    for (const e of g.enemies) if (!e.dead && (e.kind !== 'boss' || e.active || true)) show('e' + e.id, e, e.kind === 'boss' ? 4.6 : e.kind === 'kobold' ? 2.2 : 1.6, e === g.lock ? 'locked' : '', e.name, e.hp / e.maxHp);
    for (const n of g.npcs) show('n' + n.id, n, n.height + 0.35, 'npc', n.name);
    if (g.companion && !g.companion.dead) show('c', g.companion, 2.0, 'party', g.companion.name);
    for (const [k, c] of this.cursors) if (!live.has(k)) { c.el.remove(); c.tag.remove(); c.mini.remove(); this.cursors.delete(k); }
  }

  // ---------- menu ----------
  toggleMenu(on = !this.menuOpen) {
    this.menuOpen = on;
    $('#menu').classList.toggle('hidden', !on);
    this.g.paused = on;
    this.g.audio?.play('menu');
    if (on) this.renderMenu();
  }
  openTeleport() { this.tab = 'teleport'; this.toggleMenu(true); }
  renderMenu() {
    const g = this.g, p = g.player, s = g.save;
    const tabs = [['status', 'Status'], ['items', 'Items'], ['lab', 'AI Lab'], ['settings', 'Settings']];
    if (g.nearGate) tabs.push(['teleport', 'Teleport']);
    const sheet = $('#menu .sheet');
    sheet.innerHTML = '';
    const head = document.createElement('div'); head.className = 'tabs';
    for (const [id, label] of tabs) {
      const b = document.createElement('button'); b.textContent = label; b.className = this.tab === id ? 'on' : '';
      b.onclick = () => { this.tab = id; this.g.audio?.play('ui'); this.renderMenu(); };
      head.append(b);
    }
    const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => this.toggleMenu(false); head.append(close);
    sheet.append(head);
    const body = document.createElement('div'); sheet.append(body);
    if (this.tab === 'status') {
      const rows = [['Name', p.name], ['Level', p.level], ['EXP', `${Math.floor(p.xp)} / ${xpToNext(p.level)}`], ['HP', `${Math.ceil(p.hp)} / ${p.maxHp}`], ['SP', `${Math.floor(p.sp)} / ${p.maxSp}`],
        ['Attack', Math.round(p.atk)], ['Defense', Math.round(p.def)], ['Highest floor', s.maxFloor], ['Monsters defeated', s.kills], ['Col', s.col.toLocaleString()]];
      body.innerHTML = `<h2>STATUS</h2><div class="grid2"><div class="col1"></div><div class="col2"></div></div>`;
      rows.forEach((r, i) => { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = '<span></span><b></b>'; d.firstChild.textContent = r[0]; d.lastChild.textContent = r[1]; body.querySelector(i < 5 ? '.col1' : '.col2').append(d); });
      const sk = document.createElement('div'); sk.innerHTML = '<h2 style="margin-top:14px">SWORD SKILLS</h2>';
      for (const id of SKILL_SLOTS) { const k = SKILLS[id]; const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = '<span></span><b></b>'; d.firstChild.textContent = k.name; d.lastChild.textContent = `${k.sp} SP · ${k.cd}s · ×${k.mult}`; sk.append(d); }
      body.append(sk);
    } else if (this.tab === 'items') {
      body.innerHTML = '<h2>ITEMS</h2>';
      const items = [['Healing Potion', s.potions, 'Restores 40% HP'], ['Teleport Crystal', s.crystals, 'Returns you to town'], ['Col', s.col, 'Currency']];
      for (const [n, c, desc] of items) { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = '<span></span><b></b>'; d.firstChild.textContent = `${n} — ${desc}`; d.lastChild.textContent = '×' + c; body.append(d); }
      const buy = document.createElement('button'); buy.className = 'act'; buy.textContent = 'Use Teleport Crystal'; buy.style.marginTop = '12px';
      buy.onclick = () => { if (s.crystals > 0 && !g.boss?.active) { s.crystals--; g.toTown(); this.toggleMenu(false); } };
      body.append(buy);
      if (g.nearMerchant) {
        const b2 = document.createElement('button'); b2.className = 'act'; b2.textContent = 'Buy Potion (60 Col)'; b2.style.margin = '12px 0 0 8px';
        b2.onclick = () => { if (s.col >= 60) { s.col -= 60; s.potions++; g.audio?.play('potion'); this.renderMenu(); } };
        body.append(b2);
      }
    } else if (this.tab === 'lab') {
      body.className = 'lab';
      body.innerHTML = `<h2>AI LAB</h2><div class="grid2">
        <div><h3>WHAT THE MONSTERS PREDICT YOU'LL DO NEXT</h3><canvas id="lab-markov" width="360" height="140"></canvas><p id="lab-markov-t"></p></div>
        <div><h3>COMPANION · LEARNED FROM YOUR FIGHTING</h3><canvas id="lab-mlp" width="360" height="140"></canvas><p id="lab-mlp-t"></p></div>
        <div><h3>FLOOR BOSS · Q-VALUES FOR THE CURRENT SITUATION</h3><canvas id="lab-q" width="360" height="140"></canvas><p id="lab-q-t"></p></div>
        <div><h3>AI DIRECTOR · YOUR ESTIMATED SKILL</h3><canvas id="lab-dir" width="360" height="140"></canvas><p id="lab-dir-t"></p></div>
      </div>`;
      this.drawLab();
    } else if (this.tab === 'settings') {
      body.innerHTML = '<h2>SETTINGS</h2>';
      const seg = (label, key, opts) => {
        const row = document.createElement('div'); row.className = 'row-set';
        const l = document.createElement('span'); l.textContent = label; row.append(l);
        const sg = document.createElement('div'); sg.className = 'seg';
        for (const [v, t] of opts) { const b = document.createElement('button'); b.textContent = t; b.className = g.settings[key] === v ? 'on' : ''; b.onclick = () => { g.setSetting(key, v); this.renderMenu(); }; sg.append(b); }
        row.append(sg); body.append(row);
      };
      seg('Graphics quality', 'quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
      seg('Retro filter', 'retro', [[false, 'Off'], [true, 'On']]);
      seg('Music', 'music', [[true, 'On'], [false, 'Off']]);
      seg('Sound effects', 'sfx', [[true, 'On'], [false, 'Off']]);
      seg('Show AI readouts in combat', 'aiPopups', [[true, 'On'], [false, 'Off']]);
      const row = document.createElement('div'); row.className = 'row-set';
      row.innerHTML = '<span>Save and return to title</span>';
      const b = document.createElement('button'); b.className = 'act'; b.textContent = 'Log out'; b.onclick = () => { g.saveGame(); location.reload(); };
      row.append(b); body.append(row);
    } else if (this.tab === 'teleport') {
      body.innerHTML = '<h2>TELEPORT GATE</h2><p style="font-size:12px;color:var(--muted)">Floors unlock as you defeat each floor boss.</p><div class="floors"></div>';
      const fl = body.querySelector('.floors');
      for (let f = 1; f <= Math.min(100, s.maxFloor + 5); f++) {
        const b = document.createElement('button'); b.textContent = 'Floor ' + f; b.disabled = f > s.maxFloor;
        b.onclick = () => { this.toggleMenu(false); g.changeFloor(f); };
        fl.append(b);
      }
    }
  }
  drawLab() {
    const g = this.g;
    const bars = (id, labels, vals, color, hi = -1) => {
      const cv = $('#' + id); if (!cv) return;
      const c = cv.getContext('2d'), W = cv.width, H = cv.height;
      c.clearRect(0, 0, W, H);
      const n = labels.length, bw = (W - 20) / n;
      const mx = Math.max(1e-6, ...vals.map((v) => Math.abs(v)));
      c.font = '11px Saira SC, sans-serif'; c.textAlign = 'center';
      labels.forEach((l, i) => {
        const v = vals[i], hgt = (Math.abs(v) / mx) * (H - 40);
        c.fillStyle = i === hi ? '#ffffff' : color;
        c.fillRect(10 + i * bw + 4, H - 22 - (v >= 0 ? hgt : 0), bw - 8, Math.max(1, hgt));
        c.fillStyle = '#9cb2c8'; c.fillText(l, 10 + i * bw + bw / 2, H - 8);
        c.fillStyle = '#eaf4ff'; c.fillText(v.toFixed(2), 10 + i * bw + bw / 2, H - 26 - hgt);
      });
    };
    const pr = g.predictor.predict();
    bars('lab-markov', ACTIONS, ACTIONS.map((a) => pr.dist[a]), '#ff6a5a', ACTIONS.indexOf(pr.action));
    $('#lab-markov-t') && ($('#lab-markov-t').textContent = `Variable-order Markov model over your last ${g.predictor.history.length} actions. Accuracy so far: ${(g.predictor.accuracy() * 100).toFixed(0)}% of ${g.predictor.total} predictions. Monsters feint when they expect a dodge, and kobolds block when they expect a slash.`);
    const b = g.companionBrain;
    bars('lab-mlp', INTENTS, b.lastProbs, '#6ad4ff', INTENTS.indexOf(b.intent));
    $('#lab-mlp-t') && ($('#lab-mlp-t').textContent = `9-16-12-5 neural network trained on ${b.samples} of your decisions (${b.net.steps} SGD steps, loss ${b.net.loss.toFixed(3)}). She weighs it against common sense less and less as it learns.`);
    const q = g.bossQ;
    if (q) {
      const row = q.lastQ ? q.lastQ.r : BOSS_MOVES.map(() => 0);
      bars('lab-q', BOSS_MOVES, row, '#ffd24a', row.indexOf(Math.max(...row)));
      $('#lab-q-t') && ($('#lab-q-t').textContent = `Tabular Q-learning, ${q.Q.size} states seen, ${q.updates} updates, exploration ε=${q.epsilon.toFixed(2)}. State: ${q.lastQ ? q.lastQ.s : 'not met yet'}. The table is saved, so the boss remembers what worked against you.`);
    }
    const D = g.director, cv = $('#lab-dir');
    if (cv) {
      const c = cv.getContext('2d'), W = cv.width, H = cv.height;
      c.clearRect(0, 0, W, H);
      c.strokeStyle = 'rgba(150,220,255,0.2)'; c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
      const log = D.log; c.strokeStyle = '#8fe04a'; c.lineWidth = 2; c.beginPath();
      log.forEach((e, i) => { const x = (i / Math.max(1, log.length - 1)) * (W - 20) + 10, y = H / 2 - e.skill * 30; i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      $('#lab-dir-t').textContent = `Kalman-filtered skill ${D.skill.toFixed(2)} ± ${Math.sqrt(D.var).toFixed(2)}. Monster aggression ${(D.aggression * 100).toFixed(0)}%, density ×${D.densityMul.toFixed(2)}, damage ×${D.damageMul.toFixed(2)}. A* searched ${g.nav.lastExpanded} cells on the last path.`;
    }
  }
}
