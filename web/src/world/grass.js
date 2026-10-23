import * as THREE from 'three';

// GPU grass: a fixed set of blade instances laid out on a square tile that
// wraps around the camera (each blade snaps to the copy of its tile nearest
// the player), so the field follows you with zero CPU work per frame. Height
// and density come from textures baked from the terrain; wind and the
// player's footsteps bend the blades in the vertex shader.

const vert = `
precision highp float;
attribute vec3 position;
attribute vec2 offset;
attribute float seed;
uniform mat4 modelViewMatrix, projectionMatrix, viewMatrix;
uniform sampler2D tHeight, tMask;
uniform float uHalf, uTile, uTime, uRadius;
uniform vec3 uCenter, uPlayer;
varying float vH; varying float vShade; varying vec3 vWorld; varying float vSeed;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main(){
  vec2 o = offset;
  vec2 wp = o + uTile * floor((uCenter.xz - o) / uTile + 0.5);
  vec2 huv = (wp + uHalf) / (2.0 * uHalf);
  float ground = texture2D(tHeight, huv).r;
  float mask = texture2D(tMask, huv).r;
  float d = distance(wp, uCenter.xz);
  float fade = smoothstep(uRadius, uRadius * 0.7, d);
  float r = hash(wp * 1.7 + seed);
  float keep = step(r, mask * 1.4);
  float hgt = (0.16 + r * 0.28) * fade * keep * smoothstep(0.15, 0.5, mask);
  vec3 p = position;
  float t = p.y;            // 0 at the root, 1 at the tip
  vH = t; vSeed = r;
  float ang = hash(wp + 3.1) * 6.2831;
  float c = cos(ang), s = sin(ang);
  p.xz = mat2(c, -s, s, c) * (p.xz * (0.7 + r * 0.6));
  p.y *= hgt;
  // wind: big slow gusts plus a quick flutter
  float gust = sin(uTime * 1.3 + wp.x * 0.09 + wp.y * 0.06) * 0.5 + 0.5;
  float flutter = sin(uTime * 4.5 + r * 30.0 + wp.x * 0.7) * 0.25;
  vec2 bend = vec2(0.55, 0.25) * (gust * 0.9 + flutter) * t * t * hgt;
  // footsteps push blades away from the player
  vec2 away = wp - uPlayer.xz; float pd = length(away);
  bend += (pd < 1.4 ? normalize(away + 0.0001) * (1.4 - pd) * 0.7 : vec2(0.0)) * t * hgt;
  p.xz += bend; p.y -= dot(bend, bend) * 0.4;
  vec3 world = vec3(wp.x, ground - 0.02, wp.y) + p;
  vWorld = world;
  vShade = 0.65 + 0.35 * gust;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const frag = `
precision highp float;
uniform vec3 uBase, uTip, uDry, uSunDir, uSunCol, uAmb, uFogColor, uCam;
uniform float uFogDensity;
varying float vH; varying float vShade; varying vec3 vWorld; varying float vSeed;
void main(){
  vec3 col = mix(uBase, mix(uTip, uDry, smoothstep(0.75, 1.0, vSeed) * 0.6), smoothstep(0.0, 1.0, vH));
  vec3 v = normalize(vWorld - uCam);
  float back = pow(max(dot(v, uSunDir), 0.0), 3.0);
  vec3 lit = col * (uAmb + uSunCol * (0.55 * vShade)) + uSunCol * col * back * vH * 1.6;
  lit *= mix(0.55, 1.0, vH);
  float dist = length(vWorld - uCam);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  gl_FragColor = vec4(mix(lit, uFogColor, f), 1.0);
}`;

export class GrassField {
  constructor(world, density = 1) {
    const N = world.N, half = (N - 1) * 2 / 2;
    // height and density textures (half float so they filter linearly on mobile)
    const hd = new Uint16Array(N * N), md = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i * 2 - half, z = j * 2 - half;
      hd[j * N + i] = THREE.DataUtils.toHalfFloat(world.hgrid[j * N + i]);
      const w = world.splat(x, z);
      const R = Math.hypot(x, z);
      let m = w[0] * 1.0 + w[1] * 0.45;
      if (R > 118 - 5) m = 0;
      m *= world.blocked(x, z, 0.2) ? 0.15 : 1;
      const ii = Math.min(N - 2, Math.max(1, i)), jj = Math.min(N - 2, Math.max(1, j));
      const slope = Math.hypot(world.hgrid[j * N + ii + 1] - world.hgrid[j * N + ii - 1], world.hgrid[(jj + 1) * N + i] - world.hgrid[(jj - 1) * N + i]) / 4;
      m *= Math.max(0, Math.min(1, 1 - (slope - 0.45) * 2.5));
      md[j * N + i] = Math.round(Math.max(0, Math.min(1, m)) * 255);
    }
    const tH = new THREE.DataTexture(hd, N, N, THREE.RedFormat, THREE.HalfFloatType);
    tH.magFilter = tH.minFilter = THREE.LinearFilter; tH.needsUpdate = true;
    const tM = new THREE.DataTexture(md, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    tM.magFilter = tM.minFilter = THREE.LinearFilter; tM.needsUpdate = true;

    // blade: 3 segments + tip
    const bw = 0.028;
    const pos = [-bw, 0, 0, bw, 0, 0, -bw * 0.8, 0.4, 0, bw * 0.8, 0.4, 0, -bw * 0.5, 0.75, 0, bw * 0.5, 0.75, 0, 0, 1, 0];
    const idx = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];
    const tile = 56, spacing = 0.17 / Math.sqrt(density);
    const n = Math.floor(tile / spacing);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const off = new Float32Array(n * n * 2), seed = new Float32Array(n * n);
    let k = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      off[k * 2] = (i + Math.random()) * spacing; off[k * 2 + 1] = (j + Math.random()) * spacing; seed[k] = Math.random(); k++;
    }
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 2));
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.instanceCount = n * n;
    this.uniforms = {
      tHeight: { value: tH }, tMask: { value: tM }, uHalf: { value: half }, uTile: { value: tile }, uTime: { value: 0 }, uRadius: { value: tile * 0.48 },
      uCenter: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3(999, 0, 999) },
      uBase: { value: new THREE.Color('#1f3a12') }, uTip: { value: new THREE.Color('#9cc848') }, uDry: { value: new THREE.Color('#d8c060') },
      uSunDir: { value: new THREE.Vector3(0, 0.1, -1) }, uSunCol: { value: new THREE.Color('#ffc27a') }, uAmb: { value: new THREE.Color('#6a7aa8') },
      uFogColor: { value: new THREE.Color('#e8a465') }, uFogDensity: { value: 0.006 }, uCam: { value: new THREE.Vector3() },
    };
    const mat = new THREE.RawShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }
  setLighting({ sunDir, sunCol, amb, fogColor, fogDensity }) {
    const u = this.uniforms;
    if (sunDir) u.uSunDir.value.copy(sunDir);
    if (sunCol) u.uSunCol.value.set(sunCol);
    if (amb) u.uAmb.value.set(amb);
    if (fogColor) u.uFogColor.value.set(fogColor);
    if (fogDensity !== undefined) u.uFogDensity.value = fogDensity;
  }
  update(t, player, cam) {
    this.uniforms.uTime.value = t;
    if (player) this.uniforms.uPlayer.value.copy(player);
    const c = cam || player;
    if (c) { this.uniforms.uCenter.value.copy(c); this.uniforms.uCam.value.copy(c); }
  }
}
