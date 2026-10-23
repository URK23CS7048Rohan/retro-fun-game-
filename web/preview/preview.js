import * as THREE from 'three';
import { PS1Renderer } from '../src/render/ps1.js';
import { World } from '../src/world/world.js';
import { Humanoid, CLIPS } from '../src/render/character.js';

const params = new URLSearchParams(location.search);
const floor = +(params.get('floor') || 1);
const shot = params.get('shot') || 'plaza';
const canvas = document.getElementById('c');
const R = new PS1Renderer(canvas);
const scene = new THREE.Scene();
const world = new World(floor);
scene.add(world.group);
const b = world.biome;
scene.fog = new THREE.Fog(b.fog, 30, 230);
scene.add(new THREE.HemisphereLight('#a8bce8', '#6a5a3a', 1.9)); scene.add(new THREE.AmbientLight('#ffe8d8', 0.55));
const fill = new THREE.DirectionalLight(b.fill, 1.15); fill.position.set(30, 40, 60); scene.add(fill);
const sun = new THREE.DirectionalLight(b.sun, 2.4); sun.position.copy(world.sunDir).multiplyScalar(100); scene.add(sun);
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 900);

const hero = new Humanoid('kirito');
const heroine = new Humanoid('asuna');
const kob = new Humanoid('kobold');
const extras = ['klein','lisbeth','silica','heathcliff'].map(n => new Humanoid(n)); extras.forEach(e => { scene.add(e.root); e.root.position.set(400,0,400); });
scene.add(hero.root, heroine.root, kob.root);
const place = (h, x, z, ry) => { h.root.position.set(x, world.heightAt(x, z), z); h.root.rotation.y = ry; };

let t = 0;
function setup() {
  if (shot === 'plaza') {
    place(hero, -1.2, 9, Math.PI + 0.3); place(heroine, 1.2, 9.5, Math.PI - 0.3); place(kob, 300, 300, 0);
    cam.position.set(2.5, world.heightAt(0, 14) + 2.2, 14.5); cam.lookAt(-0.5, world.heightAt(0, 0) + 2.5, 0);
  } else if (shot === 'chars') {
    place(hero, -0.8, 18, 0.25); place(heroine, 0.8, 18, -0.25); place(kob, 300, 300, 0);
    const y = world.heightAt(0, 18);
    cam.position.set(0.3, y + 1.35, 20.7); cam.lookAt(0, y + 1.05, 18);
  } else if (shot === 'field') {
    const z = -45; const px = Math.sin(((45 - 30) / 58) * Math.PI * 1.5) * 14;
    place(hero, px, z, Math.PI); place(heroine, px + 1.5, z + 1, Math.PI); place(kob, px + 2, z - 6, 0);
    hero.play(CLIPS.slash1); hero.clipT = 0.1;
    cam.position.set(px - 3, world.heightAt(px, z + 6) + 3, z + 6); cam.lookAt(px + 1, world.heightAt(px, z) + 1.4, z - 3);
  } else if (shot === 'party') {
    const z0 = 16; const y = world.heightAt(0, z0);
    place(hero, 0, z0, 0.1); place(heroine, 1.1, z0 - 0.6, -0.35); place(kob, 300, 300, 0);
    place(extras[0], -1.2, z0 - 0.8, 0.4); place(extras[1], 2.0, z0 - 1.8, -0.2); place(extras[2], -2.1, z0 - 1.9, 0.3); place(extras[3], 2.6, z0 - 4, Math.PI);
    cam.position.set(0.2, y + 1.25, z0 + 3.4); cam.lookAt(0.3, y + 1.6, z0 - 6);
  } else if (shot === 'face') {
    const z0 = 16; const y = world.heightAt(0, z0);
    place(hero, -0.3, z0, 0.25); place(heroine, 0.32, z0, -0.25); place(kob, 300, 300, 0);
    cam.position.set(0, y + 1.6, z0 + 1.4); cam.lookAt(0, y + 1.5, z0);
  } else if (shot === 'vista') {
    place(hero, 0, -31, Math.PI); place(heroine, 300, 300, 0); place(kob, 300, 300, 0);
    cam.position.set(0, world.heightAt(0, 24) + 3, 24); cam.lookAt(0, 30, -110);
  }
}
setup();
function resize() { R.resize(innerWidth, innerHeight, cam); }
addEventListener('resize', resize); resize();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
  world.update(dt, t);
  for (const h of [hero, heroine, kob, ...extras]) h.update(dt, { speed: 0 });
  R.setSun(world.sunPos, cam);
  if (shot === 'field' && !hero.clip) { hero.play(CLIPS.slash1, 0.0001); hero.clipT = 0.12; }
  R.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__ready = true;
