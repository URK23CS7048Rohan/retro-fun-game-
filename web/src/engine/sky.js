import * as THREE from 'three';

// Painted anime sky: a vertical gradient warmed toward the sun, a sun disc
// with a wide glow, and two layers of noise clouds whose lighting is banded
// (shadow / mid / gold rim) the way background painters do it.

const vert = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const frag = `
uniform vec3 uTop, uMid, uLow, uHorizon, uGlow, uSunCol, uCloudLit, uCloudMid, uCloudDark;
uniform vec3 uSunDir; uniform float uTime; uniform float uCloudCover;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  // gradient
  vec3 col = mix(uLow, uMid, smoothstep(0.02, 0.32, y));
  col = mix(col, uTop, smoothstep(0.3, 0.85, y));
  col = mix(uHorizon, col, smoothstep(-0.05, 0.06, y));
  col = mix(col, uGlow, pow(sd, 5.0) * 0.75 * (1.0 - smoothstep(0.0, 0.6, y)));
  col += uSunCol * pow(sd, 60.0) * 0.6;
  // clouds projected on a flat ceiling
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.12);
    for (int L = 0; L < 2; L++) {
      float sc = L == 0 ? 0.55 : 1.3;
      vec2 q = uv * sc + vec2(uTime * 0.004 * (1.0 + float(L)), 0.0) + float(L) * 9.0;
      float n = fbm(q);
      float shape = smoothstep(uCloudCover - 0.02 * float(L), uCloudCover + 0.08, n);
      // light comes from the sun side: sample the noise slightly toward the sun
      vec2 toSun = normalize(uSunDir.xz + 0.0001) * 0.06;
      float lit = clamp((n - fbm(q + toSun)) * 9.0 + 0.5, 0.0, 1.0);
      vec3 cc = mix(uCloudDark, uCloudMid, smoothstep(0.25, 0.5, lit));
      cc = mix(cc, uCloudLit, smoothstep(0.55, 0.75, lit + pow(sd, 3.0) * 0.4));
      cc = mix(cc, uGlow * 1.3, pow(sd, 8.0) * 0.8);
      float fade = smoothstep(0.0, 0.12, y) * (L == 0 ? 1.0 : 0.85);
      col = mix(col, cc, shape * fade);
    }
  }
  // bright core
  col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9998, sd) * 3.0;
  gl_FragColor = vec4(col * 0.85, 1.0);
}`;

export const SKY_PRESETS = {
  sunset: {
    top: '#0c1c4e', mid: '#2c4a9a', low: '#e8783a', horizon: '#f59a50', glow: '#ffb848', sun: '#fff0c0',
    cloudLit: '#ffc070', cloudMid: '#d8606a', cloudDark: '#3a3470', cover: 0.52,
    sunDir: [0.22, 0.07, -1], light: '#ffc27a', amb: '#8a9ad8', ground: '#5a4a30',
  },
};

export class Sky {
  constructor(preset = SKY_PRESETS.sunset) {
    this.preset = preset;
    this.sunDir = new THREE.Vector3(...preset.sunDir).normalize();
    const C = (h) => new THREE.Color(h);
    this.uniforms = {
      uTop: { value: C(preset.top) }, uMid: { value: C(preset.mid) }, uLow: { value: C(preset.low) }, uHorizon: { value: C(preset.horizon) },
      uGlow: { value: C(preset.glow) }, uSunCol: { value: C(preset.sun) },
      uCloudLit: { value: C(preset.cloudLit) }, uCloudMid: { value: C(preset.cloudMid) }, uCloudDark: { value: C(preset.cloudDark) },
      uSunDir: { value: this.sunDir }, uTime: { value: 0 }, uCloudCover: { value: preset.cover },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.sunPos = this.sunDir.clone().multiplyScalar(850);
  }
  // Bake the sky into a PMREM so PBR materials pick up its colours as
  // ambient light and reflections.
  envMap(renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const m = this.mesh.clone(); m.material = this.mesh.material.clone(); m.material.uniforms = this.uniforms;
    s.add(m);
    const rt = pm.fromScene(s, 0.02, 1, 1000);
    pm.dispose();
    return rt.texture;
  }
  update(dt, cam) { this.uniforms.uTime.value += dt; this.mesh.position.copy(cam.position); }
}
