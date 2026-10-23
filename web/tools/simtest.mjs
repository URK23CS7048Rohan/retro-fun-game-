// Drives the game simulation directly (no rendering) to check the logic.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, url] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(url);
await p.waitForFunction(() => window.__titleReady, null, { timeout: 1800000, polling: 2000 });
const out = await p.evaluate(async () => {
  const g = window.__game, R = {};
  const step = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) g.update(dt); };
  document.querySelector('#hud').classList.remove('hidden');
  // walk north out of town
  g.input.keys.add('w'); step(90); g.input.keys.delete('w');
  R.walk = { x: +g.player.x.toFixed(2), z: +g.player.z.toFixed(2), speed: +g.player.speed.toFixed(2) };
  // fight: put the player beside a boar and swing
  const e = g.enemies.find((m) => m.kind === 'boar' && !m.dead);
  if (e) {
    g.player.place(e.x - 1.2, e.z, Math.atan2(1.2, 0));
    const hp0 = e.hp; let swings = 0;
    for (let i = 0; i < 600 && !e.dead; i++) {
      if (i % 8 === 0) { g.input.pressed.add('attack'); swings++; }
      if (i % 90 === 0) g.input.pressed.add('skill1');
      g.player.facing = Math.atan2(e.x - g.player.x, e.z - g.player.z);
      step(1);
      if (Math.hypot(e.x - g.player.x, e.z - g.player.z) > 2) g.player.place(e.x - Math.sin(g.player.facing) * 1.3, e.z - Math.cos(g.player.facing) * 1.3, g.player.facing);
    }
    R.fight = { kind: e.kind, hp0, hp: e.hp, dead: e.dead, swings, playerHp: g.player.hp, xp: g.player.xp, level: g.player.level, col: g.save.col, predictorTotal: g.predictor.history.length, mlpSamples: g.companionBrain.samples };
  }
  // boss: walk into the arena
  const a = g.world.arena;
  g.player.place(a.x, a.z + a.r - 4, Math.PI);
  step(30);
  R.boss = { active: g.boss.active, name: g.boss.name };
  for (let i = 0; i < 300; i++) { if (i % 6 === 0) g.input.pressed.add('attack'); step(1); }
  R.boss.hp = g.boss.hp; R.boss.max = g.boss.maxHp; R.boss.qUpdates = g.boss.q.updates; R.boss.lastMove = g.boss.move; R.playerHp = g.player.hp; R.dead = g.player.dead;
  R.companion = { intent: g.companionBrain.intent, steps: g.companionBrain.net.steps, hp: g.companion.hp };
  g.saveGame();
  R.saved = !!localStorage.getItem('spire-online-save-v1');
  R.nav = g.nav.lastExpanded;
  return R;
});
console.log(JSON.stringify(out, null, 1));
console.log(errs.slice(0, 10).join('\n') || 'no errors');
await b.close();
