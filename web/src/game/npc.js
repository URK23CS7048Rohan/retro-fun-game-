import * as THREE from 'three';
import { makeVRMCharacter } from '../chars/vrmchar.js';
import { CLIPS } from '../chars/anim.js';
import { angleDiff, damp } from '../core/rng.js';

// Townsfolk: wander between spots in town using A* paths, stop to chat when
// you walk up, and wave. Each one has a few lines, mostly tips about how the
// floor's systems behave.

let NID = 0;
const LINES = [
  ['Argo', ['Info costs Col, but this one\'s free: monsters here learn your habits. Mix it up.', 'Wolves hunt in packs and spread out around you. Keep your back to a wall.', 'The boss keeps a memory of every fight. Win fast before it adapts.']],
  ['Agil', ['Potions at the stalls, 60 Col each. Fair price for a death game.', 'A perfect guard, right as the blow lands, will stagger anything.', 'Switch with your partner when your skills are on cooldown.']],
  ['Sasha', ['The children are safe inside the walls. Monsters never enter town.', 'Rest here and you\'ll recover slowly. Don\'t push your luck out there.']],
  ['Diavel', ['We clear this floor together. The tower door opens at the end of the road north.', 'When the Kobold Lord drops to his last bar, he changes weapons. Watch for it.']],
  ['Yulier', ['The Teleport Gate in the plaza takes you to any floor you\'ve unlocked.', 'Sword skills glow before they fire. So do monster attacks — learn the tells.']],
  ['Thinker', ['Your partner watches how you fight and copies it. Teach her well.', 'Check the AI Lab in the menu if you want to see what the monsters think of you.']],
  ['Nishida', ['There\'s good fishing past the woods, if the boars leave you alone.', 'The Director decides how many monsters roam. Win cleanly and it sends more.']],
];

export class NPCs {
  constructor(game) { this.g = game; this.list = []; }
  async spawn(defs, count) {
    const g = this.g;
    for (let i = 0; i < Math.min(count, defs.length ? 99 : 0); i++) {
      const d = defs[i % defs.length];
      try {
        const m = await makeVRMCharacter(d.url, { height: d.height || 1.6 + Math.random() * 0.15, tint: d.tint?.(i) });
        const [nm, lines] = LINES[i % LINES.length];
        const spot = g.world.npcSpots[i % g.world.npcSpots.length];
        const n = { id: ++NID, model: m, name: nm, lines, x: spot[0], z: spot[1], y: 0, facing: Math.random() * 6, height: m.height, goal: null, path: null, waitT: Math.random() * 4, talkT: 0, line: 0, speed: 0, bubble: null };
        m.teleport(n.x, g.world.heightAt(n.x, n.z), n.z, n.facing);
        g.scene.add(m.root);
        this.list.push(n);
      } catch (e) { console.warn('npc load failed', e); }
    }
    g.npcs = this.list;
  }
  update(dt) {
    const g = this.g, p = g.player, w = g.world;
    for (const n of this.list) {
      const dp = Math.hypot(p.x - n.x, p.z - n.z);
      let mx = 0, mz = 0;
      if (dp < 2.6) {
        // stop and face the player; greet once per visit
        n.facing += angleDiff(n.facing, Math.atan2(p.x - n.x, p.z - n.z)) * Math.min(1, dt * 5);
        if (!n.greeted) { n.greeted = true; n.model.play(CLIPS.wave, 1); n.model.setExpression('happy', 0.8); this.say(n); }
        n.talkT -= dt; if (n.talkT <= 0) this.say(n);
      } else {
        if (dp > 5) { n.greeted = false; n.model.setExpression('happy', 0); this.hush(n); }
        n.waitT -= dt;
        if (!n.goal && n.waitT <= 0) {
          const s = w.npcSpots[Math.floor(Math.random() * w.npcSpots.length)];
          n.goal = s; n.path = g.nav.find(n.x, n.z, s[0], s[1], 1200) || [s];
        }
        if (n.path && n.path.length) {
          const [tx, tz] = n.path[0]; const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz);
          if (d < 0.6) n.path.shift(); else { mx = dx / d; mz = dz / d; }
          if (!n.path.length) { n.goal = null; n.waitT = 3 + Math.random() * 6; }
        }
      }
      const sp = 1.4;
      const tvx = mx * sp, tvz = mz * sp;
      n.vx = damp(n.vx || 0, tvx, 6, dt); n.vz = damp(n.vz || 0, tvz, 6, dt);
      let nx = n.x + n.vx * dt, nz = n.z + n.vz * dt;
      [nx, nz] = w.resolve(nx, nz, 0.35);
      n.speed = Math.hypot(nx - n.x, nz - n.z) / dt; n.x = nx; n.z = nz;
      if (n.speed > 0.2) n.facing += angleDiff(n.facing, Math.atan2(n.vx, n.vz)) * Math.min(1, dt * 6);
      n.y = w.heightAt(n.x, n.z);
      n.model.root.position.set(n.x, n.y, n.z); n.model.root.rotation.y = n.facing;
      const near = Math.hypot(g.camera.position.x - n.x, g.camera.position.z - n.z) < 45;
      n.model.root.visible = near;
      if (near) n.model.update(dt, { speed: n.speed });
      if (n.bubble) this.placeBubble(n);
    }
  }
  say(n) {
    n.talkT = 6;
    const text = n.lines[n.line++ % n.lines.length];
    if (!n.bubble) { n.bubble = document.createElement('div'); n.bubble.className = 'bubble'; document.getElementById('overlay').append(n.bubble); }
    n.bubble.innerHTML = '';
    const b = document.createElement('b'); b.textContent = n.name + ': '; n.bubble.append(b, text);
  }
  hush(n) { if (n.bubble) { n.bubble.remove(); n.bubble = null; } }
  placeBubble(n) {
    const v = new THREE.Vector3(n.x, n.y + n.height + 0.4, n.z).project(this.g.camera);
    if (v.z > 1) { n.bubble.style.display = 'none'; return; }
    n.bubble.style.display = 'block';
    n.bubble.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
  }
}
