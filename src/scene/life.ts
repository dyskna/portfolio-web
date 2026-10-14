/**
 * Small signs of life, all cheap: chimney smoke and fireflies are GPU-animated points (no per-
 * frame CPU work), birds are one instanced mesh flapping in the vertex shader, the cabin window
 * glows warmer at dusk, and a few boats lie moored at the harbour.
 */
import * as THREE from 'three';
import type { Route } from '../sim/route';
import { Boat } from './boat';
import { bakeGeometry } from './mergeStatic';
import { mulberry32 } from './noise';
import { sceneUniforms } from './paint';
import type { QualitySettings } from './quality';
import { HARBOUR_SITE, waveHeight, type HeightField } from './world';

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,214,140,1)');
  grad.addColorStop(0.3, 'rgba(255,190,110,0.45)');
  grad.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shared by the point materials: converts a size in metres to pixels for the current camera. */
const pointUniforms = { uPointScale: { value: 400 } };

function smoke(origin: THREE.Vector3, count: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([origin.x, origin.y, origin.z], i * 3);
    seed[i] = i / count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(origin.clone().add(new THREE.Vector3(3, 6, 0)), 14);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: sceneUniforms.uTime, uPointScale: pointUniforms.uPointScale },
    transparent: true,
    depthWrite: false,
    fog: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPointScale;
      attribute float aSeed;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        float life = fract(uTime * 0.06 + aSeed);
        vec3 p = position;
        p.y += life * 9.0;
        // Drifts downwind as it rises, and curls a little.
        p.x += (sin(aSeed * 40.0 + life * 4.0) * 0.45 + 2.2 * life) * life;
        p.z += cos(aSeed * 23.0 + life * 3.0) * 0.5 * life - 1.2 * life * life;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uPointScale * mix(0.9, 3.6, life) / -mvPosition.z;
        vAlpha = smoothstep(0.0, 0.1, life) * (1.0 - life) * 0.42;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vAlpha;
        gl_FragColor = vec4(0.86, 0.83, 0.8, a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'ChimneySmoke';
  return points;
}

function fireflies(field: HeightField, count: number): { points: THREE.Points; uNight: { value: number } } {
  const rand = mulberry32(91);
  const pos: number[] = [];
  const seed: number[] = [];
  for (let tries = 0; pos.length / 3 < count && tries < count * 80; tries++) {
    // Around the harbour and the shores of the last stretch, where the voyage reaches dusk.
    const a = rand() * Math.PI * 2;
    const r = 10 + rand() * 70;
    const x = HARBOUR_SITE.x + Math.cos(a) * r;
    const z = HARBOUR_SITE.z + 30 + Math.sin(a) * r * 1.4;
    const h = field.height(x, z);
    if (h < 0.3 || h > 6) continue;
    pos.push(x, h + 0.6 + rand() * 2.2, z);
    seed.push(rand());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geo.computeBoundingSphere();
  const uNight = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: sceneUniforms.uTime, uPointScale: pointUniforms.uPointScale, uNight },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPointScale;
      uniform float uNight;
      attribute float aSeed;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime * (0.3 + aSeed * 0.3) + aSeed * 50.0;
        p += vec3(sin(t) * 0.8, sin(t * 1.7) * 0.35, cos(t * 0.8) * 0.8);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max(2.0, uPointScale * 0.22 / -mvPosition.z);
        float blink = smoothstep(0.35, 1.0, sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 30.0));
        vAlpha = blink * uNight;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(1.0, 0.85, 0.45, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'Fireflies';
  return { points, uNight };
}

interface Flock {
  center: THREE.Vector3;
  radius: number;
  speed: number;
  phase: number;
}

function birds(route: Route, count: number): { mesh: THREE.InstancedMesh; flocks: Flock[] } {
  // A bird: two wings meeting at the body, swept back a little.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0.25, -0.85, 0, -0.1, 0, 0, -0.2, 0, 0, 0.25, 0, 0, -0.2, 0.85, 0, -0.1], 3),
  );
  const mat = new THREE.MeshBasicMaterial({ color: '#2b2a33', side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sceneUniforms.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      {
        float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        transformed.y += sin(uTime * 7.0 + phase) * 0.32 * abs(transformed.x);
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'bird';
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'Birds';
  mesh.frustumCulled = false;
  const flocks: Flock[] = [0.3, 0.62, 0.88].map((f, i) => {
    const p = route.sample(f * route.length);
    return { center: new THREE.Vector3(p.x, 34 + i * 8, p.z - 30), radius: 45 + i * 15, speed: 0.05 + i * 0.012, phase: i * 2.1 };
  });
  return { mesh, flocks };
}

export class Life {
  readonly group = new THREE.Group();
  private readonly uNight: { value: number };
  private readonly birdMesh: THREE.InstancedMesh;
  private readonly flocks: Flock[];
  private readonly birdOffsets: THREE.Vector3[] = [];
  private readonly windowGlow: THREE.Sprite | null = null;
  private readonly moored: { x: number; z: number; yaw: number }[] = [];
  private readonly mooredMesh: THREE.InstancedMesh | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly glowTex = glowTexture();

  constructor(field: HeightField, route: Route, cabin: THREE.Object3D, q: QualitySettings) {
    this.group.name = 'Life';

    // Chimney smoke, from the top of the cabin's chimney.
    const chimney = cabin.getObjectByName('Chimney');
    if (chimney) {
      chimney.updateWorldMatrix(true, false);
      const top = new THREE.Vector3(0, 1.2, 0).applyMatrix4(chimney.matrixWorld);
      this.group.add(smoke(top, q.tier === 'high' ? 28 : 16));
    }

    // Warm window glow that grows at dusk.
    const win = cabin.getObjectByName('CabinWindow');
    if (win) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      win.getWorldPosition(glow.position);
      glow.scale.setScalar(4);
      this.group.add(glow);
      this.windowGlow = glow;
    }

    const ff = fireflies(field, q.fireflies);
    this.uNight = ff.uNight;
    this.group.add(ff.points);

    const b = birds(route, q.tier === 'high' ? 21 : 12);
    this.birdMesh = b.mesh;
    this.flocks = b.flocks;
    const rand = mulberry32(3);
    for (let i = 0; i < b.mesh.count; i++) {
      // A loose V behind the leader.
      const row = Math.floor((i % 7) / 2) + 1;
      const side = i % 2 === 0 ? 1 : -1;
      this.birdOffsets.push(new THREE.Vector3(side * row * 2.2 + (rand() - 0.5), (rand() - 0.5) * 1.2, -row * 2.4));
    }
    this.group.add(b.mesh);

    // Boats moored along the harbour jetty, sails furled: hull, mast and boom baked into one
    // geometry, drawn as one instanced mesh, each boat tinted and bobbing on its own.
    const proto = new Boat();
    proto.boomPivot.rotation.y = 0.05;
    const parts = ['Hull', 'Mast', 'Boom'].map((n) => proto.root.getObjectByName(n) as THREE.Mesh).filter(Boolean);
    const geo = bakeGeometry(parts, proto.body);
    const spots: [number, number, number][] = [
      [HARBOUR_SITE.x - 6.6, HARBOUR_SITE.z + 16, 0.08],
      [HARBOUR_SITE.x - 1.4, HARBOUR_SITE.z + 23, -0.12],
      [HARBOUR_SITE.x - 6.8, HARBOUR_SITE.z + 30, 0.05],
    ];
    if (geo) {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), spots.length);
      mesh.name = 'MooredBoats';
      const tints = ['#a9c6d8', '#d8b48e', '#c5d6a4'];
      spots.forEach(([x, z, yaw], i) => {
        mesh.setColorAt(i, new THREE.Color(tints[i]));
        this.moored.push({ x, z, yaw });
      });
      this.mooredMesh = mesh;
      this.group.add(mesh);
    }
  }

  /** Size of 1 m at 1 m distance in device pixels, for the point sprites. */
  setPointScale(heightPx: number, fovDeg: number): void {
    pointUniforms.uPointScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  /** time: seconds; dusk: 0 by day, 1 at sunset (from the atmosphere). */
  update(time: number, dusk: number): void {
    const night = THREE.MathUtils.smoothstep(dusk, 0.55, 0.95);
    this.uNight.value = night;
    if (this.windowGlow) (this.windowGlow.material as THREE.SpriteMaterial).opacity = 0.25 + 0.65 * night;

    let i = 0;
    for (const f of this.flocks) {
      const a = time * f.speed + f.phase;
      const cx = f.center.x + Math.cos(a) * f.radius;
      const cz = f.center.z + Math.sin(a) * f.radius;
      // Heading along the circle.
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -a);
      for (let k = 0; k < 7 && i < this.birdMesh.count; k++, i++) {
        const o = this.birdOffsets[i];
        this.v.set(o.x, o.y + Math.sin(time * 0.8 + i) * 0.3, o.z).applyQuaternion(this.q);
        this.v.x += cx;
        this.v.y += f.center.y;
        this.v.z += cz;
        this.m.compose(this.v, this.q, this.one);
        this.birdMesh.setMatrixAt(i, this.m);
      }
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;

    if (this.mooredMesh) {
      const e = new THREE.Euler();
      const s = new THREE.Vector3(0.9, 0.9, 0.9);
      this.moored.forEach((b, i) => {
        const h = waveHeight(b.x, b.z, time);
        e.set(Math.cos(time * 0.7 + b.z) * 0.025, Math.PI + b.yaw, Math.sin(time * 0.9 + b.x) * 0.04, 'YXZ');
        this.q.setFromEuler(e);
        this.v.set(b.x, h * 0.8, b.z);
        this.m.compose(this.v, this.q, s);
        this.mooredMesh!.setMatrixAt(i, this.m);
      });
      this.mooredMesh.instanceMatrix.needsUpdate = true;
      this.mooredMesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    this.glowTex.dispose();
  }
}
