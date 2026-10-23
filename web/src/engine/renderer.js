import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// HD pipeline: ACES tone mapping, soft shadows from the low sun, bloom,
// screen-space god rays, colour grading, and an optional retro filter
// (reduced resolution + ordered dithering + 15-bit colour) toggled in settings.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSun: { value: new THREE.Vector2(0.5, 0.6) },
    uSunVis: { value: 0 },
    uRayColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
    uHurt: { value: 0 },
    uFade: { value: 1 },
    uRetro: { value: 0 },
    uRetroLines: { value: 300 },
    uSat: { value: 1.08 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform vec2 uSun; uniform float uSunVis; uniform vec3 uRayColor;
    uniform float uHurt; uniform float uFade; uniform float uRetro; uniform float uRetroLines; uniform float uSat;
    varying vec2 vUv;
    float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    float bayer4(vec2 p){
      vec2 q = mod(p, 4.0);
      float b = 0.0;
      b += step(2.0, q.x) * 2.0 + step(2.0, q.y) * 3.0 - step(2.0, q.x) * step(2.0, q.y) * 4.0;
      vec2 r = mod(q, 2.0);
      float s = r.x * 2.0 + r.y * 3.0 - r.x * r.y * 4.0;
      return (s * 4.0 + b) / 16.0 - 0.47;
    }
    void main(){
      vec2 uv = vUv;
      float lines = uRetroLines;
      vec2 cells = vec2(lines * uRes.x / uRes.y, lines);
      if (uRetro > 0.5) uv = (floor(uv * cells) + 0.5) / cells;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (uSunVis > 0.001) {
        vec2 d = (uSun - uv) / 28.0; vec2 p = uv; float w = 1.0; vec3 acc = vec3(0.0);
        for (int i = 0; i < 28; i++) {
          p += d;
          vec3 s = texture2D(tDiffuse, p).rgb;
          acc += s * smoothstep(0.85, 1.6, luma(s)) * w; w *= 0.95;
        }
        c += acc * 0.045 * uSunVis * uRayColor;
      }
      float l = luma(c);
      c = mix(vec3(l), c, uSat);
      // warm highlights, cool shadows
      c *= mix(vec3(0.93, 0.98, 1.06), vec3(1.03, 1.0, 0.96), smoothstep(0.05, 0.7, l));
      float v = length(vUv - 0.5);
      c *= 1.0 - v * v * 0.55;
      c = mix(c, vec3(0.6, 0.04, 0.03), clamp(uHurt * v * v * 2.0, 0.0, 0.75));
      c *= uFade;
      if (uRetro > 0.5) {
        vec3 lin = c;
        c += bayer4(floor(uv * cells)) / 20.0;
        c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5) / 31.0;
        c = mix(lin, c, 0.9);
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, { quality = 'high' } = {}) {
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: !!window.__capture });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.r = r;
    this.retro = false;
    this.maxPR = quality === 'high' ? 1.5 : 1;
  }
  setup(scene, camera) {
    this.scene = scene; this.camera = camera;
    const c = new EffectComposer(this.r);
    c.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.82);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    this.smaa = new SMAAPass(1, 1);
    c.addPass(this.smaa);
    this.composer = c;
  }
  setRetro(on) { this.retro = on; this.grade.uniforms.uRetro.value = on ? 1 : 0; this.smaa.enabled = !on; }
  resize(w, h) {
    const pr = Math.min(window.devicePixelRatio || 1, this.maxPR);
    this.r.setPixelRatio(pr);
    this.r.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.grade.uniforms.uRes.value.set(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setSun(worldPos) {
    const v = worldPos.clone().project(this.camera);
    const u = this.grade.uniforms;
    u.uSun.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    const edge = Math.max(Math.abs(v.x), Math.abs(v.y));
    const facing = this.camera.getWorldDirection(new THREE.Vector3()).dot(worldPos.clone().sub(this.camera.position).normalize());
    u.uSunVis.value = facing > 0 ? Math.max(0, Math.min(1, (1.4 - edge) * 1.2)) * Math.min(1, facing * 2) : 0;
  }
  render() { this.composer.render(); }
}
