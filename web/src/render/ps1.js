import * as THREE from 'three';

// PS1-style rendering: the scene renders into a small target, then a post pass
// applies ordered (Bayer) dithering and 15-bit colour quantisation before the
// image is upscaled with nearest-neighbour filtering. Materials snap their
// vertices to the low-res pixel grid, which gives the classic geometry wobble.

export const PS1 = {
  snap: { value: new THREE.Vector2(320, 180) },
};

export function ps1Material(opts = {}) {
  const m = new THREE.MeshLambertMaterial(opts);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = PS1.snap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uSnap;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 sp = gl_Position;
        sp.xyz /= sp.w;
        sp.xy = floor(sp.xy * uSnap * 0.5 + 0.5) / (uSnap * 0.5);
        sp.xyz *= sp.w;
        gl_Position = sp;`
      );
  };
  return m;
}

export function ps1Basic(opts = {}) {
  const m = new THREE.MeshBasicMaterial(opts);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = PS1.snap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uSnap;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 sp = gl_Position; sp.xyz /= sp.w;
        sp.xy = floor(sp.xy * uSnap * 0.5 + 0.5) / (uSnap * 0.5);
        sp.xyz *= sp.w; gl_Position = sp;`
      );
  };
  return m;
}

const POST_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uFade;
uniform float uHurt;
uniform float uTime;
uniform vec2 uSun;      // sun position in uv
uniform float uSunVis;  // 0 when the sun is off-screen or behind
uniform vec3 uShadowTint;
uniform vec3 uLightTint;
uniform float uSat;
varying vec2 vUv;
float bayer(vec2 p){
  int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
  m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  float r = 0.0;
  for (int k = 0; k < 16; k++) { if (k == i) r = m[k]; }
  return r / 16.0 - 0.5;
}
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 bright(vec2 uv){ vec3 c = texture2D(tScene, uv).rgb; return c * smoothstep(0.72, 1.0, luma(c)); }
void main(){
  vec2 px = 1.0 / uRes;
  vec3 c = texture2D(tScene, vUv).rgb;
  // bloom: a small ring of taps around the pixel
  vec3 bl = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    vec2 o = vec2(cos(a), sin(a));
    bl += bright(vUv + o * px * 2.5) + bright(vUv + o * px * 6.0) * 0.6;
  }
  c += bl * 0.045;
  // god rays: march toward the sun, accumulating bright sky
  if (uSunVis > 0.0) {
    vec2 d = (uSun - vUv) / 20.0;
    vec2 uv = vUv; float w = 1.0; vec3 rays = vec3(0.0);
    for (int i = 0; i < 20; i++) { uv += d; rays += bright(uv) * w; w *= 0.93; }
    c += rays * 0.05 * uSunVis * vec3(1.0, 0.75, 0.45);
  }
  // grade: saturation, split toning, gentle S-curve
  c = clamp(c, 0.0, 1.0);
  float l = luma(c);
  c = clamp(mix(vec3(l), c, uSat), 0.0, 1.0);
  c = mix(c * uShadowTint, c * uLightTint, smoothstep(0.0, 0.8, l));
  c = c * c * (3.0 - 2.0 * c) * 0.35 + c * 0.65;
  float v = length(vUv - 0.5) * 1.4;
  c *= 1.0 - v * v * 0.25;
  c = mix(c, vec3(0.55, 0.05, 0.04), clamp(uHurt * v * v, 0.0, 0.7));
  c *= uFade;
  c += bayer(floor(vUv * uRes)) * (1.0 / 28.0);
  c = floor(c * 31.0 + 0.5) / 31.0;
  gl_FragColor = vec4(c, 1.0);
}`;

export class PS1Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.target = new THREE.WebGLRenderTarget(320, 180, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(320, 180) },
        uFade: { value: 1 }, uHurt: { value: 0 }, uTime: { value: 0 },
        uSun: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 },
        uShadowTint: { value: new THREE.Color(0.78, 0.9, 1.12) }, uLightTint: { value: new THREE.Color(1.06, 1.0, 0.94) }, uSat: { value: 1.12 },
      },
      vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.lines = 300;
  }
  resize(w, h, camera) {
    // Internal resolution keeps a fixed vertical line count, like a CRT mode.
    const lines = this.lines;
    const iw = Math.round((lines * w) / h), ih = lines;
    this.renderer.setSize(iw, ih, false);
    this.target.setSize(iw, ih);
    this.postMat.uniforms.uRes.value.set(iw, ih);
    PS1.snap.value.set(iw * 0.5, ih * 0.5);
    if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }
  setSun(worldPos, camera) {
    const v = worldPos.clone().project(camera);
    const u = this.postMat.uniforms;
    u.uSun.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    const inFront = v.z < 1;
    const edge = Math.max(Math.abs(v.x), Math.abs(v.y));
    u.uSunVis.value = inFront ? Math.max(0, 1 - Math.max(0, edge - 0.9) * 2) : 0;
  }
  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }
}

// Cel shading for characters: a 3-step ramp plus inverted-hull outlines.
let ramp = null;
function toonRamp() {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}
function snapPatch(shader, extra = '') {
  shader.uniforms.uSnap = PS1.snap;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec2 uSnap;\nuniform float uOutline;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + extra)
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 sp = gl_Position; sp.xyz /= sp.w;
      sp.xy = floor(sp.xy * uSnap * 0.5 + 0.5) / (uSnap * 0.5);
      sp.xyz *= sp.w; gl_Position = sp;`
    );
}
export function ps1Toon(opts = {}) {
  const m = new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...opts });
  m.onBeforeCompile = (s) => { s.uniforms.uOutline = { value: 0 }; snapPatch(s); };
  return m;
}
const outlineUniform = { value: 0.011 };
export function outlineMat(color = 0x120e12) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (s) => { s.uniforms.uOutline = outlineUniform; snapPatch(s, 'transformed += normal * uOutline;'); };
  return m;
}
