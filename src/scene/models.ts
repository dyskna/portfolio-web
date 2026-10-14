/**
 * Optional Blender models from public/models/. The build lists which files exist
 * (virtual:asset-manifest), so nothing is requested unless it is there. Every model
 * is optional; anything missing keeps its procedural version. See MODELS.md.
 *
 *   boat.glb     objects "Hull" (required), "Mast", "Boom" — boat space, origin on the
 *                waterline amidships, bow toward Blender +Y. Boom origin at the gooseneck.
 *   cabin.glb    replaces the cabin, pier and rowing boat; modelled in world coordinates.
 *   harbour.glb  replaces the harbour; world coordinates. Optional empties "Lamp*" and "Sign".
 *   tree.glb     first mesh is used for every pine (origin at the trunk base).
 *   island.glb   used by the EscapeFromWEII moment: "Island" and "Door" (origin at the island centre).
 */
import * as THREE from 'three';
import { models } from 'virtual:asset-manifest';

type GLTFLoaderType = import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader;
let loader: Promise<GLTFLoaderType> | null = null;

export const hasModel = (file: string) => models.includes(file);

export async function loadModel(file: string): Promise<THREE.Group | null> {
  if (!hasModel(file)) return null;
  loader ??= import('three/examples/jsm/loaders/GLTFLoader.js').then((m) => new m.GLTFLoader());
  try {
    const gltf = await (await loader).loadAsync(`/models/${file}`);
    gltf.scene.updateMatrixWorld(true);
    return gltf.scene;
  } catch (err) {
    console.warn(`[models] could not load ${file}; keeping the procedural version`, err);
    return null;
  }
}

/** Detach a named object from a loaded file, baking its parents' transforms into it. */
export function takeObject(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  const obj = root.getObjectByName(name);
  if (!obj) return undefined;
  obj.updateWorldMatrix(true, false);
  const world = obj.matrixWorld.clone();
  obj.removeFromParent();
  world.decompose(obj.position, obj.quaternion, obj.scale);
  return obj;
}

/** First mesh's geometry with its transform baked in, for instancing. */
export function firstMeshGeometry(root: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  if (!found) return null;
  const mesh = found as THREE.Mesh;
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return { geometry, material };
}
