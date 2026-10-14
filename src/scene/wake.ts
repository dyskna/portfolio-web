/**
 * Wake: a ribbon laid along the route behind the boat. It lengthens, widens and brightens
 * with boat speed, and fades out slowly after the boat stops.
 */
import * as THREE from 'three';
import type { Route, RouteSample } from '../sim/route';
import { WAVE_GLSL } from './world';

const SEGMENTS = 48;

export class Wake {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly sample: RouteSample = { x: 0, z: 0, tx: 0, tz: -1 };
  private intensity = 0;
  private length = 4;
  private readonly uniforms = { uTime: { value: 0 }, uIntensity: { value: 0 } };

  constructor(private readonly route: Route) {
    const verts = (SEGMENTS + 1) * 2;
    this.positions = new Float32Array(verts * 3);
    const across = new Float32Array(verts);
    const along = new Float32Array(verts);
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      across[i * 2] = -1;
      across[i * 2 + 1] = 1;
      along[i * 2] = along[i * 2 + 1] = i / SEGMENTS;
      if (i < SEGMENTS) {
        const a = i * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
    geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    geo.setIndex(index);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute float aAcross;
        attribute float aAlong;
        varying float vAcross;
        varying float vAlong;
        varying vec2 vWorld;
        ${WAVE_GLSL}
        void main() {
          vAcross = aAcross;
          vAlong = aAlong;
          vec3 p = position;
          p.y = waveHeight(p.xz, uTime) + 0.06;
          vWorld = p.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        varying float vAcross;
        varying float vAlong;
        varying vec2 vWorld;
        void main() {
          float a = abs(vAcross);
          // Two V-shaped arms at the edges, and churned water right behind the stern.
          float arms = smoothstep(0.62, 0.9, a) * (1.0 - smoothstep(0.93, 1.0, a));
          float churn = (1.0 - smoothstep(0.0, 0.45, a)) * (1.0 - smoothstep(0.0, 0.3, vAlong));
          float breakup = 0.65 + 0.35 * sin(vWorld.x * 2.3 + uTime * 2.0) * sin(vWorld.y * 1.9 - uTime * 1.6);
          float fade = (1.0 - smoothstep(0.35, 1.0, vAlong)) * smoothstep(0.0, 0.04, vAlong);
          float alpha = (arms * 0.85 + churn * 0.6) * breakup * fade * uIntensity;
          gl_FragColor = vec4(vec3(0.97, 0.95, 0.9), alpha);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'Wake';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** s: boat route position; speed: model speed in m/s (signed). */
  update(s: number, speed: number, time: number, dt: number): void {
    const target = Math.min(1, Math.max(0, (Math.abs(speed) - 0.4) / 5));
    // Builds fast, dies away slowly like real foam.
    const rate = target > this.intensity ? 3 : 0.7;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt * rate));
    const targetLen = 5 + Math.abs(speed) * 4.5;
    this.length += (targetLen - this.length) * (1 - Math.exp(-dt * 1.2));
    this.uniforms.uTime.value = time;
    this.uniforms.uIntensity.value = this.intensity;
    this.mesh.visible = this.intensity > 0.01;
    if (!this.mesh.visible) return;

    const dir = speed >= 0 ? 1 : -1;
    const p = this.positions;
    for (let i = 0; i <= SEGMENTS; i++) {
      const k = i / SEGMENTS;
      const d = 1.6 + k * this.length; // starts at the stern
      const q = this.route.sample(s - dir * d, this.sample);
      const half = 0.45 + k * this.length * 0.32 * (0.5 + this.intensity * 0.5);
      // Right-hand normal of the tangent.
      const rx = -q.tz;
      const rz = q.tx;
      p[i * 6] = q.x - rx * half;
      p[i * 6 + 1] = 0;
      p[i * 6 + 2] = q.z - rz * half;
      p[i * 6 + 3] = q.x + rx * half;
      p[i * 6 + 4] = 0;
      p[i * 6 + 5] = q.z + rz * half;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
