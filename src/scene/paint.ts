/**
 * The painted look, shared by every material in the scene:
 * - aerial perspective: distant things first turn cooler and paler, then dissolve into the fog
 *   (one global change to Three.js's fog chunk, so it costs nothing extra per material);
 * - softer "half-Lambert" light, so low-poly facets read as brush strokes rather than hard planes;
 * - terrain colour painted in the shader from height, slope and noise (meadow, golden patches,
 *   forest, warm rock, violet high rock, snow) instead of one flat colour per facet;
 * - wind sway for trees and reeds, in the vertex shader.
 */
import * as THREE from 'three';

/** Uniforms every patched material reads (updated once per frame by the scene). */
export const sceneUniforms = {
  uTime: { value: 0 },
};

export const NOISE_GLSL = /* glsl */ `
float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float pFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += pNoise(p) * a; p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
`;

/** Half-Lambert: light wraps around facets, so the shading is soft and painterly. */
// Built from the original chunk at import time, before installPaintedLook() replaces it.
const SOFT_LAMBERT = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) * 0.62 + 0.38 ); dotNL *= dotNL;',
);

let installed = false;

/**
 * Install the painted look globally: aerial perspective in the fog chunk and half-Lambert light
 * in the Lambert chunk, so every material (terrain, trees, props, boat) shares it at no extra
 * cost. Call once, before anything compiles.
 */
export function installPaintedLook(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.lights_lambert_pars_fragment = SOFT_LAMBERT;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // Aerial perspective: distance first cools and pales colours (ridges separate into layers),
  // then the fog takes them.
  float apLuma = dot( fogColor, vec3( 0.299, 0.587, 0.114 ) );
  vec3 apTint = mix( fogColor, vec3( apLuma ) * vec3( 0.8, 0.88, 1.06 ), 0.38 );
  float apHaze = smoothstep( fogNear * 0.25, fogFar * 0.7, vFogDepth );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, apTint, apHaze * 0.32 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}

/** Terrain coloured in the shader from world height, slope and noise. */
export function paintedTerrainMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaintPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPaintPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPaintPos;\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec3 p = vPaintPos;
          vec3 fn = normalize(cross(dFdx(p), dFdy(p)));
          float slope = 1.0 - abs(fn.y);
          float h = p.y;
          float n = pFbm(p.xz * 0.035);
          float n2 = pNoise(p.xz * 0.22);
          // Meadow with golden and deep patches.
          vec3 meadow = mix(vec3(0.47, 0.6, 0.31), vec3(0.66, 0.66, 0.33), smoothstep(0.55, 0.75, n));
          meadow = mix(meadow, vec3(0.36, 0.5, 0.29), smoothstep(0.45, 0.25, n));
          vec3 forest = mix(vec3(0.27, 0.4, 0.27), vec3(0.33, 0.44, 0.27), n2);
          vec3 rock = mix(vec3(0.53, 0.48, 0.44), vec3(0.62, 0.55, 0.49), n2);
          // Horizontal strata in the rock, like brush marks.
          rock *= 0.9 + 0.1 * sin(h * 1.7 + n * 6.0);
          vec3 highRock = mix(vec3(0.5, 0.47, 0.55), vec3(0.6, 0.56, 0.62), n2);
          vec3 snow = vec3(0.96, 0.94, 0.92);
          vec3 sand = mix(vec3(0.84, 0.76, 0.59), vec3(0.76, 0.68, 0.52), n2);
          vec3 wet = vec3(0.62, 0.56, 0.45);

          vec3 c = meadow;
          c = mix(c, forest, smoothstep(6.0, 22.0, h + n * 10.0));
          c = mix(c, highRock, smoothstep(55.0, 85.0, h + n * 20.0));
          c = mix(c, rock, smoothstep(0.42, 0.62, slope + n * 0.15));
          c = mix(c, snow, smoothstep(98.0, 112.0, h + n * 18.0) * (1.0 - smoothstep(0.55, 0.75, slope)));
          c = mix(c, sand, (1.0 - smoothstep(0.6, 1.6, h + n2 * 0.6)) * (1.0 - smoothstep(0.35, 0.55, slope)));
          c = mix(c, wet, 1.0 - smoothstep(-0.2, 0.35, h));
          // A little brush grain.
          c *= 0.95 + 0.1 * pNoise(p.xz * 1.3 + p.y);
          diffuseColor.rgb = c;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'painted-terrain';
  return mat;
}

/**
 * Wind sway for instanced plants: the top moves, the base stays put. Each plant gets its own
 * phase from its position, so a forest ripples instead of moving in lockstep.
 */
export function swayingPlantMaterial(strength: number, key: string): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sceneUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 root = instanceMatrix[3].xyz;
          #else
            vec3 root = vec3(0.0);
          #endif
          float k = max(transformed.y, 0.0);
          k = k * k * ${strength.toFixed(4)};
          float phase = root.x * 0.11 + root.z * 0.07;
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + root.x * 0.013);
          transformed.x += sin(uTime * 1.3 + phase) * k * gust;
          transformed.z += cos(uTime * 1.05 + phase * 1.3) * k * 0.6 * gust;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `sway-${key}`;
  return mat;
}
