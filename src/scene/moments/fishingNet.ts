/**
 * Moment: Web. A fishing net ("sieć", the same word as web in Polish) hangs between two poles
 * beside the stop. As the boat arrives, its knots light up one after another from the corner
 * nearest the boat, like nodes joining a network, and small packets of light start hopping
 * along the threads from knot to knot.
 * Built from stock materials (lines, points, Lambert), so it adds no lights and keeps the fog.
 * It fades in with the stop, like the other moments, so it doesn't clutter the stops around it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Moment, MomentContext } from './types';

const WIDTH = 7.5;
const TOP = 4.4; // height of the cork line above the water
const BOTTOM = 0.35;
const SAG = 0.35; // the cork line dips between the poles
const COLS = 23;
const ROWS = 13;
const PACKETS = 16;
const HOP = 0.28; // seconds per hop along a thread

const ROPE = new THREE.Color('#3b3027');
const LIT = new THREE.Color('#ffc66e');
const PACKET = new THREE.Color('#fff1d2');

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,210,1)');
  grad.addColorStop(0.3, 'rgba(255,200,120,0.5)');
  grad.addColorStop(1, 'rgba(255,180,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function create(ctx: MomentContext): Moment {
  const root = new THREE.Group();
  root.name = 'WebNet';
  // To port of the stop and ahead of it, facing back toward the boat and the camera behind it;
  // closer in on a phone, whose narrow frame would leave it off the edge.
  const place = (portrait: boolean) => {
    const [ahead, side] = portrait ? [12, 4.6] : [18, 9];
    const at = ctx.route.sample(ctx.anchorS + ahead);
    root.position.set(at.x + at.tz * side, 0, at.z - at.tx * side);
    root.rotation.y = Math.atan2(-at.tx, -at.tz);
  };
  place(false);
  ctx.scene.add(root);

  // Knots on a diamond lattice: a knot wherever column + row is even.
  const index = new Map<number, number>();
  const rest: THREE.Vector3[] = [];
  const sway: number[] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      if ((i + j) % 2) continue;
      const u = i / (COLS - 1);
      const v = j / (ROWS - 1);
      const top = TOP - SAG * 4 * u * (1 - u);
      const bottom = BOTTOM + 0.25 * 4 * u * (1 - u);
      const y = top + (bottom - top) * v;
      // The net bellies out a little in the middle.
      const z = -Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.5;
      index.set(j * COLS + i, rest.length);
      rest.push(new THREE.Vector3((u - 0.5) * WIDTH, y, z));
      sway.push(v); // the bottom moves more than the cork line
    }
  }
  const count = rest.length;
  const neighbours: number[][] = rest.map(() => []);
  const edges: [number, number][] = [];
  for (let j = 0; j < ROWS - 1; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = index.get(j * COLS + i);
      if (a === undefined) continue;
      for (const di of [-1, 1]) {
        const b = index.get((j + 1) * COLS + i + di);
        if (b === undefined || i + di < 0 || i + di >= COLS) continue;
        edges.push([a, b]);
        neighbours[a].push(b);
        neighbours[b].push(a);
      }
    }
  }

  // Hops from the bottom corner nearest the boat (starboard end): the order the knots light up.
  const source = rest.reduce((best, p, k) => (p.x - p.y > rest[best].x - rest[best].y ? k : best), 0);
  const hops = new Array<number>(count).fill(Infinity);
  hops[source] = 0;
  const queue = [source];
  while (queue.length) {
    const a = queue.shift()!;
    for (const b of neighbours[a]) {
      if (hops[b] > hops[a] + 1) {
        hops[b] = hops[a] + 1;
        queue.push(b);
      }
    }
  }
  const maxHops = Math.max(...hops.filter(Number.isFinite));

  // Threads.
  const linePos = new Float32Array(edges.length * 6);
  const lineCol = new Float32Array(edges.length * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
  const threadMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true });
  const threads = new THREE.LineSegments(lineGeo, threadMaterial);
  threads.frustumCulled = false;

  // Knots and packets: soft additive glows.
  const glow = glowTexture();
  const pointMaterial = (size: number) =>
    new THREE.PointsMaterial({
      map: glow,
      size,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  const knotPos = new Float32Array(count * 3);
  const knotCol = new Float32Array(count * 3);
  const knotGeo = new THREE.BufferGeometry();
  knotGeo.setAttribute('position', new THREE.BufferAttribute(knotPos, 3).setUsage(THREE.DynamicDrawUsage));
  knotGeo.setAttribute('color', new THREE.BufferAttribute(knotCol, 3).setUsage(THREE.DynamicDrawUsage));
  const knots = new THREE.Points(knotGeo, pointMaterial(0.55));
  knots.frustumCulled = false;
  const packetPos = new Float32Array(PACKETS * 3);
  const packetCol = new Float32Array(PACKETS * 3);
  const packetGeo = new THREE.BufferGeometry();
  packetGeo.setAttribute('position', new THREE.BufferAttribute(packetPos, 3).setUsage(THREE.DynamicDrawUsage));
  packetGeo.setAttribute('color', new THREE.BufferAttribute(packetCol, 3).setUsage(THREE.DynamicDrawUsage));
  const packets = new THREE.Points(packetGeo, pointMaterial(0.9));
  packets.frustumCulled = false;

  // Poles and the cork floats along the top line, one merged mesh.
  const wood = new THREE.Color('#5b4030');
  const cork = new THREE.Color('#c9773b');
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(paint(new THREE.CylinderGeometry(0.09, 0.12, TOP + 2.2, 6).translate(side * (WIDTH / 2 + 0.12), (TOP + 2.2) / 2 - 1.6, 0), wood));
  }
  for (let i = 0; i < COLS; i += 2) {
    const k = index.get(i)!;
    const p = rest[k];
    parts.push(paint(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 6).rotateZ(Math.PI / 2).translate(p.x, p.y + 0.06, p.z), cork));
  }
  const frameMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true });
  const frame = new THREE.Mesh(mergeGeometries(parts)!, frameMaterial);

  root.add(frame, threads, knots, packets);

  // Packets walk the lattice: each hops to a random neighbour, never straight back.
  const walkers = Array.from({ length: PACKETS }, (_, k) => ({ from: (k * 37) % count, to: neighbours[(k * 37) % count][0] ?? 0, t: (k / PACKETS) * HOP, prev: -1 }));
  const now = rest.map((p) => p.clone());
  const lit = new Float32Array(count);
  let weightNow = 0;

  return {
    warmup: [root],

    update(frame, weight) {
      weightNow = weight;
      root.visible = weight > 0.01;
      if (!root.visible) return;
      const fade = Math.min(1, weight * 3);
      threadMaterial.opacity = fade;
      frameMaterial.opacity = fade;
      const time = frame.time;
      // Wind sway, stronger toward the bottom of the net.
      for (let k = 0; k < count; k++) {
        const p = rest[k];
        now[k].set(p.x, p.y, p.z + Math.sin(time * 0.9 + p.x * 0.5) * 0.12 * sway[k]);
      }
      // Knots light up hop by hop as the boat arrives, then twinkle.
      const reveal = smoothstep(0.15, 0.85, weight) * (maxHops + 3);
      for (let k = 0; k < count; k++) {
        const on = Math.min(1, Math.max(0, (reveal - hops[k]) / 3));
        lit[k] = on * (0.8 + 0.2 * Math.sin(time * 2.6 + k * 1.7));
      }
      knots.visible = weight > 0.01;
      packets.visible = weight > 0.4;

      for (let e = 0; e < edges.length; e++) {
        const [a, b] = edges[e];
        now[a].toArray(linePos, e * 6);
        now[b].toArray(linePos, e * 6 + 3);
        // A thread glows once both its knots are lit.
        const c = Math.min(lit[a], lit[b]) * 0.85;
        const r = ROPE.r + (LIT.r - ROPE.r) * c;
        const g = ROPE.g + (LIT.g - ROPE.g) * c;
        const bl = ROPE.b + (LIT.b - ROPE.b) * c;
        lineCol[e * 6] = lineCol[e * 6 + 3] = r;
        lineCol[e * 6 + 1] = lineCol[e * 6 + 4] = g;
        lineCol[e * 6 + 2] = lineCol[e * 6 + 5] = bl;
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;

      if (knots.visible) {
        for (let k = 0; k < count; k++) {
          now[k].toArray(knotPos, k * 3);
          knotCol[k * 3] = LIT.r * lit[k];
          knotCol[k * 3 + 1] = LIT.g * lit[k];
          knotCol[k * 3 + 2] = LIT.b * lit[k];
        }
        knotGeo.attributes.position.needsUpdate = true;
        knotGeo.attributes.color.needsUpdate = true;
      }

      if (packets.visible) {
        const strength = smoothstep(0.4, 0.9, weight);
        walkers.forEach((w, k) => {
          w.t += frame.dt;
          while (w.t >= HOP) {
            w.t -= HOP;
            const options = neighbours[w.to].filter((n) => n !== w.from);
            w.prev = w.from;
            w.from = w.to;
            w.to = options.length ? options[Math.floor(Math.random() * options.length)] : w.prev;
          }
          const f = w.t / HOP;
          const a = now[w.from];
          const b = now[w.to];
          packetPos[k * 3] = a.x + (b.x - a.x) * f;
          packetPos[k * 3 + 1] = a.y + (b.y - a.y) * f;
          packetPos[k * 3 + 2] = a.z + (b.z - a.z) * f;
          // Only where the net is already lit.
          const s = strength * Math.min(lit[w.from], lit[w.to]);
          packetCol[k * 3] = PACKET.r * s;
          packetCol[k * 3 + 1] = PACKET.g * s;
          packetCol[k * 3 + 2] = PACKET.b * s;
        });
        packetGeo.attributes.position.needsUpdate = true;
        packetGeo.attributes.color.needsUpdate = true;
      }
    },

    resize(width, height) {
      place(width / height < 0.8);
    },

    debugInfo: () => `net ${Math.round(weightNow * 100)}% · ${count} knots`,

    dispose() {
      ctx.scene.remove(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      glow.dispose();
    },
  };
}
