import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

// Pixel-art textures drawn on small canvases at load time. Each one is built
// from a short hand-picked palette, so nothing ships as an image file.

const cache = new Map();

function tex(name, w, h, draw, repeat = true) {
  if (cache.has(name)) return cache.get(name);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h, mulberry32(hash(name)));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(name, t);
  return t;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function px(g, x, y, col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
function speckle(g, w, h, r, pal, density = 1) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (r() > density) continue;
      px(g, x, y, pal[Math.floor(r() * pal.length)]);
    }
}

export const Tex = {
  grass: (pal) => tex('grass' + pal.join(), 32, 32, (g, w, h, r) => {
    g.fillStyle = pal[1]; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, pal, 0.55);
    for (let i = 0; i < 40; i++) { // blades
      const x = Math.floor(r() * w), y = Math.floor(r() * h);
      px(g, x, y, pal[3]); px(g, x, (y + 1) % h, pal[2]);
    }
  }),
  dirt: () => tex('dirt', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#7a6347'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, ['#6a543b', '#86705a', '#5c4932', '#917a5e'], 0.6);
  }),
  cobble: () => tex('cobble', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#4b4741'; g.fillRect(0, 0, w, h);
    const stones = ['#8c857a', '#9a9284', '#7d766b', '#a39b8b'];
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 4;
      for (let col = -1; col < 4; col++) {
        const x0 = col * 8 + off + 1, y0 = row * 8 + 1;
        g.fillStyle = stones[Math.floor(r() * stones.length)];
        g.fillRect(x0, y0, 6, 6);
        px(g, x0, y0, '#b3ab9a'); px(g, x0 + 5, y0 + 5, '#5e5850');
      }
    }
    speckle(g, w, h, r, ['#6e675d'], 0.05);
  }),
  stoneWall: () => tex('stonewall', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#5a554c'; g.fillRect(0, 0, w, h);
    const s = ['#a89f8c', '#b5ad99', '#9a917e', '#c2b9a4'];
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 8;
      for (let col = -1; col < 3; col++) {
        const x0 = col * 16 + off + 1, y0 = row * 8 + 1;
        g.fillStyle = s[Math.floor(r() * s.length)];
        g.fillRect(x0, y0, 14, 6);
        g.fillStyle = '#d1c9b3'; g.fillRect(x0, y0, 14, 1);
        g.fillStyle = '#7e7666'; g.fillRect(x0, y0 + 5, 14, 1);
      }
    }
    speckle(g, w, h, r, ['#8d8472', '#c9c0aa'], 0.06);
  }),
  plaster: () => tex('plaster', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#ecdcb8'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, ['#e2cfa8', '#f6e8c8', '#d8c298'], 0.5);
    // timber frame
    g.fillStyle = '#5b3d26';
    g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
    g.fillRect(w / 2 - 1, 0, 2, h);
  }),
  window: () => tex('window', 16, 16, (g, w, h) => {
    g.fillStyle = '#5b3d26'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9b860'; g.fillRect(2, 2, 12, 12);
    g.fillStyle = '#f6d88a'; g.fillRect(3, 3, 4, 4); g.fillRect(9, 3, 4, 4);
    g.fillStyle = '#5b3d26'; g.fillRect(7, 2, 2, 12); g.fillRect(2, 7, 12, 2);
  }, false),
  door: () => tex('door', 16, 32, (g, w, h) => {
    g.fillStyle = '#4a311d'; g.fillRect(0, 0, w, h);
    for (let x = 1; x < w; x += 4) { g.fillStyle = '#6b4a2f'; g.fillRect(x, 1, 3, h - 2); }
    g.fillStyle = '#c9a54a'; g.fillRect(11, 17, 2, 2);
  }, false),
  roof: () => tex('roof', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#5a1e14'; g.fillRect(0, 0, w, h);
    const s = ['#a8382a', '#b8442e', '#9a3024', '#c8563a'];
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 3;
      for (let col = -1; col < 6; col++) {
        g.fillStyle = s[Math.floor(r() * s.length)];
        g.fillRect(col * 6 + off, row * 4, 5, 3);
        g.fillStyle = '#e07a4a'; g.fillRect(col * 6 + off, row * 4, 5, 1);
        g.fillStyle = '#6a2418'; g.fillRect(col * 6 + off, row * 4 + 3, 5, 1);
      }
    }
  }),
  towerWall: () => tex('towerwall', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#2a2838'; g.fillRect(0, 0, w, h);
    const s = ['#4a4658', '#54506a', '#423f52', '#5c5872'];
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 4;
      for (let col = -1; col < 4; col++) { g.fillStyle = s[Math.floor(r() * s.length)]; g.fillRect(col * 8 + off, row * 4, 7, 3); }
    }
    // arched windows, some lit
    for (const x of [4, 20]) {
      const lit = r() < 0.6;
      g.fillStyle = '#16141e'; g.fillRect(x, 10, 6, 12); g.fillRect(x + 1, 9, 4, 1);
      if (lit) { g.fillStyle = '#ffb04a'; g.fillRect(x + 1, 12, 4, 9); g.fillStyle = '#ffe0a0'; g.fillRect(x + 2, 13, 2, 3); }
    }
  }),
  towerTrim: () => tex('towertrim', 16, 16, (g, w, h, r) => {
    g.fillStyle = '#36334a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, ['#4a4660', '#2c2a3c', '#5a5674'], 0.5);
    g.fillStyle = '#6a6488'; g.fillRect(0, 0, w, 1);
  }),
  towerDoor: () => tex('towerdoor', 16, 24, (g) => {
    g.fillStyle = '#16141e'; g.fillRect(0, 0, 16, 24);
    g.fillStyle = '#ff9a3a'; g.fillRect(3, 6, 10, 18); g.fillRect(4, 4, 8, 2); g.fillRect(6, 3, 4, 1);
    g.fillStyle = '#ffd890'; g.fillRect(5, 10, 6, 14);
    g.fillStyle = '#3a2a2a'; g.fillRect(7, 6, 2, 18);
  }, false),
  banner: () => tex('banner', 16, 32, (g) => {
    g.fillStyle = '#9a1e1e'; g.fillRect(0, 0, 16, 32);
    g.fillStyle = '#7a1414'; g.fillRect(0, 0, 1, 32); g.fillRect(15, 0, 1, 32);
    g.fillStyle = '#e8c060'; g.fillRect(0, 0, 16, 2);
    g.fillStyle = '#f4ece0'; g.fillRect(7, 6, 2, 18); g.fillRect(3, 10, 10, 2);
    g.fillStyle = '#9a1e1e'; g.fillRect(0, 28, 4, 4); g.fillRect(12, 28, 4, 4);
    g.clearRect(6, 30, 4, 2);
  }, false),
  sign: (floor) => tex('sign' + floor, 64, 32, (g) => {
    g.fillStyle = '#5a3a22'; g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#6e4a2c'; for (let y = 2; y < 32; y += 5) g.fillRect(0, y, 64, 2);
    g.fillStyle = '#2a1a10'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 31, 64, 1);
    g.fillStyle = '#f0e0c0';
    g.font = 'bold 9px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const ord = floor === 1 ? '1st' : floor === 2 ? '2nd' : floor === 3 ? '3rd' : floor + 'th';
    g.fillText(ord + ' Floor', 32, 9);
    g.font = '8px serif'; g.fillText(floor === 1 ? 'Town of Beginnings' : 'Floor ' + floor + ' Town', 32, 22);
  }, false),
  wood: () => tex('wood', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#6b4a2f'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const c = ['#5e4028', '#77543a', '#6b4a2f'][Math.floor(r() * 3)];
      g.fillStyle = c; g.fillRect(0, y, w, 1);
      if (y % 8 === 0) { g.fillStyle = '#3f2a19'; g.fillRect(0, y, w, 1); }
    }
  }),
  bark: () => tex('bark', 16, 32, (g, w, h, r) => {
    g.fillStyle = '#4e3a28'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 2) {
      g.fillStyle = r() > 0.5 ? '#5f4831' : '#3c2c1d';
      g.fillRect(x, 0, 1, h);
    }
    speckle(g, w, h, r, ['#6d5539', '#33251a'], 0.15);
  }),
  leaves: (pal) => tex('leaves' + pal.join(), 32, 32, (g, w, h, r) => {
    g.fillStyle = pal[0]; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h);
      g.fillStyle = pal[1 + Math.floor(r() * (pal.length - 1))];
      g.fillRect(x, y, 2, 2);
    }
  }),
  rock: () => tex('rock', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#78756d'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, ['#6a675f', '#87847b', '#5d5a53', '#9a968b'], 0.7);
    for (let i = 0; i < 6; i++) { // cracks
      let x = r() * w, y = r() * h;
      for (let k = 0; k < 8; k++) { px(g, Math.floor(x) % w, Math.floor(y) % h, '#4a4843'); x += r() * 2 - 0.5; y += 1; }
    }
  }),
  water: () => tex('water', 32, 32, (g, w, h, r) => {
    g.fillStyle = '#3c6f8a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, ['#457c98', '#356377', '#5390ab'], 0.4);
    for (let i = 0; i < 10; i++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); g.fillStyle = '#9cc6d6'; g.fillRect(x, y, 3, 1); }
  }),
  metal: () => tex('metal', 16, 16, (g, w, h, r) => {
    g.fillStyle = '#9aa1a8'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) { g.fillStyle = y % 3 ? '#a9b0b7' : '#8a9198'; g.fillRect(0, y, w, 1); }
    speckle(g, w, h, r, ['#c4cad0'], 0.08);
  }),
  cloth: (base, dark, light) => tex('cloth' + base + dark + light, 16, 16, (g, w, h, r) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = dark; g.fillRect(0, y, w, 1); }
    speckle(g, w, h, r, [light], 0.06);
  }),
  // Hair: vertical strands with a highlight band, anime style.
  hair: (base, dark, light) => tex('hair' + base + dark + light, 16, 16, (g, w, h, r) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) { if (r() < 0.4) { g.fillStyle = dark; g.fillRect(x, 0, 1, h); } }
    g.fillStyle = light; g.fillRect(0, 4, w, 2);
    for (let x = 0; x < w; x += 3) { g.fillStyle = base; g.fillRect(x, 4, 1, 2); }
  }),
  skin: (base) => tex('skin' + base, 8, 8, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); }, false),
  // Face: drawn pixel by pixel. Front face of the head box uses this texture.
  face: (skin, skinShade, eye, hair, female) => tex('face' + skin + eye + hair + female, 16, 16, (g) => {
    g.fillStyle = skin; g.fillRect(0, 0, 16, 16);
    g.fillStyle = skinShade; g.fillRect(0, 13, 16, 3); // jaw shadow
    // fringe
    g.fillStyle = hair; g.fillRect(0, 0, 16, 4);
    px(g, 3, 4, hair); px(g, 7, 4, hair); px(g, 8, 4, hair); px(g, 12, 4, hair); px(g, 4, 5, hair); px(g, 11, 5, hair);
    // brows
    g.fillStyle = '#2a1d16'; g.fillRect(3, 6, 3, 1); g.fillRect(10, 6, 3, 1);
    // eyes: dark lid, iris, highlight
    g.fillStyle = '#1b1310'; g.fillRect(3, 7, 3, 1); g.fillRect(10, 7, 3, 1);
    g.fillStyle = eye; g.fillRect(4, 8, 2, 2); g.fillRect(10, 8, 2, 2);
    g.fillStyle = '#f4f1ea'; px(g, 3, 8, '#f4f1ea'); px(g, 12, 8, '#f4f1ea');
    px(g, 4, 8, '#ffffff'); px(g, 10, 8, '#ffffff');
    if (female) { px(g, 2, 7, '#1b1310'); px(g, 13, 7, '#1b1310'); }
    // nose + mouth
    px(g, 8, 10, skinShade); px(g, 8, 11, skinShade);
    g.fillStyle = female ? '#a8574a' : '#7d4a3c'; g.fillRect(7, 13, 3, 1);
  }, false),
  kobold: () => tex('kobold', 16, 16, (g, w, h, r) => {
    g.fillStyle = '#7b6a4c'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, ['#6b5b3f', '#8a7958', '#5d4f36'], 0.6);
  }),
  koboldFace: () => tex('koboldface', 16, 16, (g) => {
    g.fillStyle = '#7b6a4c'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#e8c33a'; g.fillRect(2, 6, 4, 2); g.fillRect(10, 6, 4, 2);
    g.fillStyle = '#1b1310'; g.fillRect(4, 6, 1, 2); g.fillRect(11, 6, 1, 2);
    g.fillStyle = '#4a3d29'; g.fillRect(1, 4, 5, 1); g.fillRect(10, 4, 5, 1);
  }, false),
  fur: (base, dark, light) => tex('fur' + base, 16, 16, (g, w, h, r) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h);
      g.fillStyle = r() > 0.5 ? dark : light; g.fillRect(x, y, 1, 2);
    }
  }),
  gate: () => tex('gate', 32, 8, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const t = (Math.sin(x / w * Math.PI * 4) + 1) / 2;
      g.fillStyle = t > 0.5 ? '#9fe3ff' : '#4fa8d8'; g.fillRect(x, 0, 1, h);
    }
    g.fillStyle = '#e8fbff'; g.fillRect(0, 3, w, 2);
  }),
};

export function solid(hex) {
  return tex('solid' + hex, 2, 2, (g) => { g.fillStyle = hex; g.fillRect(0, 0, 2, 2); }, false);
}
