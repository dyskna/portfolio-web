/**
 * Draw-call reduction: bake many small static meshes (houses, posts, planks) into one
 * vertex-coloured mesh. A prop group of 50 meshes becomes one or two draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Bake meshes into one geometry in `root`'s local space, with their material colour as vertex colour. */
export function bakeGeometry(meshes: THREE.Mesh[], root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const parts: THREE.BufferGeometry[] = [];
  for (const mesh of meshes) {
    const mat = mesh.material as THREE.MeshLambertMaterial;
    let g = mesh.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    m.multiplyMatrices(toRoot, mesh.matrixWorld);
    g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'color') g.deleteAttribute(name);
    const n = g.attributes.position.count;
    const base = mat.color ?? new THREE.Color(1, 1, 1);
    const existing = mat.vertexColors ? (g.attributes.color as THREE.BufferAttribute | undefined) : undefined;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c.copy(base);
      if (existing) c.multiply(new THREE.Color(existing.getX(i), existing.getY(i), existing.getZ(i)));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts);
  if (!merged) return null;
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export interface MergeOptions {
  /** Meshes with these names stay as they are (they change at runtime, e.g. lamps). */
  keep?: string[];
  /** Meshes with these names are merged but leave an empty object behind (used as a position). */
  markers?: string[];
}

/** Replace a group's static Lambert meshes with one merged mesh per side (front / double). */
export function mergeStatic(group: THREE.Group, opts: MergeOptions = {}): void {
  const keep = new Set(opts.keep ?? []);
  const markers = new Set(opts.markers ?? []);
  const buckets = new Map<THREE.Side, THREE.Mesh[]>();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || keep.has(mesh.name) || Array.isArray(mesh.material)) return;
    const mat = mesh.material as THREE.Material;
    if (!(mat instanceof THREE.MeshLambertMaterial) || mat.transparent || mat.map) return;
    const list = buckets.get(mat.side) ?? [];
    list.push(mesh);
    buckets.set(mat.side, list);
  });
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  for (const [side, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geo = bakeGeometry(meshes, group);
    if (!geo) continue;
    for (const mesh of meshes) {
      if (markers.has(mesh.name)) {
        const marker = new THREE.Object3D();
        marker.name = mesh.name;
        new THREE.Matrix4().multiplyMatrices(toGroup, mesh.matrixWorld).decompose(marker.position, marker.quaternion, marker.scale);
        group.add(marker);
      }
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    const merged = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side }));
    merged.name = `${group.name || 'Props'}Merged`;
    merged.matrixAutoUpdate = false;
    group.add(merged);
  }
  // Drop groups that are now empty.
  const empty: THREE.Object3D[] = [];
  group.traverse((o) => {
    if (o !== group && !(o as THREE.Mesh).isMesh && o.children.length === 0 && o.type === 'Group') empty.push(o);
  });
  empty.forEach((o) => o.removeFromParent());
}
