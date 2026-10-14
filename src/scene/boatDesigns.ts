/**
 * Boat designs: hull geometry plus rig dimensions. The Boat class (boat.ts) builds the spars and
 * the wind-driven sail from the rig, so every design sails on the same apparent-wind model.
 *
 * Local frame: bow toward -z, starboard +x, up +y, origin on the waterline amidships.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Rig {
  /** Mast position along the hull and its height above the waterline. */
  mastZ: number;
  mastFoot: number;
  mastTop: number;
  /** Boom pivot height and boom length (aft from the mast). */
  boomHeight: number;
  boomLength: number;
  /** Luff (sail edge along the mast) from the boom up. */
  luff: number;
  /** Gaff spar for a four-sided sail, or null for a triangular sail. */
  gaff: { length: number; angle: number } | null;
  /** How far the leech bows out between clew and head. */
  roach: number;
  sailColor: string;
  sparColor: string;
  /** Vertical sailcloth panels (alternating tone). */
  panels: boolean;
  /** Small flag at the masthead that streams with the apparent wind. */
  flag: string | null;
  /** Forestay and shrouds. */
  rigging: boolean;
}

export interface BoatDesign {
  name: string;
  /** One vertex-coloured geometry for the whole hull (strakes, stems, seats, rudder...). */
  hull(): THREE.BufferGeometry;
  rig: Rig;
  /** Bow and stern stem tops, for the forestay. */
  stemTop: THREE.Vector3;
  /** Gunwale points abreast the mast, for the shrouds. */
  chainplateY: number;
  chainplateX: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A box between two points (for stems, rails, oars), with a colour. */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, color: string): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len).toNonIndexed();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return paint(g, color);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z), color);
}

function paint(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
  return g;
}

function finish(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Nordic: a clinker-built double-ender (like a Norwegian faering) with an ochre gaff sail
// ---------------------------------------------------------------------------

const HALF_LENGTH = 2.3;
const HALF_BEAM = 0.8;
const STRAKES = 5;

/** Hull lines: half-width, sheer (gunwale) height and keel height at t = z / HALF_LENGTH (-1 bow … 1 stern). */
const halfWidth = (t: number) => HALF_BEAM * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.1)), 0.62);
const sheer = (t: number) => 0.4 + 0.42 * Math.pow(Math.abs(t), 3);
const keel = (t: number) => -0.34 + 0.52 * Math.pow(Math.abs(t), 4);

/** A point on the hull section at t, a ∈ [0, 1] from keel to gunwale (starboard side). */
function section(t: number, a: number): THREE.Vector2 {
  const w = halfWidth(t);
  const s = sheer(t);
  const k = keel(t);
  const ang = (a * Math.PI) / 2;
  return new THREE.Vector2(w * Math.sin(ang), k + (s - k) * (1 - Math.cos(ang)));
}

/** Outward normal of the section curve (in the x-y plane). */
function sectionNormal(t: number, a: number): THREE.Vector2 {
  const e = 0.01;
  const p0 = section(t, Math.max(0, a - e));
  const p1 = section(t, Math.min(1, a + e));
  const tx = p1.x - p0.x;
  const ty = p1.y - p0.y;
  const len = Math.hypot(tx, ty) || 1;
  return new THREE.Vector2(ty / len, -tx / len);
}

function nordicHull(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const push = (p: number[], c: THREE.Color) => {
    pos.push(...p);
    col.push(c.r, c.g, c.b);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
    // a-b along z at the lower edge, c-d along z at the upper edge.
    push(a, color), push(c, color), push(b, color);
    push(b, color), push(c, color), push(d, color);
  };

  // Tarred dark planks, a painted sheer strake, a pale gunwale cap.
  const woods = ['#6a4529', '#77502f', '#6e4a2c', '#7d5634'].map((h) => new THREE.Color(h));
  const sheerStrake = new THREE.Color('#7d3324');
  const cap = new THREE.Color('#b98c5c');
  const lap = 0.022; // clinker: each plank's lower edge stands proud of the one below

  const NZ = 22;
  for (let i = 0; i < NZ; i++) {
    const t0 = -1 + (2 * i) / NZ;
    const t1 = -1 + (2 * (i + 1)) / NZ;
    const z0 = t0 * HALF_LENGTH;
    const z1 = t1 * HALF_LENGTH;
    for (let j = 0; j < STRAKES; j++) {
      const a0 = j / STRAKES;
      const a1 = (j + 1) / STRAKES;
      const color = j === STRAKES - 1 ? sheerStrake : woods[(j + i * 0) % woods.length];
      const off = j === 0 ? 0 : lap;
      for (const side of [1, -1]) {
        const lo0 = section(t0, a0).addScaledVector(sectionNormal(t0, a0), off * Math.min(1, halfWidth(t0) * 4));
        const lo1 = section(t1, a0).addScaledVector(sectionNormal(t1, a0), off * Math.min(1, halfWidth(t1) * 4));
        const hi0 = section(t0, a1);
        const hi1 = section(t1, a1);
        const P = (v: THREE.Vector2, z: number) => [side * v.x, v.y, z];
        if (side === 1) quad(P(lo0, z0), P(lo1, z1), P(hi0, z0), P(hi1, z1), color);
        else quad(P(lo1, z1), P(lo0, z0), P(hi1, z1), P(hi0, z0), color);
      }
    }
    // Gunwale cap: a flat strip on top of the sheer strake.
    for (const side of [1, -1]) {
      const g0 = section(t0, 1);
      const g1 = section(t1, 1);
      const in0 = Math.max(0, g0.x - 0.07);
      const in1 = Math.max(0, g1.x - 0.07);
      const a = [side * g0.x, g0.y + 0.012, z0];
      const b = [side * g1.x, g1.y + 0.012, z1];
      const c = [side * in0, g0.y + 0.012, z0];
      const d = [side * in1, g1.y + 0.012, z1];
      if (side === 1) quad(a, b, c, d, cap);
      else quad(b, a, d, c, cap);
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

  const parts: THREE.BufferGeometry[] = [shell];
  const stem = '#3e2618';
  // Stems: curved posts rising above the sheer at bow and stern.
  for (const dir of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 6; k++) {
      const s = k / 6;
      const y = keel(1) - 0.05 + s * (sheer(1) + 0.3 - keel(1) + 0.05);
      const z = dir * (HALF_LENGTH + 0.04 + Math.pow(s, 2) * 0.16);
      pts.push(new THREE.Vector3(0, y, z));
    }
    for (let k = 0; k < pts.length - 1; k++) parts.push(beam(pts[k], pts[k + 1], 0.08, 0.1, stem));
  }
  // Keel strip along the bottom.
  for (let i = 0; i < 8; i++) {
    const ta = -0.95 + (1.9 * i) / 8;
    const tb = -0.95 + (1.9 * (i + 1)) / 8;
    parts.push(beam(new THREE.Vector3(0, keel(ta) - 0.03, ta * HALF_LENGTH), new THREE.Vector3(0, keel(tb) - 0.03, tb * HALF_LENGTH), 0.07, 0.07, stem));
  }
  // Inside: floorboards, three thwarts, a mast thwart.
  parts.push(box(0.55, 0.04, 3.0, 0, keel(0) + 0.16, 0, '#9b7148'));
  for (const z of [-0.95, 0.15, 1.15]) {
    const t = z / HALF_LENGTH;
    const w = halfWidth(t) * 2 * 0.9;
    parts.push(box(w, 0.05, 0.26, 0, sheer(t) - 0.12, z, '#b48756'));
  }
  // Oars resting along the thwarts.
  for (const x of [-0.28, 0.28]) {
    parts.push(beam(new THREE.Vector3(x, 0.32, -1.5), new THREE.Vector3(x * 1.2, 0.36, 1.4), 0.045, 0.045, '#c9a06b'));
    parts.push(box(0.14, 0.02, 0.5, x * 1.2, 0.36, 1.45, '#c9a06b'));
  }
  // Rudder hung on the sternpost, with a tiller.
  parts.push(box(0.05, 0.78, 0.3, 0, 0.12, HALF_LENGTH + 0.27, '#4a2f1d'));
  parts.push(beam(new THREE.Vector3(0, 0.62, HALF_LENGTH + 0.2), new THREE.Vector3(0, 0.66, HALF_LENGTH - 0.7), 0.05, 0.05, '#b48756'));
  return finish(parts);
}

export const NORDIC: BoatDesign = {
  name: 'nordic',
  hull: nordicHull,
  rig: {
    mastZ: -0.95,
    mastFoot: 0.1,
    mastTop: 5.9,
    boomHeight: 1.15,
    boomLength: 2.95,
    luff: 3.0,
    gaff: { length: 2.3, angle: (50 * Math.PI) / 180 },
    roach: 0.12,
    sailColor: '#dca456',
    sparColor: '#5a3c26',
    panels: true,
    flag: '#b5332a',
    rigging: true,
  },
  stemTop: new THREE.Vector3(0, sheer(1) + 0.3, -(HALF_LENGTH + 0.2)),
  chainplateY: sheer(-0.95 / HALF_LENGTH) + 0.01,
  chainplateX: halfWidth(-0.95 / HALF_LENGTH),
};
