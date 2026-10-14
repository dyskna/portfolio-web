/**
 * Fishing village: colourful wooden houses on stilts with their gables to the water, turf, slate
 * and tile roofs, plank jetties with lanterns, barrels, crates, drying nets and a fish rack.
 * Built from many small boxes, then merged into a few draw calls (see mergeStatic in scene.ts).
 *
 * Same contract as props.ts: the cabin group contains 'CabinWindow' (the lit main window) and
 * 'Chimney'; the harbour returns its lanterns (named 'HarbourLamp') and the sign anchor.
 */
import * as THREE from 'three';
import { NORDIC } from './boatDesigns';
import { bakeGeometry } from './mergeStatic';
import { mulberry32 } from './noise';
import type { HarbourParts } from './props';
import { CABIN_SITE, HARBOUR_SITE, type HeightField } from './world';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const matCache = new Map<string, THREE.MeshLambertMaterial>();
const lambert = (color: string) => {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = new THREE.MeshLambertMaterial({ color, flatShading: true })));
  return m;
};
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: string, name = ''): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.position.set(x, y, z);
  if (name) m.name = name;
  parent.add(m);
  return m;
}

function cyl(parent: THREE.Object3D, r: number, h: number, x: number, y: number, z: number, color: string, seg = 6): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), lambert(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A box stretched between two points. */
function beam(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, color: string): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), lambert(color));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  parent.add(m);
  return m;
}

const LIT = new THREE.MeshBasicMaterial({ color: '#f4bc62' });
const GLASS = '#33414c';

interface HouseSpec {
  w: number;
  d: number;
  /** Wall height. */
  h: number;
  pitch: number;
  wall: string;
  trim: string;
  roof: 'turf' | 'slate' | 'tile';
  /** Floor height above the group origin (stilts go down from here). */
  floor: number;
  /** How far the stilts reach below the origin (into the lake bed). 0: on a low stone base. */
  stiltDepth: number;
  /** Deck in front of the gable (m). */
  deck: number;
  windowsFront: number;
  windowsSide: number;
  /** Which windows are lit, by index (front first, then side). */
  lit: number[];
  door: boolean;
  chimney: boolean;
  ladder: boolean;
}

const ROOFS = {
  turf: { top: '#5f7d3d', edge: '#4a3a2a' },
  slate: { top: '#4b4c55', edge: '#33343a' },
  tile: { top: '#9b3d2b', edge: '#6e2a1e' },
};

interface House {
  group: THREE.Group;
  lit: THREE.Mesh[];
  chimney: THREE.Mesh | null;
}

/** A gabled wooden house, front (gable, door) facing local +z. */
function house(s: HouseSpec, rand: () => number): House {
  const g = new THREE.Group();
  const lit: THREE.Mesh[] = [];
  const y0 = s.floor;
  const batten = shade(s.wall, 0.82);

  // Walls with vertical board battens, corner boards and a dark sill.
  box(g, s.w, s.h, s.d, 0, y0 + s.h / 2, 0, s.wall);
  for (let x = -s.w / 2 + 0.3; x < s.w / 2 - 0.15; x += 0.42) {
    box(g, 0.05, s.h, 0.03, x, y0 + s.h / 2, s.d / 2 + 0.015, batten);
    box(g, 0.05, s.h, 0.03, x, y0 + s.h / 2, -s.d / 2 - 0.015, batten);
  }
  for (let z = -s.d / 2 + 0.3; z < s.d / 2 - 0.15; z += 0.42) {
    box(g, 0.03, s.h, 0.05, s.w / 2 + 0.015, y0 + s.h / 2, z, batten);
    box(g, 0.03, s.h, 0.05, -s.w / 2 - 0.015, y0 + s.h / 2, z, batten);
  }
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    box(g, 0.14, s.h + 0.04, 0.14, (x * s.w) / 2, y0 + s.h / 2, (z * s.d) / 2, s.trim);
  }
  box(g, s.w + 0.12, 0.16, s.d + 0.12, 0, y0 + 0.08, 0, shade(s.wall, 0.55));

  // Gable: a wall-coloured prism under the roof.
  const tri = new THREE.Shape([new THREE.Vector2(-s.w / 2, 0), new THREE.Vector2(s.w / 2, 0), new THREE.Vector2(0, s.pitch)]);
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: s.d, bevelEnabled: false }), lambert(s.wall));
  gable.position.set(0, y0 + s.h, -s.d / 2);
  g.add(gable);

  // Roof: two slanted panels with eaves, a ridge board, white bargeboards on the front gable.
  const ov = 0.35;
  const theta = Math.atan2(s.pitch, s.w / 2);
  const sx = s.w / 2 + ov;
  const len = sx / Math.cos(theta);
  const ridgeY = y0 + s.h + s.pitch;
  const roofCol = ROOFS[s.roof];
  const depth = s.d + 0.7;
  for (const side of [1, -1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, depth), lambert(roofCol.top));
    panel.rotation.z = -side * theta;
    panel.position.set((side * sx) / 2, ridgeY - (sx / 2) * Math.tan(theta) + 0.1, 0);
    g.add(panel);
    if (s.roof === 'turf') {
      // Turf hangs over the edge on a dark birch-bark lip.
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, depth), lambert(roofCol.edge));
      lip.position.set(side * (sx - 0.05), ridgeY - sx * Math.tan(theta) + 0.08, 0);
      g.add(lip);
    }
    beam(
      g,
      new THREE.Vector3(0, ridgeY + 0.04, depth / 2 + 0.02),
      new THREE.Vector3(side * sx, ridgeY - sx * Math.tan(theta) + 0.04, depth / 2 + 0.02),
      0.14,
      0.2,
      s.trim,
    );
  }
  box(g, 0.2, 0.14, depth + 0.04, 0, ridgeY + 0.12, 0, s.roof === 'turf' ? shade(roofCol.top, 1.15) : roofCol.edge);

  // Windows: white frames, a mullion cross, dark glass or a warm lit pane.
  let wi = 0;
  const addWindow = (x: number, y: number, z: number, rotY: number) => {
    const wg = new THREE.Group();
    wg.position.set(x, y, z);
    wg.rotation.y = rotY;
    box(wg, 0.88, 1.02, 0.06, 0, 0, 0.03, s.trim);
    const isLit = s.lit.includes(wi++);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.82, 0.03), isLit ? LIT : lambert(GLASS));
    pane.position.z = 0.07;
    wg.add(pane);
    if (isLit) lit.push(pane);
    box(wg, 0.05, 0.82, 0.04, 0, 0, 0.1, s.trim);
    box(wg, 0.68, 0.05, 0.04, 0, 0, 0.1, s.trim);
    g.add(wg);
  };
  const front = s.d / 2;
  const slots = s.windowsFront + (s.door ? 1 : 0);
  for (let i = 0; i < slots; i++) {
    const x = -s.w / 2 + (s.w * (i + 0.5)) / slots;
    const doorSlot = s.door && i === Math.floor(slots / 2);
    if (doorSlot) {
      box(g, 1.02, 2.04, 0.06, x, y0 + 1.02, front + 0.03, s.trim);
      box(g, 0.86, 1.9, 0.06, x, y0 + 0.97, front + 0.06, shade(s.wall, 0.45));
    } else {
      addWindow(x, y0 + s.h * 0.56, front, 0);
    }
  }
  // A small loft window high in the gable.
  addWindow(0, y0 + s.h + s.pitch * 0.38, front, 0);
  for (let i = 0; i < s.windowsSide; i++) {
    const z = -s.d / 2 + (s.d * (i + 0.5)) / s.windowsSide;
    addWindow(s.w / 2, y0 + s.h * 0.56, z, Math.PI / 2);
  }

  let chimney: THREE.Mesh | null = null;
  if (s.chimney) {
    const cx = s.w * 0.24;
    const cy = ridgeY - cx * Math.tan(theta) + 0.6;
    chimney = box(g, 0.55, 1.5, 0.55, cx, cy, -s.d * 0.18, '#7a716b', 'Chimney');
    box(g, 0.7, 0.12, 0.7, cx, cy + 0.78, -s.d * 0.18, '#5f5852');
  }

  // Platform and deck in front, on stilts or a low stone base.
  const wood = '#8a6a4a';
  const platD = s.d + 0.3 + s.deck;
  box(g, s.w + 0.4, 0.18, platD, 0, y0 - 0.09, s.deck / 2, wood);
  const postTop = y0 - 0.18;
  const postBottom = -s.stiltDepth;
  const postH = postTop - postBottom;
  if (postH > 0.05) {
    const xs = s.w > 3.6 ? [-s.w / 2, 0, s.w / 2] : [-s.w / 2, s.w / 2];
    const zs: number[] = [];
    for (let z = -s.d / 2; z <= s.d / 2 + s.deck + 0.01; z += (s.d + s.deck) / 3) zs.push(z);
    for (const x of xs) for (const z of zs) cyl(g, 0.11, postH, x, postBottom + postH / 2, z, s.stiltDepth > 0.3 ? '#4a3a2c' : '#77706a');
    // Cross braces between the front stilts.
    if (s.stiltDepth > 0.3) {
      const zf = zs[zs.length - 1];
      beam(g, new THREE.Vector3(xs[0], postBottom + 0.4, zf), new THREE.Vector3(xs[xs.length - 1], postTop - 0.1, zf), 0.07, 0.1, '#4a3a2c');
      beam(g, new THREE.Vector3(xs[xs.length - 1], postBottom + 0.4, zf), new THREE.Vector3(xs[0], postTop - 0.1, zf), 0.07, 0.1, '#4a3a2c');
    }
  }
  if (s.deck > 0) {
    // Railing around the deck, open at the ladder.
    const zf = s.d / 2 + s.deck + 0.1;
    for (const x of [-s.w / 2 - 0.15, s.w / 2 + 0.15]) {
      cyl(g, 0.05, 0.9, x, y0 + 0.45, zf, wood);
      beam(g, new THREE.Vector3(x, y0 + 0.88, s.d / 2), new THREE.Vector3(x, y0 + 0.88, zf), 0.06, 0.06, wood);
    }
    beam(g, new THREE.Vector3(-s.w / 2 - 0.15, y0 + 0.88, zf), new THREE.Vector3(s.ladder ? 0.3 : s.w / 2 + 0.15, y0 + 0.88, zf), 0.06, 0.06, wood);
    if (s.ladder) {
      for (const x of [0.75, 1.25]) beam(g, new THREE.Vector3(x, y0, zf), new THREE.Vector3(x, -0.6, zf + 0.35), 0.06, 0.06, '#5a4532');
      for (let k = 1; k < 5; k++) {
        const t = k / 5;
        box(g, 0.5, 0.05, 0.06, 1, y0 * (1 - t) - 0.6 * t, zf + 0.35 * t, '#5a4532');
      }
    }
  }
  void rand;
  return { group: g, lit, chimney };
}

function barrel(parent: THREE.Object3D, x: number, y: number, z: number, rand: () => number) {
  const tone = rand() > 0.5 ? '#7b5636' : '#6a4a30';
  cyl(parent, 0.32, 0.82, x, y + 0.41, z, tone, 8);
  for (const hy of [0.18, 0.64]) cyl(parent, 0.335, 0.06, x, y + hy, z, '#2f2a26', 8);
}

function crate(parent: THREE.Object3D, x: number, y: number, z: number, rand: () => number) {
  const s = 0.5 + rand() * 0.2;
  const m = box(parent, s, s * 0.8, s, x, y + s * 0.4, z, rand() > 0.5 ? '#a07c52' : '#8d6c47');
  m.rotation.y = rand() * 0.6;
}

/** Two poles with a net hung to dry between them, floats along the top line. */
function dryingNet(parent: THREE.Object3D, x: number, y: number, z: number, rotY: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  for (const k of [-1.3, 1.3]) cyl(g, 0.06, 2.4, k, 1.2, 0, '#6a5440');
  beam(g, new THREE.Vector3(-1.3, 2.2, 0), new THREE.Vector3(1.3, 2.2, 0), 0.04, 0.04, '#3a332c');
  // The net sags: a few slanted strips.
  for (let i = 0; i < 6; i++) {
    const x0 = -1.2 + i * 0.48;
    const sag = Math.sin((i / 5) * Math.PI) * 0.3;
    box(g, 0.44, 1.2 - sag, 0.03, x0 + 0.2, 1.55 - sag / 2, 0, i % 2 ? '#4f5d55' : '#59675f');
  }
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), lambert('#c8452e'));
    f.position.set(-1.2 + i * 0.4, 2.18, 0.03);
    g.add(f);
  }
  parent.add(g);
}

/** A fish-drying rack (hjell): A-frames, cross poles, rows of hanging fish. */
function fishRack(parent: THREE.Object3D, x: number, y: number, z: number, rotY: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  for (const zx of [-1.6, 0, 1.6]) {
    beam(g, new THREE.Vector3(-0.6, 0, zx), new THREE.Vector3(0, 2.3, zx), 0.08, 0.08, '#7a6248');
    beam(g, new THREE.Vector3(0.6, 0, zx), new THREE.Vector3(0, 2.3, zx), 0.08, 0.08, '#7a6248');
  }
  for (const h of [1.5, 2.15]) {
    beam(g, new THREE.Vector3(0, h, -1.7), new THREE.Vector3(0, h, 1.7), 0.06, 0.06, '#7a6248');
    for (let i = 0; i < 9; i++) box(g, 0.08, 0.42, 0.05, 0, h - 0.24, -1.45 + i * 0.36, '#c9b28a');
  }
  parent.add(g);
}

/** A lantern on a post: frame, cap and a glass box (dim by day; the harbour moment lights it). */
function lantern(parent: THREE.Object3D, x: number, y: number, z: number, glass: THREE.Material, name = ''): THREE.Mesh {
  cyl(parent, 0.07, 2.6, x, y + 1.3, z, '#3a3530');
  box(parent, 0.32, 0.06, 0.32, x, y + 2.62, z, '#2a2622');
  const pane = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.24), glass);
  pane.position.set(x, y + 2.84, z);
  if (name) pane.name = name;
  parent.add(pane);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.22, 4), lambert('#2a2622'));
  cap.position.set(x, y + 3.12, z);
  cap.rotation.y = Math.PI / 4;
  parent.add(cap);
  return pane;
}

/** A jetty of individual planks on posts; deck top at deckY. */
function plankJetty(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, width: number, deckY: number, rand: () => number) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const yaw = Math.atan2(dir.x, dir.z);
  const g = new THREE.Group();
  g.position.copy(from);
  g.rotation.y = yaw;
  for (let z = 0; z <= len; z += 0.34) {
    const tone = ['#9b7552', '#a7805b', '#8f6b4a'][Math.floor(rand() * 3)];
    const p = box(g, width, 0.07, 0.29, (rand() - 0.5) * 0.06, deckY - 0.035, z, tone);
    p.rotation.y = (rand() - 0.5) * 0.04;
  }
  for (const x of [-width / 2 + 0.15, width / 2 - 0.15]) {
    box(g, 0.12, 0.16, len, x, deckY - 0.15, len / 2, '#6a4f37');
    for (let z = 0; z <= len + 0.01; z += 2.2) cyl(g, 0.12, deckY + 2.2, x, (deckY - 2.2) / 2, z, '#4a3a2c');
  }
  // Bollards at the end.
  for (const x of [-width / 2 + 0.25, width / 2 - 0.25]) cyl(g, 0.12, 0.35, x, deckY + 0.17, len - 0.2, '#3a3530');
  parent.add(g);
  return g;
}

/** Merge lit panes into one always-bright mesh (one draw call). */
function mergeLit(group: THREE.Group, panes: THREE.Mesh[], name: string): void {
  if (!panes.length) return;
  const geo = bakeGeometry(panes, group);
  panes.forEach((p) => p.removeFromParent());
  if (!geo) return;
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  m.name = name;
  group.add(m);
}

// ---------------------------------------------------------------------------
// The fisherman's house at the start, with a boathouse and the first jetty
// ---------------------------------------------------------------------------

export function buildFishingCabin(field: HeightField): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Cabin';
  const rand = mulberry32(17);
  const ground = field.height(CABIN_SITE.x, CABIN_SITE.z);

  // The house stands at the water's edge beside the jetty, on stilts where the ground dips.
  const hx = -14.5;
  const hz = 9.5;
  const hGround = field.height(hx, hz);
  const main = house(
    {
      w: 4.4, d: 5.4, h: 2.5, pitch: 1.9, wall: '#8e2f23', trim: '#efe9de', roof: 'turf',
      floor: Math.max(hGround, 0) + 0.5, stiltDepth: hGround > 0.6 ? 0 : -Math.min(hGround, 0) + 0.8, deck: 1.6, windowsFront: 2, windowsSide: 2, lit: [0], door: true, chimney: true, ladder: false,
    },
    rand,
  );
  main.group.position.set(hx, 0, hz);
  // Gable and deck toward the jetty and the water.
  main.group.rotation.y = 0.7;
  g.add(main.group);
  // The first lit window is the one the scene makes glow at dusk.
  if (main.lit[0]) main.lit[0].name = 'CabinWindow';

  // Boathouse (naust) at the waterline, gable and big doors to the water.
  const bx = -24.5;
  const bz = -3.5;
  const bGround = field.height(bx, bz);
  const naustFloor = Math.max(bGround, 0) + 0.35;
  const naust = house(
    {
      w: 3.6, d: 5.0, h: 2.1, pitch: 1.5, wall: '#c48a35', trim: '#efe9de', roof: 'slate',
      floor: naustFloor, stiltDepth: Math.max(0.4, -Math.min(bGround, 0) + 0.8), deck: 0, windowsFront: 0, windowsSide: 1, lit: [], door: true, chimney: false, ladder: false,
    },
    rand,
  );
  naust.group.position.set(bx, 0, bz);
  naust.group.rotation.y = 0.9;
  g.add(naust.group);

  // Jetty from the shore out to the boat's berth (route start is just off its end).
  plankJetty(g, new THREE.Vector3(-11, 0, 6.2), new THREE.Vector3(0.6, 0, 8.6), 1.8, 0.85, rand);
  const cabinLights: THREE.Mesh[] = [];
  cabinLights.push(lantern(g, 0.2, 0.85, 7.7, LIT));
  barrel(g, -8.4, 0.85, 6.4, rand);
  barrel(g, -7.8, 0.85, 7.1, rand);
  crate(g, -6.6, 0.85, 7.4, rand);

  // Drying net and fish rack beside the house.
  dryingNet(g, CABIN_SITE.x - 1.5, field.height(CABIN_SITE.x - 1.5, CABIN_SITE.z + 9.5), CABIN_SITE.z + 9.5, 0.2);
  fishRack(g, CABIN_SITE.x - 5.5, field.height(CABIN_SITE.x - 5.5, CABIN_SITE.z + 4), CABIN_SITE.z + 4, 1.0);

  // An upturned faering on the shore, the same build as the sailing boat.
  const dinghy = new THREE.Mesh(NORDIC.hull(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  dinghy.scale.setScalar(0.62);
  dinghy.rotation.set(0, 0.5, Math.PI);
  dinghy.position.set(CABIN_SITE.x - 1, ground + 0.48, CABIN_SITE.z + 4);
  g.add(dinghy);

  mergeLit(g, cabinLights, 'CabinLights');
  return g;
}

// ---------------------------------------------------------------------------
// The harbour: a row of houses on stilts over the water, the jetty, the quay
// ---------------------------------------------------------------------------

export function buildFishingHarbour(field: HeightField): HarbourParts {
  const g = new THREE.Group();
  g.name = 'Harbour';
  const q = HARBOUR_SITE;
  const rand = mulberry32(29);
  const quayY = Math.max(1.0, field.height(q.x, q.z));
  const lit: THREE.Mesh[] = [];

  // Quay along the shore, with a darker course of stones at the waterline.
  box(g, 46, 2.6, 8, q.x, quayY - 1.2, q.z + 6, '#a39a8e');
  for (let x = -22; x < 22; x += 2.1) box(g, 2.0, 0.9, 0.5, q.x + x + 1, quayY - 2.0, q.z + 10.1, rand() > 0.5 ? '#857c71' : '#776f65');
  box(g, 46, 0.12, 0.4, q.x, quayY + 0.06, q.z + 9.8, '#c2b9ab');

  // Breakwater arms and the lighthouse on the left one.
  for (const k of [-1, 1]) {
    const arm = box(g, 4, 2.2, 30, q.x + k * 24, 0.3, q.z + 26, '#8b8277');
    arm.rotation.y = k * 0.18;
  }
  const lh = new THREE.Group();
  lh.position.set(q.x - 27, 1.4, q.z + 40);
  cyl(lh, 1.15, 7, 0, 3.5, 0, '#f1ebe0', 10).scale.set(1, 1, 1);
  cyl(lh, 1.18, 1.3, 0, 3.0, 0, '#a8432a', 10);
  cyl(lh, 1.18, 0.9, 0, 5.6, 0, '#a8432a', 10);
  cyl(lh, 1.5, 0.15, 0, 7.05, 0, '#3a3530', 10);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.9, 8), LIT);
  lamp.position.y = 7.6;
  lh.add(lamp);
  lit.push(lamp);
  const lhTop = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.9, 8), lambert('#a8432a'));
  lhTop.position.y = 8.5;
  lh.add(lhTop);
  g.add(lh);

  // Houses on stilts over the water, gables to the lake, in two groups either side of the jetty.
  const waterHouses: [number, Partial<HouseSpec>][] = [
    [-21, { wall: '#c48a35', roof: 'turf', h: 2.7, pitch: 2.0, lit: [1] }],
    [-16.2, { wall: '#8e2f23', roof: 'slate', h: 3.1, pitch: 2.1, lit: [] }],
    [8, { wall: '#ece6da', trim: '#2f3d3a', roof: 'tile', h: 2.8, pitch: 1.9, lit: [0] }],
    [12.8, { wall: '#5d7486', roof: 'turf', h: 2.6, pitch: 1.8, lit: [] }],
    [17.6, { wall: '#d9b24a', roof: 'slate', h: 3.0, pitch: 2.2, lit: [2] }],
  ];
  for (const [x, spec] of waterHouses) {
    const hs = house(
      {
        w: 4.2, d: 5.6, h: 2.8, pitch: 2.0, wall: '#8e2f23', trim: '#efe9de', roof: 'slate',
        floor: quayY + 0.15, stiltDepth: 2.2, deck: 1.4, windowsFront: 2, windowsSide: 2, lit: [], door: true, chimney: rand() > 0.4, ladder: true,
        ...spec,
      },
      rand,
    );
    hs.group.position.set(q.x + x, 0, q.z + 12.6);
    g.add(hs.group);
    lit.push(...hs.lit);
    barrel(g, q.x + x - 1.4, quayY + 0.15, q.z + 16.1, rand);
  }

  // A second row on land behind the quay.
  const landHouses: [number, Partial<HouseSpec>][] = [
    [-14, { wall: '#56705a', roof: 'tile', w: 5, h: 2.8, lit: [] }],
    [-6.5, { wall: '#8e2f23', roof: 'slate', w: 4.4, h: 4.3, pitch: 2.3, windowsFront: 3, lit: [3] }],
    [1.5, { wall: '#c48a35', roof: 'turf', w: 4.6, h: 2.7, lit: [] }],
    [9.5, { wall: '#ece6da', trim: '#2f3d3a', roof: 'tile', w: 4.2, h: 3.2, lit: [1] }],
  ];
  for (const [x, spec] of landHouses) {
    const z = q.z - 3.5;
    const hs = house(
      {
        w: 4.4, d: 5.2, h: 2.8, pitch: 2.0, wall: '#8e2f23', trim: '#efe9de', roof: 'slate',
        floor: 0.3, stiltDepth: 0, deck: 0, windowsFront: 2, windowsSide: 2, lit: [], door: true, chimney: true, ladder: false,
        ...spec,
      },
      rand,
    );
    hs.group.position.set(q.x + x, Math.max(quayY, field.height(q.x + x, z)), z);
    g.add(hs.group);
    lit.push(...hs.lit);
  }

  // The jetty where the boat berths (route end), lanterns along it.
  plankJetty(g, new THREE.Vector3(q.x - 4, 0, q.z + 9), new THREE.Vector3(q.x - 4, 0, q.z + 37), 2.4, quayY - 0.05, rand);
  const lamps: THREE.Mesh[] = [];
  const off = new THREE.MeshBasicMaterial({ color: '#6b6258' });
  [14, 19.5, 25, 30.5, 36].forEach((z, i) => {
    const x = q.x - 4 + (i % 2 ? 1.05 : -1.05);
    lamps.push(lantern(g, x, quayY - 0.05, q.z + z, off.clone(), 'HarbourLamp'));
  });

  // Life on the quay: barrels, crates, drying nets.
  for (let i = 0; i < 6; i++) barrel(g, q.x - 9 + (rand() - 0.5) * 2, quayY, q.z + 8 + (rand() - 0.5) * 1.4, rand);
  for (let i = 0; i < 5; i++) crate(g, q.x + 1 + rand() * 2.4, quayY, q.z + 7.8 + rand() * 1.4, rand);
  dryingNet(g, q.x - 11, quayY, q.z + 4.5, 0);
  dryingNet(g, q.x + 4.5, quayY, q.z + 4.2, 0.1);

  // Sign posts; the sign itself is made by the harbour moment.
  const signAnchor = new THREE.Object3D();
  signAnchor.position.set(q.x - 4, quayY + 6.6, q.z + 7.6);
  for (const k of [-1, 1]) cyl(g, 0.17, 8, signAnchor.position.x + k * 7.6, quayY + 4, signAnchor.position.z, '#5d4130');
  g.add(signAnchor);

  mergeLit(g, lit, 'HarbourWindows');
  return { group: g, lamps, signAnchor };
}
