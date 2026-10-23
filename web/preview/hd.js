import * as THREE from 'three';
import { Renderer } from '../src/engine/renderer.js';
import { Sky } from '../src/engine/sky.js';
import { HDWorld } from '../src/world/hdworld.js';
import { makeVRMCharacter } from '../src/chars/vrmchar.js';
import { CLIPS } from '../src/chars/anim.js';
import { PropLibrary, PROP_IDS } from '../src/world/props.js';
import { dressWorld, buildStrings } from '../src/world/dressing.js';
import { Atmosphere } from '../src/world/atmosphere.js';

const q = new URLSearchParams(location.search);
const shot = q.get('shot') || 'party';
const canvas = document.getElementById('c');
const R = new Renderer(canvas);
R.r.getContext().canvas; 
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
R.setup(scene, cam);
if (q.get('retro')) R.setRetro(true);
const sky = new Sky();
scene.add(sky.mesh);
scene.environment = sky.envMap(R.r);
scene.fog = new THREE.FogExp2('#e9a86c', 0.0062);
const world = new HDWorld(1);
scene.add(world.group);
world.grass.setLighting({ sunDir: sky.sunDir, sunCol: '#ffbe78', amb: '#7080b0', fogColor: '#e9a86c', fogDensity: 0.0062 });

const hemi = new THREE.HemisphereLight('#9fb0e8', '#6a5030', 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffc888', 3.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 260;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#ffe0c8', 0.9); fill.position.set(20, 30, 60); scene.add(fill);

const chars = [];
const place = (c, x, z, ry) => c.teleport(x, world.heightAt(x, z), z, ry);
let lib, atmo;
async function main() {
  lib = new PropLibrary('props/');
  await lib.load(PROP_IDS);
  scene.add(dressWorld(world, lib));
  scene.add(buildStrings(world));
  atmo = new Atmosphere(world, scene);
  const asuna = await makeVRMCharacter('models/AvatarSample_B.vrm', { weapon: 'rapier', tint: [
    { match: /HAIR/, color: '#f0a060', shade: '#a05030' }, { match: /Tops/, color: '#ffffff', shade: '#d8c8d0' }, { match: /Bottoms/, color: '#d02a30', shade: '#801018' } ] });
  const kirito = await makeVRMCharacter('models/Seed-san.vrm', { weapon: 'elucidator', hide: /arm_mat|arm_plastic|armgear|backpack|anim_logo|green_emit/, tint: [
    { match: /^hair$/, color: '#2a2a34', shade: '#101018' }, { match: /huku/, color: '#2a2c36', shade: '#121318' } ] });
  chars.push(asuna, kirito);
  scene.add(asuna.root, kirito.root);
  let target = new THREE.Vector3(), camPos = new THREE.Vector3();
  if (shot === 'party') {
    place(kirito, -0.6, 16, 0.15); place(asuna, 0.6, 15.6, -0.2);
    const y = world.heightAt(0, 16);
    camPos.set(0.4, y + 1.35, 19.8); target.set(0, y + 1.55, 10);
  } else if (shot === 'close') {
    place(kirito, -0.45, 16, 0.3); place(asuna, 0.45, 16, -0.3);
    const y = world.heightAt(0, 16);
    camPos.set(0, y + 1.45, 17.9); target.set(0, y + 1.3, 16);
  } else if (shot === 'street') {
    place(kirito, 1.2, 21, -0.4); place(asuna, -0.4, 20.2, 0.3);
    const y = world.heightAt(0, 26);
    camPos.set(-1.5, y + 2.2, 27); target.set(1, y + 1.6, 12);
  } else if (shot === 'meadow') {
    place(kirito, 40, 30, 2.2); place(asuna, 41.2, 31, 2.0);
    const y = world.heightAt(46, 36);
    camPos.set(46, y + 2.4, 36); target.set(30, y + 2, 20);
  } else if (shot === 'vista') {
    place(kirito, -0.6, 23, Math.PI); place(asuna, 0.7, 23.3, Math.PI);
    const y = world.heightAt(0, 26);
    camPos.set(1.2, y + 2.0, 26.5); target.set(0, y + 14, -60);
  } else if (shot === 'field') {
    const z = -44, px = world.pathCenter(z);
    place(kirito, px - 0.7, z, Math.PI * 0.9); place(asuna, px + 0.9, z + 0.6, Math.PI * 1.1);
    kirito.driver.play(CLIPS.slash1, 0.0001); kirito.driver.clipT = 0.12;
    const y = world.heightAt(px, z + 5);
    camPos.set(px + 2.5, y + 1.8, z + 5); target.set(px, y + 1.2, z - 4);
  }
  cam.position.copy(camPos); cam.lookAt(target);
  sun.position.copy(target).addScaledVector(sky.sunDir, 120); sun.target.position.copy(target);
  for (const c of chars) c.lookAt(cam);
  resize();
  let last = performance.now(), t = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    sky.update(dt, cam);
    world.update(dt, t, kirito.root.position);
    world.grass.update(t, kirito.root.position, cam.position);
    for (const c of chars) c.update(dt, { speed: 0, combat: shot === 'field' });
    lib.update(cam.position); atmo.update(dt, t, cam.position);
    R.setSun(sky.sunPos.clone().add(cam.position));
    R.render();
    frames++;
    if (frames < maxFrames) requestAnimationFrame(frame); else window.__done = true;
  }
  let frames = 0; const maxFrames = +(q.get('frames') || 1e9);
  requestAnimationFrame(frame);
}
function resize() { R.resize(innerWidth, innerHeight); }
addEventListener('resize', resize);
main().catch((e) => { console.error('MAIN', e.stack || e); window.__err = String(e.stack || e); });
window.addEventListener('error', (e) => { window.__err = String(e.message); });
