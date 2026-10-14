import * as THREE from 'three';
import { HeightField } from './world';
import { noise2, ridged } from './noise';
import { paintedTerrainMaterial } from './paint';

/**
 * The land around the lake: one indexed grid (shared vertices, far lighter than one vertex per
 * facet). Colour is painted in the shader from height, slope and noise (see paint.ts); flat
 * shading keeps the low-poly facets.
 */
export function buildTerrain(field: HeightField): THREE.Mesh {
  const { nx, nz, heights, bounds, dx, dz } = field;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      pos[k] = bounds.minX + i * dx;
      pos[k + 1] = heights[j * nx + i];
      pos[k + 2] = bounds.minZ + j * dz;
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Alternate the diagonal for a less regular faceting.
      if ((i + j) % 2 === 0) index.set([a, c, b, b, c, d], t);
      else index.set([a, c, d, a, d, b], t);
      t += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, paintedTerrainMaterial());
  mesh.name = 'Terrain';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Distant rings of peaks beyond the terrain, so the horizon is mountains in every direction.
 * Painted like the terrain; aerial perspective turns each ring paler and bluer, so they read as
 * separate layers.
 */
export function buildFarRange(center: THREE.Vector2, radius: number, segments: number): THREE.Mesh {
  const rings = 5;
  const pos: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const rr = radius + r * 150;
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = center.x + Math.cos(a) * rr;
      const z = center.y + Math.sin(a) * rr;
      const peak =
        r === 0
          ? -20
          : r === rings
            ? 0
            : ridged(Math.cos(a) * 3 + r, Math.sin(a) * 3 + r * 2, 3, 4) * (85 + r * 22) + 12 + noise2(s * 0.7, r, 8) * 35;
      pos.push(x, peak, z);
    }
  }
  const index: number[] = [];
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + 1;
      const d = a + row;
      const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mat = paintedTerrainMaterial();
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'FarRange';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
