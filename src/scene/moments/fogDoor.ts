/**
 * Moment: EscapeFromWEII. Fog rolls in and a single lit door stands on a small island,
 * glowing through the murk like the exit of a puzzle room.
 * No real lights are added (that would recompile every material); the glow is emissive
 * geometry and additive sprites that ignore fog.
 */
import * as THREE from 'three';
import { hasModel, loadModel, takeObject } from '../models';
import type { Moment, MomentContext } from './types';

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,214,140,1)');
  grad.addColorStop(0.25, 'rgba(255,190,110,0.55)');
  grad.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildIsland(): { island: THREE.Object3D; door: THREE.Group } {
  const geo = new THREE.IcosahedronGeometry(5.5, 1);
  geo.scale(1.25, 0.32, 1);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const rock = new THREE.Color('#7d7672');
  const grass = new THREE.Color('#5e7a4c');
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const c = y > 0.9 ? grass : rock;
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const island = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  island.position.y = -0.3;

  const door = new THREE.Group();
  const frameMat = new THREE.MeshLambertMaterial({ color: '#4a3a30', flatShading: true });
  const postGeo = new THREE.BoxGeometry(0.28, 3.3, 0.32);
  for (const x of [-0.85, 0.85]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(x, 1.65, 0);
    door.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.34), frameMat);
  lintel.position.y = 3.35;
  door.add(lintel);
  // The light inside the doorway.
  const opening = new THREE.Mesh(
    new THREE.PlaneGeometry(1.42, 3.1),
    new THREE.MeshBasicMaterial({ color: '#ffd796', fog: false }),
  );
  opening.position.set(0, 1.55, -0.02);
  opening.name = 'DoorLight';
  door.add(opening);
  // Door leaf, swung open.
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.05, 0.08), new THREE.MeshLambertMaterial({ color: '#6b4a35' }));
  leaf.geometry.translate(0.7, 0, 0);
  leaf.position.set(-0.71, 1.55, 0.05);
  leaf.rotation.y = -1.1;
  door.add(leaf);
  door.position.y = 1.1;
  return { island, door };
}

export function create(ctx: MomentContext): Moment {
  const root = new THREE.Group();
  root.name = 'FogDoor';
  root.visible = false;

  // Place it ahead of the anchor, a little to starboard, with the door facing the approaching boat.
  const at = ctx.route.sample(ctx.anchorS + 38);
  const from = ctx.route.sample(ctx.anchorS - 10);
  const side = 10;
  root.position.set(at.x - at.tz * side, 0, at.z + at.tx * side);
  root.rotation.y = Math.atan2(from.x - root.position.x, from.z - root.position.z);

  let { island, door } = buildIsland();
  root.add(island, door);
  if (hasModel('island.glb')) {
    void loadModel('island.glb').then((m) => {
      if (!m) return;
      const customIsland = takeObject(m, 'Island');
      const customDoor = takeObject(m, 'Door');
      if (customIsland) {
        root.remove(island);
        island = customIsland;
        root.add(island);
      }
      if (customDoor) {
        root.remove(door);
        door = new THREE.Group();
        door.add(customDoor);
        root.add(door);
      }
    });
  }

  const tex = glowTexture();
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }),
  );
  halo.position.set(0, 2.7, 0.6);
  halo.scale.setScalar(9);
  root.add(halo);
  // Warm light spilling onto the water in front of the door.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }),
  );
  pool.position.set(0, 0.25, 6);
  pool.scale.set(5, 1, 8);
  root.add(pool);
  ctx.scene.add(root);

  const fog = { weight: 0, color: new THREE.Color('#b9b5bd'), near: 4, far: 80 };
  const haloMat = halo.material as THREE.SpriteMaterial;
  const poolMat = pool.material as THREE.MeshBasicMaterial;

  return {
    warmup: [root],
    update(_frame, weight) {
      // Ease in: fog thickens late, so the door appears out of it rather than the lake vanishing at once.
      const w = weight * weight * (3 - 2 * weight);
      root.visible = w > 0.01;
      fog.weight = w;
      ctx.atmosphere.fogOverride = w > 0.001 ? fog : ctx.atmosphere.fogOverride === fog ? null : ctx.atmosphere.fogOverride;
      haloMat.opacity = 0.9 * w;
      poolMat.opacity = 0.5 * w;
    },
    debugInfo: () => `fog ${Math.round(80 + (950 - 80) * (1 - fog.weight))} m`,
    dispose() {
      if (ctx.atmosphere.fogOverride === fog) ctx.atmosphere.fogOverride = null;
      ctx.scene.remove(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      tex.dispose();
    },
  };
}
