/**
 * Lake surface: a gently displaced plane (the same wave function the boat bobs on) with a
 * custom, cheap shader:
 * - ripples from a few travelling waves with analytic normals (no textures);
 * - Fresnel reflection of the sky, with mountain silhouettes reflected near the horizon;
 * - a broad sun sheen plus a glittering path of sparkles;
 * - colour by depth (from the terrain), foam along the shore and a foam ring around the hull.
 * Fog and aerial perspective come from the shared fog chunk (paint.ts).
 */
import * as THREE from 'three';
import { NOISE_GLSL } from './paint';
import { WAVE_GLSL, type HeightField } from './world';

export interface WaterUniforms {
  uTime: { value: number };
  uShallow: { value: THREE.Color };
  uDeep: { value: THREE.Color };
  uSky: { value: THREE.Color };
  uSkyTop: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  /** Boat: x, z, foam strength (0..1), speed (m/s). */
  uBoat: { value: THREE.Vector4 };
  /** 1 on desktop, lower on phones: fine ripples fade sooner. */
  uDetail: { value: number };
}

export interface Water {
  mesh: THREE.Mesh;
  /** Same surface drawn as a wireframe for the Debug view. */
  wire: THREE.Mesh;
  uniforms: WaterUniforms;
}

const VERTEX = /* glsl */ `
uniform float uTime;
attribute float aDepth;
varying float vDepth;
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
${WAVE_GLSL}
void main() {
  vec3 p = position;
  // Calmer right at the shore.
  p.y += waveHeight(p.xz, uTime) * smoothstep(-0.1, 0.25, aDepth);
  vDepth = aDepth;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uSkyTop;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uBoat;
uniform float uDetail;
varying float vDepth;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}

// Slope of a field of travelling waves (gradient of a sum of sines).
vec2 ripples(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 dirs[6] = vec2[6](vec2(1.0, 0.25), vec2(-0.45, 1.0), vec2(0.7, -0.75), vec2(-1.0, -0.35), vec2(0.25, 1.0), vec2(0.9, 0.55));
  float freqs[6] = float[6](0.37, 0.61, 1.03, 1.71, 2.83, 4.69);
  for (int i = 0; i < 6; i++) {
    vec2 d = normalize(dirs[i]);
    float f = freqs[i];
    float ph = dot(d, p) * f + t * (0.8 + f * 0.4) + float(i) * 1.7;
    g += d * cos(ph) * 0.034;
  }
  // Break the regular pattern up with drifting noise (gradient by finite differences).
  vec2 q = p * 0.42 + vec2(t * 0.11, -t * 0.07);
  float n0 = pNoise(q);
  g += vec2(pNoise(q + vec2(0.35, 0.0)) - n0, pNoise(q + vec2(0.0, 0.35)) - n0) * 0.16;
  vec2 q2 = p * 1.3 + vec2(-t * 0.23, t * 0.17);
  float m0 = pNoise(q2);
  g += vec2(pNoise(q2 + vec2(0.3, 0.0)) - m0, pNoise(q2 + vec2(0.0, 0.3)) - m0) * 0.07;
  return g;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // Fine ripples fade with distance so the far lake doesn't shimmer.
  float detail = (1.0 - smoothstep(50.0, 240.0, dist)) * uDetail;
  vec2 g = ripples(vWorld.xz, uTime) * (0.3 + 0.7 * detail);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  float elev = R.y;

  // Reflection: the sky, and the mountains as a ragged band just above the horizon.
  vec3 sky = mix(uSky, uSkyTop, smoothstep(0.08, 0.85, elev) * 0.8);
  float az = atan(R.z, R.x);
  float ridge = 0.03 + 0.05 * pNoise(vec2(az * 4.0, 1.7)) + 0.025 * pNoise(vec2(az * 13.0, 3.1));
  float mountains = 1.0 - smoothstep(ridge - 0.015, ridge + 0.004, elev);
  vec3 mountainColor = mix(vec3(0.16, 0.24, 0.21), fogColor, 0.42);
  vec3 refl = mix(sky, mountainColor, mountains * 0.9);

  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 0.8, vDepth));
  vec3 col = mix(body, refl, clamp(fres * 1.1 + 0.1, 0.0, 0.94));

  // Sun: a broad sheen, a hot core, and sparkles that make the glitter path.
  float sd = max(dot(R, uSunDir), 0.0);
  float sparkle = smoothstep(0.8, 0.97, pNoise(vWorld.xz * 1.7 + vec2(uTime * 0.9, -uTime * 0.6)));
  col += uSunColor * (pow(sd, 36.0) * 0.32 + pow(sd, 420.0) * 2.2 + pow(sd, 14.0) * sparkle * (0.4 + 1.2 * detail));

  // Foam where the water meets the shore, breathing slowly.
  float foam = 1.0 - smoothstep(0.012, 0.07, vDepth);
  foam *= 0.6 + 0.4 * sin(uTime * 1.2 + vDepth * 120.0 + pNoise(vWorld.xz * 0.5) * 6.0);
  // Foam ring around the hull, stronger with speed.
  float bd = distance(vWorld.xz, uBoat.xy);
  float ring = (1.0 - smoothstep(1.2, 2.2 + uBoat.w * 0.25, bd)) * smoothstep(0.7, 1.2, bd);
  ring *= (0.3 + uBoat.z) * smoothstep(0.35, 0.75, pNoise(vWorld.xz * 3.0 + uTime * 2.0));
  col = mix(col, vec3(0.97, 0.95, 0.9), clamp(foam * 0.8 + ring * 0.8, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function buildWater(
  field: HeightField,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  cell: number,
  detail = 1,
): Water {
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  const geo = new THREE.PlaneGeometry(w, d, Math.round(w / cell), Math.round(d / cell));
  geo.rotateX(-Math.PI / 2);
  geo.translate(bounds.minX + w / 2, 0, bounds.minZ + d / 2);

  // Depth per vertex (0 = shore, 1 = deep), used for colour and foam.
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = field.height(pos.getX(i), pos.getZ(i));
    depth[i] = Math.min(1, Math.max(-0.5, -h / 6));
  }
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');

  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color('#79aaa2') },
    uDeep: { value: new THREE.Color('#2d5b6c') },
    uSky: { value: new THREE.Color('#f2d6a8') },
    uSkyTop: { value: new THREE.Color('#7fa7c6') },
    uSunDir: { value: new THREE.Vector3(0.5, 0.25, -0.8).normalize() },
    uSunColor: { value: new THREE.Color('#ffe2b0') },
    uBoat: { value: new THREE.Vector4(0, 0, 0, 0) },
    uDetail: { value: detail },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Water';
  mesh.matrixAutoUpdate = false;

  const wireMat = new THREE.MeshBasicMaterial({ color: '#bfefff', wireframe: true, transparent: true, opacity: 0.35, fog: false });
  wireMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nattribute float aDepth;\n${WAVE_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.y += waveHeight(transformed.xz, uTime) * smoothstep(-0.1, 0.25, aDepth) + 0.02;',
      );
  };
  const wire = new THREE.Mesh(geo, wireMat);
  wire.name = 'WaterWire';
  wire.visible = false;
  wire.matrixAutoUpdate = false;
  return { mesh, wire, uniforms };
}
