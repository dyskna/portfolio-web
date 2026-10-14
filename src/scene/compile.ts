/**
 * Shader warm-up spread over frames. Building a WebGL program is synchronous: compiling a whole
 * moment (or every render-target variant of the scene) in one go stalled a frame for 60–90 ms
 * just as the boat neared a stop. Here each frame compiles only as many materials as fit a small
 * time budget, and the GPU finishes linking them in the background.
 */
import type * as THREE from 'three';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * objects: what to compile (their whole subtrees); scene: where the lights come from;
 * target: compile the variants used when rendering into this target (null = the screen).
 */
export async function compileInSlices(
  renderer: THREE.WebGLRenderer,
  objects: THREE.Object3D[],
  camera: THREE.Camera,
  scene: THREE.Scene,
  target: THREE.WebGLRenderTarget | null = null,
  budgetMs = 6,
): Promise<void> {
  // One object per material set: objects that share materials share programs.
  const seen = new Set<string>();
  const items: THREE.Object3D[] = [];
  for (const root of objects) {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      const key = (Array.isArray(m) ? m : [m]).map((x) => x.uuid).join() + ((o as THREE.InstancedMesh).isInstancedMesh ? ':i' : '');
      if (seen.has(key)) return;
      seen.add(key);
      items.push(o);
    });
  }
  const pending: Promise<unknown>[] = [];
  let i = 0;
  while (i < items.length) {
    const start = performance.now();
    do {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      pending.push(renderer.compileAsync(items[i++], camera, scene));
      renderer.setRenderTarget(previous);
    } while (i < items.length && performance.now() - start < budgetMs);
    if (i < items.length) await nextFrame();
  }
  await Promise.all(pending);
}
