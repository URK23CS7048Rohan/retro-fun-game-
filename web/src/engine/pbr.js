import * as THREE from 'three';

// PBR texture sets (Poly Haven, CC0): diffuse, OpenGL normal, and ARM
// (ambient occlusion / roughness / metalness packed in RGB).

const loader = new THREE.TextureLoader();
const sets = new Map();
let maxAniso = 4;
export function setAnisotropy(n) { maxAniso = n; }

function load(url, srgb) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function texSet(id, base = 'tex/') {
  if (sets.has(id)) return sets.get(id);
  const s = {
    map: load(`${base}${id}_diff.jpg`, true),
    normalMap: load(`${base}${id}_nor.jpg`, false),
    arm: load(`${base}${id}_arm.jpg`, false),
  };
  sets.set(id, s);
  return s;
}
// A standard material from a set. UVs are expected in metres; `scale` is how
// many metres one tile of the texture covers.
export function pbr(id, { color = '#ffffff', normalScale = 1, rough = 1, side, envMapIntensity = 0.7 } = {}) {
  const s = texSet(id);
  const m = new THREE.MeshStandardMaterial({
    map: s.map, normalMap: s.normalMap, aoMap: s.arm, roughnessMap: s.arm, color, roughness: rough, metalness: 0,
    normalScale: new THREE.Vector2(normalScale, normalScale), envMapIntensity,
  });
  if (side) m.side = side;
  return m;
}
