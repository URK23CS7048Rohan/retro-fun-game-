import * as THREE from 'three';
import { ps1Toon, ps1Basic, outlineMat } from './ps1.js';

// Character construction: cel-shaded, outlined, anime-proportioned bodies made
// from lathed profiles and capsules. Faces are painted decals on the front of
// the head. Each named preset is defined by silhouette details (hair, coat,
// trim, weapon) since that is what makes a character readable at 300 lines.

const V = (x, y) => new THREE.Vector2(x, y);

// ---------- textures ----------
const texCache = new Map();
function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t); return t;
}
// dark coat with silver seam lines (Kirito's coat)
const coatLines = (base, line) => canvasTex('coat' + base + line, 32, 16, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.fillStyle = line; for (const x of [3, 11, 20, 28]) g.fillRect(x, 0, 1, h);
});
// white cloth with a red border band at the bottom of the UV range
const trimmed = (base, trim, band = 3) => canvasTex('trim' + base + trim + band, 16, 16, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.fillStyle = trim; g.fillRect(0, h - band, w, band);
});
const crossTex = (bg, fg) => canvasTex('cross' + bg + fg, 16, 16, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, 16, 16);
  g.fillStyle = fg; g.fillRect(7, 2, 2, 12); g.fillRect(3, 5, 10, 2);
});

function faceTex(p) {
  const key = 'face' + JSON.stringify(p);
  return canvasTex(key, 64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    const P = (x, y, c, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    const ey = 26, lx = 16, rx = 37, ew = 11;
    for (const ex of [lx, rx]) {
      P(ex, ey + 1, '#fbf8f2', ew, 10);           // sclera
      const ix = ex + 2;
      P(ix, ey + 1, p.eye, 7, 10);                 // iris
      P(ix, ey + 1, p.eyeDark, 7, 2);              // shadow under the lid
      P(ix + 1, ey + 8, p.eyeLight, 5, 2);         // lower glow
      P(ix + 2, ey + 4, '#0c0a0c', 3, 4);          // pupil
      P(ix, ey + 3, '#ffffff', 2, 2); P(ix + 5, ey + 7, '#ffffff', 1, 1); // highlights
      P(ex - 1, ey, '#1a1418', ew + 2, 1);         // upper lash
      P(ex === lx ? ex - 1 : ex + ew - 2, ey - 1, '#1a1418', 3, 2); // outer corner
      if (p.female) { P(ex === lx ? ex - 2 : ex + ew, ey + 1, '#1a1418', 2, 2); }
      P(ex + 1, ey + 11, p.female ? '#8a5a50' : '#9a7a6a', ew - 2, 1);
    }
    // brows
    const bc = p.brow;
    if (p.female) { P(lx, ey - 5, bc, 9, 1); P(rx + 1, ey - 5, bc, 9, 1); }
    else { P(lx - 1, ey - 5, bc, 10, 2); P(rx + 1, ey - 5, bc, 10, 2); P(lx + 7, ey - 4, bc, 2, 1); P(rx + 1, ey - 4, bc, 2, 1); }
    // nose shadow, mouth
    P(31, ey + 15, p.shade, 2, 2);
    if (p.smile) { P(27, ey + 21, p.mouth, 10, 1); P(26, ey + 20, p.mouth, 1, 1); P(37, ey + 20, p.mouth, 1, 1); }
    else P(28, ey + 21, p.mouth, 8, 1);
    if (p.blush) { P(15, ey + 13, '#f0a0a0', 6, 2); P(43, ey + 13, '#f0a0a0', 6, 2); }
    if (p.stubble) for (let i = 0; i < 40; i++) P(22 + ((i * 7) % 20), ey + 22 + ((i * 3) % 6), '#7a5a48');
  });
}

// ---------- geometry ----------
function lathe(points, seg = 10, phiStart = 0, phiLen = Math.PI * 2, zScale = 1) {
  if (points[0].y > points[points.length - 1].y) points = points.slice().reverse(); // keep normals outward
  // LatheGeometry puts phi=0 on +z when x = r*sin(phi); keep the gap at the front
  const g = new THREE.LatheGeometry(points, seg, phiStart, phiLen);
  if (zScale !== 1) g.scale(1, 1, zScale);
  g.computeVertexNormals();
  return g;
}
// tapered capsule hanging down from its top (joint) point
function limbGeo(r0, r1, len, seg = 7) {
  const cap = 3;
  // ensure top point first, increasing downward
  const out = [];
  for (let i = 0; i <= cap; i++) { const a = Math.PI / 2 - (i / cap) * Math.PI / 2; out.push(V(Math.cos(a) * r0 + 0.0001, Math.sin(a) * r0 * 0.6)); }
  for (let i = 0; i <= cap; i++) { const a = (i / cap) * Math.PI / 2; out.push(V(Math.cos(a) * r1 + 0.0001, -len - Math.sin(a) * r1 * 0.6)); }
  return lathe(out.reverse(), seg);
}
function deformHead(geo, r) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.max(0, (-y - r * 0.15) / (r * 0.85)); // 0 at cheeks, 1 at chin
    x *= 1 - 0.42 * k; z *= 1 - 0.12 * k;
    if (z > 0) { y -= r * 0.18 * k * (z / r); z += r * 0.08 * k; }
    x *= 0.9;
    p.setXYZ(i, x, y * 1.06, z);
  }
  geo.computeVertexNormals();
}
// flattened blade-like hair spike, base at origin, pointing along local +y
function spikeGeo(w, len, thick = 0.5) {
  const g = new THREE.ConeGeometry(w, len, 4, 1);
  g.translate(0, len / 2, 0); g.scale(1, 1, thick); g.rotateY(Math.PI / 4 * 0); return g;
}

// ---------- presets ----------
export const PRESETS = {
  kirito: {
    name: 'Kirito', female: false, skin: '#f3d2b5', hair: ['#23242f', '#4a5068'], hairStyle: 'kirito',
    eye: ['#3a3a48', '#1a1a22', '#7a7c90'], outfit: 'midnight', weapon: 'elucidator', smile: false,
  },
  asuna: {
    name: 'Asuna', female: true, skin: '#f7dcc4', hair: ['#eaa060', '#fcd29a'], hairStyle: 'asuna',
    eye: ['#9a5a26', '#5a3214', '#d89a50'], outfit: 'kob', weapon: 'rapier', smile: true, blush: true,
  },
  klein: {
    name: 'Klein', female: false, skin: '#e9be98', hair: ['#9a3a1c', '#c8622e'], hairStyle: 'klein',
    eye: ['#4a3022', '#2a1a12', '#7a5a3a'], outfit: 'samurai', weapon: 'katana', smile: true, stubble: true,
  },
  lisbeth: {
    name: 'Lisbeth', female: true, skin: '#f7dcc4', hair: ['#e58fae', '#f8bcd0'], hairStyle: 'bob',
    eye: ['#7a3a3a', '#4a1a1a', '#c06a6a'], outfit: 'smith', weapon: 'mace', smile: true, blush: true,
  },
  silica: {
    name: 'Silica', female: true, skin: '#f7dcc4', hair: ['#a8642e', '#d89650'], hairStyle: 'twintails',
    eye: ['#8a4a26', '#4a2412', '#c88a4a'], outfit: 'beast', weapon: 'dagger', smile: true, blush: true, height: 0.86,
  },
  heathcliff: {
    name: 'Heathcliff', female: false, skin: '#e3c0a0', hair: ['#9a958c', '#c8c2b6'], hairStyle: 'short',
    eye: ['#4a4a44', '#2a2a26', '#7a7a70'], outfit: 'knight', weapon: 'longsword', smile: false, height: 1.04,
  },
  kobold: {
    name: 'Kobold', kobold: true, skin: '#8a7550', hair: ['#5a4630', '#7a6448'], hairStyle: 'none',
    eye: ['#e8c33a', '#a07a10', '#fff0a0'], outfit: 'kobold', weapon: 'axe',
  },
};

const VILLAGER_HAIR = [['#3a2a1e', '#5a4632'], ['#c9a25a', '#e6c98a'], ['#6b3f22', '#8c5a34'], ['#1c1a1f', '#3b3846'], ['#9a958c', '#c8c2b6']];
const VILLAGER_CLOTH = ['#5a6e3a', '#8a5a2a', '#3a5a7a', '#7a3a3a', '#6a5a7a', '#9a7a3a'];
export function villagerPreset(r) {
  const female = r() < 0.5;
  return {
    name: 'Player', female, skin: ['#f3d2b5', '#e3b892', '#c89470', '#9a6a48'][Math.floor(r() * 4)],
    hair: VILLAGER_HAIR[Math.floor(r() * VILLAGER_HAIR.length)], hairStyle: female ? (r() < 0.5 ? 'ponytail' : 'bob') : 'short',
    eye: ['#3a2a20', '#1a1410', '#6a5040'], outfit: 'tunic', cloth: VILLAGER_CLOTH[Math.floor(r() * VILLAGER_CLOTH.length)],
    weapon: r() < 0.5 ? 'longsword' : null, smile: r() < 0.5, height: 0.94 + r() * 0.1,
  };
}

// ---------- builder ----------
export function buildCharacter(H, p) {
  const T = (color, map) => ps1Toon({ color, map: map || null });
  const skin = T(p.skin);
  const hairM = T(p.hair[0]);
  const hairHi = T(p.hair[1]);
  const outline = outlineMat();
  const noOutline = new Set();
  const J = (name, parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); H.j[name] = g; return g; };
  const add = (parent, geo, m, x = 0, y = 0, z = 0, opts = {}) => {
    const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); parent.add(me);
    if (opts.noOutline) noOutline.add(me);
    return me;
  };
  const female = !!p.female;
  const sw = female ? 0.88 : 1;

  // ---- skeleton & body ----
  const hips = J('hips', H.root, 0, 0.94, 0);
  const spine = J('spine', hips, 0, 0.08, 0);
  const chest = J('chest', spine, 0, 0.2, 0);
  const neck = J('neck', chest, 0, 0.27, 0);
  const head = J('head', neck, 0, 0.07, 0.005);

  const O = outfitMats(p, T);
  // pelvis
  add(hips, lathe([V(0.001, -0.15), V(0.07, -0.14), V(0.135, -0.08), V(0.14 * (female ? 1.06 : 1), 0.02), V(0.13, 0.1)], 10, 0, Math.PI * 2, 0.72), O.pants);
  // abdomen + chest (inner layer)
  add(spine, lathe([V(0.128, -0.02), V(female ? 0.108 : 0.12, 0.1), V(female ? 0.12 : 0.135, 0.22)], 10, 0, Math.PI * 2, 0.7), O.shirt);
  const chestPts = female
    ? [V(0.115, -0.03), V(0.135, 0.06), V(0.142, 0.13), V(0.13, 0.2), V(0.1, 0.25), V(0.05, 0.28), V(0.001, 0.285)]
    : [V(0.135, -0.03), V(0.158, 0.08), V(0.172, 0.17), V(0.16, 0.23), V(0.1, 0.27), V(0.05, 0.285), V(0.001, 0.29)];
  add(chest, lathe(chestPts, 10, 0, Math.PI * 2, 0.68), O.shirt);
  // neck
  add(neck, limbGeo(0.042, 0.045, 0.06, 6), skin, 0, 0.07, 0);

  // arms
  for (const side of [1, -1]) {
    const s = side === 1 ? 'L' : 'R';
    const sh = J('sh' + s, chest, side * 0.185 * sw, 0.215, 0);
    add(sh, new THREE.SphereGeometry(0.058, 7, 5), O.sleeve);
    add(sh, limbGeo(0.05, 0.04, 0.24), O.sleeve);
    const el = J('el' + s, sh, 0, -0.265, 0);
    add(el, limbGeo(0.043, 0.034, 0.2), O.sleeve);
    if (O.cuff) add(el, limbGeo(0.047, 0.044, 0.05), O.cuff, 0, -0.15, 0);
    const wr = J('wr' + s, el, 0, -0.245, 0);
    // hand: palm + thumb
    add(wr, limbGeo(0.036, 0.03, 0.06, 6), O.glove || skin, 0, 0.0, 0.004);
    add(wr, new THREE.BoxGeometry(0.02, 0.05, 0.025), O.glove || skin, side * -0.028, -0.02, 0.02);
  }
  // legs
  for (const side of [1, -1]) {
    const s = side === 1 ? 'L' : 'R';
    const hp = J('hip' + s, hips, side * 0.078 * (female ? 1.05 : 1), -0.04, 0);
    add(hp, limbGeo(0.075, 0.052, 0.38), O.thigh || O.pants);
    const kn = J('kn' + s, hp, 0, -0.42, 0);
    add(kn, limbGeo(0.054, 0.04, 0.36), O.shin || O.pants);
    if (O.boot) add(kn, limbGeo(0.06, 0.05, O.bootLen || 0.26), O.boot, 0, -0.1 + (0.26 - (O.bootLen || 0.26)), 0);
    if (O.bootTop) add(kn, limbGeo(0.065, 0.062, 0.03), O.bootTop, 0, 0.01 + (O.bootTopY || 0), 0);
    const an = J('an' + s, kn, 0, -0.41, 0);
    const foot = new THREE.BoxGeometry(0.085, 0.06, 0.2); foot.translate(0, -0.03, 0.045);
    add(an, foot, O.shoe || O.boot || O.pants);
  }
  const tail = J('tail', hips, 0, 0.06, 0);

  buildOutfit(p, H, { hips, spine, chest, neck, head, tail }, O, add, T);
  buildHead(p, head, skin, hairM, hairHi, add, T);
  if (p.weapon) buildWeapon(H, p.weapon, add);
  if (p.weapon === 'elucidator') {
    // second sword on the back, hilt over the right shoulder
    const back = new THREE.Group(); back.position.set(-0.06, 0.12, -0.13); back.rotation.set(0, 0, -0.5); chest.add(back);
    add(back, new THREE.BoxGeometry(0.055, 0.8, 0.03), T('#121216'), 0, 0.05, 0);
    add(back, new THREE.BoxGeometry(0.13, 0.03, 0.05), T('#3a3d48'), 0, 0.46, 0);
    add(back, new THREE.BoxGeometry(0.03, 0.17, 0.03), T('#1a1a20'), 0, 0.56, 0);
  }

  // outlines: inverted hulls for every closed mesh
  const meshes = [];
  H.root.traverse((o) => { if (o.isMesh && !noOutline.has(o) && !o.userData.noOutline) meshes.push(o); });
  for (const m of meshes) {
    const ol = new THREE.Mesh(m.geometry, outline);
    ol.userData.outline = true;
    m.add(ol);
  }
}

function outfitMats(p, T) {
  switch (p.outfit) {
    case 'midnight': return {
      shirt: T('#2e303a'), pants: T('#23252c'), sleeve: T('#ffffff', coatLines('#272934', '#7a8296')),
      coat: T('#ffffff', coatLines('#272934', '#7a8296')), boot: T('#22232a'), shoe: T('#2a2b32'), glove: T('#1c1c22'),
      trim: T('#5a6070'), bootLen: 0.22,
    };
    case 'kob': return {
      shirt: T('#f4f1ea'), pants: T('#f4f1ea'), sleeve: T('#f4f1ea'), cuff: T('#c22a30'),
      thigh: T('#f7dcc4'), shin: T('#f4f1ea'), boot: T('#f4f1ea'), bootLen: 0.36, bootTop: T('#c22a30'), bootTopY: 0.1, shoe: T('#e8e4dc'),
      red: T('#c22a30'), white: T('#f4f1ea'), silver: T('#c8ccd4'),
    };
    case 'samurai': return {
      shirt: T('#8e2a22'), pants: T('#2a2224'), sleeve: T('#2a2224'), cuff: T('#8e2a22'), boot: T('#3a2a22'), shoe: T('#3a2a22'),
      red: T('#a8322a'), black: T('#1e1a1c'), gold: T('#c9a040'), glove: T('#2a2224'),
    };
    case 'smith': return {
      shirt: T('#b83a3a'), pants: T('#3a2a2a'), sleeve: T('#f4f1ea'), cuff: T('#b83a3a'), boot: T('#5a3a2a'), shoe: T('#5a3a2a'),
      white: T('#f4f1ea'), red: T('#b83a3a'),
    };
    case 'beast': return {
      shirt: T('#b8323a'), pants: T('#3a2a2a'), sleeve: T('#f0e6d6'), cuff: T('#b8323a'), thigh: T('#2a2228'), shin: T('#2a2228'),
      boot: T('#5a3428'), shoe: T('#5a3428'), red: T('#b8323a'), white: T('#f0e6d6'),
    };
    case 'knight': return {
      shirt: T('#b02a28'), pants: T('#3a2a28'), sleeve: T('#b02a28'), boot: T('#c8ccd4'), shoe: T('#c8ccd4'), glove: T('#c8ccd4'),
      red: T('#b02a28'), silver: T('#c8ccd4'), cape: T('#ffffff', crossTex('#a82624', '#f4f1ea')),
    };
    case 'kobold': return {
      shirt: T('#8a7550'), pants: T('#5a3a22'), sleeve: T('#8a7550'), boot: T('#8a7550'), shoe: T('#6a5a3a'),
      leather: T('#6a4428'), iron: T('#7a7e86'),
    };
    default: {
      const c = new THREE.Color(p.cloth || '#5a6e3a');
      const dark = '#' + c.clone().multiplyScalar(0.6).getHexString();
      return { shirt: T(p.cloth || '#5a6e3a'), pants: T('#4a3a2a'), sleeve: T('#e8dfc8'), boot: T('#5a3e28'), shoe: T('#4a3220'), belt: T('#3a2a1c'), dark: T(dark) };
    }
  }
}

function buildOutfit(p, H, J, O, add, T) {
  const { hips, spine, chest, tail } = J;
  const gap = 0.32; // front opening half-angle for coats
  if (p.outfit === 'midnight') {
    // coat torso, open at the front over the dark shirt
    add(chest, lathe([V(0.14, -0.03), V(0.165, 0.08), V(0.18, 0.17), V(0.168, 0.235), V(0.11, 0.275)], 12, gap, Math.PI * 2 - gap * 2, 0.72), O.coat, 0, 0, 0, { noOutline: true }).material.side = THREE.DoubleSide;
    add(spine, lathe([V(0.135, -0.04), V(0.128, 0.1), V(0.145, 0.22)], 12, gap * 0.7, Math.PI * 2 - gap * 1.4, 0.74), O.coat, 0, 0, 0, { noOutline: true });
    // stand collar
    add(chest, lathe([V(0.075, 0.25), V(0.085, 0.31), V(0.095, 0.37)], 10, 0.5, Math.PI * 2 - 1.0), O.coat, 0, 0, 0, { noOutline: true });
    // belt
    add(hips, lathe([V(0.142, 0.05), V(0.142, 0.1)], 10, 0, Math.PI * 2, 0.74), T('#2c2a2a'));
    add(hips, new THREE.BoxGeometry(0.04, 0.04, 0.02), T('#8a8e98'), 0, 0.075, 0.105);
    // coat tails: four panels, split front and back, swinging on the tail joint
    const tp = [V(0.15, 0.0), V(0.2, -0.3), V(0.26, -0.62), V(0.29, -0.78)];
    const panels = [[gap, Math.PI - gap - 0.06], [Math.PI + 0.06, Math.PI - gap - 0.06]];
    for (const [a, l] of panels) {
      const m = add(tail, lathe(tp, 8, a, l, 0.78), O.coat, 0, 0, 0, { noOutline: true });
      m.material.side = THREE.DoubleSide;
    }
    // shoulder trim
    for (const s of [1, -1]) add(chest, new THREE.BoxGeometry(0.06, 0.02, 0.13), O.trim, s * 0.15, 0.245, 0);
  } else if (p.outfit === 'kob') {
    // white top with red borders and the red cross
    add(chest, lathe([V(0.12, -0.03), V(0.14, 0.06), V(0.146, 0.13), V(0.135, 0.2), V(0.1, 0.25)], 12, 0, Math.PI * 2, 0.7), O.white);
    add(chest, lathe([V(0.143, 0.15), V(0.14, 0.18)], 12, 0.5, Math.PI * 2 - 1.0, 0.72), O.red, 0, 0, 0, { noOutline: true });
    add(chest, lathe([V(0.103, 0.245), V(0.06, 0.275)], 12, 0, Math.PI * 2, 0.7), O.red, 0, 0, 0, { noOutline: true });
    // red cross on the chest
    const cr = new THREE.Group(); cr.position.set(0, 0.1, 0.1); chest.add(cr);
    add(cr, new THREE.BoxGeometry(0.02, 0.1, 0.01), O.red, 0, 0, 0, { noOutline: true });
    add(cr, new THREE.BoxGeometry(0.07, 0.02, 0.01), O.red, 0, 0.02, 0, { noOutline: true });
    // silver breastplate edge
    add(chest, lathe([V(0.148, 0.04), V(0.15, 0.08)], 12, -0.9, 1.8, 0.72), O.silver, 0, 0, 0, { noOutline: true });
    // waist band + pleated red skirt with white hem
    add(spine, lathe([V(0.115, -0.02), V(0.112, 0.05)], 12, 0, Math.PI * 2, 0.74), O.red);
    const skirt = [];
    const pts = [V(0.135, 0.02), V(0.18, -0.12), V(0.24, -0.27)];
    add(hips, lathe(pts, 16, 0, Math.PI * 2, 0.8), O.red, 0, 0.06, 0, { noOutline: true }).material.side = THREE.DoubleSide;
    add(hips, lathe([V(0.235, -0.255), V(0.245, -0.3)], 16, 0, Math.PI * 2, 0.8), O.white, 0, 0.06, 0, { noOutline: true });
    // skirt pleats: thin white stripes
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25;
      const st = add(hips, new THREE.BoxGeometry(0.012, 0.25, 0.005), O.white, Math.sin(a) * 0.2, -0.07, Math.cos(a) * 0.2 * 0.8, { noOutline: true });
      st.rotation.y = a; st.rotation.x = Math.cos(a) * -0.4; st.rotation.z = Math.sin(a) * 0.4;
    }
    skirt.length = 0;
  } else if (p.outfit === 'samurai') {
    add(chest, lathe([V(0.15, -0.03), V(0.172, 0.08), V(0.185, 0.17), V(0.17, 0.235), V(0.11, 0.27)], 12, 0, Math.PI * 2, 0.74), O.red);
    // dark armor plates across the chest
    for (const y of [0.05, 0.1, 0.15]) add(chest, lathe([V(0.178 + y * 0.05, y), V(0.18 + y * 0.05, y + 0.03)], 12, 0, Math.PI * 2, 0.75), O.black, 0, 0, 0, { noOutline: true });
    for (const s of [1, -1]) { // shoulder guards
      const sg = add(chest, lathe([V(0.03, 0.04), V(0.09, 0), V(0.1, -0.08)], 8, 0, Math.PI * 2), O.red, s * 0.2, 0.22, 0);
      sg.rotation.z = s * 0.5;
    }
    add(hips, lathe([V(0.15, 0.06), V(0.2, -0.12), V(0.23, -0.26)], 10, 0, Math.PI * 2, 0.8), O.red, 0, 0, 0, { noOutline: true }).material.side = THREE.DoubleSide;
    add(hips, lathe([V(0.145, 0.04), V(0.145, 0.1)], 12, 0, Math.PI * 2, 0.75), O.gold);
  } else if (p.outfit === 'smith') {
    add(chest, lathe([V(0.12, -0.03), V(0.14, 0.08), V(0.144, 0.15), V(0.13, 0.21), V(0.09, 0.26)], 12, 0, Math.PI * 2, 0.7), O.red);
    add(chest, new THREE.BoxGeometry(0.16, 0.14, 0.012), O.white, 0, 0.07, 0.098);
    add(hips, lathe([V(0.14, 0.06), V(0.2, -0.1), V(0.23, -0.22)], 14, 0, Math.PI * 2, 0.8), O.red, 0, 0, 0, { noOutline: true }).material.side = THREE.DoubleSide;
    add(hips, lathe([V(0.15, 0.05), V(0.21, -0.12), V(0.245, -0.3)], 8, -0.7, 1.4, 0.82), O.white, 0, 0, 0, { noOutline: true }).material.side = THREE.DoubleSide;
  } else if (p.outfit === 'beast') {
    add(chest, lathe([V(0.115, -0.03), V(0.13, 0.08), V(0.135, 0.15), V(0.12, 0.21), V(0.09, 0.25)], 12, 0, Math.PI * 2, 0.7), O.red);
    add(chest, lathe([V(0.094, 0.245), V(0.06, 0.275)], 12, 0, Math.PI * 2, 0.7), O.white);
    add(hips, lathe([V(0.13, 0.06), V(0.19, -0.08), V(0.22, -0.2)], 14, 0, Math.PI * 2, 0.8), O.red, 0, 0, 0, { noOutline: true }).material.side = THREE.DoubleSide;
  } else if (p.outfit === 'knight') {
    add(chest, lathe([V(0.15, -0.03), V(0.178, 0.08), V(0.19, 0.17), V(0.175, 0.235), V(0.11, 0.275)], 12, 0, Math.PI * 2, 0.74), O.red);
    for (const s of [1, -1]) {
      const sg = add(chest, lathe([V(0.03, 0.05), V(0.1, 0), V(0.11, -0.09)], 8, 0, Math.PI * 2), O.silver, s * 0.2, 0.22, 0);
      sg.rotation.z = s * 0.45;
    }
    add(hips, lathe([V(0.15, 0.06), V(0.2, -0.15), V(0.23, -0.35)], 10, 0, Math.PI * 2, 0.8), O.red, 0, 0, 0, { noOutline: true }).material.side = THREE.DoubleSide;
    // cape with the white cross, hung from the shoulders
    const capeG = new THREE.PlaneGeometry(0.5, 1.2, 1, 4); capeG.translate(0, -0.6, 0);
    const cp = capeG.attributes.position;
    for (let i = 0; i < cp.count; i++) { const y = cp.getY(i); cp.setX(i, cp.getX(i) * (1 + -y * 0.5)); cp.setZ(i, -Math.abs(cp.getX(i)) * 0.25); }
    capeG.computeVertexNormals();
    const cape = add(tail, capeG, O.cape, 0, 0.47, -0.13, { noOutline: true });
    cape.material.side = THREE.DoubleSide; cape.rotation.y = Math.PI;
  } else if (p.outfit === 'kobold') {
    add(chest, lathe([V(0.15, -0.03), V(0.18, 0.08), V(0.19, 0.17), V(0.17, 0.23), V(0.1, 0.27)], 10, 0, Math.PI * 2, 0.75), O.leather);
    add(hips, lathe([V(0.15, 0.06), V(0.2, -0.12), V(0.22, -0.22)], 10, 0, Math.PI * 2, 0.8), O.leather, 0, 0, 0, { noOutline: true }).material.side = THREE.DoubleSide;
    for (const s of [1, -1]) add(chest, new THREE.SphereGeometry(0.075, 6, 4), O.iron, s * 0.2, 0.23, 0);
  } else {
    // villager tunic
    add(chest, lathe([V(0.13, -0.03), V(0.15, 0.08), V(0.16, 0.17), V(0.15, 0.23), V(0.1, 0.27)], 10, 0, Math.PI * 2, 0.7), O.shirt);
    add(spine, lathe([V(0.13, -0.04), V(0.125, 0.1), V(0.14, 0.22)], 10, 0, Math.PI * 2, 0.72), O.shirt);
    add(hips, lathe([V(0.14, 0.05), V(0.14, 0.1)], 10, 0, Math.PI * 2, 0.74), O.belt);
    if (p.female) add(hips, lathe([V(0.14, 0.06), V(0.2, -0.2), V(0.24, -0.5)], 12, 0, Math.PI * 2, 0.8), O.shirt, 0, 0, 0, { noOutline: true }).material.side = THREE.DoubleSide;
  }
}

function buildHead(p, head, skin, hairM, hairHi, add, T) {
  const R = 0.112;
  const hc = new THREE.Group(); hc.position.y = 0.12; head.add(hc);
  if (p.kobold) {
    const hg = new THREE.SphereGeometry(0.13, 10, 8); hg.scale(1, 0.9, 1);
    add(hc, hg, skin);
    const snout = limbGeo(0.07, 0.05, 0.12, 6); snout.rotateX(-Math.PI / 2);
    add(hc, snout, skin, 0, -0.03, 0.08);
    add(hc, new THREE.SphereGeometry(0.025, 5, 4), T('#1a1210'), 0, -0.02, 0.26, { noOutline: true });
    for (const s of [1, -1]) {
      add(hc, new THREE.SphereGeometry(0.022, 5, 4), ps1Basic({ color: 0xffd23a }), s * 0.055, 0.03, 0.105, { noOutline: true });
      const ear = add(hc, spikeGeo(0.045, 0.16, 0.5), skin, s * 0.08, 0.08, -0.02); ear.rotation.set(-0.3, 0, -s * 0.5);
    }
    // lower jaw with fangs
    const jaw = add(hc, new THREE.BoxGeometry(0.08, 0.03, 0.14), skin, 0, -0.08, 0.13);
    for (const s of [1, -1]) add(hc, new THREE.ConeGeometry(0.01, 0.04, 3), T('#f0e8d0'), s * 0.03, -0.055, 0.2, { noOutline: true });
    void jaw;
    return;
  }
  const hg = new THREE.SphereGeometry(R, 14, 12); deformHead(hg, R);
  add(hc, hg, skin);
  // painted face decal: same deformation, pushed slightly outward
  const fg = new THREE.SphereGeometry(R * 1.012, 12, 10, Math.PI / 2 - 0.85, 1.7, Math.PI * 0.36, Math.PI * 0.42);
  deformHead(fg, R * 1.012);
  const face = faceTex({ eye: p.eye[0], eyeDark: p.eye[1], eyeLight: p.eye[2], female: !!p.female, brow: shadeHex(p.hair[0], -0.15),
    shade: shadeHex(p.skin, -0.14), mouth: p.female ? '#c0605a' : '#9a5a4a', smile: p.smile, blush: p.blush, stubble: p.stubble });
  add(hc, fg, ps1Toon({ map: face, transparent: true, alphaTest: 0.5 }), 0, 0, 0, { noOutline: true });
  // ears
  for (const s of [1, -1]) add(hc, new THREE.SphereGeometry(0.022, 5, 4), skin, s * 0.095, -0.01, -0.005, { noOutline: true });

  const style = p.hairStyle;
  // hair cap: upper shell of a slightly larger sphere, reaching lower at the back
  const cap = new THREE.SphereGeometry(R * 1.14, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const cp = cap.attributes.position;
  for (let i = 0; i < cp.count; i++) { const z = cp.getZ(i); if (z < 0) cp.setY(i, cp.getY(i) - (-z / R) * 0.06); cp.setX(i, cp.getX(i) * 0.93); }
  cap.computeVertexNormals();
  add(hc, cap, hairM, 0, 0.012, -0.01);
  // back of the head
  const back = new THREE.SphereGeometry(R * 1.1, 12, 8, Math.PI * 0.9, Math.PI * 1.2, Math.PI * 0.3, Math.PI * 0.45);
  back.scale(0.93, 1, 1);
  add(hc, back, hairM, 0, 0, -0.008);

  const spike = (w, len, x, y, z, rx, ry, rz, m = hairM, thick = 0.45) => {
    const s = add(hc, spikeGeo(w, len, thick), m, x, y, z); s.rotation.set(rx, ry, rz); return s;
  };
  if (style === 'kirito') {
    // bangs falling over the forehead to the brows, slightly parted
    const bangs = [[-0.06, 0.2], [-0.03, -0.05], [0.0, 0.1], [0.03, -0.1], [0.065, 0.05]];
    for (const [x, rz] of bangs) spike(0.03, 0.075, x, 0.088, 0.09, Math.PI - 0.55, 0, rz);
    // sides over the ears
    for (const s of [1, -1]) { spike(0.03, 0.12, s * 0.1, 0.03, 0.03, Math.PI - 0.2, 0, -s * 0.25); spike(0.03, 0.1, s * 0.1, 0.02, -0.04, Math.PI + 0.2, 0, -s * 0.3); }
    // crown and back spikes, swept back and down
    const backs = [[0, 0.11, -0.02, -1.1, 0], [0.05, 0.1, -0.05, -1.4, 0.3], [-0.05, 0.1, -0.05, -1.4, -0.3], [0, 0.06, -0.1, -2.1, 0],
      [0.07, 0.04, -0.08, -2.3, 0.5], [-0.07, 0.04, -0.08, -2.3, -0.5], [0.03, 0.0, -0.11, -2.7, 0.2], [-0.03, 0.0, -0.11, -2.7, -0.2]];
    for (const [x, y, z, rx, rz] of backs) spike(0.04, 0.13, x, y, z, rx, 0, rz);
    spike(0.03, 0.09, 0.04, 0.12, 0.04, -0.5, 0, -0.5, hairHi);
  } else if (style === 'asuna') {
    // side-swept bangs
    const bangs = [[-0.07, 0.35, 0.1], [-0.035, 0.2, 0.12], [0.0, 0.05, 0.12], [0.035, -0.1, 0.12], [0.07, -0.25, 0.1]];
    for (const [x, rz, len] of bangs) spike(0.028, len * 0.62, x, 0.09, 0.09, Math.PI - 0.6, 0, rz);
    // long side locks framing the face, down to the chest
    for (const s of [1, -1]) {
      const lock = add(hc, limbGeo(0.026, 0.012, 0.34, 5), hairM, s * 0.092, 0.02, 0.05);
      lock.scale.set(1, 1, 0.6); lock.rotation.z = s * 0.06; lock.rotation.x = -0.1;
    }
    // long back curtain to the waist
    const curtain = lathe([V(0.13, 0.0), V(0.15, -0.12), V(0.17, -0.3), V(0.16, -0.5), V(0.1, -0.62), V(0.03, -0.66)], 10, Math.PI * 0.62, Math.PI * 0.76, 0.75);
    const cm = add(hc, curtain, hairM, 0, 0.0, -0.035, { noOutline: true }); cm.material.side = THREE.DoubleSide;
    cm.userData.hairCurtain = true;
    // braided crown band across the back of the head
    const band = new THREE.TorusGeometry(R * 1.08, 0.016, 4, 14, Math.PI * 1.1);
    const bm = add(hc, band, hairHi, 0, 0.02, -0.005, { noOutline: true }); bm.rotation.set(Math.PI / 2 - 0.25, 0, Math.PI * -0.05 + Math.PI);
    // two short tufts tied at the back
    for (const s of [1, -1]) spike(0.025, 0.07, s * 0.05, 0.05, -0.12, -2.2, 0, s * 0.6);
  } else if (style === 'klein') {
    // wild upswept spikes behind a red bandana
    const ups = [[0, 0.1, 0, -0.5, 0], [0.05, 0.1, -0.02, -0.6, -0.5], [-0.05, 0.1, -0.02, -0.6, 0.5], [0.09, 0.07, -0.04, -0.4, -1.0], [-0.09, 0.07, -0.04, -0.4, 1.0],
      [0, 0.08, -0.08, -1.2, 0], [0.06, 0.05, -0.09, -1.6, -0.5], [-0.06, 0.05, -0.09, -1.6, 0.5]];
    for (const [x, y, z, rx, rz] of ups) spike(0.04, 0.16, x, y, z, rx, 0, rz);
    for (const [x, rz] of [[-0.05, 0.4], [0.02, -0.1], [0.06, -0.4]]) spike(0.03, 0.07, x, 0.06, 0.1, Math.PI - 0.6, 0, rz);
    const band = new THREE.TorusGeometry(R * 1.12, 0.02, 4, 16);
    const bm = add(hc, band, T('#c8302a'), 0, 0.045, 0, { noOutline: true }); bm.rotation.x = Math.PI / 2 + 0.15; bm.scale.set(0.95, 1, 1);
    const band2 = new THREE.TorusGeometry(R * 1.13, 0.007, 3, 16);
    const b2 = add(hc, band2, T('#e8c040'), 0, 0.045, 0.002, { noOutline: true }); b2.rotation.x = Math.PI / 2 + 0.15; b2.scale.set(0.95, 1, 1);
    // bandana tails at the back
    for (const s of [1, -1]) { const t = add(hc, new THREE.BoxGeometry(0.03, 0.14, 0.006), T('#c8302a'), s * 0.03, -0.02, -0.12); t.rotation.set(0.3, 0, s * 0.3); }
  } else if (style === 'bob') {
    const bob = lathe([V(0.12, 0.02), V(0.135, -0.05), V(0.13, -0.11), V(0.1, -0.12)], 12, Math.PI * 0.35, Math.PI * 1.3, 0.95);
    add(hc, bob, hairM, 0, 0.02, -0.005, { noOutline: true }).material.side = THREE.DoubleSide;
    for (const [x, rz] of [[-0.06, 0.3], [-0.02, 0.1], [0.02, -0.1], [0.06, -0.3]]) spike(0.03, 0.09, x, 0.075, 0.095, Math.PI - 0.3, 0, rz);
    add(hc, new THREE.BoxGeometry(0.04, 0.015, 0.02), T('#c84a5a'), 0.07, 0.08, 0.06, { noOutline: true });
  } else if (style === 'twintails') {
    for (const [x, rz] of [[-0.06, 0.3], [-0.02, 0.1], [0.02, -0.1], [0.06, -0.3]]) spike(0.03, 0.09, x, 0.075, 0.095, Math.PI - 0.3, 0, rz);
    for (const s of [1, -1]) {
      const tl = add(hc, limbGeo(0.04, 0.015, 0.24, 6), hairM, s * 0.11, 0.06, -0.03);
      tl.rotation.z = s * 0.55; tl.rotation.x = 0.2;
      add(hc, new THREE.SphereGeometry(0.025, 6, 4), T('#d8323a'), s * 0.11, 0.06, -0.03, { noOutline: true });
    }
  } else if (style === 'ponytail') {
    for (const [x, rz] of [[-0.05, 0.3], [0, 0], [0.05, -0.3]]) spike(0.035, 0.08, x, 0.075, 0.095, Math.PI - 0.35, 0, rz);
    const tl = add(hc, limbGeo(0.035, 0.015, 0.25, 6), hairM, 0, 0.05, -0.12); tl.rotation.x = 0.5;
  } else if (style === 'short') {
    for (const [x, rz] of [[-0.05, 0.2], [0, -0.1], [0.05, -0.35]]) spike(0.035, 0.07, x, 0.08, 0.095, Math.PI - 0.6, 0, rz);
    for (const s of [1, -1]) spike(0.03, 0.06, s * 0.1, 0.03, 0.0, Math.PI - 0.1, 0, -s * 0.2);
  }
}

function buildWeapon(H, kind, add) {
  const wr = H.j.wrR;
  const pivot = new THREE.Group(); pivot.position.set(0, -0.05, 0.012); wr.add(pivot); H.j.weapon = pivot;
  const T = (c) => ps1Toon({ color: c });
  let len = 0.9, bladeColor = 0xdfe4ea;
  const blade = (w, l, color, thick = 0.012) => {
    const g = new THREE.BoxGeometry(w, l, thick, 1, 3, 1); g.translate(0, -l / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -l + 0.001) p.setX(i, 0);
    g.translate(0, -0.13, 0);
    const m = ps1Basic({ color });
    const mesh = add(pivot, g, m, 0, 0, 0, { noOutline: false });
    H.bladeMat = m; H.blade = mesh; H.bladeBase = new THREE.Color(color);
  };
  if (kind === 'elucidator') {
    blade(0.055, 0.86, 0x2a2d38); len = 1.0;
    add(pivot, new THREE.BoxGeometry(0.014, 0.8, 0.014), ps1Basic({ color: 0x6a7288 }), 0, -0.55, 0.004, { noOutline: true }); // fuller glint
    add(pivot, new THREE.BoxGeometry(0.15, 0.03, 0.045), T('#3a3d48'), 0, -0.12, 0);
    add(pivot, new THREE.BoxGeometry(0.032, 0.17, 0.032), T('#18181e'), 0, -0.02, 0);
    add(pivot, new THREE.BoxGeometry(0.045, 0.04, 0.045), T('#3a3d48'), 0, 0.075, 0);
  } else if (kind === 'rapier') {
    blade(0.022, 0.92, 0xeef2f6, 0.01); len = 1.05;
    const guard = new THREE.TorusGeometry(0.05, 0.008, 4, 10, Math.PI);
    const gm = add(pivot, guard, T('#d8c070'), 0, -0.1, 0); gm.rotation.y = Math.PI / 2;
    add(pivot, new THREE.BoxGeometry(0.08, 0.02, 0.025), T('#e8e8ec'), 0, -0.12, 0);
    add(pivot, new THREE.BoxGeometry(0.025, 0.15, 0.025), T('#f0ece4'), 0, -0.03, 0);
    add(pivot, new THREE.SphereGeometry(0.022, 5, 4), T('#d8c070'), 0, 0.06, 0);
  } else if (kind === 'katana') {
    blade(0.035, 0.9, 0xe4e8ec, 0.01); len = 1.03;
    add(pivot, new THREE.CylinderGeometry(0.04, 0.04, 0.015, 8), T('#2a2224'), 0, -0.12, 0);
    add(pivot, new THREE.BoxGeometry(0.03, 0.22, 0.03), T('#3a2a2a'), 0, 0.0, 0);
  } else if (kind === 'mace') {
    add(pivot, new THREE.BoxGeometry(0.035, 0.55, 0.035), T('#6a4a2a'), 0, -0.3, 0);
    const head = add(pivot, new THREE.IcosahedronGeometry(0.08, 0), T('#c8ccd4'), 0, -0.6, 0);
    H.blade = head; H.bladeMat = head.material; H.bladeBase = new THREE.Color('#c8ccd4'); len = 0.68;
  } else if (kind === 'dagger') {
    blade(0.03, 0.32, 0xe0e4ea); len = 0.48;
    add(pivot, new THREE.BoxGeometry(0.08, 0.02, 0.03), T('#b08a3c'), 0, -0.12, 0);
    add(pivot, new THREE.BoxGeometry(0.025, 0.12, 0.025), T('#5a2a2a'), 0, -0.04, 0);
  } else if (kind === 'longsword') {
    blade(0.05, 0.85, 0xd8dee6); len = 1.0;
    add(pivot, new THREE.BoxGeometry(0.17, 0.03, 0.04), T('#b08a3c'), 0, -0.12, 0);
    add(pivot, new THREE.BoxGeometry(0.03, 0.18, 0.03), T('#3a2618'), 0, -0.02, 0);
    add(pivot, new THREE.BoxGeometry(0.045, 0.04, 0.045), T('#b08a3c'), 0, 0.075, 0);
  } else if (kind === 'axe') {
    add(pivot, new THREE.BoxGeometry(0.04, 0.8, 0.04), T('#6a4a2a'), 0, -0.3, 0);
    const hd = new THREE.BoxGeometry(0.025, 0.24, 0.26); hd.translate(0, 0, 0.1);
    const head = add(pivot, hd, ps1Basic({ color: 0xb8bcc4 }), 0, -0.62, 0);
    H.blade = head; H.bladeMat = head.material; H.bladeBase = new THREE.Color(0xb8bcc4); len = 0.8;
  } else if (kind === 'cleaver') {
    blade(0.2, 1.3, 0xc8ccd4, 0.025); len = 1.45;
    add(pivot, new THREE.BoxGeometry(0.04, 0.3, 0.04), T('#2a1c14'), 0, 0, 0);
  }
  void bladeColor;
  H.bladeLen = len;
  H.tip = new THREE.Object3D(); H.tip.position.y = -len; pivot.add(H.tip);
  H.hiltRef = new THREE.Object3D(); H.hiltRef.position.y = -0.16; pivot.add(H.hiltRef);
}

function shadeHex(hex, k) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, k); return '#' + c.getHexString(); }
