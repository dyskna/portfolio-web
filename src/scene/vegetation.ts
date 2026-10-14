/**
 * Forest and shore: pines and birches swaying in the wind, reeds at the waterline, rocks on the
 * shore and in the shallows, and a few small islands. Everything is instanced (one draw call per
 * kind) and the sway runs in the vertex shader (paint.ts).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Route } from '../sim/route';
import { mulberry32, noise2 } from './noise';
import { swayingPlantMaterial } from './paint';
import type { QualitySettings } from './quality';
import { CABIN_SITE, HARBOUR_SITE, type HeightField } from './world';

/** Paint a geometry one colour, or a vertical gradient (bottom → top colour). */
function tint(geo: THREE.BufferGeometry, bottom: string, top = bottom): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.computeBoundingBox();
  const y0 = g.boundingBox!.min.y;
  const y1 = g.boundingBox!.max.y;
  const c0 = new THREE.Color(bottom);
  const c1 = new THREE.Color(top);
  const c = new THREE.Color();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    c.copy(c0).lerp(c1, (pos.getY(i) - y0) / Math.max(1e-6, y1 - y0));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Nudge vertices a little so shapes look hand-made rather than machine-perfect. */
function roughen(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const pos = geo.attributes.position;
  // Same displacement for vertices at the same place, so the surface stays closed.
  const offsets = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let o = offsets.get(key);
    if (!o) offsets.set(key, (o = [(rand() - 0.5) * amount, (rand() - 0.5) * amount * 0.5, (rand() - 0.5) * amount]));
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  return geo;
}

function finish(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** A pine: four irregular tiers, darker below and sunlit above. */
export function pineGeometry(): THREE.BufferGeometry {
  const parts = [tint(new THREE.CylinderGeometry(0.14, 0.24, 1.6, 5).translate(0, 0.8, 0), '#5a3d2c', '#6e4d37')];
  const tiers: [number, number, number, string, string][] = [
    // radius, height, y, bottom colour, top colour
    [1.75, 2.6, 2.3, '#24453a', '#2f5844'],
    [1.4, 2.3, 3.6, '#2a4f3f', '#37634a'],
    [1.05, 2.0, 4.8, '#305a45', '#3f6e4f'],
    [0.62, 1.6, 5.9, '#386449', '#4c7d56'],
  ];
  tiers.forEach(([r, h, y, c0, c1], i) => {
    const cone = new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y, 0);
    parts.push(tint(roughen(cone.toNonIndexed(), r * 0.22, 11 + i), c0, c1));
  });
  return finish(mergeGeometries(parts)!);
}

/** A birch: slim white trunk with dark marks, and a light, airy crown. */
export function birchGeometry(): THREE.BufferGeometry {
  const parts = [tint(new THREE.CylinderGeometry(0.1, 0.16, 4.6, 6).translate(0, 2.3, 0), '#e7e2d6')];
  for (const y of [0.9, 1.7, 2.6, 3.4]) {
    parts.push(tint(new THREE.CylinderGeometry(0.135, 0.145, 0.12, 6).translate(0, y, 0), '#3b3530'));
  }
  const crown: [number, number, number, number, string][] = [
    [0, 5.0, 0, 1.5, '#8db35b'],
    [0.7, 4.3, 0.3, 1.1, '#a6bd5e'],
    [-0.6, 4.5, -0.4, 1.15, '#7da650'],
    [0.1, 5.9, -0.2, 0.95, '#b5c46a'],
  ];
  crown.forEach(([x, y, z, r, c], i) => {
    const ico = new THREE.IcosahedronGeometry(r, 0).scale(1, 1.15, 1).translate(x, y, z);
    parts.push(tint(roughen(ico, r * 0.25, 31 + i), c));
  });
  return finish(mergeGeometries(parts)!);
}

/** A clump of reeds: thin leaning blades, green at the base, straw-coloured at the tips. */
export function reedGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(5);
  const pos: number[] = [];
  const col: number[] = [];
  const base = new THREE.Color('#4f6b35');
  const tip = new THREE.Color('#c2b277');
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.45;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 1.0 + rand() * 0.9;
    const lean = (rand() - 0.5) * 0.5;
    const w = 0.035 + rand() * 0.03;
    const dx = Math.cos(a + 1.57) * w;
    const dz = Math.sin(a + 1.57) * w;
    pos.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + lean, h, z + lean * 0.4);
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return finish(geo);
}

/** A boulder: a roughened, squashed icosahedron. */
export function rockGeometry(): THREE.BufferGeometry {
  const g = roughen(new THREE.IcosahedronGeometry(1, 0).scale(1.2, 0.7, 1), 0.35, 77);
  return finish(tint(g, '#6f6760', '#9a8f84'));
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const keepClear = (x: number, z: number, cabin: number, harbour: number) =>
  Math.hypot(x - CABIN_SITE.x, z - CABIN_SITE.z) < cabin || Math.hypot(x - HARBOUR_SITE.x, z - HARBOUR_SITE.z) < harbour;

interface Scatter {
  count: number;
  seed: number;
  accept: (x: number, z: number, h: number, rand: () => number) => boolean;
  scale: (rand: () => number) => [number, number, number];
  yOffset?: number;
  tint?: (rand: () => number, c: THREE.Color) => void;
  tilt?: number;
}

function scatter(field: HeightField, geometry: THREE.BufferGeometry, material: THREE.Material, opts: Scatter, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, opts.count);
  mesh.name = name;
  const rand = mulberry32(opts.seed);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const b = field.bounds;
  let placed = 0;
  for (let tries = 0; placed < opts.count && tries < opts.count * 60; tries++) {
    const x = b.minX + rand() * (b.maxX - b.minX);
    const z = b.minZ + rand() * (b.maxZ - b.minZ);
    const h = field.height(x, z);
    if (!opts.accept(x, z, h, rand)) continue;
    const [sx, sy, sz] = opts.scale(rand);
    s.set(sx, sy, sz);
    const tilt = opts.tilt ?? 0;
    e.set((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt);
    q.setFromEuler(e);
    p.set(x, h + (opts.yOffset ?? 0), z);
    m.compose(p, q, s);
    mesh.setMatrixAt(placed, m);
    if (opts.tint) {
      opts.tint(rand, c);
      mesh.setColorAt(placed, c);
    }
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Pines in clumps on the slopes (also used with a tree from tree.glb). */
export function buildForest(
  field: HeightField,
  count: number,
  geometry = pineGeometry(),
  material: THREE.Material = swayingPlantMaterial(0.0028, 'pine'),
): THREE.InstancedMesh {
  return scatter(
    field,
    geometry,
    material,
    {
      count,
      seed: 7,
      accept: (x, z, h) => {
        if (h < 0.9 || h > 66 || field.slope(x, z) > 0.75 || keepClear(x, z, 11, 32)) return false;
        // Clumps: density follows noise, thinning out higher up.
        return noise2(x * 0.03, z * 0.03, 21) - h / 150 > 0.4;
      },
      scale: (rand) => {
        const k = 0.7 + rand() * 0.8;
        return [k, k * (0.85 + rand() * 0.45), k];
      },
      yOffset: -0.2,
      tilt: 0.06,
      tint: (rand, c) => c.setHSL(0.28 + rand() * 0.07, 0.2 + rand() * 0.18, 0.74 + rand() * 0.26),
    },
    'Forest',
  );
}

export interface Vegetation {
  group: THREE.Group;
  forest: THREE.InstancedMesh;
}

export function buildVegetation(field: HeightField, route: Route, q: QualitySettings): Vegetation {
  const group = new THREE.Group();
  group.name = 'Vegetation';

  const forest = buildForest(field, q.trees);

  // Birches lower down, on gentle ground near the water, in loose groups.
  const birches = scatter(
    field,
    birchGeometry(),
    swayingPlantMaterial(0.0034, 'birch'),
    {
      count: q.birches,
      seed: 19,
      accept: (x, z, h) =>
        h > 0.8 && h < 16 && field.slope(x, z) < 0.45 && !keepClear(x, z, 9, 30) && noise2(x * 0.045, z * 0.045, 41) > 0.55,
      scale: (rand) => {
        const k = 0.75 + rand() * 0.55;
        return [k, k * (0.9 + rand() * 0.3), k];
      },
      tilt: 0.12,
      tint: (rand, c) => c.setHSL(0.15 + rand() * 0.08, 0.35, 0.8 + rand() * 0.2),
    },
    'Birches',
  );

  // Reeds along the waterline, in clusters.
  const reedMat = swayingPlantMaterial(0.07, 'reed');
  reedMat.side = THREE.DoubleSide;
  const reeds = scatter(
    field,
    reedGeometry(),
    reedMat,
    {
      count: q.reeds,
      seed: 23,
      accept: (x, z, h) => h > -0.45 && h < 0.35 && field.slope(x, z) < 0.35 && !keepClear(x, z, 4, 26) && noise2(x * 0.08, z * 0.08, 61) > 0.45,
      scale: (rand) => {
        const k = 0.7 + rand() * 0.7;
        return [k, k * (0.8 + rand() * 0.5), k];
      },
      tint: (rand, c) => c.setHSL(0.14 + rand() * 0.06, 0.3, 0.8 + rand() * 0.2),
    },
    'Reeds',
  );

  // Boulders on the shore and in the shallows.
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const rocks = scatter(
    field,
    rockGeometry(),
    rockMat,
    {
      count: q.rocks,
      seed: 29,
      accept: (x, z, h) => h > -1.6 && h < 2.2 && !keepClear(x, z, 8, 34) && noise2(x * 0.06, z * 0.06, 71) > 0.5,
      scale: (rand) => {
        const k = 0.35 + rand() * rand() * 1.6;
        return [k, k * (0.7 + rand() * 0.6), k];
      },
      yOffset: -0.15,
      tilt: 0.5,
      tint: (rand, c) => c.setHSL(0.07 + rand() * 0.05, 0.08 + rand() * 0.08, 0.75 + rand() * 0.25),
    },
    'Rocks',
  );

  group.add(birches, reeds, rocks, buildIslands(field, route));
  return { group, forest };
}

/** A few small rocky islands with a handful of pines, to port of the route (buoys are to starboard). */
function buildIslands(field: HeightField, route: Route): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Islands';
  const mounds: THREE.BufferGeometry[] = [];
  const pines: THREE.Matrix4[] = [];
  const rand = mulberry32(13);
  for (const [frac, side, size] of [
    [0.2, 27, 7],
    [0.47, 30, 9],
    [0.77, 26, 6.5],
  ] as const) {
    const p = route.sample(frac * route.length);
    // Port side: the left-hand normal of the direction of travel.
    const x = p.x + p.tz * side;
    const z = p.z - p.tx * side;
    if (field.height(x, z) > -2) continue; // only in open water
    const g = roughen(new THREE.IcosahedronGeometry(size, 1).scale(1.3, 0.28, 1), size * 0.18, Math.round(frac * 100));
    g.translate(x, -0.4, z);
    // Rock below, a cap of meadow on top.
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const rock = new THREE.Color('#7b726a');
    const grass = new THREE.Color('#6f8b4e');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 3) {
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      c.copy(y > size * 0.12 ? grass : rock).multiplyScalar(0.92 + rand() * 0.16);
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    mounds.push(g);
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * size * 0.55;
      const k = 0.6 + rand() * 0.5;
      pines.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x + Math.cos(a) * r, size * 0.16, z + Math.sin(a) * r),
          new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * 6.28),
          new THREE.Vector3(k, k, k),
        ),
      );
    }
  }
  if (!mounds.length) return group;
  const geo = mergeGeometries(mounds)!;
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  const trees = new THREE.InstancedMesh(pineGeometry(), swayingPlantMaterial(0.0028, 'pine'), pines.length);
  pines.forEach((m, i) => trees.setMatrixAt(i, m));
  trees.computeBoundingSphere();
  group.add(trees);
  return group;
}
