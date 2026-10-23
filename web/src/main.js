import { Game, loadSave, newSave } from './game/game.js';

// Boot: load everything behind a loading screen, show the title over the live
// town, let the player pick who they play (and optionally load their own
// .vrm for either hero), then "Link Start".

const $ = (s) => document.querySelector(s);
const QS = new URLSearchParams(location.search);
if (QS.has('capture')) window.__capture = true;

// ---- custom VRMs kept in IndexedDB ----
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('spire-vrm', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('vrm');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function getVRM(key) {
  try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('vrm').objectStore('vrm').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
  catch { return null; }
}
async function putVRM(key, blob) {
  const db = await idb();
  await new Promise((res, rej) => { const t = db.transaction('vrm', 'readwrite'); t.objectStore('vrm').put(blob, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function delVRM(key) { const db = await idb(); await new Promise((res) => { const t = db.transaction('vrm', 'readwrite'); t.objectStore('vrm').delete(key); t.oncomplete = res; }); }

const DEFAULT_HEROES = {
  kirito: {
    name: 'Kirito', color: '#a8b8ff', url: 'models/Seed-san.vrm',
    opts: { weapon: 'elucidator', height: 1.72, gear: { boots: '#1c1d22', coat: '#1d1f26', trim: '#5a6278' }, hide: /arm_mat|arm_plastic|armgear|backpack|anim_logo|green_emit/,
      tint: [{ match: /^hair$/, color: '#2a2a34', shade: '#101018' }, { match: /huku/, color: '#2a2c36', shade: '#121318' }] },
    blurb: 'Black Swordsman. Fast one-handed sword, high burst damage.',
  },
  asuna: {
    name: 'Asuna', color: '#ffe0a8', url: 'models/AvatarSample_B.vrm',
    opts: { weapon: 'rapier', height: 1.64, tint: [{ match: /HAIR/, color: '#f0a060', shade: '#a05030' }, { match: /Tops/, color: '#ffffff', shade: '#d8c8d0' }, { match: /Bottoms/, color: '#d02a30', shade: '#801018' }] },
    blurb: 'The Flash. Rapier thrusts with the quickest recovery.',
  },
};
const TOWNSFOLK = [
  { url: 'models/three-vrm-girl.vrm', tint: (i) => [{ match: /Hair/, color: ['#c89a60', '#6a4a30', '#e0d0b8', '#a04030'][i % 4] }, { match: /Tops/, color: ['#ffffff', '#c8d8a0', '#a8c0e0', '#e0b0a0'][i % 4] }] },
  { url: 'models/three-vrm-girl.vrm', tint: (i) => [{ match: /Hair/, color: ['#3a2a22', '#d8b070', '#8a3a2a'][i % 3] }, { match: /Bottoms/, color: ['#3a4a6a', '#5a3a2a', '#2a4a3a'][i % 3] }] },
];

async function boot() {
  const L = $('#loading'), bar = L.querySelector('.b i'), txt = L.querySelector('.s');
  const progress = (k, s) => { bar.style.width = Math.round(k * 100) + '%'; txt.textContent = s; };
  let save = loadSave() || newSave('kirito');
  // swap in custom VRMs if the player loaded any
  const heroes = JSON.parse(JSON.stringify(DEFAULT_HEROES, (k, v) => (v instanceof RegExp ? { __re: v.source } : v)), (k, v) => (v && v.__re ? new RegExp(v.__re) : v));
  for (const id of ['kirito', 'asuna']) {
    const blob = await getVRM(id);
    if (blob) { heroes[id].url = URL.createObjectURL(blob); heroes[id].opts = { weapon: heroes[id].opts.weapon, height: heroes[id].opts.height }; heroes[id].custom = true; }
  }
  const quality = QS.get('q') || save.settings?.quality || (/Android|iPhone/i.test(navigator.userAgent) ? 'medium' : 'high');
  const game = new Game($('#game'), { save, heroes, townsfolk: TOWNSFOLK, quality });
  window.__game = game;
  try { await game.init(progress); }
  catch (e) { txt.textContent = 'Failed to load: ' + e.message; console.error(e); return; }
  game.resize();
  L.classList.add('hidden');
  title(game, heroes);
  window.__titleReady = true;
}

function title(game, heroes) {
  const T = $('#title');
  T.classList.remove('hidden');
  $('#hud').classList.add('hidden');
  let pick = game.save.hero;
  const cards = T.querySelector('.chars');
  cards.innerHTML = '';
  for (const id of ['kirito', 'asuna']) {
    const h = heroes[id];
    const c = document.createElement('div'); c.className = 'card panel' + (id === pick ? ' on' : '');
    c.innerHTML = `<h4></h4><p></p><label>Load your own .vrm<input type="file" accept=".vrm,model/gltf-binary,application/octet-stream"></label>`;
    c.querySelector('h4').textContent = h.name;
    c.querySelector('p').textContent = h.blurb + (h.custom ? ' (custom model)' : '');
    c.onclick = (e) => { if (e.target.closest('label')) return; pick = id; [...cards.children].forEach((x) => x.classList.remove('on')); c.classList.add('on'); game.audio.start(); game.audio.play('ui'); };
    c.querySelector('input').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      await putVRM(id, f); location.reload();
    };
    if (h.custom) {
      const r = document.createElement('label'); r.textContent = 'Use default'; r.style.marginLeft = '6px';
      r.onclick = async (e) => { e.preventDefault(); await delVRM(id); location.reload(); };
      c.append(r);
    }
    cards.append(c);
  }
  // orbit the plaza while the title is up
  let a = 0, running = true, last = performance.now();
  const w = game.world;
  const loop = (now) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; a += dt * 0.06;
    const cy = w.heightAt(0, 0);
    game.camera.position.set(Math.sin(a) * 15, cy + 5 + Math.sin(a * 0.7) * 1.5, Math.cos(a) * 15 + 10);
    game.camera.lookAt(0, cy + 6, -30);
    game.sky.update(dt, game.camera); w.update(dt, performance.now() / 1000);
    w.grass.update(performance.now() / 1000, game.player.root.position, game.camera.position);
    game.lib.update(game.camera.position); game.atmo.update(dt, performance.now() / 1000, game.camera.position);
    game.player.update(dt, { x: 0, z: 0 }, null); game.companion.update(dt, { x: 0, z: 0 }, null);
    game.npcSystem.update(dt);
    game.renderer.setSun(game.sky.sunPos.clone().add(game.camera.position));
    game.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  $('#start').onclick = async () => {
    game.audio.start(); game.audio.play('gate');
    if (pick !== game.save.hero) swapRoles(game, pick);
    await linkStart();
    running = false;
    T.classList.add('hidden');
    $('#hud').classList.remove('hidden');
    play(game);
  };
}

function swapRoles(game, pick) {
  game.save.hero = pick;
  const [a, b] = [game.player, game.companion];
  game.player = b; game.companion = a;
  game.party = [game.player, game.companion];
  [game.player.level, game.companion.level] = [a.level, b.level];
  game.player.setLevel(game.save.level); game.companion.setLevel(game.save.level);
  game.player.xp = game.save.xp;
}

function linkStart() {
  // the tunnel of coloured light streaks, then a white flash
  return new Promise((res) => {
    const cv = $('#linkstart'); cv.classList.add('on');
    const W = (cv.width = innerWidth), H = (cv.height = innerHeight), c = cv.getContext('2d');
    const streaks = Array.from({ length: 260 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random() * 0.2, v: 0.4 + Math.random() * 1.2, hue: Math.random() * 360, w: 1 + Math.random() * 3 }));
    const t0 = performance.now();
    const frame = (now) => {
      const t = (now - t0) / 1000;
      c.fillStyle = `rgba(0,0,0,${t < 0.3 ? t * 2 : 0.35})`; c.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, R = Math.hypot(W, H) / 2;
      for (const s of streaks) {
        s.r += s.v * (0.016 + t * 0.03);
        if (s.r > 1.2) { s.r = Math.random() * 0.05; s.a = Math.random() * Math.PI * 2; }
        const r0 = Math.pow(s.r, 2) * R, r1 = Math.pow(s.r + 0.06 + t * 0.03, 2) * R;
        c.strokeStyle = `hsla(${s.hue}, 90%, 70%, ${Math.min(1, s.r * 2)})`; c.lineWidth = s.w * (0.5 + s.r);
        c.beginPath(); c.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0); c.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1); c.stroke();
      }
      c.fillStyle = '#fff'; c.font = `700 ${Math.min(64, W * 0.07)}px Saira SC, sans-serif`; c.textAlign = 'center';
      if (t < 1.4) { c.globalAlpha = Math.min(1, t * 3); c.fillText('LINK START', cx, cy + 18); c.globalAlpha = 1; }
      if (t > 1.6) { c.fillStyle = `rgba(255,255,255,${Math.min(1, (t - 1.6) * 3)})`; c.fillRect(0, 0, W, H); }
      if (t < 2.2) requestAnimationFrame(frame);
      else { res(); cv.style.transition = 'opacity 0.6s'; cv.style.opacity = '0'; setTimeout(() => { cv.classList.remove('on'); cv.style.opacity = ''; cv.style.transition = ''; }, 700); }
    };
    requestAnimationFrame(frame);
  });
}

function play(game) {
  game.cam.yaw = game.player.facing + Math.PI; game.cam.pitch = 0.3;
  game.hud.toast('WELCOME TO SPIRE ONLINE', 'FLOOR ' + game.floor + ' · ' + game.areaName(game.player.x, game.player.z).toUpperCase());
  game.log(`${game.player.name} has logged in`);
  setTimeout(() => game.log(`${game.companion.name} has logged in`), 600);
  setTimeout(() => game.log('Party formed: ' + game.player.name + ', ' + game.companion.name), 1200);
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    game.update(dt);
    game.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.saveGame(); });
}

boot();
