/**
 * Sky dome and lighting that drift from golden hour toward sunset as the page scrolls.
 * Moments can push it further (harbour) or override the fog (EscapeFromWEII).
 */
import * as THREE from 'three';
import { NOISE_GLSL, sceneUniforms } from './paint';
import type { WaterUniforms } from './water';

interface Key {
  t: number;
  sunElevation: number; // degrees
  sunAzimuth: number; // degrees from -z toward +x
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  skyTop: string;
  skyHorizon: string;
  fog: string;
  waterShallow: string;
  waterDeep: string;
  waterSky: string;
}

const KEYS: Key[] = [
  {
    t: 0, sunElevation: 16, sunAzimuth: 58, sun: '#ffe2b0', sunIntensity: 2.8,
    hemiSky: '#c9dbe6', hemiGround: '#7a6a52', hemiIntensity: 1.45,
    skyTop: '#7fa7c6', skyHorizon: '#f6dfb5', fog: '#e6d8c0',
    waterShallow: '#6fb2ae', waterDeep: '#2b7290', waterSky: '#f4dcb0',
  },
  {
    t: 0.55, sunElevation: 9, sunAzimuth: 28, sun: '#ffcb8a', sunIntensity: 2.6,
    hemiSky: '#d9cdc6', hemiGround: '#776050', hemiIntensity: 1.4,
    skyTop: '#7f9bc2', skyHorizon: '#f8ca92', fog: '#eccaa0',
    waterShallow: '#79aca6', waterDeep: '#2f6a8a', waterSky: '#f6c88f',
  },
  {
    t: 1, sunElevation: 3, sunAzimuth: -12, sun: '#ffa468', sunIntensity: 2.2,
    hemiSky: '#d6b3b8', hemiGround: '#6a4d5c', hemiIntensity: 1.35,
    skyTop: '#5f6c9c', skyHorizon: '#f6a06a', fog: '#e2a888',
    waterShallow: '#8ea0ae', waterDeep: '#3b5482', waterSky: '#f4a878',
  },
  {
    // Afterglow: only reached when the harbour moment pushes past the end of the route.
    t: 1.2, sunElevation: -0.5, sunAzimuth: -18, sun: '#ff8a5a', sunIntensity: 1.5,
    hemiSky: '#b8a0bc', hemiGround: '#4e3a52', hemiIntensity: 1.2,
    skyTop: '#46507f', skyHorizon: '#f08a62', fog: '#cf9488',
    waterShallow: '#7d8aa2', waterDeep: '#33467a', waterSky: '#ef9670',
  },
];

const colorCache = new Map<string, THREE.Color>();
const col = (hex: string) => {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)));
  return c;
};

export type MoodName = 'dusk' | 'fog' | 'night' | 'violet';

interface Mood {
  skyTop: string;
  horizon: string;
  fog: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  waterShallow: string;
  waterDeep: string;
  waterSky: string;
}

/** Colour worlds for chapters, like each club having its own colours in a story. */
const MOODS: Record<MoodName, Mood> = {
  // Chery: warm magenta dusk under the pixel-art pass.
  dusk: {
    skyTop: '#3e2b55', horizon: '#f2895c', fog: '#c9806e', sun: '#ff9a66', sunIntensity: 2.0,
    hemiSky: '#cf9fb2', hemiGround: '#4d3344', hemiIntensity: 1.25,
    waterShallow: '#7f7aa0', waterDeep: '#2d3a66', waterSky: '#f2a07e',
  },
  // EscapeFromWEII: cold grey; the fog itself comes from the moment.
  fog: {
    skyTop: '#6f7680', horizon: '#b9b6bd', fog: '#a9a7ad', sun: '#d8d4cf', sunIntensity: 1.2,
    hemiSky: '#b8bcc4', hemiGround: '#3c3f45', hemiIntensity: 1.3,
    waterShallow: '#7d8890', waterDeep: '#2f3d48', waterSky: '#b0b2b8',
  },
  // Multiplayer Sumo: navy blue hour, so the ghost boat glows.
  night: {
    skyTop: '#0c1a3d', horizon: '#4c64a3', fog: '#2f3f6e', sun: '#9ab4ff', sunIntensity: 0.9,
    hemiSky: '#6d84c4', hemiGround: '#141b33', hemiIntensity: 1.35,
    waterShallow: '#3a548a', waterDeep: '#101f45', waterSky: '#5670ad',
  },
  // Thesis: violet twilight.
  violet: {
    skyTop: '#291d4a', horizon: '#cc7f8c', fog: '#77587c', sun: '#ffb38a', sunIntensity: 1.4,
    hemiSky: '#a38abb', hemiGround: '#2b2036', hemiIntensity: 1.25,
    waterShallow: '#6b6a9c', waterDeep: '#252957', waterSky: '#c48ca2',
  },
};

export interface FogOverride {
  weight: number;
  color: THREE.Color;
  near: number;
  far: number;
}

export class Atmosphere {
  readonly sky: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight('#ffffff', 2.5);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1.2);
  readonly fog: THREE.Fog;
  readonly sunDirection = new THREE.Vector3();
  /** Added to the scroll-driven time of day (harbour moment). */
  extraTime = 0;
  /** Set by a moment to thicken the fog. */
  fogOverride: FogOverride | null = null;
  /** Chapter colour worlds and how strongly each applies (0..1); two can overlap mid-change. */
  readonly moods = new Map<MoodName, number>();
  /** Current time of day, 0 = golden hour, 1 = sunset. */
  t = 0;

  private readonly skyUniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uFogMix: { value: 0 },
    uFogColor: { value: new THREE.Color() },
    uTime: sceneUniforms.uTime,
  };
  private readonly baseNear = 60;
  private readonly baseFar = 950;
  private readonly lightDir = new THREE.Vector3();

  /** cloudOctaves: 4 on desktop, 3 on phones. */
  constructor(
    private readonly water: WaterUniforms,
    cloudOctaves = 4,
  ) {
    this.fog = new THREE.Fog('#e8d6ba', this.baseNear, this.baseFar);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        defines: { CLOUD_OCTAVES: cloudOctaves },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww; // always at the far plane
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uBottom;
          uniform vec3 uSunColor;
          uniform vec3 uSunDir;
          uniform float uFogMix;
          uniform vec3 uFogColor;
          uniform float uTime;
          varying vec3 vDir;
          ${NOISE_GLSL}
          float cloudFbm(vec2 p) {
            float sum = 0.0, a = 0.5, norm = 0.0;
            for (int i = 0; i < CLOUD_OCTAVES; i++) { sum += pNoise(p) * a; norm += a; p = p * 2.1 + 9.7; a *= 0.5; }
            return sum / norm;
          }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, h), 0.75));
            col = mix(col, uBottom, smoothstep(0.0, -0.08, h));
            float s = max(dot(d, uSunDir), 0.0);
            // Warm glow around the sun, brighter along the horizon, with a wide soft halo.
            col += uSunColor * (pow(s, 6.0) * 0.32 + pow(s, 48.0) * 0.55 + pow(s, 2.0) * 0.08) * (1.0 - smoothstep(0.0, 0.5, h) * 0.5);

            // Soft drifting clouds on a high layer, lit from the sun's side.
            if (h > 0.0) {
              vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
              float n = cloudFbm(uv);
              float cover = smoothstep(0.5, 0.78, n) * smoothstep(0.0, 0.18, h);
              // Brighter where facing the sun, a little shadow in the thick parts.
              float lit = 0.55 + 0.45 * pow(s, 3.0);
              vec3 cloud = mix(uHorizon * 0.92, mix(vec3(1.0, 0.97, 0.92), uSunColor, 0.35), lit);
              cloud = mix(cloud, uTop * 0.85 + uHorizon * 0.15, smoothstep(0.72, 0.95, n) * 0.35);
              col = mix(col, cloud, cover * 0.82);
            }

            // Sun disc, softly veiled by clouds.
            col = mix(col, vec3(1.0, 0.97, 0.88), smoothstep(0.9993, 0.9996, s));
            col = mix(col, uFogColor, uFogMix);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.name = 'Sky';
    this.sky.frustumCulled = false;
    // Drawn after all opaque objects: at the far plane, only pixels no mountain or water covers get shaded.
    this.sky.renderOrder = 1000;
    this.sun.name = 'Sun';
    this.hemi.name = 'Hemisphere';
  }

  update(progress: number, focus: THREE.Vector3): void {
    const t = Math.min(1.2, progress + this.extraTime);
    this.t = t;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t < t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    const lerpC = (ka: string, kb: string, out: THREE.Color) => out.copy(col(ka)).lerp(col(kb), k);
    const lerpN = (x: number, y: number) => x + (y - x) * k;

    const elev = THREE.MathUtils.degToRad(lerpN(a.sunElevation, b.sunElevation));
    const az = THREE.MathUtils.degToRad(lerpN(a.sunAzimuth, b.sunAzimuth));
    this.sunDirection.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev));

    // The light keeps a minimum height so the scene never goes flat-black at the end.
    const lightDir = this.lightDir.copy(this.sunDirection);
    lightDir.y = Math.max(lightDir.y, 0.06);
    this.sun.position.copy(focus).addScaledVector(lightDir.normalize(), 300);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    lerpC(a.sun, b.sun, this.sun.color);
    this.sun.intensity = lerpN(a.sunIntensity, b.sunIntensity);
    lerpC(a.hemiSky, b.hemiSky, this.hemi.color);
    lerpC(a.hemiGround, b.hemiGround, this.hemi.groundColor);
    this.hemi.intensity = lerpN(a.hemiIntensity, b.hemiIntensity);

    const u = this.skyUniforms;
    lerpC(a.skyTop, b.skyTop, u.uTop.value);
    lerpC(a.skyHorizon, b.skyHorizon, u.uHorizon.value);
    u.uBottom.value.copy(u.uHorizon.value).multiplyScalar(0.85);
    u.uSunColor.value.copy(this.sun.color);
    u.uSunDir.value.copy(this.sunDirection);

    lerpC(a.fog, b.fog, this.fog.color);
    lerpC(a.waterShallow, b.waterShallow, this.water.uShallow.value);
    lerpC(a.waterDeep, b.waterDeep, this.water.uDeep.value);
    lerpC(a.waterSky, b.waterSky, this.water.uSky.value);
    this.applyMoods();
    u.uBottom.value.copy(u.uHorizon.value).multiplyScalar(0.85);
    u.uSunColor.value.copy(this.sun.color);
    this.water.uSkyTop.value.copy(u.uTop.value);
    this.water.uSunDir.value.copy(this.sunDirection);
    this.water.uSunColor.value.copy(this.sun.color).multiplyScalar(Math.min(1.2, this.sun.intensity / 2.4));

    this.fog.near = this.baseNear;
    this.fog.far = this.baseFar;
    u.uFogMix.value = 0;
    const o = this.fogOverride;
    if (o && o.weight > 0) {
      const w = o.weight;
      this.fog.color.lerp(o.color, w);
      this.fog.near = THREE.MathUtils.lerp(this.baseNear, o.near, w);
      this.fog.far = THREE.MathUtils.lerp(this.baseFar, o.far, w);
      u.uFogMix.value = w * 0.85;
      u.uFogColor.value.copy(this.fog.color);
      this.sun.intensity *= 1 - 0.45 * w;
    }

    if (o && o.weight > 0) this.water.uSky.value.lerp(o.color, o.weight);
  }

  /** Blend the current light and colours toward the chapters' colour worlds. */
  private applyMoods(): void {
    for (const [name, w] of this.moods) if (w > 0.001) this.applyMood(MOODS[name], w);
  }

  private applyMood(m: Mood, w: number): void {
    const u = this.skyUniforms;
    u.uTop.value.lerp(col(m.skyTop), w);
    u.uHorizon.value.lerp(col(m.horizon), w);
    this.fog.color.lerp(col(m.fog), w);
    this.sun.color.lerp(col(m.sun), w);
    this.sun.intensity += (m.sunIntensity - this.sun.intensity) * w;
    this.hemi.color.lerp(col(m.hemiSky), w);
    this.hemi.groundColor.lerp(col(m.hemiGround), w);
    this.hemi.intensity += (m.hemiIntensity - this.hemi.intensity) * w;
    this.water.uShallow.value.lerp(col(m.waterShallow), w);
    this.water.uDeep.value.lerp(col(m.waterDeep), w);
    this.water.uSky.value.lerp(col(m.waterSky), w);
  }

  /** Background colour for the renderer clear (matches the fog). */
  get clearColor(): THREE.Color {
    return this.fog.color;
  }
}
