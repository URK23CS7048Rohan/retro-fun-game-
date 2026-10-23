import * as THREE from 'three';

// Swords as real geometry: an extruded blade profile with bevelled edges and a
// fuller, metal PBR materials that reflect the sky, and detailed hilts.

function bladeGeo(len, width, tipLen, thick = 0.006, bevel = 0.004) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(-width / 2, -(len - tipLen));
  s.quadraticCurveTo(-width / 2, -len + tipLen * 0.3, 0, -len);
  s.quadraticCurveTo(width / 2, -len + tipLen * 0.3, width / 2, -(len - tipLen));
  s.lineTo(width / 2, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: Math.min(bevel, width * 0.3), bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  g.computeVertexNormals();
  return g;
}
const M = (color, metal = 0.9, rough = 0.3, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });

export function buildWeaponOn(H, parent, kind) {
  const add = (geo, m, x = 0, y = 0, z = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me; };
  let len = 1;
  const setBlade = (mesh) => { H.blade = mesh; H.bladeMat = mesh.material; H.bladeBase = mesh.material.color.clone(); };
  if (kind === 'elucidator') {
    // black one-handed sword with a dark steel fuller and a squared guard
    const b = add(bladeGeo(0.86, 0.052, 0.12, 0.008, 0.005), M('#15161c', 0.85, 0.28, { emissive: new THREE.Color(0, 0, 0) }), 0, -0.12, 0);
    setBlade(b);
    add(new THREE.BoxGeometry(0.012, 0.66, 0.012), M('#3a4256', 0.9, 0.2), 0, -0.47, 0);
    const guard = new THREE.BoxGeometry(0.16, 0.026, 0.04); add(guard, M('#24262e', 0.8, 0.35), 0, -0.11, 0);
    for (const s of [1, -1]) add(new THREE.BoxGeometry(0.022, 0.05, 0.045), M('#24262e', 0.8, 0.35), s * 0.085, -0.115, 0);
    add(new THREE.CylinderGeometry(0.015, 0.016, 0.17, 8), M('#1a1a1e', 0.1, 0.8), 0, -0.02, 0);
    add(new THREE.OctahedronGeometry(0.025), M('#2a2c34', 0.9, 0.3), 0, 0.08, 0);
    len = 1.0;
  } else if (kind === 'rapier') {
    // slender white-silver rapier with a swept gold hand guard
    const b = add(bladeGeo(0.95, 0.018, 0.15, 0.006, 0.003), M('#eef2f8', 1.0, 0.15, { emissive: new THREE.Color(0, 0, 0) }), 0, -0.11, 0);
    setBlade(b);
    const ring = new THREE.TorusGeometry(0.055, 0.006, 6, 16, Math.PI * 1.2);
    const r1 = add(ring, M('#e0c070', 1, 0.25), 0, -0.07, 0.0); r1.rotation.set(0, Math.PI / 2, Math.PI * 0.9);
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 16), M('#e8e8ee', 1, 0.2), 0, -0.105, 0);
    add(new THREE.CylinderGeometry(0.013, 0.012, 0.13, 8), M('#f4f0e6', 0.2, 0.6), 0, -0.03, 0);
    add(new THREE.SphereGeometry(0.02, 10, 8), M('#e0c070', 1, 0.25), 0, 0.045, 0);
    len = 1.06;
  } else if (kind === 'katana') {
    const g = bladeGeo(0.9, 0.032, 0.06, 0.006, 0.003);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, p.getZ(i) + y * y * 0.06); }
    g.computeVertexNormals();
    setBlade(add(g, M('#e6eaee', 1, 0.18, { emissive: new THREE.Color(0, 0, 0) }), 0, -0.13, 0));
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 12), M('#2a2224', 0.7, 0.4), 0, -0.125, 0);
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.24, 8), M('#5a1a1a', 0.1, 0.8), 0, -0.0, 0);
    len = 1.03;
  } else if (kind === 'longsword' || kind === 'mace' || kind === 'dagger' || kind === 'axe') {
    const L = kind === 'dagger' ? 0.32 : 0.82;
    setBlade(add(bladeGeo(L, 0.05, 0.1, 0.008, 0.004), M('#d8dee6', 1, 0.25, { emissive: new THREE.Color(0, 0, 0) }), 0, -0.12, 0));
    add(new THREE.BoxGeometry(0.17, 0.028, 0.035), M('#b08a3c', 1, 0.35), 0, -0.11, 0);
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), M('#3a2618', 0.1, 0.8), 0, -0.02, 0);
    add(new THREE.SphereGeometry(0.024, 8, 6), M('#b08a3c', 1, 0.35), 0, 0.07, 0);
    len = L + 0.14;
  }
  H.bladeLen = len;
  H.tip = new THREE.Object3D(); H.tip.position.y = -len; parent.add(H.tip);
  H.hiltRef = new THREE.Object3D(); H.hiltRef.position.y = -0.15; parent.add(H.hiltRef);
}
