/**
 * Moment: Chery the Game. Near this card the lake turns into pixel art: the scene renders
 * into a smaller area of a target (pixels grow with the effect) and is shown with
 * nearest-neighbour sampling, a reduced palette and ordered dithering.
 */
import * as THREE from 'three';
import { compileInSlices } from '../compile';
import type { Moment, MomentContext } from './types';

const MAX_PIXEL = 6; // device pixels per art pixel at full strength

/** A 16×16 pixel-art cherry, drawn pixel by pixel. */
function cherryTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  const px = (x: number, y: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  };
  // Stems from the top joint down to each cherry, and a leaf.
  for (let i = 0; i <= 6; i++) {
    px(9 - Math.round(i * 0.6), 2 + i, '#3d6b2f');
    px(9 + Math.round(i * 0.35), 2 + i, '#3d6b2f');
  }
  for (const [x, y] of [[10, 1], [11, 1], [12, 2], [11, 2], [10, 2]]) px(x, y, '#5f9a3c');
  // Two round cherries with a dark rim and a highlight.
  for (const [cx, cy] of [[5.5, 11.5], [11.5, 11.5]]) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < 3.4) px(x, y, d > 2.6 ? '#7a1424' : '#d6283c');
      }
    }
    px(Math.floor(cx) - 1, Math.floor(cy) - 2, '#ffd0d6');
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function create(ctx: MomentContext): Moment {
  const { renderer, scene, camera } = ctx;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  // Clear only the corner the art uses.
  target.scissorTest = true;
  const uniforms = {
    tScene: { value: target.texture },
    /** Part of the target the art fills (its corner, w/W and h/H). */
    uScale: { value: new THREE.Vector2(1, 1) },
    uWeight: { value: 0 },
    uPixel: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform vec2 uScale;
      uniform float uWeight;
      uniform float uPixel;
      varying vec2 vUv;

      float bayer4(vec2 p) {
        ivec2 i = ivec2(mod(p, 4.0));
        int idx = i.x + i.y * 4;
        int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
        return float(m[idx]) / 16.0;
      }

      void main() {
        vec3 color = texture2D(tScene, vUv * uScale).rgb;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // Limited palette with ordered dithering, in art-pixel space.
        vec3 c = gl_FragColor.rgb;
        float levels = mix(24.0, 9.0, uWeight);
        float d = bayer4(floor(gl_FragCoord.xy / uPixel)) - 0.5;
        vec3 q = floor(c * levels + 0.5 + d * 0.35) / levels;
        // A touch more saturation, like a 16-bit palette.
        float l = dot(q, vec3(0.299, 0.587, 0.114));
        q = mix(vec3(l), q, 1.0 + 0.15 * uWeight);
        gl_FragColor.rgb = mix(c, clamp(q, 0.0, 1.0), smoothstep(0.0, 0.5, uWeight));
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const size = new THREE.Vector2();
  let pixel = 1;

  /**
   * One target at full resolution, allocated up front (and again only on resize): the art renders
   * into its corner, so the pixel size can grow every few frames without reallocating mid-scroll.
   */
  const fitTarget = () => {
    renderer.getDrawingBufferSize(size);
    if (target.width === size.x && target.height === size.y) return false;
    target.setSize(size.x, size.y);
    return true;
  };

  // The stop's artifact: a pixel cherry floating over a little raft, to port of the boat.
  const artifact = new THREE.Group();
  artifact.name = 'CheryArtifact';
  const at = ctx.route.sample(ctx.anchorS + 12);
  artifact.position.set(at.x + at.tz * 7, 0, at.z - at.tx * 7);
  const raft = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 2.2), new THREE.MeshLambertMaterial({ color: '#9b7552', flatShading: true }));
  raft.position.y = 0.1;
  const cherryTex = cherryTexture();
  const cherry = new THREE.Sprite(new THREE.SpriteMaterial({ map: cherryTex, transparent: true }));
  cherry.scale.setScalar(3.6);
  cherry.position.y = 2.6;
  artifact.add(raft, cherry);
  artifact.visible = false;
  scene.add(artifact);

  return {
    warmup: [artifact],

    update(frame, weight) {
      artifact.visible = weight > 0.02;
      cherry.position.y = 2.6 + Math.sin(frame.time * 1.6) * 0.18;
      artifact.position.y = Math.sin(frame.time * 1.1) * 0.05;
    },

    async prepare() {
      fitTarget();
      renderer.initRenderTarget(target);
      // Scene materials rendered into a target compile as separate (untonemapped) variants.
      await compileInSlices(renderer, [scene], camera, scene, target);
      await renderer.compileAsync(quadScene, quadCamera);
    },

    render(weight) {
      // Below ~10% the effect is invisible; let the normal render run.
      if (weight < 0.1) return false;
      pixel = Math.max(1, Math.round(1 + (weight - 0.1) / 0.9 * (MAX_PIXEL - 1)));
      fitTarget();
      const w = Math.max(1, Math.ceil(size.x / pixel));
      const h = Math.max(1, Math.ceil(size.y / pixel));
      target.viewport.set(0, 0, w, h);
      target.scissor.set(0, 0, w, h);
      uniforms.uScale.value.set(w / size.x, h / size.y);
      uniforms.uWeight.value = weight;
      uniforms.uPixel.value = pixel;

      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
      return true;
    },

    debugInfo: () => `${pixel}px pixels`,

    dispose() {
      scene.remove(artifact);
      raft.geometry.dispose();
      (raft.material as THREE.Material).dispose();
      cherryTex.dispose();
      (cherry.material as THREE.Material).dispose();
      target.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}

