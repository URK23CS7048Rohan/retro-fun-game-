import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Prop library: loads Poly Haven glTF models once, flattens each into a list
// of (geometry, material) parts with transforms baked in, then scatters them
// as InstancedMeshes bucketed into 32 m chunks. Chunks beyond a per-prop view
// distance are hidden, so a dense town costs little when you're in the fields.

const loader = new GLTFLoader();
const CHUNK = 32;

export class PropLibrary {
  constructor(base = 'props/') { this.base = base; this.defs = new Map(); this.chunks = []; }
  async load(ids) {
    await Promise.all(ids.map(async (id) => {
      try {
        const gltf = await loader.loadAsync(`${this.base}${id}/${id}.gltf`);
        const parts = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
          const m = o.material;
          if (m.map) m.map.anisotropy = 4;
          m.envMapIntensity = 0.6;
          parts.push({ g, m });
        });
        const box = new THREE.Box3();
        for (const p of parts) { p.g.computeBoundingBox(); box.union(p.g.boundingBox); }
        this.defs.set(id, { parts, box });
      } catch (e) { console.warn('prop failed', id, e); }
    }));
  }
  size(id) { const d = this.defs.get(id); return d ? d.box.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1); }
  // items: [{x, y, z, ry, s, rx, rz}]
  scatter(group, id, items, { viewDist = 90, cast = true } = {}) {
    const def = this.defs.get(id);
    if (!def || !items.length) return;
    const buckets = new Map();
    for (const it of items) {
      const k = Math.floor(it.x / CHUNK) + ',' + Math.floor(it.z / CHUNK);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(it);
    }
    const o = new THREE.Object3D();
    for (const [, list] of buckets) {
      const meshes = [];
      for (const { g, m } of def.parts) {
        const im = new THREE.InstancedMesh(g, m, list.length);
        list.forEach((it, i) => {
          o.position.set(it.x, it.y, it.z); o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
          const s = it.s || 1; o.scale.set(s * (it.sx || 1), s * (it.sy || 1), s * (it.sz || 1));
          o.updateMatrix(); im.setMatrixAt(i, o.matrix);
        });
        im.computeBoundingSphere();
        im.castShadow = cast; im.receiveShadow = true;
        group.add(im); meshes.push(im);
      }
      let cx = 0, cz = 0; for (const it of list) { cx += it.x; cz += it.z; } cx /= list.length; cz /= list.length;
      this.chunks.push({ meshes, x: cx, z: cz, d2: viewDist * viewDist });
    }
  }
  update(cam) {
    for (const c of this.chunks) {
      const dx = c.x - cam.x, dz = c.z - cam.z;
      const vis = dx * dx + dz * dz < c.d2;
      for (const m of c.meshes) m.visible = vis;
    }
  }
}

export const PROP_IDS = ['Barrel_01', 'barrel_03', 'wooden_crate_01', 'wooden_crate_02', 'wooden_lantern_01', 'WoodenTable_01', 'painted_wooden_bench',
  'shrub_03', 'fern_02', 'stone_fire_pit', 'horse_statue_01', 'kite_shield', 'rock_07', 'rock_09', 'wooden_bucket_01', 'wicker_basket_01', 'ceramic_vase_01',
  'planter_pot_clay', 'potted_plant_01', 'flower_empodium', 'flower_gazania', 'wine_barrel_01', 'jug_01', 'food_apple_01', 'lantern_chandelier_01', 'dry_branches_medium_01'];
