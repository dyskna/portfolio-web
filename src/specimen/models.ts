/**
 * Model preview (dev only: http://localhost:5173/models.html). Shows the boat, the fisherman's
 * house with its jetty, and the harbour village in the lake's golden-hour light, with orbit
 * controls and a dusk toggle. Handy for checking models before they go into the lake.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { sampleWind } from '../wind/wind';
import { Boat } from '../scene/boat';
import { NORDIC } from '../scene/boatDesigns';
import { mergeStatic } from '../scene/mergeStatic';
import { installPaintedLook } from '../scene/paint';
import { buildFishingCabin, buildFishingHarbour } from '../scene/village';
import { CABIN_SITE, HARBOUR_SITE, type HeightField } from '../scene/world';

installPaintedLook();

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
const dayFog = new THREE.Color('#e6d3b4');
const duskFog = new THREE.Color('#b9817a');
scene.fog = new THREE.Fog(dayFog.clone(), 60, 260);
scene.background = (scene.fog as THREE.Fog).color;

const sun = new THREE.DirectionalLight('#ffd9a8', 2.6);
sun.position.set(-40, 30, -60);
const hemi = new THREE.HemisphereLight('#cfdde6', '#6b5846', 1.4);
scene.add(sun, hemi);

const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 800);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.autoRotate = !params.has('still');
controls.autoRotateSpeed = 0.6;

// Water and simple land patches (the real lake isn't built here).
const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#4d8193' }));
water.position.y = -0.02;
scene.add(water);

/** Land where the builders expect it: around the cabin, and behind the harbour quay. */
const field = {
  height(x: number, z: number) {
    if (Math.hypot(x - CABIN_SITE.x, z - CABIN_SITE.z) < 10 || (x < -9 && Math.abs(z - CABIN_SITE.z) < 14)) return 1.3;
    if (Math.abs(x - HARBOUR_SITE.x) < 60 && z < HARBOUR_SITE.z + 9.8 && z > HARBOUR_SITE.z - 40) return 1.1;
    return -2.5;
  },
} as unknown as HeightField;

function land(x: number, z: number, w: number, d: number, y: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, y + 2, d), new THREE.MeshLambertMaterial({ color: '#7c9658', flatShading: true }));
  m.position.set(x, (y + 2) / 2 - 2, z);
  return m;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

interface Stage {
  group: THREE.Group;
  target: THREE.Vector3;
  eye: THREE.Vector3;
  update?: (t: number, dt: number) => void;
}

function boatStage(): Stage {
  const group = new THREE.Group();
  const nordic = new Boat(NORDIC);
  group.add(nordic.root);
  const showOld = false;
  return {
    group,
    target: new THREE.Vector3(showOld ? 3 : 0, 2.2, 0),
    eye: new THREE.Vector3(showOld ? 15 : 9.5, 4.2, 9),
    update(t, dt) {
      // Speed swings slowly so the sail fills, eases and flaps.
      const speed = 3.2 + 3 * Math.sin(t * 0.35);
      const fwd = { x: 0, z: -1 };
      const w = sampleWind(t, { x: 0, z: -speed }, fwd);
      nordic.update(0, 0, 0, -1, w.sail, t, dt);
    },
  };
}

function cabinStage(): Stage {
  const group = new THREE.Group();
  const cabin = buildFishingCabin(field);
  mergeStatic(cabin, { keep: ['CabinWindow', 'CabinLights'], markers: ['Chimney'] });
  group.add(land(CABIN_SITE.x - 4, CABIN_SITE.z, 20, 26, 1.3), cabin);
  const boat = new Boat(NORDIC);
  group.add(boat.root);
  group.position.set(-CABIN_SITE.x, 0, -CABIN_SITE.z);
  return {
    group,
    target: new THREE.Vector3(8, 1.5, 3),
    eye: new THREE.Vector3(24, 9, 26),
    update(t, dt) {
      const w = sampleWind(t, { x: 0, z: 0 }, { x: 0, z: -1 });
      boat.update(3, 10, 0, -1, w.sail, t, dt);
    },
  };
}

function harbourStage(): Stage {
  const group = new THREE.Group();
  const h = buildFishingHarbour(field);
  mergeStatic(h.group, { keep: ['HarbourLamp', 'HarbourWindows'] });
  group.add(land(HARBOUR_SITE.x, HARBOUR_SITE.z - 15, 120, 50, 1.1), h.group);
  const moored: Boat[] = [];
  for (const [x, z] of [[-6.6, 16], [-1.4, 23], [-6.8, 30]]) {
    const b = new Boat(NORDIC);
    b.root.getObjectByName('Sail')!.visible = false;
    b.root.scale.setScalar(0.9);
    b.root.position.set(HARBOUR_SITE.x + x, 0, HARBOUR_SITE.z + z);
    b.root.rotation.y = Math.PI;
    group.add(b.root);
    moored.push(b);
  }
  group.position.set(-HARBOUR_SITE.x, 0, -HARBOUR_SITE.z);
  return {
    group,
    target: new THREE.Vector3(0, 3, 10),
    eye: new THREE.Vector3(10, 16, 62),
    update(t) {
      for (const b of moored) b.body.position.y = Math.sin(t * 0.8 + b.root.position.x) * 0.06;
    },
  };
}

const stages: Record<string, () => Stage> = {
  boat: boatStage,
  cabin: cabinStage,
  harbour: harbourStage,
};

let stage: Stage | null = null;
function show(name: string) {
  if (stage) scene.remove(stage.group);
  stage = (stages[name] ?? stages.boat)();
  scene.add(stage.group);
  camera.position.copy(stage.eye);
  controls.target.copy(stage.target);
  controls.update();
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.view === name)));
}

let dusk = params.has('dusk');
function setDusk(on: boolean) {
  dusk = on;
  (scene.fog as THREE.Fog).color.copy(on ? duskFog : dayFog);
  sun.color.set(on ? '#ff9a66' : '#ffd9a8');
  sun.intensity = on ? 1.4 : 2.6;
  hemi.color.set(on ? '#b7a0bd' : '#cfdde6');
  hemi.intensity = on ? 1.0 : 1.4;
  water.material.color.set(on ? '#4a5677' : '#4d8193');
  document.getElementById('dusk')!.setAttribute('aria-pressed', String(on));
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view!)));
document.getElementById('dusk')!.addEventListener('click', () => setDusk(!dusk));
setDusk(dusk);
show(params.get('view') ?? 'boat');

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

const clock = new THREE.Clock();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;
  stage?.update?.(t, dt);
  controls.update();
  renderer.render(scene, camera);
});
